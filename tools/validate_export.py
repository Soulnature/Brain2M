"""Audit every exported pair against its SQLite source and reverse index."""
from pathlib import Path
import gzip,json,sqlite3,hashlib,time
import numpy as np,pandas as pd
from export_associations import RECORD_DTYPE,ROWS
ROOT=Path(__file__).resolve().parents[1]

def main():
    begin=time.monotonic();out=ROOT/'data/associations';meta=json.loads((out/'manifest.json').read_text());n=meta['significant_pairs'];nv=meta['source_voxels'];ns=meta['significant_SNPs']
    source=ROOT.parent/'Brain2M_resource_portal_20261022/data'
    soff=np.frombuffer(gzip.decompress((out/'snp-offsets.u32.gz').read_bytes()),dtype='<u4');voff=np.frombuffer(gzip.decompress((out/'voxel-offsets.u32.gz').read_bytes()),dtype='<u4')
    a=np.memmap(ROOT/'tools/.export_cache/audited_snp.bin',mode='w+',dtype=RECORD_DTYPE,shape=(n,))
    for start in range(0,n,ROWS):
        block=np.frombuffer(gzip.decompress((out/'snp'/f'{start//ROWS:04d}.bin.gz').read_bytes()),dtype=RECORD_DTYPE);assert len(block)==min(ROWS,n-start);a[start:start+len(block)]=block
    a.flush();sid=np.repeat(np.arange(ns,dtype='uint64'),np.diff(soff));keys=sid*nv+a['other'];assert np.all(keys[1:]>keys[:-1]);assert (a['lp']>meta['threshold_logP']).all()
    conn=sqlite3.connect((source/'resource.sqlite').as_uri()+'?mode=ro',uri=True);written=0
    for chunk in pd.read_sql_query('SELECT s,v,t,logp FROM pairs WHERE allele_match=1 AND logp>? ORDER BY s,v',conn,params=(meta['threshold_logP'],),chunksize=250000):
        z=a[written:written+len(chunk)];assert np.array_equal(sid[written:written+len(chunk)],chunk.s)
        assert np.array_equal(z['other'],chunk.v)and np.array_equal(z['t'],chunk.t.astype(np.float32))and np.array_equal(z['lp'],chunk.logp)
        written+=len(chunk)
    conn.close();assert written==n;print(f'All {n:,} SNP-indexed records match the original source.',flush=True)
    previous=-1
    for start in range(0,n,ROWS):
        z=np.frombuffer(gzip.decompress((out/'voxel'/f'{start//ROWS:04d}.bin.gz').read_bytes()),dtype=RECORD_DTYPE);v=np.searchsorted(voff,np.arange(start,start+len(z)),side='right')-1
        k=z['other'].astype('uint64')*nv+v;ix=np.searchsorted(keys,k);assert (ix<n).all()and np.array_equal(keys[ix],k)
        assert np.array_equal(a['t'][ix],z['t'])and np.array_equal(a['lp'][ix],z['lp'])
        reversekeys=v.astype('uint64')*ns+z['other'];assert reversekeys[0]>previous and np.all(reversekeys[1:]>reversekeys[:-1]);previous=int(reversekeys[-1])
        if start//ROWS%25==0:print(f'Reverse-index audit shard {start//ROWS+1}/77',flush=True)
    for asset in meta['assets']:
        p=ROOT/asset['file'];assert p.stat().st_size==asset['compressed_bytes']and hashlib.sha256(p.read_bytes()).hexdigest()==asset['sha256']
    result={'status':'pass','source_pairs_compared':n,'reverse_pairs_compared':n,'source_coordinates':nv,'source_SNPs':ns,'significant_voxels':int((np.diff(voff)>0).sum()),'all_source_and_reverse_T_and_logP_match':True,'unique_source_pair_keys':True,'unique_reverse_pair_keys':True,'all_asset_hashes_match':True,'elapsed_seconds':time.monotonic()-begin}
    (ROOT/'qa/ALL_PAIR_DATA_AUDIT.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))

if __name__=='__main__':main()
