import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DataSourceProvider } from "../data/context.jsx";
import { createMockSource, DEMO_OWNER } from "../data/mock.js";
import { Device } from "../device/Device.jsx";

export function DemoPage() {
  const mock = useMemo(() => createMockSource(), []);
  return (
    <DataSourceProvider source={mock}>
      <main className="page">
        <Device
          source={mock}
          mode="demo"
          target={{ kind: "household", owner: DEMO_OWNER }}
          onAction={(action, pet) => mock.simulate(action.kind, action.kind === "hatch" ? null : pet ? { collection: pet.collection, tokenId: pet.tokenId } : null)}
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
