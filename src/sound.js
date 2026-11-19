// Interface sounds, synthesised with Web Audio (no audio files). Off/on is remembered per browser.
// Each sound is a warm synth voice: two slightly detuned sawtooth notes through a resonant low-pass
// sweep, a sine an octave below for body, and a quiet echo on the two selection sounds.
const STORAGE_KEY = 'brain2m-sound';
const MASTER = 0.2;

// Layer fields: wave ('sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'), at (s), dur (s), gain,
// f0 → f1 (oscillator Hz), filter [type, Hz from, Hz to, Q], echo (send to the delay line).
const SOUNDS = Object.freeze({
  // Selecting a voxel: a full synth pluck on G, the filter closing as it rings.
  voxel: [
    { wave: 'sine', at: 0, dur: 0.34, gain: 0.5, f0: 196, f1: 196 },
    { wave: 'sawtooth', at: 0, dur: 0.3, gain: 0.26, f0: 389.5, f1: 389.5, filter: ['lowpass', 3200, 600, 5], echo: true },
    { wave: 'sawtooth', at: 0, dur: 0.3, gain: 0.26, f0: 394.5, f1: 394.5, filter: ['lowpass', 3200, 600, 5], echo: true },
    { wave: 'sine', at: 0, dur: 0.16, gain: 0.12, f0: 784, f1: 784, echo: true },
  ],
  // Selecting a variant: two rising notes (E then B), the filter opening on the second.
  snp: [
    { wave: 'sine', at: 0, dur: 0.42, gain: 0.45, f0: 164.8, f1: 164.8 },
    { wave: 'sawtooth', at: 0, dur: 0.14, gain: 0.24, f0: 328, f1: 328, filter: ['lowpass', 2400, 900, 4], echo: true },
    { wave: 'sawtooth', at: 0, dur: 0.14, gain: 0.24, f0: 331.5, f1: 331.5, filter: ['lowpass', 2400, 900, 4], echo: true },
    { wave: 'sawtooth', at: 0.09, dur: 0.34, gain: 0.24, f0: 492, f1: 492, filter: ['lowpass', 900, 3400, 5], echo: true },
    { wave: 'sawtooth', at: 0.09, dur: 0.34, gain: 0.24, f0: 496, f1: 496, filter: ['lowpass', 900, 3400, 5], echo: true },
  ],
  // Buttons: a short, soft blip with a little body.
  ui: [
    { wave: 'sine', at: 0, dur: 0.07, gain: 0.45, f0: 330, f1: 247 },
    { wave: 'sawtooth', at: 0, dur: 0.05, gain: 0.2, f0: 660, f1: 494, filter: ['lowpass', 2600, 900, 3] },
  ],
  // No result: two low falling notes.
  error: [
    { wave: 'sawtooth', at: 0, dur: 0.12, gain: 0.3, f0: 233, f1: 233, filter: ['lowpass', 1500, 700, 3] },
    { wave: 'sine', at: 0, dur: 0.12, gain: 0.35, f0: 116.5, f1: 116.5 },
    { wave: 'sawtooth', at: 0.13, dur: 0.22, gain: 0.3, f0: 174.6, f1: 174.6, filter: ['lowpass', 1500, 500, 3] },
    { wave: 'sine', at: 0.13, dur: 0.22, gain: 0.35, f0: 87.3, f1: 87.3 },
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
