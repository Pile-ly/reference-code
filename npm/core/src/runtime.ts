import type { PilelyService } from "./types.js";

const SERVICES: readonly PilelyService[] = [
  "simple-db",
  "simple-blob",
  "simple-group",
  "simple-email",
  "simple-limiter",
];

/** Internal only — never re-exported from index.ts. The closed surface
 *  (requirement 2) has no accessor for the client object itself; this
 *  exists so runtime.ts and call.ts share one "is the runtime loaded"
 *  check instead of two copies of the same throw. */
export function client() {
  const pilely = typeof window !== "undefined" ? window.pilely : undefined;
  if (!pilely) {
    throw new Error("pilely client not loaded or <meta name=\"pilely-app\"> missing");
  }
  return pilely;
}

/**
 * Awaits the platform runtime's boot settling. Every data call must sit
 * behind this. Skipping it races the boot-time anonymous mint on a public
 * app: the call goes out tokenless, the service answers 401, and client.js
 * reads a tokenless 401 as an expired *user* token and bounces a
 * signed-out visitor to the login page. `ready` resolves `true` only when a
 * sign-in callback was consumed — an anonymous token still resolves
 * `false` — so its boolean is discarded here; it is not a "signed in" test.
 */
export async function ready(): Promise<void> {
  await client().ready;
}

/**
 * Derives a managed service's origin from the apex `client.js` was
 * actually loaded from — never a baked-in `pilely.app`. That is what keeps
 * a bundle portable to a self-hosted instance. `service` is validated
 * against the five reserved labels at runtime as well as in the type,
 * because this function computes the URL a bearer credential is attached
 * to: a bug here is credential exfiltration, not a 500, so nothing
 * page-controlled may influence the host.
 */
export function serviceOrigin(service: PilelyService): string {
  if (!SERVICES.includes(service)) {
    throw new Error(`serviceOrigin: unknown service "${service}"`);
  }
  const apex = client().apexOrigin();
  const url = new URL(apex);
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`serviceOrigin: apex origin "${apex}" carries a path`);
  }
  if (url.username || url.password) {
    throw new Error(`serviceOrigin: apex origin "${apex}" carries credentials`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`serviceOrigin: apex origin "${apex}" is not http(s)`);
  }
  return `${url.protocol}//${service}.${url.host}`;
}

/**
 * The registered app id. Delegates entirely to `window.pilely.appId()` —
 * client.js's own three-source fallback (the meta tag when present, else
 * the current token's `pile_id` claim once `ready` has settled, else
 * `null`) decides the value; this accessor requires no meta tag itself.
 * `null` before `ready` has settled and with no tag is a legitimate
 * answer, not an error — callers that need the id should await `ready()`
 * first.
 */
export function appId(): string | null {
  return client().appId();
}
