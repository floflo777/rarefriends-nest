/**
 * The handheld: shell, LCD, three buttons, keyboard and sound. It owns the screen
 * state machine and asks the data source for everything. Care actions come from core's
 * planner; in demo mode `onSimulate` applies them to the mock, in wallet mode `chain`
 * dry-runs then signs them, in visitor mode nothing can run.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { EXPLORER_URL, type CareEvent, type Eligibility, type StewardAction } from "@nest/core";
import { friendKey, type NestDataSource } from "../data/source.js";
import { Lcd, type LcdScene } from "../lcd/Lcd.jsx";
import { careMenu, gateMenu, hatchOf, isPaid, planFor } from "../model/care.js";
import { shortHash } from "../model/format.js";
import { identityOf, petState, previousSavings, recentCareEvents, rememberSavings, type PetMemory } from "../model/pet.js";
import { sceneSource, type TokenScene } from "../model/scene.js";
import { initialState, remapCare, step, type CareEntry, type Input, type MachineContext, type MachineState, type Screen } from "../screens/machine.js";
import { isReactionOver, reactionEndsAt, screenAfterReaction, startReaction, type Reaction, type ReactionKind } from "../screens/reaction.js";
import { renderScreen, sceneCaption, type DeviceMode, type SceneState, type ScreenModel } from "../screens/render.js";
import { phaseAfterDryRun, runInput, type RunState } from "../screens/run.js";
import type { ChainActions } from "../wallet/actions.js";
import { Buttons } from "./Buttons.jsx";
import { blip, click, type BlipName } from "./sound.js";
import { useDeviceData, type DeviceTarget } from "./useDeviceData.js";

/** What a demo simulation reports: the toast line, and whether the mock applied the action (a dry-run revert applies nothing). */
export interface SimulateResult {
  line: string;
  applied: boolean;
}

