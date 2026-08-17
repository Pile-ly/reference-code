// Keeps the agent-alternate <link> in step with the current route.
//
// SPA standard §7a: every route's markdown/agent view is the same URL
// with `?isAgent=1`. index.html injects
// `<link rel="alternate" type="text/markdown">` pre-paint for the entry
// URL; this hook re-points it on every client-side navigation, so the
// DOM of ANY route — a live tab, a saved page — always carries the
// current page's agent link. The href stays root-relative on purpose:
// the app host is mutable and must never be baked in.

import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

const LINK_ID = "pilely-agent-alternate";

export function useAgentAlternateLink(): void {
  const pathname = useLocation({ select: (l) => l.pathname });
  const searchStr = useLocation({ select: (l) => l.searchStr });

  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      // Pre-paint bootstrap missing (e.g. a stripped-down embed) — create it.
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "alternate";
      link.type = "text/markdown";
      document.head.appendChild(link);
    }
    // Preserve the route's own query params, add the agent flag.
    const params = new URLSearchParams(searchStr);
    params.set("isAgent", "1");
    // setAttribute keeps the href root-relative (the .href property would
    // resolve it to an absolute URL and bake the mutable host in).
    link.setAttribute("href", `${pathname}?${params.toString()}`);
  }, [pathname, searchStr]);
}
