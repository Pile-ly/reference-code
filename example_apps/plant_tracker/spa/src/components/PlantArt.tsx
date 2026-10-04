// A generated botanical portrait, drawn entirely in SVG and seeded from the
// plant's id — the calm placeholder a plant falls back to when it has no
// photo (a real cover blob renders over it). The silhouette varies by "kind",
// which `kindFor` infers from the plant's name (a UI heuristic, like the
// placeholder tint it replaces — nothing about the kind is stored).

import type { ReactElement } from "react";

export type PlantKind = "monstera" | "snake" | "pothos" | "succulent" | "palm" | "fern" | "bushy";

/** Best-guess kind from a plant's name, so the portrait fits the plant. */
export function kindFor(name: string): PlantKind {
  const n = name.toLowerCase();
  if (/snake|sansevieria/.test(n)) return "snake";
  if (/pothos|ivy|philo|heart/.test(n)) return "pothos";
  if (/aloe|succulent|cact|jade|echeveria|haworthia/.test(n)) return "succulent";
  if (/fern/.test(n)) return "fern";
  if (/palm/.test(n)) return "palm";
  if (/monstera|swiss/.test(n)) return "monstera";
  if (/fig|ficus|rubber|zz|peace|lily|calathea|prayer/.test(n)) return "bushy";
  const kinds: PlantKind[] = ["monstera", "snake", "pothos", "succulent", "palm", "fern", "bushy"];
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) | 0;
  return kinds[Math.abs(h) % kinds.length];
}

const hashInt = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const POT_COLORS = ["#c17a54", "#d98a5f", "#e6ded0", "#93a07f", "#414d41", "#cf9a86", "#6f89a0"];
const SOIL = "#43362a";

type Style = "fan" | "rosette" | "frond" | "trailing";
const KIND_CFG: Record<PlantKind, { style: Style; count: [number, number]; len: [number, number]; w: [number, number]; spread: number; hue: [number, number]; sat: [number, number]; curve: number; edge?: boolean }> = {
  monstera: { style: "fan", count: [5, 6], len: [86, 110], w: [0.44, 0.52], spread: 64, hue: [128, 148], sat: [40, 52], curve: 0.14 },
  bushy: { style: "fan", count: [7, 9], len: [64, 86], w: [0.5, 0.6], spread: 76, hue: [118, 138], sat: [42, 54], curve: 0.1 },
  snake: { style: "fan", count: [5, 7], len: [118, 152], w: [0.06, 0.085], spread: 22, hue: [120, 150], sat: [38, 52], curve: 0.03, edge: true },
  succulent: { style: "rosette", count: [10, 13], len: [48, 72], w: [0.2, 0.27], spread: 0, hue: [150, 172], sat: [30, 42], curve: 0.06 },
  palm: { style: "fan", count: [5, 7], len: [112, 132], w: [0.08, 0.11], spread: 78, hue: [118, 138], sat: [40, 52], curve: 0.24 },
  fern: { style: "frond", count: [5, 7], len: [96, 124], w: [0, 0], spread: 78, hue: [108, 132], sat: [38, 50], curve: 0 },
  pothos: { style: "trailing", count: [5, 6], len: [42, 58], w: [0.72, 0.86], spread: 0, hue: [120, 144], sat: [40, 54], curve: 0.14 },
};

const archedLeaf = (len: number, halfW: number, bend: number) =>
  `M0 0 C ${halfW} ${-len * 0.28}, ${(halfW + bend) * 0.9} ${-len * 0.72}, ${bend} ${-len} C ${(-halfW + bend) * 0.9} ${-len * 0.72}, ${-halfW} ${-len * 0.28}, 0 0 Z`;
const heartLeaf = (len: number, halfW: number) =>
  `M0 0 C ${halfW} ${-len * 0.12}, ${halfW} ${-len * 0.72}, 0 ${-len} C ${-halfW} ${-len * 0.72}, ${-halfW} ${-len * 0.12}, 0 0 Z`;

