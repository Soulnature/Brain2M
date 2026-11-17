# Brain2M

Interactive showcase of a voxel-wise brain GWAS: every voxel has a Manhattan plot, every variant has a brain T-map.

- Static site: open `index.html` through any web server (`python3 -m http.server`).
- The association values shown are **simulated for illustration**; edit `src/config.js` to change loci and example cases.
- The brain is the MNI152NLin2009cAsym T1w template (TemplateFlow), converted with `tools/build_brain.py`.
