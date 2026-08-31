import { FormEvent, ReactElement, useMemo, useState, useSyncExternalStore } from "react";
import {
  addPlant, addWatering, careDays, currentUser, kindFor, type Plant, type PlantKind,
  removePlant, removeWatering, resetMockData, signIn, signOut, snapshot, subscribe, type Watering,
} from "./mock";

// ─────────────────────────────────────────────────────────────────────────
// Generative plant illustrations — a distinct botanical drawing per plant,
// seeded from its id + kind, so "Waterly" needs no photos to feel alive.
// ─────────────────────────────────────────────────────────────────────────
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

function PlantArt({ seed, kind = "bushy", domId }: { seed: string; kind?: PlantKind; domId?: string }) {
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

// ── Time + care status ──
const DAY = 86_400_000;
const lastWateredMs = (plant: Plant, ws: Watering[]) => { const own = ws.filter((w) => w.plantId === plant.id); return own.length ? Math.max(...own.map((w) => w.createdAt)) : plant.createdAt; };
const daysSince = (ms: number) => (Date.now() - ms) / DAY;
type Tone = "over" | "due" | "soon" | "ok";
function statusOf(plant: Plant, ws: Watering[]): { tone: Tone; label: string; due: number } {
  const every = plant.waterEvery ?? 7;
  const due = Math.round(every - daysSince(lastWateredMs(plant, ws)));
  if (due < 0) return { tone: "over", label: `${-due}d overdue`, due };
  if (due === 0) return { tone: "due", label: "Water today", due };
  if (due <= 2) return { tone: "soon", label: `Water in ${due}d`, due };
  return { tone: "ok", label: `Water in ${due}d`, due };
}
function relTime(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.floor(d)}d ago`;
  const w = d / 7; if (w < 5) return `${Math.floor(w)}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function downloadPlant(plant: Plant): void {
  const svg = document.getElementById("hero-art");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", "240");
  clone.setAttribute("height", "240");
  const NS = "http://www.w3.org/2000/svg";
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "240"); bg.setAttribute("height", "240"); bg.setAttribute("fill", "#eef3e8");
  clone.insertBefore(bg, clone.firstChild);
  const str = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const S = 960;
    const c = document.createElement("canvas");
    c.width = S; c.height = S + 130;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#eef3e8"; ctx.fillRect(0, 0, S, S + 130);
    ctx.drawImage(img, 0, 0, S, S);
    ctx.textAlign = "center";
    ctx.fillStyle = "#1c2a1e"; ctx.font = "600 56px -apple-system, system-ui, sans-serif";
    ctx.fillText(plant.name, S / 2, S + 62);
    ctx.fillStyle = "#5f7a5f"; ctx.font = "400 34px -apple-system, system-ui, sans-serif";
    ctx.fillText(plant.species ?? "Waterly", S / 2, S + 106);
    const a = document.createElement("a");
    a.download = `${plant.name.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
}

// ── Icons ──
const ICONS: Record<string, ReactElement> = {
  drop: <path d="M12 3s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.4 12 3 12 3z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  pin: <><path d="M20 10.5c0 6-8 11.5-8 11.5s-8-5.5-8-11.5a8 8 0 0 1 16 0z" /><circle cx="12" cy="10.5" r="2.8" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  leaf: <path d="M11 20A7 7 0 0 1 4 13c0-6 8-9 16-9 0 8-4 14-9 14a7 7 0 0 1-4-1.3" />,
  back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
};
function Icon({ name, size = 18, fill = false }: { name: keyof typeof ICONS; size?: number; fill?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

// ── Store hook ──
function useMock() {
  useSyncExternalStore(subscribe, () => JSON.stringify({ user: currentUser(), data: snapshot() }), () => "");
  return { user: currentUser(), ...snapshot() };
}

type ToastItem = { id: number; text: string; undo?: () => void };
let toastSeq = 0;

export function App() {
  const { user, plants, waterings } = useMock();
  const [theme, setTheme] = useState(() => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = (text: string, undo?: () => void) => {
    const id = ++toastSeq;
    setToasts((l) => [...l, { id, text, undo }]);
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), 4200);
  };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("waterly_theme", next); } catch { /* private mode */ }
  };

  const owner = user?.id === "owner-demo";
  const selected = owner ? (plants.find((p) => p.id === selectedId) ?? null) : null;

  const stats = useMemo(() => {
    const needs = plants.filter((p) => statusOf(p, waterings).due <= 0).length;
    const weekAgo = Date.now() - 7 * DAY;
    const thisWeek = waterings.filter((w) => w.createdAt >= weekAgo).length;
    return { plants: plants.length, needs, thisWeek };
  }, [plants, waterings]);

  const water = (plant: Plant, note = "") => {
    const w = addWatering(plant.id, note);
    toast(`${plant.name} watered 💧`, () => { removeWatering(w.id); });
  };

  // ── Gates ──
  if (!user) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-logo"><Icon name="leaf" size={30} fill /></div>
          <h1>Waterly</h1>
          <p>A calm little garden log. This one is private — sign in to see the plants.</p>
          <button className="btn btn-primary btn-block" onClick={() => signIn()}><Icon name="leaf" size={16} /> Sign in as owner</button>
          <button className="btn btn-ghost btn-block" onClick={() => signIn("other")}>Preview as a non-owner</button>
        </div>
        <Toasts toasts={toasts} dismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-logo muted"><Icon name="leaf" size={30} fill /></div>
          <h1>Nothing to see here</h1>
          <p>This garden is private to its owner. You're signed in as <b>@{user.handle}</b>, so there are no plants to show.</p>
          <button className="btn btn-ghost btn-block" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand" onClick={() => setSelectedId(null)}>
          <span className="brand-mark"><Icon name="leaf" size={17} fill /></span>
          <span><b>Waterly</b><small>@{user.handle}'s garden</small></span>
        </div>
        <div className="top-actions">
          <span className="demo-pill"><i />Local demo</span>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
          <button className="mini-btn" onClick={() => { resetMockData(); signIn(); setSelectedId(null); toast("Garden reset to its fixtures."); }}>Reset</button>
          <button className="mini-btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="wrap view-anim">
        <div className="stat-row">
          <div className="stat"><b>{stats.plants}</b><span>Plants</span></div>
          <div className={`stat ${stats.needs > 0 ? "warn" : ""}`}><b>{stats.needs}</b><span>Need water</span></div>
          <div className="stat"><b>{stats.thisWeek}</b><span>Watered this week</span></div>
        </div>

        <div className="section-head">
          <h2>Your plants</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add plant</button>
        </div>

        {plants.length === 0 ? (
          <div className="empty">No plants yet. Add your first green friend.</div>
        ) : (
          <div className="plant-grid">
            {plants.map((p) => {
              const st = statusOf(p, waterings);
              return (
                <button key={p.id} className="plant-card" onClick={() => setSelectedId(p.id)}>
                  <div className="art-frame"><PlantArt seed={p.id} kind={p.kind} /></div>
                  <div className="pc-body">
                    <h3>{p.name}</h3>
                    {p.species && <p className="species">{p.species}</p>}
                    <div className="pc-foot">
                      <span className={`status ${st.tone}`}><Icon name="drop" size={12} fill /> {st.label}</span>
                      <span className="water-btn" onClick={(e) => { e.stopPropagation(); water(p); }} role="button" aria-label={`Water ${p.name}`}><Icon name="drop" size={15} fill /></span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div style={{ height: 24 }} />
      </main>

      <footer className="foot">Local mock — data lives in this browser and resets on reload. No API requests are made.</footer>

      {selected && (
        <PlantDetail
          plant={selected}
          waterings={waterings.filter((w) => w.plantId === selected.id)}
          onClose={() => setSelectedId(null)}
          onWater={(note) => water(selected, note)}
          onPhoto={(photo, note) => { const w = addWatering(selected.id, note || "Photo update", photo); toast("Photo logged 📷", () => removeWatering(w.id)); }}
          onDeleteWatering={(id) => removeWatering(id)}
          onDelete={() => { removePlant(selected.id); setSelectedId(null); toast(`${selected.name} removed.`); }}
          onDownload={() => downloadPlant(selected)}
        />
      )}

      {adding && (
        <AddPlant
          onClose={() => setAdding(false)}
          onAdd={(name, opts) => { const p = addPlant(name, opts); setAdding(false); setSelectedId(p.id); toast(`${p.name} added 🌱`); }}
        />
      )}

      <Toasts toasts={toasts} dismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </div>
  );
}

function PlantDetail({ plant, waterings, onClose, onWater, onPhoto, onDeleteWatering, onDelete, onDownload }: {
  plant: Plant; waterings: Watering[]; onClose: () => void; onWater: (note: string) => void;
  onPhoto: (photo: string, note: string) => void; onDeleteWatering: (id: string) => void; onDelete: () => void; onDownload: () => void;
}) {
  const [note, setNote] = useState("");
  const st = statusOf(plant, waterings);
  const rows = [...waterings].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top">
          <button className="backlink" onClick={onClose}><Icon name="back" size={16} /> Garden</button>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="detail-hero">
          <div className="hero-art-frame"><PlantArt seed={plant.id} kind={plant.kind} domId="hero-art" /></div>
          <div className="hero-info">
            <h1>{plant.name}</h1>
            {plant.species && <p className="species">{plant.species}</p>}
            <span className={`status ${st.tone} big`}><Icon name="drop" size={13} fill /> {st.label}</span>
            <div className="fact-chips">
              <span className="chip"><Icon name="drop" size={13} /> Every {plant.waterEvery ?? careDays(plant.kind ?? "bushy")}d</span>
              {plant.light && <span className="chip"><Icon name="sun" size={13} /> {plant.light}</span>}
              {plant.room && <span className="chip"><Icon name="pin" size={13} /> {plant.room}</span>}
            </div>
          </div>
        </div>

        <div className="log-card">
          <input className="field" value={note} maxLength={140} placeholder="Add a note (optional) — new leaf, repotted, misted…" onChange={(e) => setNote(e.target.value)} />
          <div className="log-actions">
            <button className="btn btn-primary" onClick={() => { onWater(note.trim()); setNote(""); }}><Icon name="drop" size={16} fill /> Water now</button>
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              <Icon name="camera" size={16} /> Photo
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onPhoto(URL.createObjectURL(f), note.trim()); setNote(""); }} />
            </label>
            <button className="btn btn-ghost" onClick={onDownload}><Icon name="download" size={16} /> Download</button>
          </div>
        </div>

        <div className="section-head sm"><h2>History</h2><span>{rows.length} {rows.length === 1 ? "entry" : "entries"}</span></div>
        {rows.length === 0 ? (
          <p className="empty sm">No waterings logged yet.</p>
        ) : (
          <ul className="timeline">
            {rows.map((w) => (
              <li key={w.id}>
                <span className="tl-dot"><Icon name="drop" size={11} fill /></span>
                <div className="tl-body">
                  <div className="tl-head"><b>{w.note || "Watered"}</b><time>{relTime(w.createdAt)}</time></div>
                  {w.photo && <img className="tl-photo" src={w.photo} alt="" />}
                </div>
                <button className="tl-del" onClick={() => onDeleteWatering(w.id)} aria-label="Delete entry"><Icon name="trash" size={13} /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="sheet-foot">
          <button className="btn btn-danger-ghost" onClick={() => { if (window.confirm(`Remove ${plant.name} and its ${rows.length} log entries?`)) onDelete(); }}><Icon name="trash" size={15} /> Delete plant</button>
        </div>
      </div>
    </div>
  );
}

function AddPlant({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, opts: { species?: string; room?: string; light?: string; waterEvery?: number }) => void }) {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [room, setRoom] = useState("");
  const [light, setLight] = useState("Bright indirect");
  const [every, setEvery] = useState(7);
  const previewKind = name.trim() ? kindFor(name) : "bushy";
  const submit = (e: FormEvent) => { e.preventDefault(); if (!name.trim()) return; onAdd(name.trim(), { species: species.trim() || undefined, room: room.trim() || undefined, light, waterEvery: every }); };
  return (
    <div className="scrim" onClick={onClose}>
      <form className="sheet compact" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-top">
          <h2 className="sheet-title">Add a plant</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="add-preview"><div className="art-frame sm"><PlantArt seed={"new-" + name} kind={previewKind} /></div><small>A portrait is generated from the name — no photo needed.</small></div>
        <div className="add-fields">
          <label>Name<input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rubber tree" /></label>
          <label>Species <span className="opt">optional</span><input className="field" value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="Ficus elastica" /></label>
          <div className="add-two">
            <label>Water every<div className="stepper"><button type="button" onClick={() => setEvery((v) => Math.max(1, v - 1))}>−</button><b>{every}d</b><button type="button" onClick={() => setEvery((v) => Math.min(60, v + 1))}>+</button></div></label>
            <label>Light<select className="field" value={light} onChange={(e) => setLight(e.target.value)}><option>Bright direct</option><option>Bright indirect</option><option>Medium indirect</option><option>Low to medium</option><option>Low</option></select></label>
          </div>
          <label>Room <span className="opt">optional</span><input className="field" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Living room" /></label>
        </div>
        <div className="sheet-foot end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}><Icon name="plus" size={15} /> Add plant</button>
        </div>
      </form>
    </div>
  );
}

function Toasts({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.undo && <button onClick={() => { t.undo!(); dismiss(t.id); }}>Undo</button>}
        </div>
      ))}
    </div>
  );
}
