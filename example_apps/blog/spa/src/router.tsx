// TanStack Router tree — code-first, four routes.
//
// The app is served from its own origin (`<label>.pilely.app`) and owns the
// ORIGIN ROOT: Vite `base` is "/" and there is NO router `basepath` —
// `createRoute` paths are already the real paths (SPA standard §1/§3).
//
// The shell around every page: nav (who am I / owner actions), the page,
// the §7b AI-client footer, the toast. Session rehydrate runs once here so
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
import { DraftsPage } from "./pages/DraftsPage";
import { HomePage } from "./pages/HomePage";
import { PostPage } from "./pages/PostPage";
import { WritePage } from "./pages/WritePage";
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

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/post/$postId",
  component: function PostRouteComponent() {
    const { postId } = postRoute.useParams();
    return <PostPage postId={postId} />;
  },
});

const draftsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts",
  component: DraftsPage,
});

// /write edits three things depending on search params — see WritePage.
interface WriteSearch {
  draft?: string;
  post?: string;
}

const writeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/write",
  validateSearch: (search: Record<string, unknown>): WriteSearch => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
    post: typeof search.post === "string" ? search.post : undefined,
  }),
  component: function WriteRouteComponent() {
    const { draft, post } = writeRoute.useSearch();
    // Key by target so switching what's being edited resets the form.
    return <WritePage key={`${draft ?? ""}|${post ?? ""}`} draftId={draft} postId={post} />;
  },
});

const routeTree = rootRoute.addChildren([homeRoute, postRoute, draftsRoute, writeRoute]);

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