export function PlantArt({ seed, kind = "bushy", domId }: { seed: string; kind?: PlantKind; domId?: string }) {
  const rng = mulberry32(hashInt(seed) ^ 0x51ed2701);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const cfg = KIND_CFG[kind];
  const cx = 120, base = 158;
  const pot = POT_COLORS[Math.floor(R(0, POT_COLORS.length))];
  const G = (h: number, s: number, l: number) => `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l}%)`;
  const hue = R(cfg.hue[0], cfg.hue[1]);
  const sat = R(cfg.sat[0], cfg.sat[1]);
  const shade = (t: number) => G(hue + R(-6, 6), sat, 30 + t * 24);
  const midrib = G(hue, Math.max(0, sat - 8), 26);

  const foliage: ReactElement[] = [];
  const vines: ReactElement[] = [];

  if (cfg.style === "fan") {
    const n = Math.round(R(cfg.count[0], cfg.count[1]));
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(b / (n - 1) - 0.5) - Math.abs(a / (n - 1) - 0.5));
    order.forEach((i, k) => {
      const t = i / (n - 1);
      const ang = (t - 0.5) * 2 * cfg.spread + R(-5, 5);
      const len = R(cfg.len[0], cfg.len[1]) * (1 - Math.abs(t - 0.5) * 0.22);
      const halfW = len * R(cfg.w[0], cfg.w[1]);
      const bend = cfg.curve * len * (t < 0.5 ? -1 : 1);
      foliage.push(
        <g key={i} transform={`translate(${cx} ${base}) rotate(${ang.toFixed(1)})`}>
          <path d={archedLeaf(len, halfW, bend)} fill={shade(k / (n - 1))} stroke={cfg.edge ? G(48, 62, 62) : "none"} strokeWidth={cfg.edge ? 2 : 0} strokeLinejoin="round" />
          <path d={`M0 -4 Q ${bend * 0.5} ${-len * 0.5}, ${bend} ${-len * 0.94}`} fill="none" stroke={midrib} strokeWidth={1} opacity={0.45} />
        </g>,
      );
    });
  } else if (cfg.style === "rosette") {
    for (let ring = 0; ring < 2; ring++) {
      const rn = ring === 0 ? Math.round(R(cfg.count[0], cfg.count[1])) : Math.round(R(cfg.count[0], cfg.count[1]) * 0.55);
      for (let i = 0; i < rn; i++) {
        const ang = -92 + 184 * (i / (rn - 1)) + R(-4, 4);
        const len = R(cfg.len[0], cfg.len[1]) * (ring === 0 ? 1 : 0.58);
        const halfW = len * R(cfg.w[0], cfg.w[1]);
        foliage.push(
          <g key={`${ring}-${i}`} transform={`translate(${cx} ${base - 4}) rotate(${ang.toFixed(1)})`}>
            <path d={archedLeaf(len, halfW, cfg.curve * len)} fill={G(hue + R(-6, 6), sat, 34 + ring * 8 + (i % 3) * 3)} />
          </g>,
        );
      }
    }
  } else if (cfg.style === "frond") {
    const n = Math.round(R(cfg.count[0], cfg.count[1]));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const ang = (t - 0.5) * 2 * cfg.spread + R(-4, 4);
      const len = R(cfg.len[0], cfg.len[1]) * (1 - Math.abs(t - 0.5) * 0.18);
      const color = G(hue + R(-6, 6), sat, 34 + t * 10);
      const bend = 0.32 * len * (t < 0.5 ? -1 : 1);
      const cpx = bend * 0.5, cpy = -len * 0.55, tipx = bend, tipy = -len;
      const leaflets: ReactElement[] = [];
      for (let s = 1; s <= 9; s++) {
        const p = s / 9;
        const bx = 2 * (1 - p) * p * cpx + p * p * tipx;
        const by = 2 * (1 - p) * p * cpy + p * p * tipy;
        const ll = 13 * (1 - p * 0.65);
        leaflets.push(<line key={`l${s}`} x1={bx} y1={by} x2={bx - ll} y2={by - ll * 0.35} stroke={color} strokeWidth={2.3} strokeLinecap="round" />);
        leaflets.push(<line key={`r${s}`} x1={bx} y1={by} x2={bx + ll} y2={by - ll * 0.35} stroke={color} strokeWidth={2.3} strokeLinecap="round" />);
      }
      foliage.push(
        <g key={i} transform={`translate(${cx} ${base}) rotate(${ang.toFixed(1)})`}>
          <path d={`M0 0 Q ${cpx} ${cpy}, ${tipx} ${tipy}`} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          {leaflets}
        </g>,
      );
    }
  } else {
    const n = Math.round(R(cfg.count[0], cfg.count[1]));
    for (let i = 0; i < n; i++) {
      const ang = -70 + 140 * (i / (n - 1)) + R(-6, 6);
      const len = R(cfg.len[0], cfg.len[1]);
      const halfW = len * R(cfg.w[0], cfg.w[1]);
      foliage.push(
        <g key={i} transform={`translate(${cx} ${base}) rotate(${ang.toFixed(1)})`}>
          <path d={heartLeaf(len, halfW)} fill={shade(i / (n - 1))} />
        </g>,
      );
    }
    const vn = Math.round(R(2, 3));
    for (let v = 0; v < vn; v++) {
      const dir = v % 2 === 0 ? -1 : 1;
      const sx = cx + dir * R(26, 40), sy = 168;
      const ex = cx + dir * R(52, 78), ey = R(224, 238);
      foliage.push(<path key={`v${v}`} d={`M${sx} ${sy} C ${sx + dir * 22} ${sy + 22}, ${cx + dir * R(78, 96)} ${R(196, 220)}, ${ex} ${ey}`} fill="none" stroke={G(hue, sat, 32)} strokeWidth={2.3} strokeLinecap="round" />);
      for (let s = 1; s <= 4; s++) {
        const p = s / 5;
        const px = sx + (ex - sx) * p, py = sy + (ey - sy) * p;
        vines.push(<g key={`vl${v}-${s}`} transform={`translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${dir * 42})`}><path d={heartLeaf(17, 10)} fill={shade((s % 3) / 3)} /></g>);
      }
    }
  }

  return (
    <svg id={domId} className="plant-art" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d={`M${cx - 56} 172 L ${cx + 56} 172 L ${cx + 40} 214 L ${cx - 40} 214 Z`} fill={pot} />
      <path d={`M${cx - 56} 172 L ${cx - 40} 214 L ${cx - 30} 214 L ${cx - 44} 172 Z`} fill="rgba(0,0,0,0.10)" />
      <rect x={cx - 62} y={156} width={124} height={16} rx={5} fill={pot} />
      <rect x={cx - 62} y={156} width={124} height={5} rx={3} fill="rgba(255,255,255,0.16)" />
      <ellipse cx={cx} cy={160} rx={50} ry={6} fill={SOIL} />
      {foliage}
      {vines}
    </svg>
  );
}
