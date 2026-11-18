"""Build the gene coordinate table used by the Brain2M search box.

Usage:
    python tools/build_genes.py tools/gencode/gencode.v19.annotation.gtf.gz

Reads a GENCODE GTF and writes data/genes.tsv: one protein-coding autosomal
gene per line as `symbol<TAB>chromosome<TAB>start<TAB>end` (1-based, bp).
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import re
from pathlib import Path
from typing import Iterator, NamedTuple

LOG = logging.getLogger("build_genes")
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
AUTOSOMES = frozenset(f"chr{n}" for n in range(1, 23))
NAME_RE = re.compile(r'gene_name "([^"]+)"')
TYPE_RE = re.compile(r'gene_(?:bio)?type "([^"]+)"')
DESCRIPTION_RE = re.compile(r"##description: (.+)")


class Gene(NamedTuple):
    symbol: str
    chrom: int
    start: int
    end: int


def read_genes(path: Path) -> Iterator[Gene | str]:
    """Yield the GTF description line (if any), then every protein-coding autosomal gene."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("#"):
                match = DESCRIPTION_RE.match(line)
                if match:
                    yield match.group(1).strip()
                continue
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 9 or fields[2] != "gene" or fields[0] not in AUTOSOMES:
                continue
            name = NAME_RE.search(fields[8])
            kind = TYPE_RE.search(fields[8])
            if name and kind and kind.group(1) == "protein_coding":
                yield Gene(name.group(1), int(fields[0][3:]), int(fields[3]), int(fields[4]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("gtf", type=Path, help="GENCODE annotation (.gtf or .gtf.gz)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    description = args.gtf.name
    genes: dict[str, Gene] = {}
    duplicates = 0
    for item in read_genes(args.gtf):
        if isinstance(item, str):
            description = item
            continue
        seen = genes.get(item.symbol.upper())
        if seen is not None:
            duplicates += 1
            if seen.end - seen.start >= item.end - item.start:
                continue  # keep the longer record for a repeated symbol
        genes[item.symbol.upper()] = item
    if not genes:
        raise ValueError(f"No protein-coding autosomal genes found in {args.gtf}")

    ordered = sorted(genes.values(), key=lambda g: (g.chrom, g.start))
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "genes.tsv").write_text("".join(f"{g.symbol}\t{g.chrom}\t{g.start}\t{g.end}\n" for g in ordered))
    release = re.search(r"\((GRCh\d+)\), version (\w+)", description)
    label = f"GENCODE v{release.group(2)}, {release.group(1)}" if release else args.gtf.name
    meta = {"label": label, "source": f"GENCODE: {description}", "genes": len(ordered), "scope": "protein-coding genes on chromosomes 1-22"}
    (OUT_DIR / "genes.json").write_text(json.dumps(meta, indent=2) + "\n")
    LOG.info("Wrote %d genes (%d repeated symbols merged) from %s", len(ordered), duplicates, description)


if __name__ == "__main__":
    main()
