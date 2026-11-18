// Search box: turns a typed query into a variant or voxel selection.
import { CHR_MB } from './config.js';

const VOXEL_RE = /^(?:voxel\s*)?\(?\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)?$/i;
const COORD_RE = /^(?:chr)?\s*(\d{1,2})\s*[:\s]\s*([\d.,]+)\s*(mb|kb|bp)?$/i;

/** Parse a query into { type: 'voxel', ijk } | { type: 'locus', chr, mb } | { type: 'gene', name } | { type: 'error', message }. */
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
    return { type: 'locus', chr, mb };
  }

  if (/^rs\d+$/i.test(q)) return { type: 'error', message: 'rsIDs are not indexed here. Use a position such as chr17:44.1.' };

  return { type: 'gene', name: q };
}

let genesPromise = null;
/**
 * Gene table built by tools/build_genes.py from the GENCODE annotation.
 * Resolves to { label, find(symbol), suggest(prefix, limit) }; loaded on first use.
 */
export function loadGenes() {
  genesPromise = genesPromise || Promise.all([
    fetch('data/genes.json').then((r) => { if (!r.ok) throw new Error(`genes.json: HTTP ${r.status}`); return r.json(); }),
    fetch('data/genes.tsv').then((r) => { if (!r.ok) throw new Error(`genes.tsv: HTTP ${r.status}`); return r.text(); }),
  ]).then(([meta, text]) => {
    const bySymbol = new Map();
    for (const line of text.split('\n')) {
      const [symbol, chr, start, end] = line.split('\t');
      if (end) bySymbol.set(symbol.toUpperCase(), { symbol, chr: Number(chr), start: Number(start), end: Number(end) });
    }
    const symbols = [...bySymbol.keys()].sort();
    return {
      label: meta.label,
      find: (symbol) => bySymbol.get(symbol.trim().toUpperCase()) ?? null,
      suggest: (prefix, limit) => {
        const p = prefix.trim().toUpperCase();
        if (!p) return [];
        const out = [];
        for (const s of symbols) {
          if (s.startsWith(p)) { out.push(bySymbol.get(s).symbol); if (out.length >= limit) break; }
        }
        return out;
      },
    };
  }).catch((err) => { genesPromise = null; throw err; });
  return genesPromise;
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
