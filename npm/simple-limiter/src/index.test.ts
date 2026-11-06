import { PilelyError } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getChallenge, solveChallenge } from "./index.js";
import type { Challenge } from "./index.js";
import { PrefixHasher, sha256Hex } from "./sha256.js";
import { findNumber } from "./solve.js";

// A fixed ALTCHA v1 challenge, as the platform's signer issues it: the
// SHA-256 of salt + 42424, signed with HMAC-SHA-256 under "test-key"
// (computed with node:crypto, independently of this package). The other
// expected digests come from the platform's own `crypto.subtle`.
const VECTOR: Challenge = {
  algorithm: "SHA-256",
  challenge: "61bcac9cf800b858d6e5d2d6522809aad835c9e78bed5fe9a64e4054da420fda",
  maxnumber: 100_000,
  salt: "a1b2c3d4e5f60718293a4b5c?expires=1700000300&app=11111111-2222-3333-4444-555555555555&",
  signature: "aa2b8b43441d25d9bcd78a875a21e25adf886099bbe1319b449ea68742e1ffe2",
};
const VECTOR_NUMBER = 42424;
const VECTOR_ANSWER =
  "eyJhbGdvcml0aG0iOiJTSEEtMjU2IiwiY2hhbGxlbmdlIjoiNjFiY2FjOWNmODAwYjg1OGQ2ZTVkMmQ2NTIyODA5YWFkODM1YzllNzhiZWQ1ZmU5YTY0ZTQwNTRkYTQyMGZkYSIsIm51bWJlciI6NDI0MjQsInNhbHQiOiJhMWIyYzNkNGU1ZjYwNzE4MjkzYTRiNWM/ZXhwaXJlcz0xNzAwMDAwMzAwJmFwcD0xMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUmIiwic2lnbmF0dXJlIjoiYWEyYjhiNDM0NDFkMjVkOWJjZDc4YTg3NWEyMWUyNWFkZjg4NjA5OWJiZTEzMTliNDQ5ZWE2ODc0MmUxZmZlMiJ9";

async function subtleSha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function challengeFor(salt: string, number: number, maxnumber = 100_000): Promise<Challenge> {
  return { algorithm: "SHA-256", challenge: await subtleSha256(`${salt}${number}`), maxnumber, salt, signature: "s" };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function stubWindow(fetchImpl: PilelyClient["fetch"]): void {
  const client: PilelyClient = {
    ready: Promise.resolve(true),
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => null,
    claims: () => null,
    token: () => null,
    fetch: fetchImpl,
    appId: () => "app-1",
    signIn: vi.fn(),
    signOut: vi.fn(),
    takeReturnPath: () => null,
  };
  (globalThis as { window?: unknown }).window = { pilely: client };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("sha256", () => {
  it("matches crypto.subtle for every message length across the block boundaries", async () => {
    for (let length = 0; length <= 200; length += 1) {
      const text = "x".repeat(length);
      expect(sha256Hex(text)).toBe(await subtleSha256(text));
    }
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("héllo ✓")).toBe(await subtleSha256("héllo ✓"));
  });

  it("hashes prefix + suffix the same as the whole message, for prefixes of every length", async () => {
    for (let length = 0; length <= 140; length += 7) {
      const prefix = "p".repeat(length);
      const hasher = new PrefixHasher(prefix);
      for (const suffix of ["", "0", "99999", "1234567890123456"]) {
        expect(hasher.hashHex(suffix)).toBe(await subtleSha256(prefix + suffix));
      }
    }
  });
});

describe("solveChallenge", () => {
  it("solves the fixed v1 vector to its known number and encodes the exact answer", async () => {
    await expect(findNumber(VECTOR)).resolves.toBe(VECTOR_NUMBER);
    const answer = await solveChallenge(VECTOR);
    expect(answer).toBe(VECTOR_ANSWER);
    expect(JSON.parse(atob(answer))).toEqual({
      algorithm: "SHA-256",
      challenge: VECTOR.challenge,
      number: VECTOR_NUMBER,
      salt: VECTOR.salt,
      signature: VECTOR.signature,
    });
    expect(Object.keys(JSON.parse(atob(answer)))).toEqual(["algorithm", "challenge", "number", "salt", "signature"]);
  });

  it("finds 0 and maxnumber itself, and runs without a document (node)", async () => {
    const salt = "00ff?expires=1&app=a&";
    expect(typeof document).toBe("undefined");
    await expect(findNumber(await challengeFor(salt, 0, 10))).resolves.toBe(0);
    await expect(findNumber(await challengeFor(salt, 10, 10))).resolves.toBe(10);
  });

  it("throws challenge_unsolvable when no number up to maxnumber solves it", async () => {
    const error = await solveChallenge(await challengeFor("ab?expires=1&app=a&", 11, 10)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PilelyError);
    expect(error).toMatchObject({ status: 0, code: "challenge_unsolvable" });
  });

  it("throws challenge_unsolvable on another algorithm or a malformed challenge", async () => {
    for (const bad of [
      { ...VECTOR, algorithm: "SHA-512" },
      { ...VECTOR, challenge: "not-hex" },
      { ...VECTOR, maxnumber: -1 },
      { ...VECTOR, maxnumber: 1.5 },
    ]) {
      await expect(solveChallenge(bad)).rejects.toMatchObject({ code: "challenge_unsolvable" });
    }
  });
});

describe("getChallenge", () => {
  it("POSTs simple-limiter.pilely.app/challenge with an empty body and answers the challenge object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ...VECTOR, extra: "ignored" }));
    stubWindow(fetchImpl);
    await expect(getChallenge()).resolves.toEqual(VECTOR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://simple-limiter.pilely.app/challenge");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("x-pilely-challenge");
  });

  it("throws root's 401 login_required as a PilelyError", async () => {
    stubWindow(
      vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, code: "login_required", reason: "sign in first" })),
    );
    const error = await getChallenge().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PilelyError);
    expect(error).toMatchObject({ status: 401, code: "login_required" });
  });
});
