/// <reference types="vite/client" />

// The platform runtime's types (the client.js global, the signed-in user,
// the error every hook reports) come from `@pilely/core`; app code reaches
// the runtime only through its hooks.

interface ImportMetaEnv {
  /** Mock mode switch, read by the `@pilely` packages ("1" = on). */
  readonly VITE_PILELY_MOCK?: string;
  /** Overrides `OWNER_HANDLE`'s fallback in `config.ts`. */
  readonly VITE_OWNER_HANDLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
