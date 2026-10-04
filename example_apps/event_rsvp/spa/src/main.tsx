import { appId, PilelyProvider } from "@pilely/core";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MissingAppId } from "./components/MissingAppId";
import { HOST } from "./config";
import { router } from "./router";
// Mock mode's sample content; a no-op (and no content) in any other build.
import "./mock_seed";
import "./i18n";
import "./styles/globals.css";

// The static <title> in index.html is a pre-JS fallback; the real title
// comes from config so a copier edits it in ONE place.
document.title = HOST.name;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element missing in index.html");
}

// The placeholder must fail loudly, never silently bounce through a failing
// mint or a page of failed data calls. appId() answers the
// <meta name="pilely-app"> value through client.js (mock mode answers its
// own fixed id); it throws when client.js did not load, which is treated
// like the placeholder, since neither confirms a real id.
function hasRegisteredAppId(): boolean {
  try {
    const id = appId();
    return id !== null && id !== "REPLACE_WITH_YOUR_PILE_ID";
  } catch {
    return false;
  }
}

createRoot(rootEl).render(
  <StrictMode>
    {hasRegisteredAppId() ? (
      // PilelyProvider is the app's single source of auth state and its
      // single data cache: every @pilely hook below it waits for the
      // runtime's `ready`, and every write refreshes the reads it affects.
      <PilelyProvider>
        <RouterProvider router={router} />
      </PilelyProvider>
    ) : (
      <MissingAppId />
    )}
  </StrictMode>,
);
