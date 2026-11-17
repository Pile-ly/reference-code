// SHA-256 in plain TypeScript, shaped for the proof-of-work search: the
// message is always `salt + number`, so the salt's whole 64-byte blocks are
// hashed once (the "midstate") and each candidate hashes only the tail. It
// runs synchronously, with no `crypto.subtle`: one awaited digest per
// candidate spends more time on the promise than on the hash, and
// `crypto.subtle` is missing outside secure contexts. The server checks
// every answer, so this code only has to be correct, never secret.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const W = new Int32Array(64);

/** Mixes one 64-byte block of `bytes`, starting at `offset`, into `h`. */
function compress(h: Int32Array, bytes: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i += 1) {
    const at = offset + i * 4;
    W[i] = ((bytes[at] as number) << 24) | ((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
  }
  for (let i = 16; i < 64; i += 1) {
    const x = W[i - 15] as number;
    const y = W[i - 2] as number;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = ((W[i - 16] as number) + s0 + (W[i - 7] as number) + s1) | 0;
  }
  let a = h[0] as number;
  let b = h[1] as number;
  let c = h[2] as number;
  let d = h[3] as number;
  let e = h[4] as number;
  let f = h[5] as number;
  let g = h[6] as number;
  let k = h[7] as number;
  for (let i = 0; i < 64; i += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (k + s1 + ((e & f) ^ (~e & g)) + (K[i] as number) + (W[i] as number)) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    k = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = ((h[0] as number) + a) | 0;
  h[1] = ((h[1] as number) + b) | 0;
  h[2] = ((h[2] as number) + c) | 0;
  h[3] = ((h[3] as number) + d) | 0;
  h[4] = ((h[4] as number) + e) | 0;
  h[5] = ((h[5] as number) + f) | 0;
  h[6] = ((h[6] as number) + g) | 0;
  h[7] = ((h[7] as number) + k) | 0;
}

const encoder = new TextEncoder();

/** The digest's eight words as lowercase hex. */
function wordsToHex(h: Int32Array): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += ((h[i] as number) >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

/** The lowercase hex SHA-256 of `text`'s UTF-8 bytes. */
export function sha256Hex(text: string): string {
  return new PrefixHasher(text).hashHex("");
}

/**
 * SHA-256 of `prefix + suffix` for one fixed prefix and many short
 * suffixes: the prefix's whole blocks are mixed once, at construction.
 */
export class PrefixHasher {
  private readonly midstate: Int32Array;
  /** The prefix bytes after its last whole block. */
  private readonly rest: Uint8Array;
  private readonly prefixLength: number;
  private readonly state = new Int32Array(8);
  /** Room for the rest, a suffix of up to 63 bytes, and the padding. */
  private readonly tail = new Uint8Array(192);

  constructor(prefix: string) {
    const bytes = encoder.encode(prefix);
    const whole = bytes.length - (bytes.length % 64);
    this.midstate = new Int32Array(IV);
    for (let offset = 0; offset < whole; offset += 64) {
      compress(this.midstate, bytes, offset);
    }
    this.rest = bytes.subarray(whole);
    this.prefixLength = bytes.length;
  }

  /** The digest of `prefix + suffix` as eight words, in a buffer reused by
   *  the next call. `suffix` is ASCII of at most 63 characters. */
  hashWords(suffix: string): Int32Array {
    const tail = this.tail;
    const restLength = this.rest.length;
    tail.set(this.rest, 0);
    for (let i = 0; i < suffix.length; i += 1) {
      tail[restLength + i] = suffix.charCodeAt(i);
    }
    const used = restLength + suffix.length;
    const blocks = used + 9 <= 64 ? 1 : used + 9 <= 128 ? 2 : 3;
    const end = blocks * 64;
    tail[used] = 0x80;
    tail.fill(0, used + 1, end);
    const bits = (this.prefixLength + suffix.length) * 8;
    // A message under 512 MB: the length's top 32 bits are zero.
    tail[end - 4] = bits >>> 24;
    tail[end - 3] = bits >>> 16;
    tail[end - 2] = bits >>> 8;
    tail[end - 1] = bits;
    const state = this.state;
    state.set(this.midstate);
    for (let offset = 0; offset < end; offset += 64) {
      compress(state, tail, offset);
    }
    return state;
  }

  /** The lowercase hex digest of `prefix + suffix`. */
  hashHex(suffix: string): string {
    return wordsToHex(this.hashWords(suffix));
  }
}

/** A 64-character lowercase hex digest as eight words, or `null` when it is
 *  not one. */
export function hexToWords(digest: string): Int32Array | null {
  const hex = digest.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    return null;
  }
  const words = new Int32Array(8);
  for (let i = 0; i < 8; i += 1) {
    words[i] = Number.parseInt(hex.slice(i * 8, i * 8 + 8), 16) | 0;
  }
  return words;
}
