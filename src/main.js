// Brain2M showcase: scene orchestration, selection state, camera flights, tour.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RING } from './config.js';
import { loadResource } from './resource.js';
import { buildGenome, buildVoxels, createModel, regionName, snpLabel, voxelLabel } from './model.js';
import { createBrain, createGenome, createSnpMarker, createVoxelMarker } from './scene.js';
import { createPanels } from './panels.js';
import { geneQuery, genesInResults, loadGenes, parseQuery } from './search.js';
import { isSoundOn, play, setSound } from './sound.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOV = 38;

// ---------- real, statically hosted data ----------
let resource;
try {
  resource = await loadResource();
} catch (error) {
  $('scaleNote').textContent = `The association index could not be loaded: ${error.message}. Serve this folder over HTTP and check that data/associations is included.`;
  $('dataStatus').textContent = 'Data unavailable. Reload after checking the resource files.';
  throw error;
}
const genome = buildGenome(resource);
const vox = buildVoxels(resource);
const model = createModel(genome, vox);
let snpRequest = 0;
let voxelRequest = 0;
function dataStatus(text, error = false) {
  $('dataStatus').textContent = text;
  $('dataStatus').classList.toggle('error', error);
}

// ---------- scene ----------
const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x04070d);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
camera.position.set(0, 1.2, 8);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 0.5, maxDistance: 9, autoRotateSpeed: 0.45 });
controls.target.set(0, -0.05, 0);

const brain = createBrain(vox);
const ring = createGenome(genome);
const voxMarker = createVoxelMarker(vox.step);
const snpMarker = createSnpMarker();
scene.add(brain.object, ring.object, voxMarker.object, snpMarker.object);

const labels = genome.arcs.map((arc) => {
  const el = document.createElement('span');
  el.textContent = arc.chr;
  $('labels').append(el);
  const a = (arc.a0 + arc.a1) / 2;
  return { el, pos: new THREE.Vector3((RING.radius + 0.17) * Math.cos(a), RING.y, (RING.radius + 0.17) * Math.sin(a)) };
});

// ---------- tweens ----------
const tweens = [];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function tween(ms, fn) {
  if (reduceMotion || ms <= 0) { fn(1); return Promise.resolve(); }
  return new Promise((resolve) => tweens.push({ t0: performance.now(), ms, fn, resolve }));
}
const tweenValue = (u, to, ms) => { const from = u.value; return tween(ms, (k) => { u.value = from + (to - from) * k; }); };
const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 300) : ms));

let flight = 0;
function flyTo(pos, target, ms) {
  const id = ++flight;
  controls.enabled = false; controls.autoRotate = false;
  const t0 = controls.target.clone();
  const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(t0));
  const s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
  const dTheta = Math.atan2(Math.sin(s1.theta - s0.theta), Math.cos(s1.theta - s0.theta));
  const sph = new THREE.Spherical();
  return tween(ms, (k) => {
    if (id !== flight) return;
    sph.set(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + dTheta * k);
    controls.target.lerpVectors(t0, target, k);
    camera.position.setFromSpherical(sph).add(controls.target);
    camera.lookAt(controls.target);
  }).then(() => { if (id === flight) controls.enabled = true; return id === flight; });
}
function cancelFlight() { flight++; controls.enabled = true; }

// ---------- state ----------
const state = { voxel: null, snp: null, lp: null, peak: null };
const tmp = new THREE.Vector3(); const tmp2 = new THREE.Vector3();
const voxPos = (v, out) => vox.positionOf(v, out);
const centreVoxel = resource.meta.cases.find(c => c.type === 'voxel').idx;
const OVERVIEW = { pos: new THREE.Vector3(0, 1.25, 5.3), target: new THREE.Vector3(0, -0.05, 0) };
resize();

const HOME_CUT = { focus: new THREE.Vector3(0, 0.12, 0.1), dir: new THREE.Vector3(0.6, 0, 0.8) };
/** Open the cutaway wedge at `focus`; `dir` (horizontal) is the side that gets removed. */
function setCut(focus, dir) {
  brain.uniforms.uFocus.value.copy(focus);
  if (dir && dir.lengthSq() > 1e-4) brain.uniforms.uCutDir.value.copy(dir).setY(0).normalize();
}

function syncUi() {
  const exploring = state.voxel != null || state.snp != null;
  document.body.classList.toggle('exploring', exploring);
  document.body.classList.toggle('has-snp', state.snp != null);
  document.body.classList.toggle('has-voxel', state.voxel != null);
  document.querySelectorAll('#cases button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.type === 'voxel' ? Number(b.dataset.idx) === state.voxel : Number(b.dataset.idx) === state.snp));
  });
}

