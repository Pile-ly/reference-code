// Generative energetic cover art, drawn entirely in SVG and seeded from a
// stable string (a class id, or "hero"/"final" for the banded sections) — the
// storefront needs no photos to feel alive. Warm-biased gradient + soft blobs
// + diagonal impact bars + grain. Also exports a deterministic initials Avatar
// used by the coaches grid and the admin inbox.

import type { ReactElement } from "react";

const hashInt = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const WARM_HUES = [6, 16, 26, 38, 350, 300, 205];

export function ClassArt({ seed }: { seed: string }) {
  const uid = "ca" + seed.replace(/[^a-zA-Z0-9]/g, "");
  const rng = mulberry32(hashInt(seed) ^ 0x9e3779b9);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const hue = WARM_HUES[Math.floor(R(0, WARM_HUES.length))];
  const H = (h: number, s: number, l: number) => `hsl(${(((h % 360) + 360) % 360).toFixed(0)}, ${s}%, ${l}%)`;
  const bgA = H(hue, 74, 15), bgB = H(hue + R(-12, 22), 84, 44);
  const blobs = Array.from({ length: 3 }, (_, i) => ({
    id: `${uid}b${i}`, cx: R(60, 580), cy: R(30, 360), rx: R(150, 280), ry: R(120, 240), rot: R(0, 180),
    color: H(hue + R(-20, 40), 88, R(52, 64)), op: R(0.5, 0.85),
  }));
  const bars = Array.from({ length: 3 }, () => ({ x: R(-40, 640), w: R(26, 70) }));
  return (
    <svg className="cover-svg" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={bgA} /><stop offset="1" stopColor={bgB} /></linearGradient>
        {blobs.map((b) => (<radialGradient key={b.id} id={b.id}><stop offset="0" stopColor={b.color} stopOpacity="0.95" /><stop offset="1" stopColor={b.color} stopOpacity="0" /></radialGradient>))}
        <radialGradient id={`${uid}vg`} cx="50%" cy="36%" r="78%"><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.4" /></radialGradient>
        <filter id={`${uid}gr`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n" /><feColorMatrix in="n" type="saturate" values="0" /></filter>
      </defs>
      <rect width="640" height="400" fill={`url(#${uid}bg)`} />
      {blobs.map((b) => (<ellipse key={b.id} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={`url(#${b.id})`} opacity={b.op} transform={`rotate(${b.rot.toFixed(1)} ${b.cx.toFixed(1)} ${b.cy.toFixed(1)})`} />))}
      <g transform="skewX(-18)" opacity="0.14">{bars.map((bar, i) => (<rect key={i} x={bar.x} y={-40} width={bar.w} height={480} fill="#fff" />))}</g>
      <rect width="640" height="400" fill={`url(#${uid}vg)`} />
      <rect width="640" height="400" filter={`url(#${uid}gr)`} opacity="0.14" style={{ mixBlendMode: "overlay" }} />
    </svg>
  );
}

const AV = ["#ef4a2a", "#e8863a", "#c9482f", "#8a5cc0", "#3f86c9", "#3f9d6a"];
export function Avatar({ name, size = 46 }: { name: string; size?: number }): ReactElement {
  let n = 0; for (const c of name) n = (n * 31 + c.charCodeAt(0)) | 0;
  const initials = name.replace(/^@/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: AV[Math.abs(n) % AV.length] }}>{initials}</span>;
}
