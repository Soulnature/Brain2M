// Brain2M showcase configuration.
// Everything on the page is generated from this file. The association model is
// SYNTHETIC: replace LOCI and CASES with real Brain2M results when ready.

export const TOTALS = Object.freeze({ voxels: 2_000_000, snps: 8_000_000 });

// Autosome lengths in Mb (GRCh37, rounded).
export const CHR_MB = Object.freeze([
  249, 243, 198, 191, 181, 171, 159, 146, 141, 136, 135,
  134, 115, 107, 103, 90, 81, 78, 59, 63, 48, 51,
]);

export const N_SNP = 36000; // variants drawn (of 8M)
export const RING = Object.freeze({ radius: 1.85, y: -0.25, gap: 0.02, liftPerLog: 0.02 });
export const LOCUS_WIDTH_MB = 0.45;
export const GWS = 7.30103; // -log10(5e-8)
export const T_THRESHOLD = 2.3;

// Each locus couples a genomic position to a spatial effect pattern.
// blobs: c = centre [x (left-right), y (up), z (front)], s = spread, w = signed weight.
export const LOCI = Object.freeze([
  { chr: 1, mb: 215.2, amp: 11, blobs: [{ c: [0.25, -0.38, -0.55], s: 0.13, w: 1 }, { c: [-0.25, -0.38, -0.55], s: 0.13, w: 1 }] },
  { chr: 2, mb: 58.1, amp: 9, blobs: [{ c: [-0.3, 0.35, 0.5], s: 0.14, w: 1 }] },
  { chr: 3, mb: 89.6, amp: 13, blobs: [{ c: [0, 0.15, 0.3], s: 0.1, w: 1 }, { c: [0, 0.17, -0.2], s: 0.1, w: 1 }] },
  { chr: 5, mb: 82.3, amp: 10, blobs: [{ c: [0.22, 0.02, 0.08], s: 0.09, w: 1 }, { c: [-0.22, 0.02, 0.08], s: 0.09, w: 1 }] },
  { chr: 6, mb: 126.7, amp: 12, blobs: [{ c: [0.2, 0.1, -0.7], s: 0.14, w: -1 }, { c: [-0.2, 0.1, -0.7], s: 0.14, w: -1 }] },
  { chr: 7, mb: 120.9, amp: 8, blobs: [{ c: [0.46, -0.2, 0.1], s: 0.13, w: 1 }] },
  { chr: 9, mb: 119.2, amp: 9, blobs: [{ c: [0, -0.5, -0.2], s: 0.1, w: 1 }] },
  { chr: 11, mb: 47.5, amp: 8, blobs: [{ c: [0.3, 0.5, -0.2], s: 0.15, w: -1 }, { c: [-0.3, 0.5, -0.2], s: 0.15, w: -1 }] },
  { chr: 12, mb: 65.8, amp: 14, blobs: [{ c: [0.12, 0.2, -0.1], s: 0.1, w: 1 }, { c: [-0.12, 0.2, -0.1], s: 0.1, w: 1 }, { c: [0.34, 0.22, -0.1], s: 0.1, w: -0.5 }, { c: [-0.34, 0.22, -0.1], s: 0.1, w: -0.5 }] },
  { chr: 14, mb: 59.6, amp: 10, blobs: [{ c: [0.26, -0.14, -0.05], s: 0.08, w: 1 }, { c: [-0.26, -0.14, -0.05], s: 0.08, w: 1 }] },
  { chr: 16, mb: 87.2, amp: 9, blobs: [{ c: [0.18, 0.2, 0.75], s: 0.12, w: -1 }, { c: [-0.18, 0.2, 0.75], s: 0.12, w: -1 }] },
  { chr: 17, mb: 44.1, amp: 16, blobs: [{ c: [0.35, 0.3, 0.2], s: 0.2, w: 1 }, { c: [-0.35, 0.3, 0.2], s: 0.2, w: 1 }, { c: [0, -0.36, -0.5], s: 0.2, w: -0.6 }] },
  { chr: 19, mb: 45.4, amp: 7, blobs: [{ c: [0.4, -0.25, 0.35], s: 0.1, w: -1 }, { c: [-0.4, -0.25, 0.35], s: 0.1, w: -1 }] },
  { chr: 22, mb: 38.4, amp: 8, blobs: [{ c: [-0.36, 0.05, 0.15], s: 0.09, w: 1 }] },
]);

// Example entry points shown as buttons and used by the guided tour.
// voxel cases: `at` is a scene coordinate (nearest voxel is used).
// snp cases: `locus` indexes LOCI (its lead variant is used).
export const CASES = Object.freeze([
  { type: 'voxel', label: 'Cerebellar cortex', at: [0.25, -0.38, -0.55] },
  { type: 'snp', label: 'chr17 · 44.1 Mb', locus: 11 },
  { type: 'voxel', label: 'Putamen', at: [0.22, 0.02, 0.08] },
  { type: 'snp', label: 'chr12 · 65.8 Mb', locus: 8 },
  { type: 'voxel', label: 'Occipital pole', at: [-0.2, 0.1, -0.7] },
  { type: 'snp', label: 'chr14 · 59.6 Mb', locus: 9 },
]);