function refreshSnpPanel() {
  if (state.snp == null) return;
  const { T, records, tmax, peak, peakT } = state.snpData;
  panels.showSnp({
    s: state.snp, T, records, tmax, peak, peakT,
    focus: T.has(state.voxel) ? state.voxel : peak ?? centreVoxel,
  });
}

async function selectVoxel(v, { fly = true } = {}) {
  if (!Number.isInteger(v) || v < 0 || v >= resource.meta.source_voxels) return;
  const request = ++voxelRequest;
  dataStatus(`Loading significant SNPs at ${voxelLabel(vox, v)}…`);
  let records;
  try { records = await model.tForVoxel(v); }
  catch (error) { if (request === voxelRequest) dataStatus(error.message, true); return; }
  if (request !== voxelRequest) return;
  if (!touring) play('voxel');
  state.voxel = v;
  // Zero here means no visual lift, not a measured P value.
  const lp = new Float32Array(genome.n);
  for (const row of records) lp[row.s] = row.lp;
  state.lp = lp;
  ring.setLp(lp);
  tweenValue(ring.uniforms.uLift, 1, 900);
  voxPos(v, voxMarker.object.position);
  voxMarker.object.visible = true;
  setCut(voxMarker.object.position, fly ? voxPos(v, new THREE.Vector3()) : null);
  syncUi();
  panels.showVoxel(v, records);
  panels.markSnp(state.snp);
  refreshSnpPanel();
  dataStatus(`${records.length.toLocaleString('en-US')} significant SNPs at ${voxelLabel(vox, v)}.`);
  if (!fly) return;
  const p = voxPos(v, new THREE.Vector3());
  const dir = brain.uniforms.uCutDir.value.clone();
  if (!(await flyTo(p.clone().addScaledVector(dir, 0.7).add(new THREE.Vector3(0, 0.5, 0)), p, 1200))) return;
  const id = flight;
  await wait(700);
  if (id !== flight || state.voxel !== v) return;
  flyTo(dir.multiplyScalar(5.2).setY(2.1), new THREE.Vector3(0, 0.1, 0), 1200);
}

async function selectSnp(s, { fly = true } = {}) {
  if (!Number.isInteger(s) || s < 0 || s >= genome.n) return;
  const request = ++snpRequest;
  dataStatus(`Loading ${genome.rows[s][1]} significant voxels…`);
  let records;
  try { records = await model.tForSnp(s); }
  catch (error) { if (request === snpRequest) dataStatus(error.message, true); return; }
  if (request !== snpRequest) return;
  if (!touring) play('snp');
  const T = new Map(records.map(r => [r.other, r]));
  const peak = genome.rows[s][7];
  if (!T.has(peak)) { dataStatus('The stored peak is missing from its association list.', true); return; }
  let tmax = 1;
  const displayT = new Float32Array(vox.n);
  for (const row of records) {
    tmax = Math.max(tmax, Math.abs(row.t));
    // Each 3D block shows the strongest T among its native 1-mm voxels.
    const at = vox.displayIndex[row.other];
    if (at >= 0 && Math.abs(row.t) > Math.abs(displayT[at])) displayT[at] = row.t;
  }
  state.snp = s;
  state.snpData = { T, records, tmax, peak, peakT: T.get(peak).t };
  brain.setT(displayT, tmax);
  tweenValue(brain.uniforms.uTmix, 1, 900);
  const side = fly ? new THREE.Vector3(Math.cos(genome.theta[s]), 0, Math.sin(genome.theta[s])) : null;
  setCut(voxPos(peak, tmp), side);
  snpMarker.object.visible = true;
  syncUi();
  panels.markSnp(s);
  refreshSnpPanel();
  dataStatus(`${genome.rows[s][1]}: ${records.length.toLocaleString('en-US')} significant 1-mm voxels.`);
  if (!fly) return;
  const p = ring.position(s, new THREE.Vector3());
  const radial = new THREE.Vector3(Math.cos(genome.theta[s]), 0, Math.sin(genome.theta[s]));
  if (!(await flyTo(p.clone().addScaledVector(radial, 0.75).add(new THREE.Vector3(0, 0.28, 0)), p, 1200))) return;
  const id = flight;
  await wait(700);
  if (id !== flight || state.snp !== s) return;
  flyTo(radial.multiplyScalar(5).setY(1.9), new THREE.Vector3(0, 0, 0), 1200);
}

