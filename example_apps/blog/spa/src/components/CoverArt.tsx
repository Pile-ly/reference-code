// A per-post banner, generated entirely in SVG — no image assets, no storage.
// Posts carry no cover field, so the art is DERIVED: a hash of the post id
// picks a hue and seeds a small PRNG, so every post gets a stable, distinct
// abstract composition (aurora light blobs + one motif + film grain + a
// vignette). `slice` lets one drawing fill both the square-ish feed tile and
// the wide post-page banner without distortion.

import type { ReactElement } from "react";

const hashInt = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function CoverArt({ seed }: { seed: string }) {
  const uid = "cv" + seed.replace(/[^a-zA-Z0-9]/g, "");
  const hue = hashInt(seed) % 360;
  const rng = mulberry32(hashInt(seed) ^ 0x9e3779b9);
  const rand = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const H = (h: number, s: number, l: number) => `hsl(${(((h % 360) + 360) % 360).toFixed(0)} ${s}% ${l}%)`;

  const bgA = H(hue + rand(-10, 10), 55, 12);
  const bgB = H(hue + rand(-26, 26), 62, 23);
  const blobColors = [H(hue + rand(-12, 12), 74, 55), H(hue + rand(28, 66), 68, 60), H(hue - rand(24, 58), 60, 45), H(hue + rand(150, 195), 70, 58)];
  const lightA = H(hue + rand(-10, 12), 80, 72);
  const lightB = H(hue + rand(30, 72), 72, 66);
  const accent = H(hue + rand(150, 195), 78, 64);

  const blobs = Array.from({ length: 3 + Math.floor(rng() * 2) }, (_, i) => ({
    id: `${uid}b${i}`, cx: rand(40, 600), cy: rand(20, 380), rx: rand(150, 300), ry: rand(120, 260), rot: rand(0, 180),
    color: blobColors[i % blobColors.length], op: rand(0.55, 0.9),
  }));

  const MOTIFS = ["waves", "rings", "scatter", "ribbon"] as const;
  const motif = MOTIFS[Math.floor(rng() * MOTIFS.length)];
  let motifEls: ReactElement[] = [];
  if (motif === "waves") {
    const shades = [H(hue, 60, 38), H(hue, 66, 50), H(hue, 74, 64)];
    motifEls = shades.map((c, i) => {
      const y = 250 + i * 44 + rand(-10, 10);
      const amp = rand(30, 68);
      return <path key={i} d={`M-20 ${y} C 160 ${y - amp}, 430 ${y + amp}, 660 ${y - amp * 0.3} L660 420 L-20 420 Z`} fill={c} opacity={0.5 - i * 0.09} />;
    });
  } else if (motif === "rings") {
    const cx = rand(70, 570), cy = rand(50, 350);
    motifEls = Array.from({ length: 6 }, (_, i) => (
      <circle key={i} cx={cx} cy={cy} r={30 + i * rand(34, 50)} fill="none" stroke={i % 2 ? lightA : lightB} strokeWidth={rand(1.5, 3.2)} opacity={0.5 - i * 0.05} />
    ));
  } else if (motif === "scatter") {
    motifEls = Array.from({ length: 30 }, (_, i) => (
      <circle key={i} cx={rand(12, 628)} cy={rand(12, 388)} r={rand(1.5, 7)} fill={pick([lightA, lightB, accent])} opacity={rand(0.25, 0.8)} />
    ));
  } else {
    motifEls = Array.from({ length: 3 }, (_, i) => {
      const y = rand(70, 330);
      const a = rand(40, 120) * (rng() < 0.5 ? -1 : 1);
      return <path key={i} d={`M-40 ${y} C 180 ${y + a}, 440 ${y - a}, 680 ${y + a * 0.4}`} fill="none" stroke={pick([lightA, lightB, accent])} strokeWidth={rand(8, 24)} strokeLinecap="round" opacity={rand(0.28, 0.5)} />;
    });
  }

  return (
    <svg className="cover-svg" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bgA} />
          <stop offset="1" stopColor={bgB} />
        </linearGradient>
        {blobs.map((b) => (
          <radialGradient key={b.id} id={b.id}>
            <stop offset="0" stopColor={b.color} stopOpacity="0.95" />
            <stop offset="1" stopColor={b.color} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${uid}vg`} cx="50%" cy="38%" r="76%">
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.34" />
        </radialGradient>
        <filter id={`${uid}gr`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
        </filter>
      </defs>
      <rect width="640" height="400" fill={`url(#${uid}bg)`} />
      {blobs.map((b) => (
        <ellipse key={b.id} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={`url(#${b.id})`} opacity={b.op} transform={`rotate(${b.rot.toFixed(1)} ${b.cx.toFixed(1)} ${b.cy.toFixed(1)})`} />
      ))}
      {motifEls}
      <rect width="640" height="400" fill={`url(#${uid}vg)`} />
      <rect width="640" height="400" filter={`url(#${uid}gr)`} opacity="0.16" style={{ mixBlendMode: "overlay" }} />
    </svg>
  );
}
