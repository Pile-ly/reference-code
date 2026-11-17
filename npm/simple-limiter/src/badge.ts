// The corner badge `solveChallenge()` draws, so a visitor always sees that a
// bot check ran: "Verifying you're human…" with a spinner while it solves,
// then "Verified ✓" for about a second and a half before it fades out.
// Plain DOM under one fixed id, styles injected once; nothing at all where
// there is no `document` (node, a worker). Solves that overlap share the
// one badge: it says "Verified ✓" once the last of them has finished.

export const BADGE_ID = "pilely-challenge-badge";
export const BADGE_STYLE_ID = "pilely-challenge-badge-style";

export const VERIFYING_TEXT = "Verifying you're human…";
export const VERIFIED_TEXT = "Verified ✓";

/** How long "Verified ✓" stays before the fade starts. */
export const VERIFIED_MS = 1_500;
/** How long the fade takes; the badge is removed when it ends. */
export const FADE_MS = 300;

const STYLES = `
#${BADGE_ID} {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 999px;
  background: #ffffff; color: #1f2328; border: 1px solid rgba(31, 35, 40, 0.15);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  opacity: 1; transition: opacity ${FADE_MS}ms ease; pointer-events: none;
}
#${BADGE_ID}[data-state="fading"] { opacity: 0; }
#${BADGE_ID} .pilely-challenge-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(31, 35, 40, 0.2); border-top-color: currentColor;
  animation: pilely-challenge-spin 0.8s linear infinite;
}
#${BADGE_ID}[data-state="verified"] .pilely-challenge-spinner,
#${BADGE_ID}[data-state="fading"] .pilely-challenge-spinner { display: none; }
@keyframes pilely-challenge-spin { to { transform: rotate(360deg); } }
@media (prefers-color-scheme: dark) {
  #${BADGE_ID} { background: #24292f; color: #f0f3f6; border-color: rgba(240, 243, 246, 0.2); }
}
@media (prefers-reduced-motion: reduce) {
  #${BADGE_ID} .pilely-challenge-spinner { animation-duration: 2.4s; }
}
`;

/** Solves running now. */
let active = 0;
/** The pending "Verified ✓" fade and removal, cancelled by a new solve. */
let timers: ReturnType<typeof setTimeout>[] = [];

function hasDocument(): boolean {
  return typeof document !== "undefined" && document.body != null;
}

function clearTimers(): void {
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers = [];
}

function injectStyles(): void {
  if (document.getElementById(BADGE_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = BADGE_STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function badgeElement(): HTMLElement {
  const existing = document.getElementById(BADGE_ID);
  if (existing) {
    return existing;
  }
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  const spinner = document.createElement("span");
  spinner.className = "pilely-challenge-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "pilely-challenge-label";
  badge.append(spinner, label);
  document.body.appendChild(badge);
  return badge;
}

function show(state: "verifying" | "verified", text: string): HTMLElement {
  const badge = badgeElement();
  badge.setAttribute("data-state", state);
  const label = badge.querySelector(".pilely-challenge-label");
  if (label) {
    label.textContent = text;
  }
  return badge;
}

function removeBadge(): void {
  document.getElementById(BADGE_ID)?.remove();
}

/** A solve started: show "Verifying you're human…". */
export function badgeStarted(): void {
  active += 1;
  if (!hasDocument()) {
    return;
  }
  clearTimers();
  injectStyles();
  show("verifying", VERIFYING_TEXT);
}

/** A solve finished. `solved` shows "Verified ✓" (once no other solve is
 *  running), then fades it out; a failure removes the badge. */
export function badgeFinished(solved: boolean): void {
  active = Math.max(0, active - 1);
  if (!hasDocument() || active > 0) {
    return;
  }
  clearTimers();
  if (!solved) {
    removeBadge();
    return;
  }
  const badge = show("verified", VERIFIED_TEXT);
  timers.push(
    setTimeout(() => {
      badge.setAttribute("data-state", "fading");
      timers.push(setTimeout(removeBadge, FADE_MS));
    }, VERIFIED_MS),
  );
}