function clearVoxel() {
  voxelRequest++;
  state.voxel = null; state.lp = null;
  voxMarker.object.visible = false;
  tweenValue(ring.uniforms.uLift, 0, 900);
  panels.hideVoxel();
  syncUi(); refreshSnpPanel();
  if (state.snp == null) goHome();
}
function clearSnp() {
  snpRequest++;
  state.snp = null; state.snpData = null;
  snpMarker.object.visible = false;
  tweenValue(brain.uniforms.uTmix, 0, 900);
  panels.hideSnp(); panels.markSnp(null);
  syncUi();
  if (state.voxel == null) goHome();
}
function goHome() {
  setCut(HOME_CUT.focus, HOME_CUT.dir);
  flyTo(OVERVIEW.pos, OVERVIEW.target, 1600).then((ok) => { if (ok && state.voxel == null && state.snp == null) controls.autoRotate = !reduceMotion; });
}
function reset() {
  snpRequest++; voxelRequest++;
  $('searchMsg').hidden = true;
  dataStatus('Select a significant SNP or a data-bearing voxel.');
  if (state.voxel != null) { state.voxel = null; state.lp = null; voxMarker.object.visible = false; tweenValue(ring.uniforms.uLift, 0, 900); panels.hideVoxel(); }
  if (state.snp != null) { state.snp = null; state.snpData = null; snpMarker.object.visible = false; tweenValue(brain.uniforms.uTmix, 0, 900); panels.hideSnp(); panels.markSnp(null); }
  syncUi(); goHome();
}

const panels = createPanels({
  genome, vox, model,
  on: {
    snp: (s) => { stopTour(); selectSnp(s); },
    voxel: (v) => { stopTour(); selectVoxel(v, { fly: false }); },
    closeVoxel: () => { stopTour(); clearVoxel(); },
    closeSnp: () => { stopTour(); clearSnp(); },
    step: (d) => stepSnp(d),
  },
});
function stepSnp(d) {
  if (state.snp == null) return;
  stopTour();
  selectSnp(Math.min(genome.n - 1, Math.max(0, state.snp + d)), { fly: false });
}

// ---------- example cases + tour ----------
const cases = resource.meta.cases.map(c => ({ ...c, idx: c.type === 'voxel' ? c.idx : genome.sidToIndex[c.sid] }));
cases.forEach((c) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `case case-${c.type}`;
  b.dataset.type = c.type; b.dataset.idx = c.idx;
  b.innerHTML = `<i aria-hidden="true"></i><span>${c.type === 'voxel' ? 'Voxel' : 'Variant'}</span>${c.label}`;
  b.addEventListener('click', () => { stopTour(); (c.type === 'voxel' ? selectVoxel : selectSnp)(c.idx); });
  $('cases').append(b);
});

let tourId = 0; let touring = false; // the tour plays silently
function stopTour() { tourId++; touring = false; $('btnTour').textContent = 'Play tour'; }
async function runTour() {
  const id = ++tourId; touring = true;
  $('btnTour').textContent = 'Stop tour';
  const alive = () => id === tourId;
  for (let i = 0; alive(); i = (i + 2) % cases.length) {
    reset(); await wait(2200); if (!alive()) return;
    selectVoxel(cases[i].idx); await wait(7500); if (!alive()) return;
    selectSnp(cases[i + 1].idx); await wait(8500);
  }
}
$('btnTour').addEventListener('click', () => { if ($('btnTour').textContent === 'Stop tour') stopTour(); else runTour(); });
$('btnOverview').addEventListener('click', () => { stopTour(); reset(); });

// ---------- sound ----------
function syncSound() {
  $('btnSound').textContent = isSoundOn() ? 'Sound on' : 'Sound off';
  $('btnSound').setAttribute('aria-pressed', String(isSoundOn()));
}
$('btnSound').addEventListener('click', () => { setSound(!isSoundOn()); syncSound(); play('ui'); });
['btnOverview', 'btnTour', 'closeVoxel', 'closeSnp'].forEach((id) => $(id).addEventListener('click', () => play('ui')));
syncSound();