export interface DeviceProps {
  source: NestDataSource;
  mode: DeviceMode;
  target: DeviceTarget;
  initialScreen?: Screen;
  /** Demo mode: applies the action to the mock and returns the toast line (a bare string means applied). */
  onSimulate?: (action: StewardAction) => Promise<string | SimulateResult> | string | SimulateResult;
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

type DeviceEvent =
  | { type: "input"; input: Input; ctx: MachineContext }
  | { type: "ran" }
  | { type: "goto"; screen: Screen }
  | { type: "recare"; prev: readonly CareEntry[]; next: readonly CareEntry[] };

function reducer(s: DeviceState, e: DeviceEvent): DeviceState {
  if (e.type === "ran") return { ...s, pending: null };
  if (e.type === "recare") {
    const machine = remapCare(s.machine, e.prev, e.next);
    return machine === s.machine ? s : { ...s, machine };
  }
  if (e.type === "goto") return { ...s, machine: initialState(e.screen) };
  const [machine, effect] = step(s.machine, e.input, e.ctx);
  return {
    machine,
    petIndex: effect?.type === "select" ? effect.friendIndex : s.petIndex,
    pending: effect?.type === "action" ? { kind: effect.kind, seq: (s.pending?.seq ?? 0) + 1 } : s.pending,
  };
}

const SOUND_KEY = "nest.sound";
const SLOW_TICK_MS = 30_000;
/** Frame rate while a reaction plays (the hop is the idle clip at double rate; sparkles step at 8 Hz). */
const REACTION_FPS = 8;

/** The blip a reaction opens with; save, withdraw and wake stay silent. */
const REACTION_BLIP: Readonly<Partial<Record<ReactionKind, BlipName>>> = { eating: "eat", training: "train", moving: "raise", hatching: "hatch" };

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
  const [scenes, setScenes] = useState<Record<string, SceneState>>({});
  /** Demo only: pets whose generation moved on the mock while the minted scene did not. */
  const [staleScenes, setStaleScenes] = useState<Record<string, true>>({});
  const [reaction, setReaction] = useState<Reaction | null>(null);
  /** Promotes/upgrades run in this session, so the pet looks proud right after. */
  const [localEvents, setLocalEvents] = useState<CareEvent[]>([]);
  /** Savings scale per token as it was when the token first came on screen this session. */
  const savingsBefore = useRef<Record<string, number | undefined>>({});
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
      care: care.map((c) => ({ kind: c.action.kind, enabled: c.enabled, paid: isPaid(c.action) })),
      friendCount: friends.length,
      hasEgg: (data.household?.eggTokenId ?? null) !== null,
      readOnly: mode === "visitor",
    }),
    [care, friends.length, data.household, mode],
  );

  // The CARE list is rebuilt on every refresh; keep the cursor on the action kind it was on.
  const prevCare = useRef<readonly CareEntry[]>(ctx.care);
  useLayoutEffect(() => {
    const prev = prevCare.current;
    prevCare.current = ctx.care;
    if (prev !== ctx.care && prev.map((e) => e.kind).join() !== ctx.care.map((e) => e.kind).join()) dispatch({ type: "recare", prev, next: ctx.care });
  }, [ctx.care]);

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

  /** A promote or upgrade that went through (simulated or signed) makes the pet proud for a day. */
  const recordCare = useCallback((action: StewardAction) => {
    const kind = action.kind === "raise" ? "promote" : action.kind === "train" ? "upgrade" : null;
    if (kind) setLocalEvents((e) => [...e, { action: kind, at: Date.now() / 1000 }]);
  }, []);

  // Thrifty: compare today's savings with what this browser saw last time, once per token.
  const memory: PetMemory = useMemo(() => {
    const m: PetMemory = { recentEvents: recentCareEvents(data.household?.owner, data.snapshot, now, localEvents) };
    if (petKey && pet) {
      if (!(petKey in savingsBefore.current)) savingsBefore.current[petKey] = previousSavings(petKey);
      const before = savingsBefore.current[petKey];
      if (before !== undefined) m.previousSavings = before;
    }
    return m;
    // `now` only matters at day granularity for the events; re-deriving on every tick is cheap.
  }, [data.household, data.snapshot, localEvents, petKey, pet, now]);

  useEffect(() => {
    if (!pet || !petKey) return;
    rememberSavings(petKey, petState(pet, data.protocol, now, memory).vitals.savings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petKey, data.generation]);

  /** Plays the action's reaction on the LCD now that its verdict is known. */
  const beginReaction = useCallback(
    (action: StewardAction) => {
      const at = Date.now();
      const r = startReaction(action, pet, data.protocol, at / 1000, mode === "demo");
      if (!r) return;
      setNowMs(at);
      setReaction(r);
      const name = REACTION_BLIP[r.kind];
      if (sound && name) blip(name);
    },
    [pet, data.protocol, mode, sound],
  );

  /** Ends the reaction (timer or button): a move goes on to HOME and refreshes the scene. */
  const endReaction = useCallback(() => {
    if (!reaction) return;
    setReaction(null);
    const next = screenAfterReaction(reaction);
    if (!next) return;
    dispatch({ type: "goto", screen: next });
    const key = reaction.friend ? friendKey(reaction.friend.collection, reaction.friend.tokenId) : petKey;
    if (!key) return;
    if (mode === "demo") setStaleScenes((m) => ({ ...m, [key]: true }));
    else
      setScenes((m) => {
        const { [key]: _dropped, ...rest } = m;
        return rest;
      });
  }, [reaction, petKey, mode]);

  useEffect(() => {
    if (!reaction) return;
    const now = Date.now() / 1000;
    if (isReactionOver(reaction, now)) {
      endReaction();
      return;
    }
    const t = setTimeout(endReaction, Math.ceil((reactionEndsAt(reaction) - now) * 1000));
    return () => clearTimeout(t);
  }, [reaction, endReaction]);

  const finishRun = useCallback(
    (refresh: boolean) => {
      setRun(null);
      if (refresh) {
        chain?.settled?.();
        data.refresh();
        if (run?.phase.phase === "done") beginReaction(run.action);
      }
    },
    [chain, data, run, beginReaction],
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
        recordCare(action);
        setToast(`DONE · tx ${shortHash(hashes[hashes.length - 1] ?? "")}`);
      } catch (e) {
        update({ phase: "failed", message: errorText(e), hashes });
      }
    },
    [chain, recordCare],
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
          (result) => {
            const { line, applied } = typeof result === "string" ? { line: result, applied: true } : result;
            setToast(line);
            if (applied) {
              recordCare(action);
              beginReaction(action);
            }
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

  // HOME: read the pet's tokenURI scene once per token, only when someone looks at it.
  const screen = state.machine.screen;
  useEffect(() => {
    if (screen !== "HOME" || !pet || !petKey || scenes[petKey]) return;
    if (!source.scene) {
      setScenes((m) => ({ ...m, [petKey]: { status: "failed", message: "no scene in this data source" } }));
      return;
    }
    let cancelled = false;
    setScenes((m) => ({ ...m, [petKey]: { status: "loading" } }));
    void source.scene(pet).then(
      (scene: TokenScene) => !cancelled && setScenes((m) => ({ ...m, [petKey]: { status: "ready", scene } })),
      (err: unknown) => !cancelled && setScenes((m) => ({ ...m, [petKey]: { status: "failed", message: errorText(err) } })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, petKey]);

  // Clock: at the clip's frame rate on the PET screen, slowly elsewhere (vitals and mood follow the time).
  const fps = reaction ? (reduced ? 0 : REACTION_FPS) : pet && screen === "PET" && !reduced && !run ? petState(pet, data.protocol, now, memory).animation.fps : 0;
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), fps > 0 ? Math.round(1000 / fps) : SLOW_TICK_MS);
    return () => clearInterval(t);
  }, [fps]);

  const press = useCallback(
    (input: Input) => {
      if (sound) click();
      if (reaction) {
        endReaction(); // any button skips the reaction
        return;
      }
      if (run) {
        const command = runInput(run, input);
        if (command === "sign") void sign(run.action);
        else if (command === "dismiss") finishRun(false);
        else if (command === "refresh-and-dismiss") finishRun(true);
        return;
      }
      dispatch({ type: "input", input, ctx });
    },
    [ctx, sound, run, sign, finishRun, reaction, endReaction],
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
    memory,
    scene: petKey ? (scenes[petKey] ?? null) : null,
    sceneStale: petKey !== null && staleScenes[petKey] === true,
    reaction,
    pupSprite: reaction?.pupId !== null && reaction?.pupId !== undefined ? (data.sprites[friendKey("Generations", reaction.pupId)] ?? null) : null,
  };
  const image = renderScreen(state.machine, model);
  const sceneState = model.scene;
  const sceneSrc = sceneState?.status === "ready" ? sceneSource(sceneState.scene, reduced) : null;
  const lcdScene: LcdScene | null =
    screen === "HOME" && !run && !reaction && pet && sceneSrc ? { src: sceneSrc, alt: `On-chain scene of ${identityOf(pet).name}, ${pet.collection} #${pet.tokenId}`, caption: sceneCaption(pet) } : null;

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
        <Lcd image={image} scene={lcdScene} />
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
