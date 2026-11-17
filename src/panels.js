// 2D panels: Manhattan plot for a voxel, T-map slices and locus strip for a variant.
import { GWS, T_THRESHOLD } from './config.js';
import { negLog10P, regionName, snpLabel, voxelLabel } from './model.js';

const $ = (id) => document.getElementById(id);
const FONT = '11px "IBM Plex Sans", system-ui, sans-serif';
const C = { muted: '#8fa3b8', teal: '#5fd6c9', peri: '#7088ff', amber: '#ffd27a', grid: 'rgba(150,210,225,.14)' };

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function tColor(t, tmax) {
  const a = Math.abs(t);
  if (a < T_THRESHOLD) return null;
  const m = Math.min(1, (a - T_THRESHOLD) / (tmax - T_THRESHOLD));
  return t > 0 ? [255, 64 + 166 * m, 26 + 76 * m] : [26 + 76 * m, 90 + 152 * m, 255];
}

export function createPanels({ genome, vox, model, on }) {
  const man = { lp: null, ymax: 12, sel: null, box: null };
  const view = { s: null, T: null, tmax: 8, focus: 0, ref: 0, strip: [] };
  const manCv = $('manhattan');
  const stripCv = $('locus');
  const slices = [
    { cv: $('sliceAx'), u: 0, v: 2, fixed: 1 },
    { cv: $('sliceCor'), u: 0, v: 1, fixed: 2 },
    { cv: $('sliceSag'), u: 2, v: 1, fixed: 0 },
  ];
  const off = document.createElement('canvas');

  // ----- Manhattan -----
  function drawManhattan() {
    if (!man.lp || $('panelVoxel').hidden) return;
    const { ctx, w, h } = fit(manCv);
    const L = 34; const R = 10; const T = 10; const B = 20;
    const pw = w - L - R; const ph = h - T - B;
    man.box = { L, T, pw, ph };
    const X = (s) => L + genome.x[s] * pw;
    const Y = (lp) => T + ph * (1 - Math.min(lp, man.ymax) / man.ymax);
    ctx.font = FONT; ctx.fillStyle = C.muted; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    const step = man.ymax > 45 ? 20 : man.ymax > 22 ? 10 : 5;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = 0; y <= man.ymax; y += step) {
      ctx.fillText(String(y), L - 6, Y(y));
      ctx.beginPath(); ctx.moveTo(L, Y(y) + 0.5); ctx.lineTo(L + pw, Y(y) + 0.5); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const arc of genome.arcs) {
      if (arc.chr > 12 && arc.chr % 2 && pw < 900) continue;
      ctx.fillText(String(arc.chr), L + ((arc.a0 + arc.a1) / 2 / (Math.PI * 2)) * pw, T + ph + 5);
    }
    for (const pass of [0, 1, 2]) {
      ctx.fillStyle = [C.teal, C.peri, C.amber][pass];
      ctx.globalAlpha = pass === 2 ? 1 : 0.75;
      for (let s = 0; s < genome.n; s++) {
        const sig = man.lp[s] >= GWS;
        if (pass === 2 ? !sig : sig || genome.chr[s] % 2 !== pass) continue;
        const r = sig ? 1.5 : 0.8;
        ctx.fillRect(X(s) - r, Y(man.lp[s]) - r, 2 * r, 2 * r);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,210,122,.6)';
    ctx.beginPath(); ctx.moveTo(L, Y(GWS)); ctx.lineTo(L + pw, Y(GWS)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.amber; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('5×10⁻⁸', L + pw, Y(GWS) - 2);
    if (man.sel != null) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(man.sel) + 0.5, T); ctx.lineTo(X(man.sel) + 0.5, T + ph); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(man.sel), Y(man.lp[man.sel]), 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function manHit(e) {
    if (!man.box) return -1;
    const rect = manCv.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const { L, T, pw, ph } = man.box;
    const frac = (mx - L) / pw;
    let lo = 0; let hi = genome.n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (genome.x[mid] < frac) lo = mid + 1; else hi = mid; }
    const win = Math.ceil((genome.n * 9) / pw);
    let best = -1; let bd = 100;
    for (let s = Math.max(0, lo - win); s < Math.min(genome.n, lo + win); s++) {
      const dx = L + genome.x[s] * pw - mx;
      const dy = T + ph * (1 - Math.min(man.lp[s], man.ymax) / man.ymax) - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  manCv.addEventListener('pointermove', (e) => {
    const s = manHit(e);
    manCv.style.cursor = s < 0 ? 'default' : 'pointer';
    $('manReadout').textContent = s < 0 ? 'Hover a point to read it, click to open its brain map.'
      : `${snpLabel(genome, s)}, −log₁₀P ${man.lp[s].toFixed(1)}`;
  });
  manCv.addEventListener('click', (e) => { const s = manHit(e); if (s >= 0) on.snp(s); });

  function renderPeaks() {
    const order = [];
    for (let s = 0; s < genome.n; s++) if (man.lp[s] >= GWS) order.push(s);
    order.sort((a, b) => man.lp[b] - man.lp[a]);
    const peaks = [];
    for (const s of order) {
      if (peaks.every((p) => Math.abs(p - s) > 400)) peaks.push(s);
      if (peaks.length === 4) break;
    }
    const box = $('manPeaks');
    box.replaceChildren();
    if (!peaks.length) { box.textContent = 'No variant passes 5×10⁻⁸ at this voxel.'; return; }
    for (const s of peaks) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = `${snpLabel(genome, s)} (${man.lp[s].toFixed(0)})`;
      b.addEventListener('click', () => on.snp(s));
      box.append(b);
    }
  }

  // ----- T-map slices -----
  function drawSlices() {
    if (!view.T || $('panelSnp').hidden) return;
    const f = [vox.ijk[3 * view.focus], vox.ijk[3 * view.focus + 1], vox.ijk[3 * view.focus + 2]];
    for (const sl of slices) {
      const du = vox.dims[sl.u]; const dv = vox.dims[sl.v];
      off.width = du; off.height = dv;
      const octx = off.getContext('2d');
      const img = octx.createImageData(du, dv);
      const ijk = [0, 0, 0]; ijk[sl.fixed] = f[sl.fixed];
      for (let a = 0; a < du; a++) for (let b = 0; b < dv; b++) {
        ijk[sl.u] = a; ijk[sl.v] = b;
        const v = vox.at(ijk[0], ijk[1], ijk[2]);
        if (v < 0) continue;
        const o = 4 * ((dv - 1 - b) * du + a);
        const g = 235 * vox.t1[v];
        const c = tColor(view.T[v], view.tmax) || [g * 0.9, g * 0.95, g];
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      const { ctx, w, h } = fit(sl.cv);
      const scale = Math.min(w / du, h / dv);
      const ox = (w - du * scale) / 2; const oy = (h - dv * scale) / 2;
      sl.map = { ox, oy, scale, du, dv };
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, ox, oy, du * scale, dv * scale);
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
      const cx = ox + (f[sl.u] + 0.5) * scale; const cy = oy + (dv - 0.5 - f[sl.v]) * scale;
      ctx.beginPath(); ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + dv * scale);
      ctx.moveTo(ox, cy); ctx.lineTo(ox + du * scale, cy); ctx.stroke();
    }
  }
  slices.forEach((sl) => sl.cv.addEventListener('click', (e) => {
    if (!sl.map) return;
    const rect = sl.cv.getBoundingClientRect();
    const ijk = [vox.ijk[3 * view.focus], vox.ijk[3 * view.focus + 1], vox.ijk[3 * view.focus + 2]];
    ijk[sl.u] = Math.floor((e.clientX - rect.left - sl.map.ox) / sl.map.scale);
    ijk[sl.v] = sl.map.dv - 1 - Math.floor((e.clientY - rect.top - sl.map.oy) / sl.map.scale);
    const v = vox.at(ijk[0], ijk[1], ijk[2]);
    if (v >= 0) on.voxel(v);
  }));

  // ----- locus strip -----
  function drawStrip() {
    if (view.s == null || $('panelSnp').hidden) return;
    const { ctx, w, h } = fit(stripCv);
    const near = [];
    for (let s = Math.max(0, view.s - 45); s <= Math.min(genome.n - 1, view.s + 45); s++) {
      if (genome.chr[s] === genome.chr[view.s]) near.push({ s, lp: negLog10P(model.tAt(view.ref, s)) });
    }
    const m0 = genome.mb[near[0].s]; const m1 = genome.mb[near[near.length - 1].s];
    const ymax = Math.max(10, ...near.map((p) => p.lp)) * 1.1;
    const B = 16;
    view.strip = near.map((p) => ({ ...p, x: 6 + ((genome.mb[p.s] - m0) / (m1 - m0 || 1)) * (w - 12) }));
    for (const p of view.strip) {
      const y = (h - B) * (1 - p.lp / ymax) + 2;
      const me = p.s === view.s;
      ctx.strokeStyle = me ? '#fff' : p.lp >= GWS ? C.amber : 'rgba(95,214,201,.55)';
      ctx.lineWidth = me ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(p.x, h - B); ctx.lineTo(p.x, y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(p.x, y, me ? 3.5 : 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = FONT; ctx.fillStyle = C.muted; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText(`${m0.toFixed(1)} Mb`, 4, h);
    ctx.textAlign = 'right'; ctx.fillText(`${m1.toFixed(1)} Mb`, w - 4, h);
  }
  stripCv.addEventListener('click', (e) => {
    const mx = e.clientX - stripCv.getBoundingClientRect().left;
    let best = null;
    for (const p of view.strip) if (!best || Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p;
    if (best) on.snp(best.s);
  });

  $('closeVoxel').addEventListener('click', on.closeVoxel);
  $('closeSnp').addEventListener('click', on.closeSnp);
  $('prevSnp').addEventListener('click', () => on.step(-1));
  $('nextSnp').addEventListener('click', () => on.step(1));
  window.addEventListener('resize', () => { drawManhattan(); drawSlices(); drawStrip(); });

  return {
    showVoxel(v, lp) {
      man.lp = lp;
      let max = 0;
      for (let s = 0; s < lp.length; s++) if (lp[s] > max) max = lp[s];
      man.ymax = Math.max(12, max * 1.08);
      $('voxTitle').textContent = `${regionName(vox, v)}, ${voxelLabel(vox, v)}`;
      $('panelVoxel').hidden = false;
      renderPeaks(); drawManhattan();
    },
    hideVoxel() { $('panelVoxel').hidden = true; man.lp = null; },
    markSnp(s) { man.sel = s; drawManhattan(); },
    showSnp({ s, T, tmax, focus, ref, peak, peakT, sigShare }) {
      Object.assign(view, { s, T, tmax, focus, ref });
      $('snpTitle').textContent = snpLabel(genome, s);
      $('snpMeta').textContent = peak == null
        ? 'No voxel passes 5×10⁻⁸ for this variant. The map shows background noise only.'
        : `Strongest effect T = ${peakT.toFixed(1)} in ${regionName(vox, peak).toLowerCase()}, ${voxelLabel(vox, peak)}. ${(sigShare * 100).toFixed(1)}% of voxels pass 5×10⁻⁸.`;
      $('locusCap').textContent = `Neighbouring variants at ${voxelLabel(vox, ref)}`;
      $('tmaxLabel').textContent = `+${tmax.toFixed(0)}`;
      $('tminLabel').textContent = `−${tmax.toFixed(0)}`;
      $('panelSnp').hidden = false;
      drawSlices(); drawStrip();
    },
    hideSnp() { $('panelSnp').hidden = true; view.s = null; view.T = null; },
    redraw() { drawManhattan(); drawSlices(); drawStrip(); },
  };
}
