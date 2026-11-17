// Synthetic voxel × variant association model.
// One function, tAt(voxel, snp), defines the whole matrix: a row of it is a
// Manhattan plot, a column of it is a brain T-map.
import { CHR_MB, N_SNP, RING, LOCI, LOCUS_WIDTH_MB } from './config.js';

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(a, b) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return ((x >>> 0) + 0.5) / 4294967296;
}

function hashGauss(a, b) {
  return Math.sqrt(-2 * Math.log(hash01(a, b))) * Math.cos(TAU * hash01(b ^ 0x5bd1e995, a));
}

/** Two-sided -log10(p) for a z score. */
export function negLog10P(z) {
  const a = Math.abs(z);
  if (a > 5) return (a * a) / 2 / Math.LN10 + Math.log10(a * Math.sqrt(TAU)) - Math.log10(2);
  const x = a / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return -Math.log10(Math.max(poly * Math.exp(-x * x), 1e-300));
}

// ---------- genome ----------
export function buildGenome() {
  const total = CHR_MB.reduce((s, v) => s + v, 0);
  const usable = TAU - RING.gap * CHR_MB.length;
  const rng = mulberry32(8_000_000);
  const chr = new Uint8Array(N_SNP);
  const mb = new Float32Array(N_SNP);
  const theta = new Float32Array(N_SNP);
  const x = new Float32Array(N_SNP);
  const chrStart = [];
  let acc = 0;
  for (const len of CHR_MB) { chrStart.push(acc); acc += len; }

  let c = 0;
  for (let i = 0; i < N_SNP; i++) {
    const g = ((i + 0.15 + 0.7 * rng()) / N_SNP) * total;
    while (c < CHR_MB.length - 1 && g >= chrStart[c] + CHR_MB[c]) c++;
    chr[i] = c + 1;
    mb[i] = g - chrStart[c];
    theta[i] = c * RING.gap + RING.gap / 2 + (g / total) * usable;
    x[i] = theta[i] / TAU;
  }

  const arcs = CHR_MB.map((len, ci) => {
    const a0 = ci * RING.gap + RING.gap / 2 + (chrStart[ci] / total) * usable;
    return { chr: ci + 1, a0, a1: a0 + (len / total) * usable };
  });

  // Sparse variant→locus coupling (loci are far enough apart that one is enough).
  const snpLocus = new Int16Array(N_SNP).fill(-1);
  const snpG = new Float32Array(N_SNP);
  const leads = LOCI.map(() => ({ idx: -1, d: Infinity }));
  for (let i = 0; i < N_SNP; i++) {
    for (let l = 0; l < LOCI.length; l++) {
      if (LOCI[l].chr !== chr[i]) continue;
      const d = mb[i] - LOCI[l].mb;
      const g = Math.exp(-(d * d) / (2 * LOCUS_WIDTH_MB * LOCUS_WIDTH_MB));
      if (Math.abs(d) < leads[l].d) leads[l] = { idx: i, d: Math.abs(d) };
      if (g > 0.01) {
        snpLocus[i] = l;
        snpG[i] = g * (0.25 + 0.75 * Math.pow(rng(), 1.5)); // imperfect LD
      }
    }
  }
  leads.forEach((lead) => { snpG[lead.idx] = 1; });

  return { n: N_SNP, chr, mb, theta, x, arcs, snpLocus, snpG, leads: leads.map((l) => l.idx) };
}

export function snpLabel(genome, s) {
  return `chr${genome.chr[s]}:${genome.mb[s].toFixed(2)} Mb`;
}

// ---------- brain ----------
const SCENE_LENGTH = 2.3; // front-to-back size of the brain in scene units
/** LOCI and CASES coordinates are written for a brain 1.8 units long; multiply by this to place them. */
export const BRAIN_SCALE = SCENE_LENGTH / 1.8;
const Y_OFFSET = -0.05;

/**
 * Voxel list from the T1 grid written by tools/build_brain.py.
 * Scene axes: x = left, y = up, z = front.
 */
export function buildVoxels(meta, bytes) {
  const [nx, ny, nz] = meta.dims;
  const step = SCENE_LENGTH / (nz - 2);
  const index = new Int32Array(nx * ny * nz).fill(-1);
  let n = 0;
  for (let c = 0; c < bytes.length; c++) if (bytes[c] > 0) index[c] = n++;
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : index[(i * ny + j) * nz + k]);

  const pos = new Float32Array(n * 3); const normal = new Float32Array(n * 3);
  const t1 = new Float32Array(n); const exposure = new Float32Array(n); const ijk = new Uint16Array(n * 3);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const v = index[(i * ny + j) * nz + k];
    if (v < 0) continue;
    pos.set([(i + 0.5 - nx / 2) * step, (j + 0.5 - ny / 2) * step + Y_OFFSET, (k + 0.5 - nz / 2) * step], 3 * v);
    ijk.set([i, j, k], 3 * v);
    t1[v] = bytes[(i * ny + j) * nz + k] / 255;
    // Outward normal and exposure from the empty cells among the 26 neighbours.
    let ex = 0; let ey = 0; let ez = 0; let empty = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if ((a || b || c) && at(i + a, j + b, k + c) < 0) { ex += a; ey += b; ez += c; empty++; }
    }
    const len = Math.hypot(ex, ey, ez);
    if (len > 0) normal.set([ex / len, ey / len, ez / len], 3 * v);
    exposure[v] = empty / 26;
  }
  return { n, dims: meta.dims, step, index, at, pos, normal, t1, exposure, ijk };
}