// ---------- search ----------
const searchMsg = $('searchMsg');
function say(text, isError = false) {
  searchMsg.textContent = text;
  searchMsg.hidden = !text;
  searchMsg.classList.toggle('error', isError);
  clearTimeout(sayTimer);
  if (text && !isError) sayTimer = setTimeout(() => say(''), 12000);
}
let sayTimer = 0;
$('searchInput').addEventListener('focus', () => { stopTour(); loadGenes().catch(() => {}); });
$('searchInput').addEventListener('input', async () => {
  say('');
  const typed = $('searchInput').value;
  if (!/^[a-z]/i.test(typed) || /^rs\d/i.test(typed)) { $('geneList').replaceChildren(); return; }
  try {
    const genes = await loadGenes();
    if ($('searchInput').value !== typed) return;
    $('geneList').replaceChildren(...genes.suggest(typed, 12).map(g => Object.assign(document.createElement('option'), { value: g })));
  } catch { /* reported when the search is submitted */ }
});
$('search').addEventListener('submit', async e => {
  e.preventDefault();
  stopTour();
  let q = parseQuery($('searchInput').value, resource);
  if (q.type === 'gene') {
    try {
      const genes = await loadGenes();
      const gene = genes.find(q.name);
      q = gene ? geneQuery(gene, genes.label, resource)
        : { type: 'error', message: `"${q.name}" is not an rsID in this collection or a protein-coding gene on chromosomes 1 to 22 (${genes.label}).` };
    } catch (error) {
      q = { type: 'error', message: `The gene table could not be loaded (${error.message}). Search by rsID or position instead.` };
    }
  }
  if (q.type === 'error') { say(q.message, true); play('error'); return; }
  if (q.type === 'voxel') {
    const v = resource.at(q.ijk);
    if (v < 0) { say(`No source voxel is indexed at (${q.ijk.join(', ')}). No nearby voxel has been substituted.`, true); return; }
    say(`${voxelLabel(vox, v)} · source ID ${v}`);
    selectVoxel(v, { fly: false });
    return;
  }
  say(q.message || snpLabel(genome, genome.sidToIndex[q.sid]));
  selectSnp(genome.sidToIndex[q.sid], { fly: false });
});

// Dropdown of every gene that contains a significant SNP.
loadGenes().then((genes) => {
  const list = genesInResults(genes, resource);
  const select = $('geneSelect');
  select.options[0].textContent = `Genes in results (${list.length.toLocaleString('en-US')})`;
  select.append(...list.map(g => Object.assign(document.createElement('option'), { value: g.symbol, textContent: `${g.symbol} · ${g.count.toLocaleString('en-US')} SNP${g.count > 1 ? 's' : ''}` })));
  select.disabled = false;
}).catch(() => { $('geneSelect').options[0].textContent = 'Gene list unavailable'; });
$('geneSelect').addEventListener('change', () => {
  const symbol = $('geneSelect').value;
  if (!symbol) return;
  $('searchInput').value = symbol;
  $('search').requestSubmit();
  $('geneSelect').value = '';
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') { stopTour(); reset(); }
  if (e.key === 'ArrowLeft') stepSnp(-1);
  if (e.key === 'ArrowRight') stepSnp(1);
});

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin; const d = raycaster.ray.direction;
  const scan = (arr, n, radius, liftOf, skip) => {
    let best = -1; let bt = Infinity; const r2 = radius * radius;
    for (let i = 0; i < n; i++) {
      const wx = arr[3 * i] - o.x; const wy = arr[3 * i + 1] + (liftOf ? liftOf(i) : 0) - o.y; const wz = arr[3 * i + 2] - o.z;
      const t = wx * d.x + wy * d.y + wz * d.z;
      if (t <= 0 || t >= bt) continue;
      if (wx * wx + wy * wy + wz * wz - t * t < r2 && !(skip && skip(i))) { bt = t; best = i; }
    }
    return { idx: best, t: bt };
  };
  const lift = RING.liftPerLog * ring.uniforms.uLift.value;
  const v = scan(vox.pos, vox.n, vox.step * 0.75, null, i => vox.sourceIds[i] < 0 || brain.isCut(i));
  const s = scan(ring.base, genome.n, 0.028, (i) => Math.min(ring.lp[i], 70) * lift);
  if (v.idx < 0 && s.idx < 0) return null;
  return s.t < v.t ? { type: 'snp', idx: s.idx } : { type: 'voxel', idx: vox.sourceIds[v.idx] };
}

