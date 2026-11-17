// Click sounds, synthesised with Web Audio (no audio files). Off/on is remembered per browser.
const STORAGE_KEY = 'brain2m-sound';
const VOLUME = 0.07;

// kind → [waveform, start Hz, end Hz, seconds]
const TONES = Object.freeze({
  voxel: ['triangle', 340, 210, 0.16],
  snp: ['sine', 880, 1320, 0.12],
  ui: ['sine', 620, 620, 0.05],
  error: ['triangle', 200, 150, 0.14],
});

function readPreference() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

let enabled = readPreference();
let ctx = null;

export const isSoundOn = () => enabled;

export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* private mode: keep it for this visit only */ }
}

/** Play a short tone. Silent when sound is off or the browser has no Web Audio. */
export function play(kind) {
  const tone = TONES[kind];
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!enabled || !tone || !AudioCtx) return;
  try {
    ctx = ctx || new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const [type, f0, f1, dur] = tone;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(VOLUME, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch (err) {
    console.warn('Sound unavailable:', err);
    enabled = false;
  }
}