export function nearestVoxel(vox, at) {
  const [x, y, z] = at.map((c) => c * BRAIN_SCALE);
  let best = 0; let bd = Infinity;
  for (let v = 0; v < vox.n; v++) {
    const d = (vox.pos[3 * v] - x) ** 2 + (vox.pos[3 * v + 1] - y) ** 2 + (vox.pos[3 * v + 2] - z) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** Approximate anatomical label from scene coordinates (display only). */
export function regionName(vox, v) {
  const x = vox.pos[3 * v] / BRAIN_SCALE; const y = vox.pos[3 * v + 1] / BRAIN_SCALE; const z = vox.pos[3 * v + 2] / BRAIN_SCALE;
  const side = Math.abs(x) < 0.05 ? 'Midline' : x > 0 ? 'Left' : 'Right';
  let lobe = 'central';
  if (y < -0.18 && z < -0.24) lobe = 'cerebellum';
  else if (y < -0.3 && Math.abs(x) < 0.14) lobe = 'brainstem';
  else if (Math.abs(x) < 0.32 && Math.abs(y - 0.08) < 0.2 && Math.abs(z) < 0.32) lobe = 'subcortical';
  else if (z > 0.25) lobe = 'frontal';
  else if (z < -0.5) lobe = 'occipital';
  else if (y < 0 && Math.abs(x) > 0.3) lobe = 'temporal';
  else if (y > 0.2) lobe = 'parietal';
  return `${side} ${lobe}`;
}

export function voxelLabel(vox, v) {
  return `voxel (${vox.ijk[3 * v]}, ${vox.ijk[3 * v + 1]}, ${vox.ijk[3 * v + 2]})`;
}

// ---------- association model ----------
const WAVES = 3;
const waveBuf = new Float32Array(WAVES * 4);
function wavesFor(s) {
  const rng = mulberry32(Math.imul(s + 1, 0x9e3779b1));
  for (let w = 0; w < WAVES; w++) {
    waveBuf[4 * w] = (rng() - 0.5) * 14;
    waveBuf[4 * w + 1] = (rng() - 0.5) * 14;
    waveBuf[4 * w + 2] = (rng() - 0.5) * 14;
    waveBuf[4 * w + 3] = rng() * TAU;
  }
}
const WAVE_AMP = 0.75 * Math.sqrt(2 / WAVES);

function nullZ(x, y, z, v, s) { // call wavesFor(s) first
  let n = 0;
  for (let w = 0; w < WAVES; w++) n += Math.sin(waveBuf[4 * w] * x + waveBuf[4 * w + 1] * y + waveBuf[4 * w + 2] * z + waveBuf[4 * w + 3]);
  return WAVE_AMP * n + 0.66 * hashGauss(v, s);
}

function spatial(locus, sx, sy, sz) {
  const x = sx / BRAIN_SCALE; const y = sy / BRAIN_SCALE; const z = sz / BRAIN_SCALE;
  let sum = 0;
  for (const b of locus.blobs) {
    const d = (x - b.c[0]) ** 2 + (y - b.c[1]) ** 2 + (z - b.c[2]) ** 2;
    sum += b.w * Math.exp(-d / (2 * b.s * b.s));
  }
  return sum;
}

export function createModel(genome, vox) {
  const spatialCache = new Map();
  const locusMap = (l) => {
    if (!spatialCache.has(l)) {
      const m = new Float32Array(vox.n);
      for (let v = 0; v < vox.n; v++) m[v] = spatial(LOCI[l], vox.pos[3 * v], vox.pos[3 * v + 1], vox.pos[3 * v + 2]);
      spatialCache.set(l, m);
    }
    return spatialCache.get(l);
  };

  const tAt = (v, s) => {
    const x = vox.pos[3 * v]; const y = vox.pos[3 * v + 1]; const z = vox.pos[3 * v + 2];
    wavesFor(s);
    const l = genome.snpLocus[s];
    return nullZ(x, y, z, v, s) + (l < 0 ? 0 : LOCI[l].amp * genome.snpG[s] * spatial(LOCI[l], x, y, z));
  };

  /** Row of the matrix: T of every variant at one voxel. */
  const tForVoxel = (v) => {
    const x = vox.pos[3 * v]; const y = vox.pos[3 * v + 1]; const z = vox.pos[3 * v + 2];
    const S = LOCI.map((locus) => locus.amp * spatial(locus, x, y, z));
    const out = new Float32Array(genome.n);
    for (let s = 0; s < genome.n; s++) {
      wavesFor(s);
      const l = genome.snpLocus[s];
      out[s] = nullZ(x, y, z, v, s) + (l < 0 ? 0 : S[l] * genome.snpG[s]);
    }
    return out;
  };

  /** Column of the matrix: T of one variant at every voxel. */
  const tForSnp = (s) => {
    const l = genome.snpLocus[s];
    const map = l < 0 ? null : locusMap(l);
    const k = l < 0 ? 0 : LOCI[l].amp * genome.snpG[s];
    const out = new Float32Array(vox.n);
    wavesFor(s);
    for (let v = 0; v < vox.n; v++) {
      out[v] = nullZ(vox.pos[3 * v], vox.pos[3 * v + 1], vox.pos[3 * v + 2], v, s) + (map ? k * map[v] : 0);
    }
    return out;
  };

  return { tAt, tForVoxel, tForSnp };
}
