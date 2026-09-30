/** Tiny WebAudio click for button presses. Silent until the user enables sound. */
let ctx: AudioContext | null = null;

export function click(): void {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1600, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.04);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch {
    // Audio is optional.
  }
}
