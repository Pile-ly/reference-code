// Writes the base neoApp skeleton -- mirroring the layout of the platform's
// own SPA -- to a target directory. Pure "write these files to this
// directory": no argv parsing, no prompts, no install, no network, so it is
// callable and testable on its own. Called unconditionally by the CLI
// wiring (src/cli.js); src/generate_sign_in.js adds the optional
// "Login with Pilely" affordance on top of what this writes.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SERVICE_PACKAGE = {
  "simple-db": "@pilely/simple-db",
  "simple-blob": "@pilely/simple-blob",
  "simple-group": "@pilely/simple-group",
  "simple-email": "@pilely/simple-email",
};

// The @pilely/core range every generated project pins. The service packages
// take core as a peer at this same range — their hooks run inside core's
// provider and their mock-mode fakes register with core's mock runtime — so
// the two ranges move together.
const CORE_VERSION = "^0.4.0";

// Every service package's own current version range, in step with
// CORE_VERSION: a service range behind core's would leave `npm install`
// unable to satisfy the service's core peer next to the pin above.
const SERVICE_VERSION = {
  "simple-db": "^0.4.0",
  "simple-blob": "^0.4.0",
  "simple-group": "^0.4.0",
  "simple-email": "^0.4.0",
};

/** A valid, boring npm package name derived from the target directory. */
function sanitizePackageName(targetDir) {
  const raw = basename(targetDir).toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]/g, "-").replace(/^[._]+/, "");
  return cleaned || "pilely-app";
}

