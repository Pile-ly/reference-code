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
// §7b AI-client footer, the toast. Who is signed in comes from
// <PilelyProvider> in main.tsx, read anywhere with usePilelyAuth().

import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AiFooter } from "./components/AiFooter";
import { AppNav } from "./components/AppNav";
import { Toast } from "./components/Toast";
import { useAgentAlternateLink } from "./hooks/useAgentAlternateLink";
import { AdminPage } from "./pages/AdminPage";
import { EventPage } from "./pages/EventPage";
import { HomePage } from "./pages/HomePage";

function Shell() {
  // Keep <link rel="alternate" type="text/markdown"> pointing at the
  // current route's markdown (.md) view (§7a).
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
