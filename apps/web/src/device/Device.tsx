/**
 * The handheld: shell, LCD, three buttons, keyboard and sound. It owns the screen
 * state machine and asks the data source for everything. Care actions are delegated
 * to `onAction`; in demo mode the caller simulates, in visitor mode nothing can run.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Friend, StewardAction, StewardActionKind } from "@nest/core";
import { friendKey, type NestDataSource } from "../data/source.js";
import { Lcd, LCD_MONO } from "../lcd/Lcd.jsx";
import { careActions } from "../model/steward.js";
import { initialState, step, type Input, type MachineContext, type MachineState, type Screen } from "../screens/machine.js";
import { renderScreen, type DeviceMode, type ScreenModel } from "../screens/render.js";
import { Buttons } from "./Buttons.jsx";
import { click } from "./sound.js";
import { useDeviceData, type DeviceTarget } from "./useDeviceData.js";

export interface DeviceProps {
  source: NestDataSource;
  mode: DeviceMode;
  target: DeviceTarget;
  initialScreen?: Screen;
  /**
   * Called when the user confirms a care action; returns the toast line. Never called
   * in visitor mode. The wallet wiring (steward txs + sendTransaction) lands here later.
   */
  onAction?: (action: StewardAction, pet: Friend | null) => Promise<string> | string;
  /** Rendered under the device (links, wallet controls). */
  footer?: ReactNode;
}

interface DeviceState {
  machine: MachineState;
  petIndex: number;
  /** Action confirmed by the user, waiting to be run; `seq` distinguishes repeats. */
  pending: { kind: StewardActionKind; seq: number } | null;
}

type DeviceEvent = { type: "input"; input: Input; ctx: MachineContext } | { type: "ran" };

function reducer(s: DeviceState, e: DeviceEvent): DeviceState {
  if (e.type === "ran") return { ...s, pending: null };
  const [machine, effect] = step(s.machine, e.input, e.ctx);
  return {
    machine,
    petIndex: effect?.type === "select" ? effect.friendIndex : s.petIndex,
    pending: effect?.type === "action" ? { kind: effect.kind, seq: (s.pending?.seq ?? 0) + 1 } : s.pending,
  };
}

const SOUND_KEY = "nest.sound";

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function usePrefersReducedMotion(): boolean {
  const query = () => (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function Device({ source, mode, target, initialScreen = "PET", onAction, footer }: DeviceProps) {
  const data = useDeviceData(source, target);
  const [state, dispatch] = useReducer(reducer, initialScreen, (s): DeviceState => ({ machine: initialState(s), petIndex: 0, pending: null }));
  const [toast, setToast] = useState<string | null>(null);
  const [sound, setSound] = useState(readSound);
  const [tick, setTick] = useState(0);
  const reduced = usePrefersReducedMotion();

  const friends = data.household?.friends ?? [];
  const pet = friends[Math.min(state.petIndex, Math.max(0, friends.length - 1))] ?? null;
  const care = useMemo(() => careActions(pet, { protocol: data.protocol, household: data.household }), [pet, data.protocol, data.household]);

  const ctx: MachineContext = useMemo(
    () => ({ careKinds: care.map((a) => a.kind), friendCount: friends.length, hasEgg: (data.household?.eggTokenId ?? null) !== null, readOnly: mode === "visitor" }),
    [care, friends.length, data.household, mode],
  );

  // Run a confirmed action outside the reducer, once per confirmation.
  const pending = state.pending;
  useEffect(() => {
    if (!pending) return;
    dispatch({ type: "ran" });
    const action = care.find((a) => a.kind === pending.kind);
    if (!action || mode === "visitor") return;
    if (!onAction) {
      setToast("Action not wired yet");
      return;
    }
    void Promise.resolve(onAction(action, pet)).then(
      (line) => {
        setToast(line);
        data.refresh();
      },
      (e: unknown) => setToast(e instanceof Error ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.seq]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Idle animation on the PET screen, off under prefers-reduced-motion.
  const screen = state.machine.screen;
  useEffect(() => {
    if (reduced || screen !== "PET") return;
    const t = setInterval(() => setTick((n) => n + 1), 600);
    return () => clearInterval(t);
  }, [reduced, screen]);

  const press = useCallback(
    (input: Input) => {
      if (sound) click();
      dispatch({ type: "input", input, ctx });
    },
    [ctx, sound],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") press("left");
      else if (e.key === "ArrowRight") press("right");
      else if (e.key === "Enter" || e.key === " ") {
        if (tag === "BUTTON" || tag === "A") return; // let the focused control activate natively
        press("ok");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Storage is optional.
    }
    if (next) click();
  };

  const model: ScreenModel = {
    mode,
    protocol: data.protocol,
    household: data.household,
    snapshot: data.snapshot,
    pet,
    frames: pet ? (data.sprites[friendKey(pet.collection, pet.tokenId)] ?? []) : [],
    care,
    status: data.status,
    loading: data.loading,
  };
  const buffer = renderScreen(state.machine, model, tick);

  return (
    <section className="device" aria-label="Nest handheld">
      <div className="shell">
        <div className="shell-top">
          <span className="brand">NEST</span>
          <span className="mode-tag">{mode === "demo" ? "SIMULATED" : mode === "visitor" ? "READ ONLY" : "LIVE"}</span>
          <button type="button" className="icon-btn" aria-pressed={sound} aria-label={sound ? "Mute button sounds" : "Enable button sounds"} onClick={toggleSound}>
            {sound ? "♫" : "♪"}
          </button>
        </div>
        <Lcd buffer={buffer} palette={LCD_MONO} />
        <Buttons onPress={press} />
        <p className="hint">Arrow keys move, Enter or Space selects</p>
      </div>
      <div className="toast-area" role="status" aria-live="polite">
        {toast && <span className={`toast${mode === "demo" ? " toast-sim" : ""}`}>{mode === "demo" ? `SIMULATED: ${toast}` : toast}</span>}
      </div>
      {footer}
    </section>
  );
}
