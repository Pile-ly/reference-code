// Conformance guard for the SPA standard's index.html contract — the parts
// a refactor can silently drop. String-level on purpose (the shell is
// pulled in as text via Vite's `?raw` query, no DOM): visual behavior is
// verified in the browser; this stops the tags/bootstraps from vanishing.

import { describe, expect, it } from "vitest";

import { APP_TITLE, READ_GROUP } from "./config";
import html from "../index.html?raw";
import indexMd from "../public/index.md?raw";

// §0: the platform auth runtime is MANDATORY in every neoApp. Without it
// sign-in never completes — and on this PRIVATE app sign-in is the only way
// to see anything at all.
describe("index.html auth conformance (standards/spa §0)", () => {
  it("includes the platform client from the APEX", () => {
    expect(html).toMatch(/<script src="https:\/\/pilely\.app\/~\/client\.js"><\/script>/);
  });

  it("declares the app id meta tag (placeholder until registration)", () => {
    // The committed value is a placeholder; build_instruction.md step 3
    // replaces it with the real pile_id before the first upload.
    expect(html).toMatch(/<meta name="pilely-app" content="[^"]+"/);
  });

  it("loads the client BEFORE the app bundle", () => {
    const client = html.indexOf("/~/client.js");
    const bundle = html.indexOf("/src/main.tsx");
    expect(client).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(-1);
    expect(client).toBeLessThan(bundle);
  });

  it("declares the app id ABOVE the client script", () => {
    // The client reads the meta tag while it parses. The standard's ordering
    // rule is unconditional; on a PUBLIC app a reversed order breaks the
    // boot-time anonymous mint (signed-out visitors bounce to login on the
    // first read), and a copier of THIS app may flip it public later — keep
    // the meta first so that flip can never be the thing that breaks them.
    const meta = html.indexOf('name="pilely-app"');
    const client = html.indexOf("/~/client.js");
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(client);
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

describe("index.html theme + agent conformance (standards/spa §7a/§10)", () => {
  it("ships the pre-paint theme bootstrap (no wrong-theme flash)", () => {
    expect(html).toContain("prefers-color-scheme");
    expect(html).toContain("data-theme");
  });

  it("carries the ?isAgent=1 hint comment for cold agents", () => {
    expect(html).toContain("?isAgent=1");
  });

  it("ships the per-route agent-alternate link bootstrap", () => {
    // The pre-paint script injects <link rel="alternate"
    // type="text/markdown"> for the entry URL; useAgentAlternateLink
    // re-points it on navigation. Both halves key off this id.
    expect(html).toContain("pilely-agent-alternate");
    expect(html).toContain("text/markdown");
  });
});

// §7: a STATIC neoApp must ship index.md at the bundle root (public/ lands
// there) — it IS the app's AI surface, and upload rejects without it.
describe("public/index.md (standards/spa §7, static apps)", () => {
  it("exists and ends with the platform-manual footer", () => {
    expect(indexMd.length).toBeGreaterThan(0);
    expect(indexMd).toContain("https://pilely.app/skill?isAgent=1");
  });
});

// §7c: an app that keeps data owes its reader the DATA SURFACE. Private
// changes nothing about that — the owner's own agent reads this manual, and
// it is the only place the tables and the blob resolution are written down.
describe("public/index.md data surface (standards/spa §7c)", () => {
  it("carries a section a reader can find by name", () => {
    expect(indexMd).toContain("## Data surface");
  });

  it("names every table the app uses", () => {
    for (const table of ["plants", "waterings"]) {
      expect(indexMd).toContain(`\`${table}\``);
    }
  });

  it("says where <app_id> comes from, and keeps it a placeholder", () => {
    expect(indexMd).toContain("<app_id>");
    expect(indexMd).toContain('<meta name="pilely-app">');
  });

  it("shows the literal read and write calls", () => {
    expect(indexMd).toContain(
      "POST https://simple-db.pilely.app/apps/<app_id>/tables/plants/records/list",
    );
    expect(indexMd).toContain(
      "POST https://simple-db.pilely.app/apps/<app_id>/tables/waterings/records/create",
    );
  });

  it("resolves a blob id to bytes rather than storing a URL", () => {
    expect(indexMd).toContain("https://simple-blob.pilely.app/blobs/");
    expect(indexMd).toContain("/download");
  });
});

// This app's extra deployment value: the empty group's nanoid rides in the
// BUNDLE (every simple-blob upload names it as read_group). An empty string
// here would make photo uploads fail while everything else looks fine.
describe("src/config.ts deployment values", () => {
  it("exports a non-empty READ_GROUP and APP_TITLE", () => {
    expect(READ_GROUP.length).toBeGreaterThan(0);
    expect(APP_TITLE.length).toBeGreaterThan(0);
  });
});
