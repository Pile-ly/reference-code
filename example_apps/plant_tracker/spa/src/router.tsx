// TanStack Router tree — code-first, three routes.
//
// The app is served from its own origin (`<label>.pilely.app`) and owns the
// ORIGIN ROOT: Vite `base` is "/" and there is NO router `basepath` —
// `createRoute` paths are already the real paths (SPA standard §1/§3).
// `/plant/$plantId` carries the simple_db RECORD ID, so every plant page
// deep-links and survives a refresh (the server serves the shell for any
// unknown path; PlantPage resolves the id after load).
//
// The shell around every page: nav, the page — or the SIGN-IN GATE: this
// app is PRIVATE, no anonymous credential exists, so until
// `window.pilely.user()` answers someone there is nothing to show — then
// the §7b AI-client footer and the toast. Session rehydrate runs once here
// so every page below can read the store synchronously.

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AiFooter } from "./components/AiFooter";
import { AppNav } from "./components/AppNav";
import { SignInGate } from "./components/SignInGate";
import { Toast } from "./components/Toast";
import { useAgentAlternateLink } from "./hooks/useAgentAlternateLink";
import { AddPlantPage } from "./pages/AddPlantPage";
import { HomePage } from "./pages/HomePage";
import { PlantPage } from "./pages/PlantPage";
import { useSessionStore } from "./stores/session_store";

function Shell() {
  const rehydrate = useSessionStore((s) => s.rehydrate);
  const ready = useSessionStore((s) => s.ready);
  const user = useSessionStore((s) => s.user);
  // Establish who the visitor is, once: await the platform client's ready
  // promise (sign-in callback consumed, token stored), then read the
  // claims. No `/~/me`-style round trip — the token already says who.
  useEffect(() => {
    void rehydrate();
  }, [rehydrate]);
  // Keep <link rel="alternate" type="text/markdown"> pointing at the
  // current route's ?isAgent=1 view (§7a).
  useAgentAlternateLink();

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav />
      <main className="flex-1">
        {!ready ? null : user ? <Outlet /> : <SignInGate />}
      </main>
      <AiFooter />
      <Toast />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const plantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plant/$plantId",
  component: function PlantRouteComponent() {
    const { plantId } = plantRoute.useParams();
    // Key by id so navigating between plants resets page-local state
    // (open sheet, pending confirm).
    return <PlantPage key={plantId} plantId={plantId} />;
  },
});

const addRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/add",
  component: AddPlantPage,
});

const routeTree = rootRoute.addChildren([homeRoute, plantRoute, addRoute]);

export const router = createRouter({
  routeTree,
  // No basepath — the app is at its origin root.
});

// Register the router type so `navigate`/`Link` are fully typed app-wide.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
