import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// A page restored from the back/forward cache (e.g. Back after logging out)
// would show the old screens without asking the server; reload so the session
// is checked again.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

// Register the PWA service worker (installability + offline fallback page).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // Non-fatal — the app works fine without the service worker.
      });
  });
}
