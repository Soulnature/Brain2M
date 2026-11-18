# Significant-association integration

Source baseline: public Brain2M repository, main at 6112f8f. Keep its 3D brain, genomic ring, palette, click sounds and navigation. Replace synthetic association generation with the existing Brain2M significant-pair resource.

Acceptance criteria:

1. Export every unique, map-allele-matched source association satisfying P < 5e-8/2,075,298. Keep original T and stored −log10(P); never derive P from T or fill missing associations with simulated values.
2. Provide both variant → significant voxels and voxel → significant variants using compressed, bounded static shards. No server or SQL service is needed on GitHub Pages. Initial loading must not download the full association matrix.
3. The genomic ring contains actual significant variants at their GRCh37 positions. The voxel panel displays only observed significant SNP markers on a static genome-axis backdrop; blank locations do not open invented records. No full Manhattan plot or nonsignificant genome scan is generated.
4. The anatomical volume is a static background from the study reference grid. A sampled 3D preview is clearly labelled; exact native 1-mm coordinates and values are retained in native slices, search, tables and downloads. Only data-bearing voxel hotspots are selectable in the 3D preview. Exact voxel searches never silently substitute a nearby voxel.
5. rsID, exact position, source-backed gene-interval search and native voxel searches work. Use the updated Brain2M 120-region atlas (83 GM + 37 WM labels).
6. Handle loading, empty, failed and rapid successive requests without leaving stale values. Provide keyboard-accessible table alternatives to canvas picking. Verify actual pair round trips, missing/corrupt shards, desktop/mobile interactions and console/network errors.

Implementation slices: (1) static data export and round-trip checks, (2) real-data reader and geometry mapping, (3) existing scene/panel integration, (4) browser checks and local deployment package. No git commits or remote push during local implementation, respecting the existing user preference.
