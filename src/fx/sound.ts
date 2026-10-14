// Sound effects for the round recap, synthesized with Web Audio -- no sound
// files to ship. Best-effort: in a browser without Web Audio, or before the
// page has had a click, they just stay silent.
//
// The mute switch is remembered per browser.

const MUTE_KEY = "godfield.muted";

let muted: boolean = readMuted();
let audioCtx: AudioContext | null = null;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable (private window etc.) -- just don't remember it
  }
}

function ctx(): AudioContext | null {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

// --- tiny synth ----------------------------------------------------------

interface ToneOptions {
  type?: OscillatorType;
  from: number;
  to?: number;
  start?: number;
  duration: number;
  volume?: number;
}

// A single oscillator note whose pitch glides from `from` to `to` Hz.
function tone(ac: AudioContext, { type = "sine", from, to = from, start = 0, duration, volume = 0.2 }: ToneOptions): void {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

interface NoiseOptions {
  start?: number;
  duration: number;
  volume?: number;
  filter?: BiquadFilterType;
  from?: number;
  to?: number;
}

// A burst of filtered white noise (impacts, whooshes).
function noise(
  ac: AudioContext,
  { start = 0, duration, volume = 0.3, filter = "lowpass", from = 2000, to = from }: NoiseOptions
): void {
  const t0 = ac.currentTime + start;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buffer;
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.setValueAtTime(from, t0);
  biquad.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(biquad).connect(gain).connect(ac.destination);
  src.start(t0);
}

const SFX: Record<string, (ac: AudioContext) => void> = {
  card: (ac) => noise(ac, { duration: 0.18, volume: 0.15, filter: "bandpass", from: 600, to: 3000 }),
  hit: (ac) => {
    noise(ac, { duration: 0.25, volume: 0.45, from: 3000, to: 200 });
    tone(ac, { type: "sine", from: 160, to: 45, duration: 0.3, volume: 0.5 });
  },
  block: (ac) => {
    tone(ac, { type: "square", from: 900, to: 700, duration: 0.12, volume: 0.08 });
    tone(ac, { type: "triangle", from: 1400, to: 1300, start: 0.02, duration: 0.35, volume: 0.12 });
  },
  shield: (ac) => {
    [523, 659, 784].forEach((f, i) => tone(ac, { type: "triangle", from: f, start: i * 0.07, duration: 0.3, volume: 0.14 }));
  },
  buff: (ac) => {
    tone(ac, { type: "sine", from: 400, to: 1200, duration: 0.35, volume: 0.15 });
    [1047, 1319].forEach((f, i) => tone(ac, { type: "sine", from: f, start: 0.25 + i * 0.08, duration: 0.2, volume: 0.08 }));
  },
  debuff: (ac) => {
    tone(ac, { type: "sawtooth", from: 520, to: 130, duration: 0.45, volume: 0.08 });
    tone(ac, { type: "sine", from: 260, to: 70, duration: 0.5, volume: 0.15 });
  },
  ultimate: (ac) => {
    tone(ac, { type: "sawtooth", from: 110, to: 880, duration: 0.5, volume: 0.07 });
    noise(ac, { start: 0.45, duration: 0.9, volume: 0.5, from: 4000, to: 120 });
    tone(ac, { type: "sine", from: 90, to: 30, start: 0.45, duration: 0.9, volume: 0.6 });
  },
  // Ultimate cut-in banner: a whoosh into a bright chord stab.
  cutin: (ac) => {
    noise(ac, { duration: 0.35, volume: 0.25, filter: "bandpass", from: 400, to: 6000 });
    [523, 659, 784, 1047].forEach((f) => tone(ac, { type: "sawtooth", from: f, start: 0.12, duration: 0.5, volume: 0.035 }));
    tone(ac, { type: "sine", from: 130, to: 110, start: 0.12, duration: 0.6, volume: 0.25 });
  },
  // Guardian ultimate: a falling whistle, then a heavy metallic crash.
  guardianDrop: (ac) => {
    tone(ac, { type: "sine", from: 1400, to: 260, duration: 0.42, volume: 0.12 });
    noise(ac, { duration: 0.42, volume: 0.12, filter: "bandpass", from: 3000, to: 500 });
  },
  guardianImpact: (ac) => {
    tone(ac, { type: "sine", from: 80, to: 22, duration: 1.1, volume: 0.75 });
    noise(ac, { duration: 0.9, volume: 0.55, from: 2500, to: 80 });
    [1760, 2350, 3100].forEach((f, i) => tone(ac, { type: "triangle", from: f, to: f * 0.98, start: 0.01 * i, duration: 1.3, volume: 0.07 }));
  },
  // Pyromancer ultimate: a rising roar while charging, then a crackling blast.
  pyroCharge: (ac) => {
    noise(ac, { duration: 1.0, volume: 0.3, filter: "bandpass", from: 180, to: 2600 });
    tone(ac, { type: "sawtooth", from: 70, to: 260, duration: 1.0, volume: 0.07 });
  },
  pyroExplode: (ac) => {
    tone(ac, { type: "sine", from: 70, to: 20, duration: 1.2, volume: 0.7 });
    noise(ac, { duration: 1.3, volume: 0.6, from: 6000, to: 120 });
    for (let i = 0; i < 10; i++) {
      noise(ac, { start: 0.1 + Math.random() * 0.9, duration: 0.05, volume: 0.25, filter: "highpass", from: 2500 });
    }
  },
  draw: (ac) => {
    [440, 440, 392].forEach((f, i) => tone(ac, { type: "triangle", from: f, start: i * 0.2, duration: 0.4, volume: 0.13 }));
  },
  victory: (ac) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(ac, { type: "triangle", from: f, start: i * 0.12, duration: 0.4, volume: 0.15 }));
  },
  defeat: (ac) => {
    [392, 349, 311, 262].forEach((f, i) => tone(ac, { type: "triangle", from: f, start: i * 0.16, duration: 0.45, volume: 0.15 }));
  },
};

export type SfxName = keyof typeof SFX | string;

export function playSfx(name: string): void {
  if (muted || !SFX[name]) return;
  try {
    const ac = ctx();
    if (ac) (SFX[name] as (ac: AudioContext) => void)(ac);
  } catch (err) {
    console.warn(`[sound] ${name}:`, err);
  }
}
