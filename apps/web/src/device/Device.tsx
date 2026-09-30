/**
 * The handheld: shell, LCD, three buttons, keyboard and sound. It owns the screen
 * state machine and asks the data source for everything. Care actions come from core's
 * planner; in demo mode `onSimulate` applies them to the mock, in wallet mode `chain`
 * dry-runs then signs them, in visitor mode nothing can run.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { EXPLORER_URL, type Eligibility, type StewardAction } from "@nest/core";
import { friendKey, type NestDataSource } from "../data/source.js";
import { Lcd } from "../lcd/Lcd.jsx";
import { careMenu, gateMenu, hatchOf, planFor } from "../model/care.js";
import { shortHash } from "../model/format.js";
import { petState } from "../model/pet.js";
import { initialState, step, type Input, type MachineContext, type MachineState, type Screen } from "../screens/machine.js";
import { renderScreen, type DeviceMode, type ScreenModel } from "../screens/render.js";
import { phaseAfterDryRun, runInput, type RunState } from "../screens/run.js";
import type { ChainActions } from "../wallet/actions.js";
import { Buttons } from "./Buttons.jsx";
import { click } from "./sound.js";
import { useDeviceData, type DeviceTarget } from "./useDeviceData.js";

export interface DeviceProps {
  source: NestDataSource;
  mode: DeviceMode;
  target: DeviceTarget;
  initialScreen?: Screen;
  /** Demo mode: applies the action to the mock and returns the toast line. */
  onSimulate?: (action: StewardAction) => Promise<string> | string;
  /** Wallet mode: ownership gate, dry-run and signing. Absent in demo and visitor mode. */
  chain?: ChainActions;
  /** Rendered under the device (links, wallet controls). */
  footer?: ReactNode;
}

