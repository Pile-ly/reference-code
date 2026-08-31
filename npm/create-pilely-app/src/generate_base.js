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
    // Every service package takes this as a peer, and the app needs it
    // directly -- installed regardless of --services.
    "@pilely/core": "^0.1.0",
  };
  for (const service of resolvedOptions.services) {
    dependencies[SERVICE_PACKAGE[service]] = "^0.1.0";
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
import { defineConfig } from "vite";
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

// \`define\` only rewrites JS, so it cannot reach the client.js tag in the
// static index.html -- this plugin substitutes the same two placeholders
// into the HTML at build time, in dev and build alike.
const pilelyApexInHtml = {
  name: "pilely-apex-in-html",
  transformIndexHtml(html: string) {
    return html
      .replaceAll("%PILELY_BASE_DOMAIN%", PILELY_BASE_DOMAIN)
      .replaceAll("%PILELY_APP_ID%", PILELY_APP_ID);
  },
};

export default defineConfig({
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
  plugins: [react(), pilelyApexInHtml],
  server: { port: 5173 },
  test: { environment: "node" },
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
    <!-- pilely: append ?isAgent=1 to this URL for the agent/markdown view — https://pilely.app/skill -->
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
import { appId } from "@pilely/core";
import { router } from "./router";
import "./styles/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element missing in index.html");
}

// The placeholder must fail loudly, never silently bounce through a failing
// mint: signIn() mints for an app the registry has never heard of while the
// id is still unfilled. appId() throws when client.js has not loaded or the
// <meta name="pilely-app"> tag is missing — treated the same as a placeholder
// match, since both mean "cannot confirm a real id".
function hasRegisteredAppId(): boolean {
  try {
    return appId() !== "REPLACE_WITH_YOUR_PILE_ID";
  } catch {
    return false;
  }
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
  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider router={router} />
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