let down = null; let hover = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; stopTour(); cancelFlight(); controls.autoRotate = false; });
canvas.addEventListener('pointermove', (e) => { hover = e.buttons ? null : { x: e.clientX, y: e.clientY }; if (e.buttons) $('tip').hidden = true; });
canvas.addEventListener('pointerleave', () => { hover = null; $('tip').hidden = true; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const hit = pick(e.clientX, e.clientY);
  if (hit) (hit.type === 'voxel' ? selectVoxel : selectSnp)(hit.idx);
});
function updateHover() {
  if (!hover) return;
  const hit = pick(hover.x, hover.y);
  const tip = $('tip');
  canvas.style.cursor = hit ? 'pointer' : 'grab';
  tip.hidden = !hit;
  if (hit) {
    const label = document.createElement('b');
    label.textContent = hit.type === 'voxel' ? `${voxelLabel(vox, hit.idx)} · ${regionName(vox, hit.idx)}` : snpLabel(genome, hit.idx);
    tip.replaceChildren(label, document.createElement('br'), document.createTextNode(hit.type === 'voxel' ? 'Click for observed significant SNPs' : 'Click for its significant-voxel map'));
    tip.style.transform = `translate(${Math.min(hover.x + 14, window.innerWidth - 240)}px, ${hover.y + 16}px)`;
  }
  hover = null;
}

// ---------- layout + loop ----------
const shift = { x: 0, y: 0, t: 0 };
function resize() {
  const w = window.innerWidth; const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const px = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((FOV * Math.PI) / 360));
  brain.uniforms.uSize.value = vox.step * 1.8 * px;
  ring.uniforms.uSize.value = 0.015 * px;
  OVERVIEW.pos.set(0, 1.25, 5.3).multiplyScalar(Math.max(1.12, 1.9 / camera.aspect));
}
window.addEventListener('resize', resize);

function targetShift() {
  const w = window.innerWidth; const h = window.innerHeight; const wide = w > 900;
  if (state.voxel == null && state.snp == null) return wide ? [-0.21 * w, 0] : [0, -0.2 * h];
  if (!wide) return [0, 0.22 * h];
  return [state.snp != null ? 180 : 0, state.voxel != null ? 140 : 0];
}

function frame(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; const k = Math.min(1, (now - tw.t0) / tw.ms);
    tw.fn(ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
  const [tx, ty] = targetShift();
  const blend = shift.t ? 1 - Math.exp(-(now - shift.t) / 280) : 1;
  shift.t = now;
  shift.x += (tx - shift.x) * blend; shift.y += (ty - shift.y) * blend;
  camera.setViewOffset(window.innerWidth, window.innerHeight, shift.x, shift.y, window.innerWidth, window.innerHeight);
  controls.update();
  brain.uniforms.uEye.value.copy(camera.position);
  updateHover();

  const pulse = 0.5 + 0.5 * Math.sin(now / 280);
  voxMarker.fill.material.opacity = 0.25 + 0.35 * pulse;
  if (state.snp != null) {
    ring.position(state.snp, tmp);
    snpMarker.place(tmp, state.snpData.peak == null ? null : voxPos(state.snpData.peak, tmp2));
    snpMarker.halo.quaternion.copy(camera.quaternion);
    snpMarker.halo.scale.setScalar(1 + 0.5 * pulse);
  }
  const show = ring.uniforms.uShow.value;
  for (const l of labels) {
    tmp.copy(l.pos).project(camera);
    l.el.style.opacity = tmp.z < 1 ? show * 0.9 : 0;
    l.el.style.transform = `translate(-50%,-50%) translate(${((tmp.x + 1) / 2) * window.innerWidth}px, ${((1 - tmp.y) / 2) * window.innerHeight}px)`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- intro ----------
$('scaleNote').textContent = `${resource.meta.significant_pairs.toLocaleString('en-US')} significant associations · ${genome.n.toLocaleString('en-US')} SNPs · ${resource.meta.significant_voxels.toLocaleString('en-US')} voxels. P < 5e−8 / 2,075,298. Brain2M atlas: 120 regions. The 3D brain is drawn in ${vox.cellMm}-mm blocks, each showing the strongest effect inside it; slices, search, tables and downloads keep the native 1-mm grid.`;
dataStatus('Real association index loaded. Select an example, SNP or voxel.');
syncUi();
requestAnimationFrame(frame);
setCut(HOME_CUT.focus, HOME_CUT.dir);
tweenValue(brain.uniforms.uAssemble, 1, 3200).then(() => tweenValue(brain.uniforms.uCut, 1, 1800));
wait(1200).then(() => tweenValue(ring.uniforms.uShow, 1, 1600));
flyTo(OVERVIEW.pos, OVERVIEW.target, 3000).then(async (ok) => {
  if (!ok) return;
  controls.autoRotate = !reduceMotion;
  // The guided tour starts only when requested by the visitor.
});