interface DeviceState {
  machine: MachineState;
  petIndex: number;
  /** Action confirmed by the user, waiting to be run; `seq` distinguishes repeats. */
  pending: { kind: StewardAction["kind"]; seq: number } | null;
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
const SLOW_TICK_MS = 30_000;

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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Device({ source, mode, target, initialScreen = "PET", onSimulate, chain, footer }: DeviceProps) {
  const data = useDeviceData(source, target);
  const [state, dispatch] = useReducer(reducer, initialScreen, (s): DeviceState => ({ machine: initialState(s), petIndex: 0, pending: null }));
  const [toast, setToast] = useState<string | null>(null);
  const [sound, setSound] = useState(readSound);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [eligibility, setEligibility] = useState<Record<string, Eligibility | "pending">>({});
  const [run, setRun] = useState<RunState | null>(null);
  const [txLinks, setTxLinks] = useState<Hex[]>([]);
  const runSeq = useRef(0);
  const reduced = usePrefersReducedMotion();
  const now = nowMs / 1000;

  const friends = data.household?.friends ?? [];
  const pet = friends[Math.min(state.petIndex, Math.max(0, friends.length - 1))] ?? null;
  const petKey = pet ? friendKey(pet.collection, pet.tokenId) : null;

  const plan = useMemo(() => planFor(data.household, data.protocol), [data.household, data.protocol]);
  const gate = mode === "wallet" && chain && petKey ? (eligibility[petKey] ?? "pending") : null;
  const care = useMemo(() => gateMenu(careMenu(plan, pet), gate, mode === "visitor"), [plan, pet, gate, mode]);
  const hatch = useMemo(() => hatchOf(plan), [plan]);

  const ctx: MachineContext = useMemo(
    () => ({
      care: care.map((c) => ({ kind: c.action.kind, enabled: c.enabled })),
      friendCount: friends.length,
      hasEgg: (data.household?.eggTokenId ?? null) !== null,
      readOnly: mode === "visitor",
    }),
    [care, friends.length, data.household, mode],
  );

  // Ownership gate: re-checked at a fresh block whenever the pet or the data changes.
  useEffect(() => {
    if (mode !== "wallet" || !chain || !pet || !petKey) return;
    let cancelled = false;
    setEligibility((m) => ({ ...m, [petKey]: "pending" }));
    void chain.eligibility(pet).then(
      (e) => !cancelled && setEligibility((m) => ({ ...m, [petKey]: e })),
      (err: unknown) => !cancelled && setEligibility((m) => ({ ...m, [petKey]: { eligible: false, reason: errorText(err), blockNumber: 0n } })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chain, petKey, data.generation]);

  const finishRun = useCallback(
    (refresh: boolean) => {
      setRun(null);
      if (refresh) {
        chain?.settled?.();
        data.refresh();
      }
    },
    [chain, data],
  );

  const sign = useCallback(
    async (action: StewardAction) => {
      if (!chain) return;
      const seq = ++runSeq.current;
      const total = action.txs.length;
      const hashes: Hex[] = [];
      const update = (phase: RunState["phase"]) => {
        if (runSeq.current === seq) setRun({ action, phase });
      };
      try {
        for (let i = 0; i < total; i++) {
          const tx = action.txs[i]!;
          update({ phase: "signing", index: i, total, description: tx.description });
          const hash = await chain.send(tx, (h) => update({ phase: "pending", index: i, total, hash: h }));
          hashes.push(hash);
          setTxLinks((l) => [...l, hash]);
        }
        update({ phase: "done", hashes });
        setToast(`DONE · tx ${shortHash(hashes[hashes.length - 1] ?? "")}`);
      } catch (e) {
        update({ phase: "failed", message: errorText(e), hashes });
      }
    },
    [chain],
  );

  // Run a confirmed action outside the reducer, once per confirmation.
  const pending = state.pending;
  useEffect(() => {
    if (!pending) return;
    dispatch({ type: "ran" });
    const item = care.find((c) => c.action.kind === pending.kind);
    if (!item || !item.enabled || mode === "visitor") return;
    const action = item.action;
    if (mode === "demo") {
      if (!onSimulate) return;
      void Promise.resolve()
        .then(() => onSimulate(action))
        .then(
          (line) => {
            setToast(line);
            data.refresh();
          },
          (e: unknown) => setToast(errorText(e)),
        );
      return;
    }
    if (!chain) return;
    const seq = ++runSeq.current;
    setRun({ action, phase: { phase: "simulating" } });
    void chain.dryRun(action.txs).then(
      (results) => runSeq.current === seq && setRun({ action, phase: phaseAfterDryRun(results) }),
      (e: unknown) => runSeq.current === seq && setRun({ action, phase: { phase: "rejected", reason: errorText(e) } }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.seq]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Clock: at the clip's frame rate on the PET screen, slowly elsewhere (vitals and mood follow the time).
  const screen = state.machine.screen;
  const fps = pet && screen === "PET" && !reduced && !run ? petState(pet, data.protocol, now).animation.fps : 0;
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), fps > 0 ? Math.round(1000 / fps) : SLOW_TICK_MS);
    return () => clearInterval(t);
  }, [fps]);

  const press = useCallback(
    (input: Input) => {
      if (sound) click();
      if (run) {
        const command = runInput(run, input);
        if (command === "sign") void sign(run.action);
        else if (command === "dismiss") finishRun(false);
        else if (command === "refresh-and-dismiss") finishRun(true);
        return;
      }
      dispatch({ type: "input", input, ctx });
    },
    [ctx, sound, run, sign, finishRun],
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
    now,
    reducedMotion: reduced,
    protocol: data.protocol,
    household: data.household,
    snapshot: data.snapshot,
    pet,
    sprite: petKey ? (data.sprites[petKey] ?? null) : null,
    care,
    hatch,
    status: data.status,
    loading: data.loading,
    run,
  };
  const image = renderScreen(state.machine, model);

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
        <Lcd image={image} />
        <Buttons onPress={press} />
        <p className="hint">Arrow keys move, Enter or Space selects</p>
      </div>
      <div className="toast-area" role="status" aria-live="polite">
        {toast && <span className={`toast${mode === "demo" ? " toast-sim" : ""}`}>{mode === "demo" ? `SIMULATED: ${toast}` : toast}</span>}
      </div>
      {txLinks.length > 0 && (
        <ul className="tx-links" aria-label="Transactions sent this session">
          {txLinks.map((hash) => (
            <li key={hash}>
              <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">
                tx {shortHash(hash)}
              </a>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}
