import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshState, inboxPage, signIn, submitInquiry } from "./model";

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("network forbidden"); });
  vi.stubGlobal("XMLHttpRequest", class { constructor() { throw new Error("network forbidden"); } });
});

describe("storefront mock", () => {
  it("resets independent fixtures", () => { const one = freshState(); const two = freshState(); one.inquiries.pop(); expect(two.inquiries).toHaveLength(6); });
  it("gates and validates inquiries", () => {
    expect(() => submitInquiry(freshState(), { email: "sam@example.test", question: "Hello" })).toThrow("Sign in");
    const member = signIn(freshState(), "member");
    expect(() => submitInquiry(member, { email: "bad", question: "Hello" })).toThrow("valid email");
    expect(() => submitInquiry(member, { email: "sam@example.test", question: "" })).toThrow("Tell us");
    expect(submitInquiry(member, { email: "sam@example.test", question: "Hello", classId: "foundations" }).inquiries[0].classId).toBe("foundations");
  });
  it("paginates the owner-only inbox", () => {
    const owner = signIn(freshState(), "owner");
    const collected: string[] = [];
    let cursor = 0;
    for (;;) {
      const page = inboxPage(owner, cursor);
      expect(page.rows.length).toBeLessThanOrEqual(2);
      collected.push(...page.rows.map((row) => row.id));
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    expect(collected).toHaveLength(6);
    expect(() => inboxPage(freshState())).toThrow("Owner");
  });
});
