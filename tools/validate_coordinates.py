"""Verify all native coordinates and atlas labels against source voxel rows."""
from pathlib import Path
import sqlite3,json,gzip
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1]

def main():
    data=ROOT/'data/associations';packed=np.frombuffer(gzip.decompress((data/'coordinates.u32.gz').read_bytes()),dtype='<u4');labels=np.frombuffer(gzip.decompress((data/'regions.u8.gz').read_bytes()),dtype='u1')
    assert np.unique(packed).size==len(packed)
    source=ROOT.parent/'Brain2M_resource_portal_20261022/data/resource.sqlite'
    c=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);n=0
    for chunk in pd.read_sql_query('SELECT v,i,j,k,brain2m120 FROM voxels ORDER BY v',c,chunksize=250000):
        v=chunk.v.to_numpy(int);p=(chunk.i.to_numpy(np.int64)*218+chunk.j.to_numpy(np.int64))*182+chunk.k.to_numpy(np.int64)
        assert np.array_equal(packed[v],p)and np.array_equal(labels[v],chunk.brain2m120.to_numpy());n+=len(v)
    c.close();assert n==len(packed)==2075298
    q={'status':'pass','source_voxels_checked':n,'all_native_coordinates_match_original_voxel_rows':True,'all_120_region_labels_match_original_voxel_rows':True,'unique_native_grid_positions':n,'source_modified':False}
    (ROOT/'qa/COORDINATE_ATLAS_AUDIT.json').write_text(json.dumps(q,indent=2));print(json.dumps(q,indent=2))
if __name__=='__main__':main()
