/**
 * The mock runtime's persisted state: identity, whether a seed has been
 * applied, and one slice per service fake. It lives under ONE namespaced
 * `localStorage` key (the store is already per origin). Every storage
 * access sits in a `try`/`catch`: a blocked or absent store (private mode,
 * disabled site data, a non-browser host) degrades to memory only, and
 * the page keeps working for the rest of its life.
 */

/** Also the mock runtime's marker string — unique to this module, so a
 *  production bundle can be grepped for its absence. */
export const MOCK_STORAGE_KEY = "pilely-mock-runtime:v1";

export interface MockState {
  signedIn: boolean;
  seeded: boolean;
  services: Record<string, unknown>;
}

let state: MockState | null = null;

function freshState(): MockState {
  return { signedIn: false, seeded: false, services: {} };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): MockState {
  if (!raw) {
    return freshState();
  }
  try {
    const value = JSON.parse(raw) as Partial<MockState> | null;
    return {
      signedIn: value?.signedIn === true,
      seeded: value?.seeded === true,
      services:
        value?.services && typeof value.services === "object" ? value.services : {},
    };
  } catch {
    return freshState();
  }
}

/** The live state object, read from storage once per page. */
export function readState(): MockState {
  if (!state) {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(MOCK_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    state = parse(raw);
  }
  return state;
}

/** Writes the live state through to storage; a refusal keeps it in memory. */
export function writeState(): void {
  const current = readState();
  try {
    storage()?.setItem(MOCK_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // blocked or full store — memory still holds the state
  }
}

/** Drops everything: memory and storage alike. */
export function clearState(): void {
  state = freshState();
  try {
    storage()?.removeItem(MOCK_STORAGE_KEY);
  } catch {
    // blocked store — memory is already clear
  }
}

/** Forgets the in-memory copy so the next read goes back to storage — what
 *  a page reload does. */
export function forgetState(): void {
  state = null;
}
