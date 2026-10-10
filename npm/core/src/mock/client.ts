import { SERVICES } from "../services.js";
import type { PilelyClaims, PilelyClient, PilelyService } from "../types.js";
import { MOCK_APP_ID, mockService, mockUser } from "./registry.js";
import type { MockReply } from "./registry.js";
import { readState, writeState } from "./store.js";

/** The placeholder apex. `.invalid` is reserved and never resolves, and
 *  nothing here ever fetches it — service URLs are derived from it only so
 *  `call()` builds them exactly as it does against the real runtime. */
const MOCK_APEX_HOST = "pilely.invalid";

let instance: PilelyClient | null = null;

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

function serviceOf(url: URL): PilelyService | null {
  const suffix = `.${MOCK_APEX_HOST}`;
  if (!url.hostname.endsWith(suffix)) {
    return null;
  }
  const label = url.hostname.slice(0, -suffix.length);
  return SERVICES.find((service) => service === label) ?? null;
}

function toResponse(reply: MockReply): Response {
  if (reply.body === undefined) {
    return new Response(null, { status: reply.status });
  }
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });
}

async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const service = serviceOf(url);
  if (!service) {
    throw new Error(`no mock for ${url.host} ${url.pathname}`);
  }
  const fake = mockService(service);
  if (!fake) {
    throw new Error(`no mock for ${service} ${url.pathname}`);
  }

  const raw = init?.body;
  let body: unknown = undefined;
  let form: FormData | null = null;
  if (typeof FormData !== "undefined" && raw instanceof FormData) {
    form = raw;
  } else if (typeof raw === "string" && raw !== "") {
    try {
      body = JSON.parse(raw);
    } catch {
      return toResponse({
        status: 400,
        body: { ok: false, code: "bad_request", reason: "malformed JSON body" },
      });
    }
  }

  const reply = await fake.handle({ path: url.pathname, body, form });
  if (!reply) {
    throw new Error(`no mock for ${service} ${url.pathname}`);
  }
  return toResponse(reply);
}

function createMockClient(): PilelyClient {
  return {
    ready: Promise.resolve(false),
    isAppOrigin: () => true,
    apexOrigin: () => `https://${MOCK_APEX_HOST}`,
    authOrigin: () => `https://auth.${MOCK_APEX_HOST}`,
    user: mockUser,
    claims: (): PilelyClaims | null => {
      const user = mockUser();
      if (!user || user.id === null) {
        return null;
      }
      return { sub: user.id, handle: user.handle ?? undefined, pile_id: MOCK_APP_ID };
    },
    // Mock mode carries no credential, ever.
    token: () => null,
    fetch: mockFetch,
    appId: () => MOCK_APP_ID,
    // Signs the mock user in or out in place — no navigation, no reload.
    signIn: async () => {
      readState().signedIn = true;
      writeState();
    },
    signOut: () => {
      readState().signedIn = false;
      writeState();
    },
    takeReturnPath: () => null,
  };
}

/**
 * The mock runtime, built once per page. It is also what `window.pilely`
 * holds in mock mode — replacing any `client.js` object — because app code
 * reads `user()`, `signIn()` and `signOut()` straight off `window.pilely`.
 */
export function mockClient(): PilelyClient {
  if (!instance) {
    instance = createMockClient();
  }
  if (typeof window !== "undefined" && window.pilely !== instance) {
    window.pilely = instance;
  }
  return instance;
}
