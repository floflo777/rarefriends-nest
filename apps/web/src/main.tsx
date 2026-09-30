import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { resolveDeepLink } from "./deepLink.js";
import "./styles.css";

// `/?p=/pet/gen/1969` (the 200-returning form of a deep link): restore the route before the router reads it.
const deep = resolveDeepLink(window.location.search);
if (deep) window.history.replaceState(null, "", `${import.meta.env.BASE_URL.replace(/\/$/, "")}${deep}${window.location.hash}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
