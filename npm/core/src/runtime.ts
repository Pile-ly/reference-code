import type { PilelyService } from "./types.js";

const SERVICES: readonly PilelyService[] = [
  "simple-db",
  "simple-blob",
  "simple-group",
  "simple-email",
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
 * against the four reserved labels at runtime as well as in the type,
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
 * The registered app id, declared once by `<meta name="pilely-app">`.
 * Throws the same actionable message every hand-written app copy uses when
 * the client is not loaded or the meta is missing.
 */
export function appId(): string {
  const id = client().appId();
  if (!id) {
    throw new Error("pilely client not loaded or <meta name=\"pilely-app\"> missing");
  }
  return id;
}
