// Real resource geometry. Randomness below is cosmetic scene animation only.
import { CHR_MB, RING } from './config.js';
import { scenePosition } from './resource.js';
const TAU=Math.PI*2;
export function mulberry32(seed) {
  let a=seed|0;
  return ()=>{a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};
}
export function buildGenome(resource) {
  const rows=[...resource.variants].sort((a,b)=>a[2]-b[2]||a[3]-b[3]||a[0]-b[0]);
  const n=rows.length,total=CHR_MB.reduce((a,b)=>a+b,0),usable=TAU-RING.gap*CHR_MB.length;
  const chr=new Uint8Array(n),mb=new Float64Array(n),theta=new Float32Array(n),x=new Float64Array(n),sidToIndex=new Int32Array(n);
  const chrStart=[];let acc=0;for(const len of CHR_MB){chrStart.push(acc);acc+=len;}
  rows.forEach((r,s)=>{chr[s]=r[2];mb[s]=r[3]/1e6;theta[s]=(r[2]-1)*RING.gap+RING.gap/2+((chrStart[r[2]-1]+mb[s])/total)*usable;x[s]=theta[s]/TAU;sidToIndex[r[0]]=s;});
  const arcs=CHR_MB.map((len,c)=>{const a0=c*RING.gap+RING.gap/2+chrStart[c]/total*usable;return {chr:c+1,a0,a1:a0+len/total*usable};});
  return {n,rows,chr,mb,theta,x,arcs,sidToIndex};
}
export function snpLabel(genome,s) {const r=genome.rows[s];return `${r[1]} · chr${r[2]}:${r[3].toLocaleString('en-US')}`;}
const CELL = 2;      // mm per 3D display cell (native data stay at 1 mm)
const TISSUE = 0.3;  // cells darker than this fraction of white matter are CSF and are not drawn

/**
 * 3D preview: the native 1-mm source voxels grouped into CELL-mm blocks.
 * Each block is shaded with the mean template intensity of its voxels. CSF blocks are left
 * out so sulci stay open, unless one of their voxels carries a significant association.
 * displayIndex maps every source voxel to its block; sourceIds gives, per block, the source
 * voxel with the most significant SNPs (or -1), which is what a 3D click selects.
 */
export function buildVoxels(resource) {
  const [nx, ny, nz] = resource.meta.native_shape;
  const { packed, template, voxelOffsets } = resource;
  const cx = Math.ceil(nx / CELL), cy = Math.ceil(ny / CELL), cz = Math.ceil(nz / CELL);
  const cells = cx * cy * cz, nSource = packed.length;
  const sum = new Float32Array(cells), count = new Uint8Array(cells);
  const bestPairs = new Uint32Array(cells), bestId = new Int32Array(cells).fill(-1);
  const cellOf = new Int32Array(nSource);
  const histogram = new Uint32Array(256);
  for (let id = 0; id < nSource; id++) {
    const p = packed[id], k = p % nz, j = Math.floor(p / nz) % ny, i = Math.floor(p / (ny * nz));
    const c = (Math.floor(i / CELL) * cy + Math.floor(j / CELL)) * cz + Math.floor(k / CELL);
    cellOf[id] = c; sum[c] += template[p]; count[c]++; histogram[template[p]]++;
    const pairs = voxelOffsets[id + 1] - voxelOffsets[id];
    if (pairs > bestPairs[c]) { bestPairs[c] = pairs; bestId[c] = id; }
  }
  let ceiling = 255;
  for (let seen = 0; ceiling > 1; ceiling--) { seen += histogram[ceiling]; if (seen > nSource * 0.01) break; }

  const slot = new Int32Array(cells).fill(-1);
  let n = 0;
  for (let c = 0; c < cells; c++) {
    if (count[c] && (sum[c] / count[c] >= TISSUE * ceiling || bestPairs[c] > 0)) slot[c] = n++;
  }
  const pos = new Float32Array(n * 3), normal = new Float32Array(n * 3), t1 = new Float32Array(n), exposure = new Float32Array(n);
  const sourceIds = new Int32Array(n);
  const filled = (a, b, c) => a >= 0 && b >= 0 && c >= 0 && a < cx && b < cy && c < cz && slot[(a * cy + b) * cz + c] >= 0;
  for (let a = 0; a < cx; a++) for (let b = 0; b < cy; b++) for (let c = 0; c < cz; c++) {
    const cell = (a * cy + b) * cz + c, v = slot[cell];
    if (v < 0) continue;
    const mid = (CELL - 1) / 2;
    pos.set(scenePosition([a * CELL + mid, b * CELL + mid, c * CELL + mid]), 3 * v);
    t1[v] = Math.min(1, sum[cell] / count[cell] / ceiling);
    sourceIds[v] = bestId[cell];
    // Outward normal and exposure from the empty blocks among the 26 neighbours (scene axes: i, k, j).
    let ex = 0, ey = 0, ez = 0, empty = 0;
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
      if ((da || db || dc) && !filled(a + da, b + db, c + dc)) { ex += da; ey += dc; ez += db; empty++; }
    }
    const len = Math.hypot(ex, ey, ez);
    if (len) normal.set([ex / len, ey / len, ez / len], 3 * v);
    exposure[v] = empty / 26;
  }
  const displayIndex = new Int32Array(nSource);
  for (let id = 0; id < nSource; id++) displayIndex[id] = slot[cellOf[id]];
  const labels = new Map(resource.meta.regions.map(r => [r.label, r.name]));
  return { n, pos, normal, t1, exposure, step: CELL / 100, cellMm: CELL, dims: resource.meta.native_shape, sourceIds, displayIndex, resource, labels,
    at: (i, j, k) => resource.at([i, j, k]), ijkOf: resource.ijkOf,
    positionOf: (id, out) => out.fromArray(scenePosition(resource.ijkOf(id))) };
}
export function regionName(vox,id) {return vox.labels.get(vox.resource.regions[id])||'Outside labelled Brain2M parcels';}
export function voxelLabel(vox,id) {const [i,j,k]=vox.ijkOf(id);return `voxel (${i}, ${j}, ${k})`;}
export function createModel(genome,vox) {
  const resource=vox.resource;
  return {
    async tForVoxel(id) {return (await resource.voxelPairs(id)).map(r=>({...r,s:genome.sidToIndex[r.other]}));},
    async tForSnp(s) {return resource.snpPairs(genome.rows[s][0]);},
  };
}
