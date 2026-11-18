// Interface sounds, synthesised with Web Audio (no audio files). Off/on is remembered per browser.
// Each sound is a few short layers: clear high sine/triangle notes with a crisp noise attack,
// and a quiet echo on the two selection sounds.
const STORAGE_KEY = 'brain2m-sound';
const MASTER = 0.16;

// Layer fields: wave ('sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'), at (s), dur (s), gain,
// f0 → f1 (oscillator Hz), filter [type, Hz from, Hz to, Q], echo (send to the delay line).
const SOUNDS = Object.freeze({
  // Selecting a voxel: a clear glass ping with a bright overtone and a crisp attack.
  voxel: [
    { wave: 'noise', at: 0, dur: 0.012, gain: 0.3, filter: ['highpass', 7000, 7000, 1] },
    { wave: 'sine', at: 0, dur: 0.32, gain: 0.5, f0: 1568, f1: 1568, echo: true },
    { wave: 'sine', at: 0, dur: 0.2, gain: 0.22, f0: 3136, f1: 3136, echo: true },
    { wave: 'triangle', at: 0, dur: 0.09, gain: 0.12, f0: 4704, f1: 4704 },
  ],
  // Selecting a variant: two bright rising notes with an airy shimmer.
  snp: [
    { wave: 'noise', at: 0, dur: 0.16, gain: 0.1, filter: ['highpass', 6000, 12000, 1] },
    { wave: 'sine', at: 0, dur: 0.14, gain: 0.42, f0: 2093, f1: 2093, echo: true },
    { wave: 'triangle', at: 0, dur: 0.07, gain: 0.14, f0: 4186, f1: 4186 },
    { wave: 'sine', at: 0.07, dur: 0.3, gain: 0.45, f0: 3136, f1: 3136, echo: true },
    { wave: 'triangle', at: 0.07, dur: 0.12, gain: 0.12, f0: 6272, f1: 6272 },
  ],
  // Buttons: a short, crisp tick.
  ui: [
    { wave: 'noise', at: 0, dur: 0.01, gain: 0.35, filter: ['highpass', 6500, 6500, 1] },
    { wave: 'sine', at: 0, dur: 0.03, gain: 0.3, f0: 3520, f1: 3520 },
  ],
  // No result: two clear falling notes.
  error: [
    { wave: 'triangle', at: 0, dur: 0.1, gain: 0.4, f0: 988, f1: 988 },
    { wave: 'triangle', at: 0.11, dur: 0.18, gain: 0.4, f0: 740, f1: 740 },
  ],
});

function readPreference() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

let enabled = readPreference();
let rig = null; // { ctx, out, echo, noise }

export const isSoundOn = () => enabled;

export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* private mode: keep it for this visit only */ }
}

function buildRig(AudioCtx) {
  const ctx = new AudioCtx();
  const out = ctx.createGain();
  out.gain.value = MASTER;
  out.connect(ctx.destination);
  // Short feedback echo for the selection sounds.
  const echo = ctx.createDelay(0.5);
  echo.delayTime.value = 0.11;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(out);
  // One second of white noise, reused by every noise layer.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return { ctx, out, echo, noise };
}

function playLayer({ ctx, out, echo, noise }, layer, t0) {
  const start = t0 + layer.at;
  const end = start + layer.dur;
  let source;
  if (layer.wave === 'noise') {
    source = ctx.createBufferSource();
    source.buffer = noise;
  } else {
    source = ctx.createOscillator();
    source.type = layer.wave;
    source.frequency.setValueAtTime(layer.f0, start);
    source.frequency.exponentialRampToValueAtTime(layer.f1, end);
  }
  let node = source;
  if (layer.filter) {
    const [type, from, to, q] = layer.filter;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, end);
    node = node.connect(filter);
  }
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(layer.gain, start + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);
  node.connect(amp);
  amp.connect(out);
  if (layer.echo) amp.connect(echo);
  source.start(start);
  source.stop(end + 0.02);
}

/** Play one interface sound. Silent when sound is off or the browser has no Web Audio. */
export function play(kind) {
  const layers = SOUNDS[kind];
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!enabled || !layers || !AudioCtx) return;
  try {
    rig = rig || buildRig(AudioCtx);
    if (rig.ctx.state === 'suspended') rig.ctx.resume();
    const t0 = rig.ctx.currentTime + 0.005;
    for (const layer of layers) playLayer(rig, layer, t0);
  } catch (err) {
    console.warn('Sound unavailable:', err);
    enabled = false;
  }
}
