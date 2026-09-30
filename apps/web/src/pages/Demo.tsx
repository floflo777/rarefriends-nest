import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createNestClient, type StewardAction } from "@nest/core";
import { DataSourceProvider } from "../data/context.jsx";
import { createLiveSource } from "../data/live.js";
import { DEMO_OWNER, DEMO_TIME_SCALE, createMockSource } from "../data/mock.js";
import { Device } from "../device/Device.jsx";
import { deepLink } from "../deepLink.js";
import { shortAddress } from "../model/format.js";
import { runDemo, type DemoPhase } from "../screens/run.js";

function phaseText(phase: DemoPhase): string {
  if (phase.phase === "simulating") return `SIMULATING ON CHAIN… dry-run from ${shortAddress(phase.from, 4)}, nothing is sent`;
  return phase.line;
}

/**
 * The demo: a real household baked from the chain (real Friends, sprites, balances and
 * census), simulated actions. Confirming YES dry-runs the exact calldata on the live RPC
 * before the local mutation; the wallet is never asked for anything.
 */
export function DemoPage() {
  const live = useMemo(() => createLiveSource(createNestClient()), []);
  const mock = useMemo(() => createMockSource({ snapshot: () => live.snapshot(), scene: (f) => live.scene(f) }), [live]);
  const [phase, setPhase] = useState<DemoPhase | null>(null);
  const onSimulate = useCallback(
    (action: StewardAction) => runDemo(action, { client: live.client, owner: DEMO_OWNER, simulate: (a) => mock.simulate(a), isSimulated: (a) => mock.isSimulated(a), onPhase: setPhase }).then((r) => ({ line: r.line, applied: r.applied })),
    [live, mock],
  );
  const { fixture } = mock;
  const baked = new Date(fixture.bakedAt * 1000).toISOString().slice(0, 10);

  return (
    <DataSourceProvider source={mock}>
      <main className="page">
        <Device
          source={mock}
          mode="demo"
          target={{ kind: "household", owner: DEMO_OWNER }}
          onSimulate={onSimulate}
          footer={
            <>
              <p className="hint" aria-label="Demo notice">
                <strong>DEMO · REAL FRIENDS, SIMULATED ACTIONS</strong>
              </p>
              <p className="hint">
                Household {shortAddress(DEMO_OWNER, 4)} read at block {fixture.blockNumber.toLocaleString("en-US")} on {baked} · DEMO TIME ×{DEMO_TIME_SCALE}: rewards accrue{" "}
                {DEMO_TIME_SCALE}× faster than on chain
              </p>
              <p className="hint" role="status" aria-live="polite" data-testid="demo-dry-run">
                {phase ? phaseText(phase) : "YES dry-runs the real calldata on the live RPC (eth_simulateV1) before anything moves here; nothing is ever sent"}
              </p>
              <nav className="under">
                <Link to="/">Home</Link>
                <Link to={deepLink("/card/gen/1969?demo")}>Pet card</Link>
                <Link to={deepLink("/ledger")}>Ledger</Link>
              </nav>
            </>
          }
        />
      </main>
    </DataSourceProvider>
  );
}
