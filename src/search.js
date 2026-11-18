import { CHR_MB } from './config.js';
const VOXEL=/^(?:voxel\s*)?\(?\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)?$/i;
const COORD=/^(?:chr)?\s*(\d{1,2})\s*[:\s]\s*([\d.,]+)\s*(mb|kb|bp)?$/i;
export function parseQuery(text,resource) {
  const q=text.trim();if(!q)return {type:'error',message:'Enter an rsID, gene, chr:position or native voxel i j k.'};
  const voxel=q.match(VOXEL);if(voxel)return {type:'voxel',ijk:voxel.slice(1,4).map(Number)};
  if(/^rs\d+$/i.test(q)) {
    const sid=resource.byRsid.get(q.toLowerCase());return sid==null?{type:'error',message:`${q} is absent from this significant-SNP collection.`}:{type:'snp',sid};
  }
  const coord=q.match(COORD);
  if(coord) {
    const chr=Number(coord[1]),value=Number(coord[2].replace(/,/g,'')),unit=(coord[3]||(value<1000?'mb':'bp')).toLowerCase();
    const bp=Math.round(value*(unit==='mb'?1e6:unit==='kb'?1e3:1));
    if(chr<1||chr>22||bp<1||bp>CHR_MB[chr-1]*1e6)return {type:'error',message:'Enter a valid GRCh37 autosomal position.'};
    const hits=resource.variants.filter(r=>r[2]===chr&&r[3]===bp);
    if(!hits.length)return {type:'error',message:`No significant SNP is indexed at chr${chr}:${bp}.`};
    return {type:'snp',sid:hits.sort((a,b)=>b[9]-a[9])[0][0],message:hits.length>1?`${hits.length} allele-specific variants at this position; showing the strongest.`:null};
  }
  return {type:'gene',name:q};
}

/** Resolve a gene symbol to the strongest significant SNP inside its GENCODE interval. Never substitutes a SNP outside the gene. */
export function geneQuery(gene, label, resource) {
  const bp = n => n.toLocaleString('en-US');
  const where = `${gene.symbol}: chr${gene.chr}:${bp(gene.start)}-${bp(gene.end)} (${label})`;
  const onChr = resource.variants.filter(r => r[2] === gene.chr);
  const hits = onChr.filter(r => r[3] >= gene.start && r[3] <= gene.end).sort((a, b) => b[9] - a[9]);
  if (hits.length) return { type: 'snp', sid: hits[0][0], message: `${where}. ${hits.length} significant SNP${hits.length > 1 ? 's' : ''} inside the gene; showing the strongest, ${hits[0][1]}. Positional overlap is not a causal gene assignment.` };
  let near = null, gap = Infinity;
  for (const r of onChr) { const d = r[3] < gene.start ? gene.start - r[3] : r[3] - gene.end; if (d < gap) { gap = d; near = r; } }
  return { type: 'error', message: `${where}. No significant SNP lies inside this gene.${near ? ` The nearest is ${near[1]}, ${bp(gap)} bp away; search it by rsID to open it.` : ''}` };
}

let genesPromise = null;
/** GENCODE gene table (tools/build_genes.py), fetched on first use: { label, find(symbol), suggest(prefix, limit) }. */
export function loadGenes() {
  const at = file => new URL(`../data/${file}`, import.meta.url);
  genesPromise = genesPromise || Promise.all([
    fetch(at('genes.json')).then(r => { if (!r.ok) throw new Error(`genes.json: HTTP ${r.status}`); return r.json(); }),
    fetch(at('genes.tsv')).then(r => { if (!r.ok) throw new Error(`genes.tsv: HTTP ${r.status}`); return r.text(); }),
  ]).then(([meta, text]) => {
    const bySymbol = new Map();
    for (const line of text.split('\n')) {
      const [symbol, chr, start, end] = line.split('\t');
      if (end) bySymbol.set(symbol.toUpperCase(), { symbol, chr: Number(chr), start: Number(start), end: Number(end) });
    }
    const symbols = [...bySymbol.keys()].sort();
    return {
      label: meta.label,
      find: symbol => bySymbol.get(symbol.trim().toUpperCase()) ?? null,
      suggest: (prefix, limit) => {
        const p = prefix.trim().toUpperCase(), out = [];
        if (!p) return out;
        for (const s of symbols) { if (s.startsWith(p)) { out.push(bySymbol.get(s).symbol); if (out.length >= limit) break; } }
        return out;
      },
    };
  }).catch(error => { genesPromise = null; throw error; });
  return genesPromise;
}
