// Small built-in gene lookup for the search box: [chromosome, position in Mb].
// Positions are approximate GRCh37 gene midpoints, good to roughly 0.1 Mb.
// Replace with a full annotation (e.g. GENCODE) when real results are wired in.
export const GENES = Object.freeze({
  APOE: [19, 45.41], MAPT: [17, 44.0], KANSL1: [17, 44.2], CRHR1: [17, 43.8], GRN: [17, 42.43],
  SLC6A4: [17, 28.54], BDNF: [11, 27.7], DRD2: [11, 113.3], PICALM: [11, 85.7], SORL1: [11, 121.4],
  COMT: [22, 19.95], SHANK3: [22, 51.13], SNCA: [4, 90.7], HTT: [4, 3.15], SLC39A8: [4, 103.2],
  LRRK2: [12, 40.7], CACNA1C: [12, 2.4], GRIN2B: [12, 13.9], MSRB3: [12, 65.75], HMGA2: [12, 66.25],
  GBA: [1, 155.21], PSEN2: [1, 227.07], TARDBP: [1, 11.08], MTHFR: [1, 11.85], DISC1: [1, 231.9],
  APP: [21, 27.4], SOD1: [21, 33.04], PSEN1: [14, 73.64], KTN1: [14, 56.1],
  FOXP2: [7, 114.1], WNT16: [7, 120.97], TMEM106B: [7, 12.26],
  TREM2: [6, 41.13], FOXO3: [6, 108.9], BIN1: [2, 127.83], NRXN1: [2, 50.6], DPP4: [2, 162.9], NBEAL1: [2, 203.95],
  CLU: [8, 27.46], NRG1: [8, 32.0], C9ORF72: [9, 27.56], FTO: [16, 53.85], VCAN: [5, 82.8],
  DCC: [18, 50.5], EPHA3: [3, 89.3], ZIC4: [3, 147.1], GMNC: [3, 190.6], BCL2L1: [20, 30.28],
});
