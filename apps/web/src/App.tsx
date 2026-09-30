import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { resolveDeepLink } from "./deepLink.js";
import { CardPage } from "./pages/Card.jsx";
import { DemoPage } from "./pages/Demo.jsx";
import { HomePage } from "./pages/Home.jsx";
import { LedgerPage } from "./pages/Ledger.jsx";
import { PetPage } from "./pages/Pet.jsx";
import { WalletProvider } from "./wallet/useWallet.jsx";

/** Vite's BASE_URL follows NEST_BASE so the router works under a GitHub Pages repo path. */
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Routes, after turning an in-app `/?p=/route` link into the route itself. */
function AppRoutes() {
  const location = useLocation();
  const deep = resolveDeepLink(location.search);
  if (deep) return <Navigate to={deep} replace />;
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/pet/:collection/:tokenId" element={<PetPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/ledger" element={<LedgerPage />} />
      <Route path="/card/:collection/:tokenId" element={<CardPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

export function App() {
  return (
    <WalletProvider>
      <BrowserRouter basename={basename}>
        <AppRoutes />
      </BrowserRouter>
    </WalletProvider>
  );
}
