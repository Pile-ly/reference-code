// TanStack Router tree — code-first, four routes: the marketing landing,
// the class list, the gated inquiry form, and the owner-only inbox.
//
// The app is served from its own origin (`<label>.pilely.app`) and owns the
// ORIGIN ROOT: Vite `base` is "/" and there is NO router `basepath` —
// `createRoute` paths are already the real paths (SPA standard §1/§3).
//
// The shell around every page: nav (who am I / owner link), the page, the
// §7b AI-client footer, the toast. Session rehydrate runs once here so
// every page below can read the store synchronously.

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AiFooter } from "./components/AiFooter";
import { AppNav } from "./components/AppNav";
import { Toast } from "./components/Toast";
import { useAgentAlternateLink } from "./hooks/useAgentAlternateLink";
import { AdminPage } from "./pages/AdminPage";
import { ClassesPage } from "./pages/ClassesPage";
import { ContactPage } from "./pages/ContactPage";
import { LandingPage } from "./pages/LandingPage";
import { useSessionStore } from "./stores/session_store";

function Shell() {
  const rehydrate = useSessionStore((s) => s.rehydrate);
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
        <Outlet />
      </main>
      <AiFooter />
      <Toast />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingPage,
});

const classesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/classes",
  component: ClassesPage,
});

// /contact takes an optional ?class=<id> — a class row's Inquire button
// (or a landing band CTA) pre-fills the form's "About" select with it.
interface ContactSearch {
  class?: string;
}

const contactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/contact",
  validateSearch: (search: Record<string, unknown>): ContactSearch => ({
    class: typeof search.class === "string" ? search.class : undefined,
  }),
  component: function ContactRouteComponent() {
    const { class: classId } = contactRoute.useSearch();
    return <ContactPage prefillClassId={classId} />;
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([landingRoute, classesRoute, contactRoute, adminRoute]);

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
