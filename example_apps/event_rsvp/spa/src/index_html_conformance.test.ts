// Conformance guard for the SPA standard's index.html contract — the parts
// a refactor can silently drop. String-level on purpose (the shell is
// pulled in as text via Vite's `?raw` query, no DOM): visual behavior is
// verified in the browser; this stops the tags/bootstraps from vanishing.

import { describe, expect, it } from "vitest";

import html from "../index.html?raw";
import indexMd from "../public/index.md?raw";
import { HOST, LIMITS, OWNER_HANDLE } from "./config";

// §0: the platform auth runtime is MANDATORY in every neoApp. Without it
// sign-in never completes and every data call is anonymous.
describe("index.html auth conformance (standards/spa §0)", () => {
  it("includes the platform client from the APEX", () => {
    expect(html).toMatch(/<script src="https:\/\/pilely\.app\/~\/client\.js"><\/script>/);
  });

  it("declares the app id meta tag (placeholder until registration)", () => {
    // The committed value is a placeholder; build_instruction.md step 2
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
    // The client runs the boot-time anonymous mint synchronously while it
    // parses and reads the meta tag at that moment. With the tag below the
    // script, a public app's signed-out visitors get no anon credential and
    // the first data call's 401 bounces them to the login page (found in
    // live verification — keep the meta first).
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

// §7c: an app that keeps data owes its reader the DATA SURFACE. This app
// leans on it hardest — a guest can never read the table back, so the manual
// is the only description of what a valid RSVP even looks like.
describe("public/index.md data surface (standards/spa §7c)", () => {
  it("carries a section a reader can find by name", () => {
    expect(indexMd).toContain("## Data surface");
  });

  it("names both tables and every column an RSVP must carry", () => {
    for (const table of ["events", "rsvps"]) {
      expect(indexMd).toContain(`\`${table}\``);
    }
    for (const column of ["event_id", "status", "party", "note"]) {
      expect(indexMd).toContain(`\`${column}\``);
    }
  });

  it("says where <app_id> comes from, and keeps it a placeholder", () => {
    expect(indexMd).toContain("<app_id>");
    expect(indexMd).toContain('<meta name="pilely-app">');
  });

  it("shows the literal read and write calls", () => {
    expect(indexMd).toContain(
      "POST https://simple-db.pilely.app/apps/<app_id>/tables/events/records/list",
    );
    expect(indexMd).toContain(
      "POST https://simple-db.pilely.app/apps/<app_id>/tables/rsvps/records/create",
    );
  });

  it("resolves a cover blob id to bytes rather than storing a URL", () => {
    expect(indexMd).toContain("https://simple-blob.pilely.app/blobs/");
    expect(indexMd).toContain("/download");
  });

  it("documents the host rollup the raw rows do not state", () => {
    expect(indexMd).toContain("_submitter_handle");
    expect(indexMd).toContain("headcount");
  });
});

// The deployment values a copier must fill in (build_instruction.md steps
// 1–2). The committed tree carries placeholders on purpose — this only
// guards against them being emptied or deleted outright, which would break
// sign-in or the host gate with no visible symptom until someone tries.
describe("config placeholders", () => {
  it("declares an owner handle without an @", () => {
    expect(OWNER_HANDLE.length).toBeGreaterThan(0);
    expect(OWNER_HANDLE.startsWith("@")).toBe(false);
  });

  it("declares the club's branding", () => {
    expect(HOST.name.length).toBeGreaterThan(0);
    expect(HOST.mark.length).toBeGreaterThan(0);
  });

  it("keeps the party stepper's bounds sane", () => {
    // The RSVP card steps between these; a swapped pair would lock it.
    expect(LIMITS.partyMin).toBeGreaterThanOrEqual(1);
    expect(LIMITS.partyMax).toBeGreaterThan(LIMITS.partyMin);
  });
});
