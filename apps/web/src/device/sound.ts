/**
 * Tiny WebAudio sounds. Silent until the user enables sound: a click on every button press
 * and one short blip per care reaction (eat, train, raise, hatch), each a different shape so
 * they can be told apart with the screen out of sight.
 */
let ctx: AudioContext | null = null;

interface Note {
  /** Start offset in seconds. */
  at: number;
  from: number;
  to: number;
  length: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: readonly Note[]): void {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of notes) {
      const t = t0 + n.at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? "square";
      osc.frequency.setValueAtTime(n.from, t);
      osc.frequency.exponentialRampToValueAtTime(n.to, t + n.length * 0.8);
      gain.gain.setValueAtTime(n.gain ?? 0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.length + 0.01);
    }
  } catch {
    // Audio is optional.
  }
}

export function click(): void {
  play([{ at: 0, from: 1600, to: 900, length: 0.05 }]);
}

export type BlipName = "eat" | "train" | "raise" | "hatch";

const BLIPS: Readonly<Record<BlipName, readonly Note[]>> = {
  // Two munches: low, then lower.
  eat: [
    { at: 0, from: 520, to: 380, length: 0.09, type: "triangle", gain: 0.08 },
    { at: 0.14, from: 480, to: 340, length: 0.09, type: "triangle", gain: 0.08 },
  ],
  // Three rising steps, one per pip.
  train: [
    { at: 0, from: 660, to: 660, length: 0.07 },
    { at: 0.1, from: 830, to: 830, length: 0.07 },
    { at: 0.2, from: 1050, to: 1050, length: 0.1 },
  ],
  // A short fanfare for the new land.
  raise: [
    { at: 0, from: 523, to: 523, length: 0.1 },
    { at: 0.12, from: 659, to: 659, length: 0.1 },
    { at: 0.24, from: 784, to: 784, length: 0.1 },
    { at: 0.36, from: 1047, to: 1047, length: 0.22 },
  ],
  // A chirp: quick upward sweep, twice.
  hatch: [
    { at: 0, from: 900, to: 1800, length: 0.08, type: "sine", gain: 0.08 },
    { at: 0.16, from: 1000, to: 2000, length: 0.1, type: "sine", gain: 0.08 },
  ],
};

export function blip(name: BlipName): void {
  play(BLIPS[name]);
}
