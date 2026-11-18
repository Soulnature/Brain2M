"""Export the real significant-pair resource as bounded static gzip shards."""
from pathlib import Path
import argparse, gzip, hashlib, json, sqlite3, time
import numpy as np
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
RECORD_DTYPE=np.dtype([('other','<u4'),('t','<f4'),('lp','<f8')])
ROWS=262144

def encode_records(ids,t,lp):
    if len(ids)!=len(t)or len(ids)!=len(lp):raise ValueError('Record lengths differ')
    a=np.empty(len(ids),dtype=RECORD_DTYPE);a['other']=ids;a['t']=t;a['lp']=lp
    return a.tobytes()

def packed_coordinates(ijk,shape):
    xyz=np.asarray(ijk)
    if xyz.ndim!=2 or xyz.shape[1]!=3 or np.any(xyz<0)or np.any(xyz>=np.array(shape)):raise ValueError('Coordinates outside the native reference grid')
    return np.ravel_multi_index(xyz.T,shape).astype('<u4')

def gzwrite(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(gzip.compress(raw,compresslevel=6,mtime=0))
    return {'file':str(path.relative_to(ROOT)),'compressed_bytes':path.stat().st_size,'raw_bytes':len(raw),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT.parent/'Brain2M_resource_portal_20261022/data');args=parser.parse_args()
    source=args.source.resolve();out=ROOT/'data/associations';qa=ROOT/'qa';qa.mkdir(exist_ok=True);out.mkdir(parents=True,exist_ok=True)
    cache=ROOT/'tools/.export_cache';cache.mkdir(exist_ok=True)
    begin=time.monotonic();p=5e-8/2075298;cut=-np.log10(p);files=[]
    c=sqlite3.connect((source/'resource.sqlite').as_uri()+'?mode=ro',uri=True)
    variants=pd.read_sql_query('SELECT sid,snp,chr,bp,a1,a2,is_lead FROM variants ORDER BY sid',c)
    assert np.array_equal(variants.sid,np.arange(len(variants)))
    counts=pd.read_sql_query('SELECT s,COUNT(*) n FROM pairs WHERE allele_match=1 AND logp>? GROUP BY s ORDER BY s',c,params=(cut,))
    assert np.array_equal(counts.s,variants.sid)
    total=int(counts.n.sum());nv=len(np.load(source/'coordinates.npy',mmap_mode='r'));ns=len(variants)
    assert (ns,nv,total)==(60674,2075298,20018724)
    offsets=np.r_[0,counts.n.cumsum()].astype('<u4');raw=np.memmap(cache/'by_snp.bin',mode='w+',dtype=RECORD_DTYPE,shape=(total,));written=0
    for chunk in pd.read_sql_query('SELECT s,v,t,logp FROM pairs WHERE allele_match=1 AND logp>? ORDER BY s,v',c,params=(cut,),chunksize=250000):
        n=len(chunk);assert chunk.logp.gt(cut).all();raw['other'][written:written+n]=chunk.v;raw['t'][written:written+n]=chunk.t;raw['lp'][written:written+n]=chunk.logp;written+=n
        if written%5000000==0:print(f'Read {written:,}/{total:,} source pairs',flush=True)
    assert written==total;raw.flush()
    peaks=[]
    for sid in range(ns):
        a,b=map(int,offsets[sid:sid+2]);block=raw[a:b];k=int(np.argmax(block['lp']));peaks.append((int(block['other'][k]),float(block['t'][k]),float(block['lp'][k])))
    packed=packed_coordinates(np.load(source/'coordinates.npy'),(182,218,182))
    atlas=np.load(source/'atlas_brain2m120.npy',mmap_mode='r').ravel()[packed].astype('u1')
    rows=[]
    for v,n,pk in zip(variants.itertuples(index=False),counts.n,peaks):rows.append([v.sid,v.snp,v.chr,v.bp,v.a1,v.a2,int(n),*pk,int(v.is_lead)])
    region=[r for r in json.loads((source/'regions.json').read_text())if r['atlas']=='brain2m120'];assert len(region)==120
    genes=pd.read_sql_query('SELECT symbol,chr,start,end,source FROM genes ORDER BY symbol',c).to_dict(orient='records');c.close()
    files.append(gzwrite(out/'variants.json.gz',json.dumps(rows,separators=(',',':')).encode()))
    files.append(gzwrite(out/'coordinates.u32.gz',packed.tobytes()))
    files.append(gzwrite(out/'regions.u8.gz',atlas.tobytes()))
    files.append(gzwrite(out/'snp-offsets.u32.gz',offsets.tobytes()))
    # Native anatomical reference remains a static image volume, never an association substitute.
    template=np.load(source/'template.npy',mmap_mode='r');positive=template[np.isfinite(template)&(template>0)];ceiling=float(np.percentile(positive,99.5))
    image=np.nan_to_num(np.clip(template/ceiling,0,1),nan=0).astype(float);image=np.rint(image*255).astype('u1')
    files.append(gzwrite(out/'template.u8.gz',image.tobytes()))
    ijk=np.stack(np.unravel_index(packed,(182,218,182)),axis=1)
    preview=np.flatnonzero((ijk%3==0).all(axis=1));preview=np.unique(np.r_[preview,np.array(peaks)[:,0].astype(int)]).astype('<u4')
    files.append(gzwrite(out/'preview-ids.u32.gz',preview.tobytes()))
    for a in range(0,total,ROWS):
        files.append(gzwrite(out/'snp'/f'{a//ROWS:04d}.bin.gz',raw[a:a+ROWS].tobytes()))
        if a//ROWS%20==0:print(f'Wrote SNP shard {a//ROWS+1}/{(total+ROWS-1)//ROWS}',flush=True)
    voxelcounts=np.bincount(raw['other'],minlength=nv);voff=np.r_[0,voxelcounts.cumsum()].astype('<u4');files.append(gzwrite(out/'voxel-offsets.u32.gz',voff.tobytes()))
    # Stable sorting retains sid order within each voxel, matching the source pair keys.
    order=np.argsort(raw['other'],kind='stable');sids=np.repeat(np.arange(ns,dtype='<u4'),counts.n)
    for a in range(0,total,ROWS):
        sel=order[a:a+ROWS];files.append(gzwrite(out/'voxel'/f'{a//ROWS:04d}.bin.gz',encode_records(sids[sel],raw['t'][sel],raw['lp'][sel])))
        if a//ROWS%20==0:print(f'Wrote voxel shard {a//ROWS+1}/{(total+ROWS-1)//ROWS}',flush=True)
    cases=[]
    for rsid in ['rs13107325','rs2286571','rs429358']:
        row=variants[variants.snp.eq(rsid)].iloc[0];sid=int(row.sid);cases.extend([{'type':'voxel','label':f'{rsid} peak','idx':peaks[sid][0]},{'type':'snp','label':rsid,'sid':sid}])
    manifest={'format_version':1,'build_date':'2026-11-17','significant_pairs':total,'significant_SNPs':ns,'source_voxels':nv,'significant_voxels':int((voxelcounts>0).sum()),'preview_voxels':len(preview),'threshold_P':p,'threshold_logP':cut,'genome_build':'GRCh37/hg19','native_shape':[182,218,182],'native_affine':[[-1,0,0,90],[0,1,0,-126],[0,0,1,-72],[0,0,0,1]],'atlas':'Brain2M 120 regions (83 GM + 37 WM)','regions':region,'genes':genes,'cases':cases,'rows_per_shard':ROWS,'record_bytes':16,'record_layout':'little-endian uint32 otherID; float32 T; float64 stored -log10(P)','variant_columns':['sid','rsid','chr','bp','a1','a2','n_pairs','peak_voxel','peak_t','peak_logp','is_lead'],'assets':files,'exclusions':{'rounded_boundary_source_records':197,'alternate_map_allele_source_records':1676},'scope':'All unique map-allele-matched source pairs passing the exact threshold. Missing pairs are not imputed. Three-dimensional anatomy is sampled; native 1-mm coordinates and all qualifying pairs remain queryable.'}
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    (qa/'EXPORT_RECEIPT.json').write_text(json.dumps({'source_database':str(source/'resource.sqlite'),'source_coordinate_file':str(source/'coordinates.npy'),'source_database_bytes':(source/'resource.sqlite').stat().st_size,'source_database_mtime_ns':(source/'resource.sqlite').stat().st_mtime_ns,'source_coordinate_sha256':hashlib.sha256((source/'coordinates.npy').read_bytes()).hexdigest(),'counts':{k:manifest[k]for k in ['significant_pairs','significant_SNPs','source_voxels','significant_voxels','preview_voxels']},'compressed_data_bytes':sum(f['compressed_bytes']for f in files),'largest_static_shard_bytes':max(f['compressed_bytes']for f in files),'elapsed_seconds':time.monotonic()-begin,'source_modified':False},indent=2))
    print((qa/'EXPORT_RECEIPT.json').read_text(),flush=True)

if __name__=='__main__':main()