function packageJsonSource(resolvedOptions) {
  const dependencies = {
    react: "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-router": "^1.121.0",
    // The cache and refresh machinery under PilelyProvider and every @pilely
    // hook; @pilely/core takes it as a peer.
    "@tanstack/react-query": "^5.0.0",
    // Every service package takes this as a peer, and the app needs it
    // directly for PilelyProvider -- installed regardless of --services.
    "@pilely/core": CORE_VERSION,
  };
  for (const service of resolvedOptions.services) {
    dependencies[SERVICE_PACKAGE[service]] = SERVICE_VERSION[service];
  }

  const pkg = {
    name: sanitizePackageName(resolvedOptions.projectDir),
    private: true,
    version: "0.1.0",
    type: "module",
    // Tailwind v4's @tailwindcss/oxide needs it; under Node 18 the install
    // silently skips the native binding and vite build fails with
    // "Cannot find native binding".
    engines: { node: ">=20" },
    scripts: {
      dev: "vite",
      // Mode "mock" loads .env.mock, which sets VITE_PILELY_MOCK=1 -- a
      // flag passed by --mode instead of a shell assignment, so the same
      // script runs in sh, PowerShell and cmd alike.
      "dev:mock": "vite --mode mock",
      build: "tsc -b && vite build",
      preview: "vite preview",
      typecheck: "tsc --noEmit",
      test: "vitest run",
    },
    dependencies,
    devDependencies: {
      "@tailwindcss/postcss": "^4.0.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.0",
      autoprefixer: "^10.4.20",
      postcss: "^8.5.0",
      tailwindcss: "^4.0.0",
      typescript: "^5.7.0",
      vite: "^6.0.0",
      vitest: "^3.0.0",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

const TSCONFIG_SOURCE = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const POSTCSS_CONFIG_SOURCE = `// Tailwind v4 uses @tailwindcss/postcss as the build plugin.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
`;

function viteConfigSource(resolvedOptions) {
  return `/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The platform's ONE domain knob, baked in at build time. A browser bundle
// has no runtime env, so this is how the SPA follows PILELY_BASE_DOMAIN.
// Plain var name, no VITE_ prefix -- \`define\` bypasses Vite's prefix
// filter entirely.
const PILELY_BASE_DOMAIN = process.env.PILELY_BASE_DOMAIN ?? "pilely.app";

// This app's registry id, baked in at build time. The default here is the
// value given to create-pilely-app (or the REPLACE_WITH_YOUR_PILE_ID
// placeholder when none was given) -- fill it in after registration, or
// override with the PILELY_APP_ID env var and rebuild.
const PILELY_APP_ID = process.env.PILELY_APP_ID ?? ${JSON.stringify(resolvedOptions.appId)};

// The two platform tags in index.html. Mock mode drops both, so a mock page
// never asks the apex for anything -- sign-in included.
const PILELY_APP_META = /[ \\t]*<meta name="pilely-app"[^>]*>\\r?\\n?/;
const CLIENT_JS_SCRIPT = /[ \\t]*<script src="[^"]*\\/~\\/client\\.js"><\\/script>\\r?\\n?/;

// \`define\` only rewrites JS, so it cannot reach the client.js tag in the
// static index.html -- this plugin substitutes the same two placeholders
// into the HTML at build time, in dev and build alike. In mock mode it
// first removes both tags from the served page; index.html itself keeps
// them, so the conformance test still reads them there.
function pilelyApexInHtml(mock: boolean) {
  return {
    name: "pilely-apex-in-html",
    transformIndexHtml(html: string) {
      const shell = mock
        ? html.replace(PILELY_APP_META, "").replace(CLIENT_JS_SCRIPT, "")
        : html;
      return shell
        .replaceAll("%PILELY_BASE_DOMAIN%", PILELY_BASE_DOMAIN)
        .replaceAll("%PILELY_APP_ID%", PILELY_APP_ID);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Mock mode: every @pilely package answers from in-memory fakes, with no
  // backend, no app id and no sign-in round trip (see README.md). Read
  // through loadEnv with the VITE_ prefix -- .env files for this mode plus
  // VITE_* shell variables -- the same values the browser code sees in
  // import.meta.env, so the config and the packages always agree.
  const mock = loadEnv(mode, process.cwd(), "VITE_").VITE_PILELY_MOCK === "1";

  return {
    define: {
      "import.meta.env.PILELY_BASE_DOMAIN": JSON.stringify(PILELY_BASE_DOMAIN),
    },
    // Pilely SPA standard: a handle-root app is served from its own origin
    // and sits at the ORIGIN ROOT, so base is "/". A non-root pile uses
    // base: "/<pile_path>/"; "/@handle/" itself is never a serving surface.
    base: "/",
    build: {
      assetsDir: "_assets",
    },
    plugins: [react(), pilelyApexInHtml(mock)],
    server: { port: 5173 },
    test: { environment: "node" },
  };
});
`;
}

function indexHtmlSource() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <!-- pilely §9a bootstrap (standards/spa): inside the Pilely app the
         WebView injects window.__PILELY_APP__ before any script runs.
         Classic inline script (Vite passes it through verbatim), placed
         before everything else so it runs pre-paint, unconditionally: it
         publishes the exact top clearance for the app's floating chrome
         as --pilely-safe-top and tags <html> as in-app. CSS keeps the §9
         universal fallback when the global is absent. -->
    <script>
      (function () {
        var app = window.__PILELY_APP__;
        if (app && app.v >= 1 && Number.isFinite(app.safeAreaTop)) {
          document.documentElement.style.setProperty(
            "--pilely-safe-top", (app.safeAreaTop + 56) + "px");
          document.documentElement.classList.add("pilely-in-app");
        }
      })();
    </script>
    <!-- The platform auth runtime (standards/spa §0). MANDATORY in every
         neoApp: it consumes the sign-in callback, stores the app-scoped token,
         strips the one-time code from the URL, and silently re-mints on expiry.
         Loaded from the APEX because platform paths (\`/~/…\`) are apex-only, so
         this is always a cross-origin script — expected, and why the handler
         sends \`Access-Control-Allow-Origin: *\`. Classic (non-module) and
         before the bundle, so \`window.pilely\` exists by first render. -->
    <!-- This app's id, so \`window.pilely.signIn()\` knows what to mint for.
         An ID (not a hostname) on purpose: the mint resolves the callback host
         from the registry, so the destination can never be supplied by a page.
         MUST come before client.js: its boot block reads the declared id at
         parse time (anonymous mint). -->
    <meta name="pilely-app" content="%PILELY_APP_ID%" />
    <script src="https://%PILELY_BASE_DOMAIN%/~/client.js"></script>
    <!-- pilely: append .md to this URL's path for the agent/markdown view — https://pilely.app/skill.md -->
    <link rel="canonical" href="https://pilely.app/@REPLACE_WITH_YOUR_HANDLE" />
    <title>Pilely neoApp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

// Verbatim per node 2-3's context: its assertions match the index.html this
// generator emits by construction. Only make the generated index.html
// satisfy it -- never edit this file.
const CONFORMANCE_TEST_SOURCE = `// Conformance guard for the mobile rules of the SPA standard (root skill
// standards/spa §9/§9a): index.html must ship \`viewport-fit=cover\` (what
// makes env(safe-area-inset-top) resolve in the Pilely app's WebView)
// and the inline §9a bootstrap that turns the injected
// window.__PILELY_APP__ into the --pilely-safe-top CSS var plus the
// \`pilely-in-app\` <html> class. String-level on purpose — the visual
// clearance is verified manually at phone widths; this only stops the
// meta/bootstrap from being dropped in a refactor. Runs in vitest's node
// env — the shell is pulled in as text via Vite's \`?raw\` query, no DOM.

import { describe, expect, it } from "vitest";

import html from "../index.html?raw";

// §0: the platform auth runtime is MANDATORY in every neoApp. Without it the
// SPA never consumes the sign-in callback, so a user who signs in lands back
// here still anonymous — and, because the token is what authorizes data calls,
// every read fails. Dropping this tag is silent breakage, hence the guard.
describe("index.html auth conformance (standards/spa §0)", () => {
  it("includes the platform client from the APEX", () => {
    // Apex, not our own host: platform paths (\`/~/...\`) are apex-only, so this
    // is deliberately a cross-origin script. The apex is a build-time
    // placeholder, substituted from PILELY_BASE_DOMAIN (production by
    // default) so a lane's shell loads the lane's client, not production's.
    expect(html).toMatch(
      /<script src="https:\\/\\/%PILELY_BASE_DOMAIN%\\/~\\/client\\.js"><\\/script>/,
    );
  });

  it("declares the app id so signIn() knows what to mint for", () => {
    expect(html).toMatch(/<meta name="pilely-app" content="%PILELY_APP_ID%"/);
  });

  it("loads the client BEFORE the app bundle", () => {
    // \`window.pilely\` must exist by first render, or the app reads an empty
    // session and flashes signed-out.
    const client = html.indexOf("/~/client.js");
    const bundle = html.indexOf("/src/main.tsx");
    expect(client).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(-1);
    expect(client).toBeLessThan(bundle);
  });
});

describe("index.html mobile conformance (standards/spa §9/§9a)", () => {
  it("viewport meta enables safe-area env() via viewport-fit=cover", () => {
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });

  it("ships the §9a in-app bootstrap", () => {
    expect(html).toContain("window.__PILELY_APP__");
    expect(html).toContain("--pilely-safe-top");
    expect(html).toContain("pilely-in-app");
  });
});
`;

const VITE_ENV_SOURCE = `/// <reference types="vite/client" />

// The platform auth runtime, loaded in index.html from
// \`https://<apex>/~/client.js\` (SPA standard §0). It is served centrally so a
// fix to the sign-in dance reaches every neoApp without a rebuild — do not
// reimplement any of it locally.
declare global {
  interface PilelyClaims {
    /** the user's id — identity (handles are mutable, ids are not) */
    sub?: string;
    /** display handle, may be stale within the token's life */
    handle?: string;
    /** the app this token is scoped to */
    pile_id?: string;
    /** epoch SECONDS */
    exp?: number;
    /** the host this token may be used at */
    aud?: string;
  }

  interface PilelyClient {
    /** Resolves once a sign-in callback (if any) has been consumed. */
    ready: Promise<boolean>;
    /** True on an app host (\`<label>.pilely.app\` / custom domain), false on the apex. */
    isAppOrigin(): boolean;
    apexOrigin(): string;
    /**
     * Identity from the token's claims — no round trip. Null when signed
     * out — INCLUDING on a public app's anonymous token, which is what makes
     * \`user() === null\` the reliable "show the sign-in affordance" test
     * (denied writes come back as uniform 404s, never 401s).
     */
    user(): { id: string | null; handle: string | null; app: string | null } | null;
    claims(): PilelyClaims | null;
    token(): string | null;
    /** Data call carrying the token (cross-origin too); silently re-mints on 401. */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /** The app id declared by \`<meta name="pilely-app">\`, if any. */
    appId(): string | null;
    /** Start the sign-in dance. Defaults to the declared app id. Navigates away. */
    signIn(appId?: string): Promise<void>;
    signOut(): void;
    takeReturnPath(): string | null;
  }

  interface Window {
    pilely?: PilelyClient;
  }
}

export {};
`;

const MAIN_TSX_SOURCE = `import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PilelyProvider, appId } from "@pilely/core";
import { router } from "./router";
import "./styles/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element missing in index.html");
}

// The placeholder must fail loudly, never silently bounce through a failing
// mint: signIn() mints for an app the registry has never heard of while the
// id is still unfilled. appId() returns null when client.js has not loaded,
// the <meta name="pilely-app"> tag is missing or unresolved, or the tag was
// removed (it is optional once this app mints by its own host) — treated
// the same as a placeholder match, since neither means "a real id is
// confirmed".
function hasRegisteredAppId(): boolean {
  const id = appId();
  return id !== null && id !== "REPLACE_WITH_YOUR_PILE_ID";
}

if (!hasRegisteredAppId()) {
  rootEl.innerHTML = [
    '<div style="font: 16px system-ui; max-width: 640px; margin: 48px auto; padding: 0 24px;">',
    "<h1>No registered pile id</h1>",
    "<p>This app has no registered pile id. Replace the placeholder in ",
    'index.html\\'s <code>&lt;meta name="pilely-app"&gt;</code> (or set ',
    "<code>PILELY_APP_ID</code> and rebuild) with the id from registration, ",
    "then rebuild. See README.md.</p>",
    "</div>",
  ].join("");
} else {
  // PilelyProvider is the app's single source of auth state and its single
  // data cache: every @pilely hook below it waits for the runtime's \`ready\`,
  // and every write refreshes the reads it affects.
  createRoot(rootEl).render(
    <StrictMode>
      <PilelyProvider>
        <RouterProvider router={router} />
      </PilelyProvider>
    </StrictMode>,
  );
}
`;

const ROUTER_TSX_SOURCE = `import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { HomePage } from "./pages/HomePage";

// The app is served from its own origin and owns the ORIGIN ROOT: Vite
// base is "/" and there is no router basepath. One route, rendering the
// Hello World page directly at "/" — no Shell/nav/footer wrapper, this is
// the minimal scaffold.
const rootRoute = createRootRoute();

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const routeTree = rootRoute.addChildren([homeRoute]);

export const router = createRouter({ routeTree });

// Register the router type so navigate/Link are fully typed app-wide.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
`;

const HOME_PAGE_SOURCE = `export function HomePage() {
  return (
    <main>
      <h1>{"Hello World"}</h1>
    </main>
  );
}
`;

const GLOBALS_CSS_SOURCE = `@import "tailwindcss";

/* The scaffold deliberately ships no theme — that is the app author's to
   choose. It does have to be LEGIBLE before they choose one, though, and
   Tailwind's preflight leaves text at the UA default over a transparent
   canvas. On a device in dark mode that renders near-black on near-black,
   so a freshly generated app looks broken on first run.

   Declaring color-scheme is the whole fix: the browser then paints its own
   canvas and text for the active mode, and form controls follow. Replace
   this block as soon as you have a palette. */
:root {
  color-scheme: light dark;
}
`;

// Loaded by `vite --mode mock` (the dev:mock script) on top of .env.
const ENV_MOCK_SOURCE = `# Loaded only by \`npm run dev:mock\` (vite --mode mock). Turns on mock mode:
# every @pilely package answers from in-memory fakes. See README.md.
VITE_PILELY_MOCK=1
`;

function readmeSource(resolvedOptions) {
  const name = sanitizePackageName(resolvedOptions.projectDir);
  return `# ${name}

A Pilely neoApp: a Vite + React SPA on the \`@pilely/*\` packages.

## Commands

| Command | What it does |
| --- | --- |
| \`npm run dev\` | Dev server against the real platform |
| \`npm run dev:mock\` | Dev server in mock mode (below) |
| \`npm run build\` | Typecheck and production build into \`dist/\` |
| \`npm run typecheck\` | Typecheck only |
| \`npm test\` | Unit tests, including the \`index.html\` conformance guard |

## Data and auth

\`src/main.tsx\` wraps the router in \`<PilelyProvider>\` from \`@pilely/core\`.
It is the app's single source of auth state and its single data cache
(TanStack Query), so every \`@pilely\` hook must render below it.

- **Auth.** \`usePilelyAuth()\` returns \`{ ready, user, signIn, signOut }\`;
  \`user\` is \`null\` when signed out. \`<SignedIn>\` / \`<SignedOut>\` render
  their children only once \`ready\`, and only for that state. Signing in or
  out clears every cached \`@pilely\` result.
- **Reads and writes are hooks.** Each service package has a hook per route
  (\`useRecords\`, \`useCreateRecord\`, ...). A hook never fires before the
  runtime is ready, so there is no \`ready\` check to write.
- **Writes refresh reads.** A write invalidates every read it affects, so
  every list on screen updates on its own: no \`refetch()\`, no
  \`useEffect\` for data, no store.

## App id

\`npm run dev\` and production builds need this app's registered pile id.
Until it is filled in, the page shows "No registered pile id" instead of the
app. Set it in \`vite.config.ts\` (the \`PILELY_APP_ID\` default), or set the
\`PILELY_APP_ID\` environment variable and rebuild. Mock mode needs no id.

## Mock mode

\`npm run dev:mock\` runs this same app with every \`@pilely\` package
answering from in-memory fakes in the browser: no backend, no network, no
registered app, no app id, no sign-in round trip. Nothing about the app code
changes — there is no flag to check and no fake data layer to write. The
real packages run unchanged against a fake backend, so the screens built in
mock mode are the screens that ship.

- **The switch.** Mock mode is on only when \`VITE_PILELY_MOCK\` is exactly
  \`1\` at build time. \`dev:mock\` sets it through \`.env.mock\`; setting it
  in \`.env\` or the shell works the same way. \`npm run build\` without it
  carries no mock code at all.
- **No platform tags.** In mock mode \`vite.config.ts\` drops the
  \`client.js\` script and the \`<meta name="pilely-app">\` tag from the
  served page, so nothing is requested from pilely.app. \`index.html\`
  itself keeps both.
- **Sign-in.** A mock starts signed out. "Login with Pilely" signs a fixed
  mock user in on the spot, without leaving the page; signing out works the
  same way. Data writes need that signed-in user.
- **State.** The fakes start empty and fill as the app writes. State and
  the signed-in flag survive a reload (\`localStorage\`); uploaded file
  bytes do not.
- **Sample content and reset.** \`@pilely/core\` exports \`seedMock(...)\`
  (start signed in, rows per table, groups — applied once) and
  \`resetMock()\` (clear everything, back to signed out). Both do nothing
  outside mock mode, and neither is required.
- **Shape, not policy.** The fakes return the real services' responses and
  error codes, but they do not model access rules: every signed-in user may
  read and write everything, and there are no caps, quotas or rate limits.
  Test those against the real app.
`;
}

/**
 * Writes the base neoApp skeleton to `targetDir`.
 * @param {string} targetDir
 * @param {{projectDir: string, services: string[], signIn: boolean, appId: string, install: boolean, json: boolean}} resolvedOptions
 * @returns {{filesWritten: string[]}}
 */
export function generateBaseProject(targetDir, resolvedOptions) {
  const filesWritten = [];

  function write(relPath, content) {
    const full = join(targetDir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    filesWritten.push(relPath);
  }

  write("package.json", packageJsonSource(resolvedOptions));
  write("README.md", readmeSource(resolvedOptions));
  write(".env.mock", ENV_MOCK_SOURCE);
  write("tsconfig.json", TSCONFIG_SOURCE);
  write("postcss.config.cjs", POSTCSS_CONFIG_SOURCE);
  write("vite.config.ts", viteConfigSource(resolvedOptions));
  write("index.html", indexHtmlSource());
  write("src/main.tsx", MAIN_TSX_SOURCE);
  write("src/router.tsx", ROUTER_TSX_SOURCE);
  write("src/vite-env.d.ts", VITE_ENV_SOURCE);
  write("src/index_html_conformance.test.ts", CONFORMANCE_TEST_SOURCE);
  write("src/pages/HomePage.tsx", HOME_PAGE_SOURCE);
  write("src/styles/globals.css", GLOBALS_CSS_SOURCE);

  return { filesWritten };
}
