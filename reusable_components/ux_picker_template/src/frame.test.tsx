import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { LOOKS } from "./frame/looks";
import { SCREENS } from "./screens";
import en from "./i18n/locales/en.json";
import "./i18n";

/* These guard the ways an adapted picker silently stops being a Pilely
   picker: a look that exists in one place but not the other, a screen that
   only renders under the look it was written in, and a missing control. */

afterEach(cleanup);

describe("the looks", () => {
  it("match the blocks in looks.css exactly", () => {
    /* vitest runs from the package root. */
    const css = readFileSync("src/frame/looks.css", "utf8");
    const defined = [...css.matchAll(/^\.(t-[a-z]+) \{/gm)].map((m) => m[1]);

    expect(defined).toEqual(LOOKS.map((l) => l.id));
  });

  it("gives every look a backdrop", () => {
    const css = readFileSync("src/frame/looks.css", "utf8");
    for (const look of LOOKS) {
      expect(css, `no backdrop for ${look.id}`).toContain(`body.bg-${look.id} {`);
    }
  });

  it("uses logical edges, so a look mirrors correctly in Arabic", () => {
    const css = readFileSync("src/frame/looks.css", "utf8");
    const physical = css.match(/\b(border|margin|padding)-(left|right)\b/g) ?? [];

    expect(physical, "use border-inline-start / margin-inline-end instead").toEqual([]);
  });
});

describe("every screen", () => {
  it("renders under every look", () => {
    for (const look of LOOKS) {
      const { container } = render(<App />);
      expect(container.querySelectorAll(".screen .device .demo")).toHaveLength(SCREENS.length);
      cleanup();
      void look;
    }
  });

  it("is listed with a unique id, a label and a plain-words note", () => {
    expect(SCREENS.length).toBeGreaterThan(0);
    for (const entry of SCREENS) {
      expect(entry.id.trim()).not.toBe("");
      expect(entry.label.trim()).not.toBe("");
      expect(entry.note.trim()).not.toBe("");
    }
    expect(new Set(SCREENS.map((s) => s.id)).size).toBe(SCREENS.length);
  });
});

describe("the frame", () => {
  it("always offers the note, the width toggle, the dock and the ? explainer", () => {
    render(<App />);

    expect(screen.getByText(en.picker.note)).toBeDefined();
    expect(screen.getByRole("group", { name: en.picker.width.label })).toBeDefined();
    expect(screen.getByRole("navigation", { name: en.picker.looks.label })).toBeDefined();
    expect(screen.getByRole("button", { name: en.picker.help.open })).toBeDefined();
    for (const look of LOOKS) {
      expect(screen.getByRole("button", { name: look.name })).toBeDefined();
    }
  });
});
