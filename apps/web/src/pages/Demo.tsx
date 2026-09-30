import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DataSourceProvider } from "../data/context.jsx";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { Device } from "../device/Device.jsx";

/** A simulated household: the same planner, vitals and screens as live mode, applied to fixtures. */
export function DemoPage() {
  const mock = useMemo(() => createMockSource(), []);
  return (
    <DataSourceProvider source={mock}>
      <main className="page">
        <Device
          source={mock}
          mode="demo"
          target={{ kind: "household", owner: DEMO_OWNER }}
          onSimulate={(action) => mock.simulate(action)}
          footer={
            <nav className="under">
              <Link to="/">Home</Link>
              <Link to="/card/gen/1969?demo">Pet card</Link>
              <Link to="/ledger">Ledger</Link>
            </nav>
          }
        />
      </main>
    </DataSourceProvider>
  );
}
