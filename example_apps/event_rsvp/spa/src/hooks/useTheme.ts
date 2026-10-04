// Dark/light theme state (SPA standard §10). The FIRST paint is decided by
// the inline bootstrap in index.html (stored choice, else device
// preference) — this hook only mirrors that attribute into React and flips
// it from the nav toggle, persisting the override.

import { useCallback, useState } from "react";

export type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("event_rsvp_theme", next);
    } catch {
      // storage unavailable (private mode) — the toggle still works for
      // this visit, it just won't persist.
    }
    setTheme(next);
  }, []);

  return { theme, toggle };
}
