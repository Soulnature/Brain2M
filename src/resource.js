// Static, exact significant-association data. No inferred or synthetic P values.
const BASE = new URL('../data/associations/', import.meta.url);
const SUPER = {'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};

export function formatP(lp) {
  if (!Number.isFinite(lp)) return 'Not available';
  const e=-Math.ceil(lp);const mantissa=10**(-lp-e);
  return `${mantissa.toFixed(3)} × 10${String(e).split('').map(c=>SUPER[c]).join('')}`;
}
export function nativeIJK(packed,[,ny,nz]) {
  return [Math.floor(packed/(ny*nz)),Math.floor(packed/nz)%ny,packed%nz];
}
export function scenePosition([i,j,k]) { return [(i-90)/100,(k-72)/100-.05,(j-126)/100]; }
export function shardRanges(start,end,size) {
  if (!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||!Number.isInteger(size)||size<=0) throw new Error('Invalid association range');
  const result=[];
  for(let a=start;a<end;) {const shard=Math.floor(a/size),b=Math.min(end,(shard+1)*size);result.push({shard,start:a%size,end:b-shard*size});a=b;}
  return result;
}
export function decodeRecords(buffer,start=0,end=buffer.byteLength/16) {
  if (buffer.byteLength%16||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end*16>buffer.byteLength) throw new Error('Invalid association shard');
  const v=new DataView(buffer),out=[];
  for(let i=start;i<end;i++)out.push({other:v.getUint32(i*16,true),t:v.getFloat32(i*16+4,true),lp:v.getFloat64(i*16+8,true)});
  return out;
}
async function loadGzip(file) {
  const r=await fetch(new URL(file,BASE));if(!r.ok)throw new Error(`Data file ${file}: HTTP ${r.status}`);
  if(typeof DecompressionStream==='undefined')throw new Error('Please use a current browser with gzip decompression support.');
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export async function loadResource() {
  const response=await fetch(new URL('manifest.json',BASE));if(!response.ok)throw new Error(`Resource manifest: HTTP ${response.status}`);
  const meta=await response.json();if(meta.format_version!==1||meta.record_bytes!==16)throw new Error('Unsupported association data format');
  const names=['variants.json.gz','coordinates.u32.gz','snp-offsets.u32.gz','voxel-offsets.u32.gz','template.u8.gz','regions.u8.gz'];
  const buffers=await Promise.all(names.map(loadGzip));
  const variants=JSON.parse(new TextDecoder().decode(buffers[0]));
  if(!variants.every((v,s)=>v[0]===s&&typeof v[1]==='string'&&v[2]>=1&&v[2]<=22&&Number.isInteger(v[3]))) throw new Error('Variant IDs or genomic positions are invalid');
  const packed=new Uint32Array(buffers[1]),snpOffsets=new Uint32Array(buffers[2]),voxelOffsets=new Uint32Array(buffers[3]);
  const template=new Uint8Array(buffers[4]),regions=new Uint8Array(buffers[5]);
  if(variants.length!==meta.significant_SNPs||packed.length!==meta.source_voxels||snpOffsets.length!==variants.length+1||voxelOffsets.length!==packed.length+1||regions.length!==packed.length||template.length!==meta.native_shape.reduce((a,b)=>a*b,1)||snpOffsets.at(-1)!==meta.significant_pairs||voxelOffsets.at(-1)!==meta.significant_pairs) throw new Error('Resource arrays do not match their manifest');
  const byRsid=new Map(variants.map((v,s)=>[v[1].toLowerCase(),s]));
  const grid=new Int32Array(template.length).fill(-1);packed.forEach((p,id)=>{grid[p]=id;});
  const cache=new Map();const size=meta.rows_per_shard;
  async function chunk(axis,shard) {
    const key=`${axis}/${String(shard).padStart(4,'0')}.bin.gz`;
    if(cache.has(key)){const promise=cache.get(key);cache.delete(key);cache.set(key,promise);return promise;}
    const promise=loadGzip(key).then(b=>{
      const expected=Math.min(size,meta.significant_pairs-shard*size)*16;
      if(b.byteLength!==expected)throw new Error(`Incomplete data shard: ${key}`);
      return b;
    });
    cache.set(key,promise);if(cache.size>6)cache.delete(cache.keys().next().value);
    try{return await promise;}catch(e){cache.delete(key);throw e;}
  }
  async function pairs(axis,id) {
    const offsets=axis==='snp'?snpOffsets:voxelOffsets;
    if(!Number.isInteger(id)||id<0||id>=offsets.length-1)throw new Error(`Unknown ${axis} identifier`);
    const parts=shardRanges(offsets[id],offsets[id+1],size);
    const blocks=await Promise.all(parts.map(async p=>decodeRecords(await chunk(axis,p.shard),p.start,p.end)));
    const rows=blocks.flat();const bound=axis==='snp'?meta.source_voxels:meta.significant_SNPs;
    if(rows.some(r=>r.other>=bound||!Number.isFinite(r.t)||!Number.isFinite(r.lp)||r.lp<=meta.threshold_logP))throw new Error('Unexpected values in association data');
    return rows;
  }
  const ijkOf=id=>nativeIJK(packed[id],meta.native_shape);
  const at=([i,j,k])=>Number.isInteger(i)&&Number.isInteger(j)&&Number.isInteger(k)&&i>=0&&j>=0&&k>=0&&i<meta.native_shape[0]&&j<meta.native_shape[1]&&k<meta.native_shape[2]?grid[(i*meta.native_shape[1]+j)*meta.native_shape[2]+k]:-1;
  return {meta,variants,byRsid,packed,template,regions,snpOffsets,voxelOffsets,grid,ijkOf,at,
    snpPairs:sid=>pairs('snp',sid),voxelPairs:id=>pairs('voxel',id),
    hasVoxel:id=>id>=0&&id<meta.source_voxels&&voxelOffsets[id+1]>voxelOffsets[id]};
}
