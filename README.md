# Brain2M · significant SNP–voxel resource

This is the original Brain2M 3D website filled with real significant associations. It runs entirely as static files, including under the GitHub Pages `/Brain2M/` path. No API server, database service or build step is required to browse the exported results.

## Included data

- **60,674 significant SNPs** at their actual GRCh37 positions.
- **20,018,724 unique SNP–voxel associations** involving **292,730 source voxels**.
- Exact significance cutoff: **P < 5e-8 / 2,075,298** (2.409292544974264e-14).
- Original signed T statistics and stored −log10(P), matched to the variant map alleles.
- Native **182 × 218 × 182**, 1-mm reference grid and **Brain2M 120-region atlas** (83 GM + 37 WM modeling labels).

Source filtering retains the exact threshold and map-allele identity: 197 rounded-boundary records and 1,676 alternate-map-allele records from the broader source table are excluded. No new significance/QC cutoff is tuned for this website. The original research files remain unchanged.

## What is interactive

1. Click an actual SNP position on the genomic ring, or search its rsID, to load **all** its significant voxels.
2. Click a data-bearing voxel hotspot, a colored native slice voxel, or its table button to load **all** significant SNPs at that exact source voxel.
3. The voxel panel shows only observed significant SNP points on a **static genome-axis background**. Below the significance line it draws a seeded, purely decorative scatter of grey points so the plot does not look empty. Those points are not measured P values, are labelled as decorative on the page, cannot be clicked, and never appear in tables or downloads.
4. The anatomical volume is a **static reference image**. The 3D overview groups the native voxels into 2-mm blocks in the browser: each block is shaded with its mean template intensity, shows the strongest T among its 1-mm voxels for the selected SNP, and a click on it opens its voxel with the most significant SNPs. CSF blocks without associations are not drawn. It is a navigation preview. Native slices, coordinate lookup, tables and TSV downloads preserve the original 1-mm coordinates and every qualifying association. Only preview points with actual associations are picked.
5. Search exact `chr:position`, e.g. `chr4:103188709`, or native `voxel 82 128 65`. Missing coordinates never silently select a neighbor. Gene queries use the GENCODE v19 (GRCh37) intervals of all 19,342 protein-coding autosomal genes (`data/genes.tsv`, built by `tools/build_genes.py`) and select the strongest significant SNP inside the gene; a gene with none reports its nearest significant SNP without opening it; positional overlap is labelled and is not a causal gene assignment.

The source SNP collection is significance-filtered. An absent rsID or association is not assigned a measured P value of 1 or a T value of 0. The page does not display the old simulated association model. Cosmetic randomness is used only for the scene's introductory animation and small marker offsets, not for statistical values.

## Run locally

From this folder:

```bash
python3 -m http.server 8088 --bind 127.0.0.1
```

Open **http://127.0.0.1:8088/**. Use a current browser with `DecompressionStream` support. Do not open `index.html` as a `file://` URL.

Three.js 0.160.0 and OrbitControls are bundled locally with their MIT license. Browsing the site makes no CDN or external font requests. Existing sound controls and the user-started tour remain available.

## Static hosting

Keep `index.html`, `.nojekyll`, `styles.css`, `src/`, `assets/`, `vendor/` and `data/associations/` together in the published folder. The full exported data occupies about **386 MB decimal (368 MiB)**. It is split into small compressed shards; the largest asset is under 2.9 MB. The browser initially loads only the catalog, geometry, static template and offsets. Association shards are loaded on demand, with a six-shard cache.

No remote push or commit is made by this update. Publishing these local files to the existing Pages source is a separate repository operation. The old `data/brain.bin`, `data/brain.json` and `tools/build_brain.py` are retained as historical template-conversion assets but are not used by the updated runtime.

## Rebuild and verify

The exporter requires Python with NumPy and pandas and reads the existing local Brain2M resource database and reference arrays. It writes `data/associations/` and local audit files:

```bash
python tools/export_associations.py --source /path/to/Brain2M_resource_portal/data
python -m unittest discover -s tools -p test_export_associations.py
npm test
python tools/validate_export.py
python tools/browser_qa.py
```

`validate_export.py` compares **every** SNP-indexed exported record against the original SQLite source and checks every reverse-indexed record against its exact SNP/voxel counterpart. It also verifies uniqueness, threshold membership and all asset hashes. Its default source is the sibling resource folder; adjust it if relocating the build tools. Export intermediates in `tools/.export_cache/` and QA screenshots/logs are ignored by git and are not needed to serve the site.

`browser_qa.py` uses the existing local Playwright installation from the sibling resource folder in this workspace. Elsewhere, install Playwright and its Chromium browser or adjust those paths. Tests cover real SNP/voxel round trips and complete downloads, actual hotspot clicks, unknown/empty results, rapid requests, failed-shard retry, `/Brain2M/` base paths and mobile layout. A temporary localhost server is stopped after the tests.

## Static data format

`data/associations/manifest.json` defines counts, thresholds, atlas metadata, source-backed gene intervals, record columns and SHA-256 hashes. `variants.json.gz` contains the exact rsID/allele catalog. Coordinates are packed native C-order volume offsets **in the original source voxel-ID order**. The two offset arrays delimit each SNP or voxel's full association list.

Each shard has up to 262,144 records, each 16 bytes, little-endian: `uint32 other_ID`, `float32 T`, `float64 stored_minus_log10_P`. SNP shards point to source voxel IDs; voxel shards point to source SNP IDs. T precision matches a float32 map export; log P retains source double precision, including values whose raw P would underflow. Background references and unknown measurements are kept separate from these records.
