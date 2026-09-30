import { Link } from "react-router-dom";
import { useDataSource } from "../data/context.jsx";
import { Device } from "../device/Device.jsx";
import { deepLink } from "../deepLink.js";

/** The device opened on the LEDGER screen: protocol totals from the snapshot and chain state. */
export function LedgerPage() {
  const source = useDataSource();
  return (
    <main className="page">
      <Device
        source={source}
        mode="visitor"
        target={{ kind: "none" }}
        initialScreen="LEDGER"
        footer={
          <nav className="under">
            <Link to="/">Home</Link>
            <Link to={deepLink("/demo")}>Demo</Link>
          </nav>
        }
      />
    </main>
  );
}
