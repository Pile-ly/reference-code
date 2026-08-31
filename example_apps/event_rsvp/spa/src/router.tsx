// TanStack Router tree — three routes: the club's home, one event, and the
// host portal.
//
// The app is served from its own origin (`<label>.pilely.app`) and owns the
// ORIGIN ROOT: Vite `base` is "/" and there is NO router `basepath` —
// `createRoute` paths are already the real paths (SPA standard §1/§3).
// `/event/$eventId` takes the simple_db RECORD ID, so an event link is
// shareable and survives a reload: the app host has no file at that path,
// falls through to the shell, and this router resolves it.
//
// The shell around every page: nav (who am I / host link), the page, the
// §7b AI-client footer, the toast. Session rehydrate runs once here so
// every page below can read the store synchronously.

import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { AiFooter } from "./components/AiFooter";
import { AppNav } from "./components/AppNav";
import { Toast } from "./components/Toast";
import { useAgentAlternateLink } from "./hooks/useAgentAlternateLink";
import { AdminPage } from "./pages/AdminPage";
import { EventPage } from "./pages/EventPage";
import { HomePage } from "./pages/HomePage";
import { useSessionStore } from "./stores/session_store";

function Shell() {
  const rehydrate = useSessionStore((s) => s.rehydrate);
  // Establish who the visitor is, once: await the platform client's ready
  // promise (sign-in callback consumed, token stored — and on this PUBLIC
  // app, the anonymous credential minted for signed-out visitors), then
  // read the claims. No `/~/me`-style round trip — the token already says
  // who.
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
        <Outlet />
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

const eventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/event/$eventId",
  component: function EventRouteComponent() {
    const { eventId } = eventRoute.useParams();
    return <EventPage eventId={eventId} />;
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([homeRoute, eventRoute, adminRoute]);

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
