// Search box: turns a typed query into a variant or voxel selection.
import { CHR_MB } from './config.js';
import { GENES } from './genes.js';

const VOXEL_RE = /^(?:voxel\s*)?\(?\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)?$/i;
const COORD_RE = /^(?:chr)?\s*(\d{1,2})\s*[:\s]\s*([\d.,]+)\s*(mb|kb|bp)?$/i;

/** Parse a query into { type: 'voxel', ijk } | { type: 'locus', chr, mb, name } | { type: 'error', message }. */
export function parseQuery(text) {
  const q = text.trim();
  if (!q) return { type: 'error', message: 'Type a gene, a position such as chr17:44.1, or a voxel such as 30 40 50.' };

  const voxel = q.match(VOXEL_RE);
  if (voxel) return { type: 'voxel', ijk: voxel.slice(1, 4).map(Number) };

  const coord = q.match(COORD_RE);
  if (coord) {
    const chr = Number(coord[1]);
    const value = Number(coord[2].replace(/,/g, ''));
    const unit = (coord[3] || (value < 1000 ? 'mb' : 'bp')).toLowerCase();
    const mb = unit === 'mb' ? value : unit === 'kb' ? value / 1e3 : value / 1e6;
    if (!(chr >= 1 && chr <= CHR_MB.length)) return { type: 'error', message: `Chromosome ${coord[1]} is not on the ring. Use 1 to ${CHR_MB.length}.` };
    if (!Number.isFinite(mb) || mb > CHR_MB[chr - 1]) return { type: 'error', message: `chr${chr} ends at ${CHR_MB[chr - 1]} Mb.` };
    return { type: 'locus', chr, mb, name: null };
  }

  if (/^rs\d+$/i.test(q)) return { type: 'error', message: 'rsIDs are not indexed here. Use a position such as chr17:44.1.' };

  const gene = GENES[q.toUpperCase()];
  if (gene) return { type: 'locus', chr: gene[0], mb: gene[1], name: q.toUpperCase() };
  return { type: 'error', message: `"${q}" is not in the built-in gene list. Try a position such as chr17:44.1.` };
}

/** Nearest drawn variant to a genomic position, or -1. */
export function nearestSnp(genome, chr, mb) {
  let best = -1; let bd = Infinity;
  for (let s = 0; s < genome.n; s++) {
    if (genome.chr[s] !== chr) continue;
    const d = Math.abs(genome.mb[s] - mb);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Brain voxel at grid cell (i, j, k), or the nearest one inside the brain. */
export function voxelNear(vox, [i, j, k]) {
  const exact = vox.at(i, j, k);
  if (exact >= 0) return { v: exact, exact: true };
  let best = -1; let bd = Infinity;
  for (let v = 0; v < vox.n; v++) {
    const d = (vox.ijk[3 * v] - i) ** 2 + (vox.ijk[3 * v + 1] - j) ** 2 + (vox.ijk[3 * v + 2] - k) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return { v: best, exact: false };
}

export const geneNames = () => Object.keys(GENES).sort();
