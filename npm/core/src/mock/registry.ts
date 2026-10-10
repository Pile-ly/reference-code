import type { PilelyService, PilelyUser } from "../types.js";
import { readState, writeState } from "./store.js";

/** The fixed app id every mock call runs under. */
export const MOCK_APP_ID = "mock-app";

/** The one user mock mode signs in. */
export const MOCK_USER: Readonly<{ id: string; handle: string; app: string }> = {
  id: "mock-user",
  handle: "mock_user",
  app: MOCK_APP_ID,
};

/** What a fake sees of one request: the path on its service and the body
 *  `call()` sent — parsed JSON, or the multipart form. */
export interface MockRequest {
  path: string;
  /** Parsed JSON body; `undefined` on the multipart path. */
  body: unknown;
  /** The multipart body; `null` on the JSON path. */
  form: FormData | null;
}

/** A fake's answer. `body` left `undefined` is a bare, bodiless response. */
export interface MockReply {
  status: number;
  body?: unknown;
}

/** Sample content for `seedMock`. Each fake reads the part it owns. */
export interface MockSeed {
  /** Start signed in. Default: signed out, like a first visit. */
  signedIn?: boolean;
  /** simple-db: rows per table name, created as the mock user's. */
  tables?: Record<string, Record<string, unknown>[]>;
  /** simple-group: groups, with optional members. */
  groups?: MockSeedGroup[];
}

export interface MockSeedGroup {
  display_name?: string | null;
  members?: { subject_type: "user" | "app"; subject_id: string }[];
}

/** What the mock runtime hands each fake when it builds it. */
export interface MockServiceContext {
  /** The fixed mock app id, the same one `appId()` answers. */
  readonly appId: string;
  /** The signed-in mock user, or `null` when signed out. */
  user(): PilelyUser | null;
  /** This service's persisted slice, `undefined` until first saved. */
  load<T>(): T | undefined;
  /** Persists this service's slice (to `localStorage` when it is usable). */
  save(slice: unknown): void;
  /** Epoch milliseconds, strictly increasing across calls, so rows created
   *  in one tick still order deterministically. */
  now(): number;
  /** A random v4-shaped uuid. */
  uuid(): string;
  /** A random ASCII-alphanumeric id of `length` characters. */
  nanoid(length?: number): string;
  /** 200 (or `status`) with a JSON body. */
  ok(body: unknown, status?: number): MockReply;
  /** The uniform bare 404: a missing row and a signed-out write alike. */
  notFound(): MockReply;
  /** A refusal in the services' `{ok: false, code, reason}` envelope. */
  refuse(status: number, code: string, reason: string): MockReply;
}

/** One service's fake. `handle` answers `null` for a path it has no route
 *  for, which the mock runtime turns into a named error. */
export interface MockService {
  /** A string unique to this fake, so a production bundle can be grepped
   *  for its absence. */
  readonly marker: string;
  handle(request: MockRequest): MockReply | null | Promise<MockReply | null>;
  /** Applies the part of a seed this service owns. */
  seed?(seed: MockSeed): void;
  /** Releases what the fake holds outside its state (object URLs). */
  dispose?(): void;
}

export type MockServiceFactory = (context: MockServiceContext) => MockService;

const factories = new Map<PilelyService, MockServiceFactory>();
const instances = new Map<PilelyService, MockService>();

let lastNow = 0;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function nanoid(length = 21): string {
  let out = "";
  for (const byte of randomBytes(length)) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

function uuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The current mock identity, derived from the persisted state. */
export function mockUser(): PilelyUser | null {
  return readState().signedIn ? { ...MOCK_USER } : null;
}

function contextFor(service: PilelyService): MockServiceContext {
  return {
    appId: MOCK_APP_ID,
    user: mockUser,
    load: <T>() => readState().services[service] as T | undefined,
    save: (slice) => {
      readState().services[service] = slice;
      writeState();
    },
    now: () => {
      lastNow = Math.max(Date.now(), lastNow + 1);
      return lastNow;
    },
    uuid,
    nanoid,
    ok: (body, status = 200) => ({ status, body }),
    notFound: () => ({ status: 404 }),
    refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
  };
}

/**
 * Registers the fake for one service. Service packages call this from
 * their entry module, behind `if (isMockMode())`, so importing the package
 * is all an app does to get its fake — and a production build drops both
 * the call and the fake. A second registration for the same service
 * replaces the first.
 */
export function registerMockService(service: PilelyService, factory: MockServiceFactory): void {
  factories.set(service, factory);
  instances.get(service)?.dispose?.();
  instances.delete(service);
}

/** The fake for `service`, built on first use; `null` when no package
 *  registered one. */
export function mockService(service: PilelyService): MockService | null {
  let instance = instances.get(service);
  if (!instance) {
    const factory = factories.get(service);
    if (!factory) {
      return null;
    }
    instance = factory(contextFor(service));
    instances.set(service, instance);
  }
  return instance;
}

/** Every registered fake, built if need be. */
export function allMockServices(): MockService[] {
  const out: MockService[] = [];
  for (const service of factories.keys()) {
    const instance = mockService(service);
    if (instance) {
      out.push(instance);
    }
  }
  return out;
}

/** Drops every built fake; each is rebuilt from the persisted state on
 *  next use. */
export function disposeMockServices(): void {
  for (const instance of instances.values()) {
    instance.dispose?.();
  }
  instances.clear();
}
