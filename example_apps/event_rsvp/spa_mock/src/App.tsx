import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { addEvent, latestForEvent, removeEvent, resetFixtures, rollup, submitRsvp, updateEvent, type Event, type Guest, type MockState, type Rsvp, type Status } from "./mock";

const CLUB = "Sunset Supper Club";
const TAGLINE = "Good food, good people, golden hour.";
const HOST_NAME = "Anika Rao";

// ── Date helpers (host-timezone aware) ──
const fmt = (e: Event, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: e.tz, ...opts }).format(new Date(e.starts_at_ms));
const evMonth = (e: Event) => fmt(e, { month: "short" }).toUpperCase();
const evDay = (e: Event) => fmt(e, { day: "numeric" });
const evTime = (e: Event) => fmt(e, { hour: "numeric", minute: "2-digit" });
const evWeekdayDate = (e: Event) => fmt(e, { weekday: "long", month: "long", day: "numeric" });
const evShortWhen = (e: Event) => fmt(e, { weekday: "short", month: "short", day: "numeric" });

const guestName = (h: Guest) => (h === "host" ? "Anika" : h.charAt(0).toUpperCase() + h.slice(1));
const latestBy = (state: MockState, eventId: string, handle: Guest): Rsvp | null => {
  const rows = state.rsvps.filter((r) => r.eventId === eventId && r.handle === handle);
  return rows.length ? rows.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;
};

// ── Generative Luma-style gradient covers (aurora blobs + motif + grain) ──
const hashInt = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function CoverArt({ seed }: { seed: string }) {
  const uid = "cv" + seed.replace(/[^a-zA-Z0-9]/g, "");
  const hue = hashInt(seed) % 360;
  const rng = mulberry32(hashInt(seed) ^ 0x9e3779b9);
  const rand = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const H = (h: number, s: number, l: number) => `hsl(${(((h % 360) + 360) % 360).toFixed(0)} ${s}% ${l}%)`;

  const bgA = H(hue + rand(-10, 10), 58, 13);
  const bgB = H(hue + rand(-26, 26), 64, 26);
  const blobColors = [H(hue + rand(-12, 12), 78, 56), H(hue + rand(28, 66), 72, 61), H(hue - rand(24, 58), 64, 47), H(hue + rand(150, 195), 74, 60)];
  const lightA = H(hue + rand(-10, 12), 82, 74);
  const lightB = H(hue + rand(30, 72), 74, 68);
  const accent = H(hue + rand(150, 195), 80, 66);

  const blobs = Array.from({ length: 3 + Math.floor(rng() * 2) }, (_, i) => ({
    id: `${uid}b${i}`, cx: rand(40, 600), cy: rand(20, 380), rx: rand(150, 300), ry: rand(120, 260), rot: rand(0, 180),
    color: blobColors[i % blobColors.length], op: rand(0.55, 0.9),
  }));

  const MOTIFS = ["waves", "rings", "scatter", "ribbon"] as const;
  const motif = MOTIFS[Math.floor(rng() * MOTIFS.length)];
  let motifEls: ReactElement[] = [];
  if (motif === "waves") {
    const shades = [H(hue, 62, 40), H(hue, 68, 52), H(hue, 76, 66)];
    motifEls = shades.map((c, i) => {
      const y = 250 + i * 44 + rand(-10, 10); const amp = rand(30, 68);
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
      const y = rand(70, 330); const a = rand(40, 120) * (rng() < 0.5 ? -1 : 1);
      return <path key={i} d={`M-40 ${y} C 180 ${y + a}, 440 ${y - a}, 680 ${y + a * 0.4}`} fill="none" stroke={pick([lightA, lightB, accent])} strokeWidth={rand(8, 24)} strokeLinecap="round" opacity={rand(0.28, 0.5)} />;
    });
  }

  return (
    <svg className="cover-svg" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={bgA} /><stop offset="1" stopColor={bgB} /></linearGradient>
        {blobs.map((b) => (
          <radialGradient key={b.id} id={b.id}><stop offset="0" stopColor={b.color} stopOpacity="0.95" /><stop offset="1" stopColor={b.color} stopOpacity="0" /></radialGradient>
        ))}
        <radialGradient id={`${uid}vg`} cx="50%" cy="38%" r="76%"><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.34" /></radialGradient>
        <filter id={`${uid}gr`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n" /><feColorMatrix in="n" type="saturate" values="0" /></filter>
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

function Cover({ event, children }: { event: Event; children?: ReactElement | null }) {
  return (
    <div className="cover">
      <CoverArt seed={event.id} />
      {event.canceled && <span className="cancel-flag">Canceled</span>}
      {children}
    </div>
  );
}

// ── Inline icons ──
const ICONS: Record<string, ReactElement> = {
  back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  chevron: <polyline points="9 6 15 12 9 18" />,
  arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="17" rx="3" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
  pin: <><path d="M20 10.5c0 6-8 11.5-8 11.5s-8-5.5-8-11.5a8 8 0 0 1 16 0z" /><circle cx="12" cy="10.5" r="2.8" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  minus: <line x1="5" y1="12" x2="19" y2="12" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  sparkle: <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  eye: <><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></>,
};
function Icon({ name, size = 18, fill = false }: { name: keyof typeof ICONS; size?: number; fill?: boolean }) {
  return <svg className="i" width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

const AV_PALETTE = ["#e0563f", "#3f7d8f", "#7a6f9c", "#4f8a63", "#b06a8a", "#c98a5e", "#5f818f", "#8a7a4a"];
function Avatar({ name, size = 34, host = false, ghost = false }: { name?: string; size?: number; host?: boolean; ghost?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (ghost) return <span className="avatar ghost" style={style}>?</span>;
  const initials = (name?.[0] ?? "?").toUpperCase();
  if (host) return <span className="avatar host" style={style}>{initials}</span>;
  return <span className="avatar" style={{ ...style, background: AV_PALETTE[hashInt(name ?? "?") % AV_PALETTE.length] }}>{initials}</span>;
}

const PERSONAS: { key: Guest; label: string; host?: boolean }[] = [
  { key: "maya", label: "Maya" },
  { key: "leo", label: "Leo" },
  { key: "host", label: "Anika", host: true },
];

type ToastItem = { id: number; kind: "success" | "info"; text: string };

export function App() {
  const [state, setState] = useState<MockState>(resetFixtures);
  const [viewer, setViewer] = useState<Guest>("maya");
  const [route, setRoute] = useState<"home" | "event">("home");
  const [selectedId, setSelectedId] = useState("supper");
  const [hostMode, setHostMode] = useState(false);
  const [theme, setTheme] = useState(() => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"));
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);

  const isHostView = viewer === "host" && hostMode;
  const event = state.events.find((e) => e.id === selectedId) ?? null;

  const toast = (kind: ToastItem["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((l) => [...l, { id, kind, text }]);
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), 2600);
  };
  const toTop = () => window.scrollTo({ top: 0, behavior: "auto" });
  const goHome = () => { setRoute("home"); setHostMode(false); toTop(); };
  const openEvent = (id: string) => { setSelectedId(id); setRoute("event"); setHostMode(false); toTop(); };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("rsvp_theme", next); } catch { /* private mode */ }
  };
  const changeViewer = (v: Guest) => {
    setViewer(v); setHostMode(false);
    toast("info", v === "host" ? "Previewing as Anika (host)." : `Previewing as ${guestName(v)} (guest).`);
  };
  const reset = () => { setState(resetFixtures()); setSelectedId("supper"); setRoute("home"); setHostMode(false); toast("info", "Demo restored to its original events."); };

  const onRsvp = (eventId: string, status: Status, party: number, note: string) => {
    setState((s) => submitRsvp(s, { eventId, handle: viewer, status, party, note }));
    toast("success", status === "going" ? "You're on the list — see you there!" : "Response sent privately to the host.");
  };

  return (
    <div className="shell">
      <nav className="topbar">
        <button className="wordmark" onClick={goHome} aria-label={`${CLUB} home`}>
          <span className="sun"><Icon name="sparkle" size={18} fill /></span>
          <span><b>{CLUB}</b><small>{TAGLINE}</small></span>
        </button>
        <div className="nav-actions">
          <span className="demo-pill"><i />Local demo</span>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
          <button className="mini-btn" onClick={reset}>Reset</button>
        </div>
      </nav>

      <div className="persona-bar">
        <span className="persona-label">Previewing as</span>
        <div className="segmented" role="group" aria-label="Choose a persona">
          {PERSONAS.map((p) => (
            <button key={p.key} className="segment" aria-pressed={viewer === p.key} onClick={() => changeViewer(p.key)}>
              <Avatar name={p.label} host={p.host} size={24} />
              <span className="seg-label">{p.label}</span>
            </button>
          ))}
        </div>
        {viewer === "host" && (
          <button className={`host-toggle ${hostMode ? "on" : ""}`} onClick={() => setHostMode((v) => !v)}>
            <Icon name={hostMode ? "eye" : "sparkle"} size={15} />
            {hostMode ? "Guest view" : "Host dashboard"}
          </button>
        )}
      </div>

      <main className="view-anim" key={isHostView ? "host" : route === "event" && event ? `event-${event.id}-${viewer}` : "home"}>
        {isHostView ? (
          <HostDashboard state={state} setState={setState} onPreview={openEvent} toast={toast} />
        ) : route === "event" && event ? (
          <EventDetail event={event} viewer={viewer} existing={latestBy(state, event.id, viewer)} onRsvp={onRsvp} onBack={goHome} />
        ) : (
          <Home events={state.events} viewer={viewer} rollupOf={(id) => rollup(state, id)} onOpen={openEvent} />
        )}
      </main>

      <footer className="foot">{CLUB} · An RSVP goes privately to the host — never to other guests.</footer>

      <div className="toast-stack">
        {toasts.map((t) => (<div key={t.id} className={`toast ${t.kind}`}><span className="tdot" />{t.text}</div>))}
      </div>
    </div>
  );
}

function Home({ events, viewer, rollupOf, onOpen }: { events: Event[]; viewer: Guest; rollupOf: (id: string) => ReturnType<typeof rollup>; onOpen: (id: string) => void }) {
  const isHost = viewer === "host";
  return (
    <>
      <header className="home-head">
        <div className="host-mark"><Icon name="sparkle" size={30} fill /></div>
        <div>
          <h1>{CLUB}</h1>
          <p>{TAGLINE} Hosted by {HOST_NAME}.</p>
        </div>
      </header>
      <div className="section-head">
        <h2>Upcoming events</h2>
        <span>{events.length} invitations</span>
      </div>
      <div className="event-list">
        {events.map((e) => {
          const heads = rollupOf(e.id).heads;
          return (
            <button key={e.id} className="event-row" onClick={() => onOpen(e.id)}>
              <Cover event={e} />
              <div className="er-body">
                <span className="er-when"><Icon name="calendar" size={13} /> {evShortWhen(e)} · {evTime(e)}</span>
                <h3>{e.title}</h3>
                <span className="er-place"><Icon name="pin" size={13} /> {e.place}</span>
              </div>
              <div className="er-go">
                {isHost && !e.canceled && heads > 0 ? <span className="pill going"><Icon name="check" size={13} /> {heads} going</span> : <span className="pill">View</span>}
                <span className="chevron"><Icon name="chevron" size={18} /></span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function EventDetail({ event, viewer, existing, onRsvp, onBack }: { event: Event; viewer: Guest; existing: Rsvp | null; onRsvp: (eventId: string, status: Status, party: number, note: string) => void; onBack: () => void }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>(existing?.status ?? "going");
  const [party, setParty] = useState(existing?.status === "going" ? existing.party : 1);
  const [note, setNote] = useState(existing?.note ?? "");
  const showForm = !existing || editing;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onRsvp(event.id, status, status === "going" ? party : 0, note.trim());
    setEditing(false);
  };

  return (
    <div className="event-detail narrow">
      <aside className="event-aside">
        <Cover event={event} />
        <div className="host-card">
          <Avatar name="Anika" host size={40} />
          <div className="who">
            <small>Hosted by</small>
            <b>{HOST_NAME}</b>
            <span>{CLUB}</span>
          </div>
        </div>
      </aside>

      <div className="event-main">
        <button className="backlink" onClick={onBack}><Icon name="back" size={16} /> All events</button>
        <p className="kicker">{CLUB} invitation</p>
        <h1>{event.title}</h1>

        <div className="meta-list">
          <div className="meta-row">
            <div className="cal-tile"><small>{evMonth(event)}</small><b>{evDay(event)}</b></div>
            <div className="meta-text"><b>{evWeekdayDate(event)}</b><small>{evTime(event)} · {event.tz.replace("America/", "").replace("_", " ")}</small></div>
          </div>
          <div className="meta-row">
            <div className="pin-tile"><Icon name="pin" size={20} /></div>
            <div className="meta-text"><b>{event.place}</b><small>Location shared by the host</small></div>
          </div>
        </div>

        {event.canceled ? (
          <div className="register">
            <div className="canceled-box">
              <span className="badge"><Icon name="x" size={22} /></span>
              <h2>This event is canceled</h2>
              <p>We're sorry to miss you. Watch for the next invitation.</p>
            </div>
          </div>
        ) : showForm ? (
          <form className="register" onSubmit={submit}>
            <div className="register-top">
              <h2>Will you join us?</h2>
              <span className="secure"><Icon name="lock" size={12} /> Private</span>
            </div>
            <p className="sub">Your response goes straight to {HOST_NAME}.</p>
            <div className="rsvp-options">
              <button type="button" className={`rsvp-opt going ${status === "going" ? "on" : ""}`} onClick={() => setStatus("going")}>
                <span className="mark"><Icon name="check" size={14} /></span>
                <b>Going</b><small>Save me a seat</small>
              </button>
              <button type="button" className={`rsvp-opt cant ${status === "cant" ? "on" : ""}`} onClick={() => setStatus("cant")}>
                <span className="mark"><Icon name="x" size={14} /></span>
                <b>Can't make it</b><small>Maybe next time</small>
              </button>
            </div>
            {status === "going" && (
              <div className="field">
                <label>Guests in your party</label>
                <div className="stepper">
                  <button type="button" disabled={party <= 1} onClick={() => setParty((v) => v - 1)}><Icon name="minus" size={16} /></button>
                  <b>{party}</b>
                  <button type="button" disabled={party >= 12} onClick={() => setParty((v) => v + 1)}><Icon name="plus" size={16} /></button>
                </div>
              </div>
            )}
            <div className="field">
              <label>A note for the host <span style={{ color: "var(--faint)", fontWeight: 400 }}>(optional)</span></label>
              <textarea value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder="Dietary needs, a plus-one's name, or a little hello…" />
            </div>
            <button className="btn btn-primary btn-block btn-lg" type="submit" style={{ marginTop: 16 }}>
              {status === "going" ? "Confirm my spot" : "Send response"} <Icon name="arrow" size={16} />
            </button>
            {existing && <button type="button" className="text-btn" style={{ display: "block", margin: "10px auto 0" }} onClick={() => setEditing(false)}>Cancel</button>}
            <p className="privacy"><Icon name="lock" size={14} /> Only {HOST_NAME} can see your response — never other guests.</p>
          </form>
        ) : (
          <div className="register">
            <div className={`confirmed ${existing.status}`}>
              <span className="badge"><Icon name={existing.status === "going" ? "check" : "x"} size={22} /></span>
              <div>
                <b>{existing.status === "going" ? "You're in!" : "You said you can't make it"}</b>
                <p>{existing.status === "going" ? `Party of ${existing.party}${existing.note ? ` · “${existing.note}”` : ""}` : "The host has your note."}</p>
              </div>
              <button className="mini-btn change" onClick={() => { setStatus(existing.status); setParty(existing.status === "going" ? existing.party : 1); setNote(existing.note); setEditing(true); }}>Change</button>
            </div>
            <p className="privacy"><Icon name="lock" size={14} /> Your response is private to {HOST_NAME}.</p>
          </div>
        )}

        <div className="about">
          <h3>About this event</h3>
          <p>{event.description}</p>
          <div className="chips">
            <span className="chip"><Icon name="sparkle" size={13} /> Hosted gathering</span>
            <span className="chip"><Icon name="lock" size={13} /> Private RSVP</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HostDashboard({ state, setState, onPreview, toast }: { state: MockState; setState: React.Dispatch<React.SetStateAction<MockState>>; onPreview: (id: string) => void; toast: (kind: "success" | "info", text: string) => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [place, setPlace] = useState("");
  const [description, setDescription] = useState("");

  const heads = state.events.reduce((n, e) => n + rollup(state, e.id).heads, 0);
  const responses = state.events.reduce((n, e) => n + latestForEvent(state, e.id).length, 0);

  const create = (e: FormEvent) => {
    e.preventDefault();
    const starts = new Date(when).getTime();
    if (!title.trim() || Number.isNaN(starts)) { toast("info", "Add a title and a start date first."); return; }
    setState((s) => addEvent(s, { title: title.trim(), starts_at_ms: starts, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, place: place.trim(), description: description.trim() }));
    setTitle(""); setWhen(""); setPlace(""); setDescription("");
    toast("success", "Event published to the demo.");
  };

  return (
    <div className="host-dash">
      <div className="dash-hero">
        <div>
          <p className="kicker">Host dashboard</p>
          <h1>Welcome back, Anika.</h1>
          <p>Keep your table full and your guests in the loop.</p>
        </div>
      </div>

      <div className="dash-stats">
        <div><b>{state.events.length}</b><span>Published events</span></div>
        <div><b>{heads}</b><span>Confirmed guests</span></div>
        <div><b>{responses}</b><span>Total responses</span></div>
      </div>

      <div className="section-head"><h2>Create a new event</h2></div>
      <form className="create-card" onSubmit={create}>
        <div className="create-grid">
          <div className="full">
            <label>Event title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Autumn pasta night" />
          </div>
          <div>
            <label>Date &amp; time</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label>Location</label>
            <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="The community table" />
          </div>
          <div>
            <label>Short description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should guests know?" />
          </div>
        </div>
        <div className="create-foot">
          <button className="btn btn-primary" type="submit"><Icon name="plus" size={16} /> Publish event</button>
        </div>
      </form>

      <div className="section-head" style={{ marginBottom: 14 }}>
        <h2>Your events</h2>
        <span><Icon name="lock" size={12} /> Responses visible only to you</span>
      </div>
      <div className="host-events">
        {state.events.map((e) => {
          const summary = rollup(state, e.id);
          return (
            <article className="host-event" key={e.id}>
              <Cover event={e} />
              <div className="he-main">
                <div className="he-title">
                  <div>
                    <h3>{e.title}</h3>
                    <p>{evShortWhen(e)} · {evTime(e)} · {e.place}</p>
                  </div>
                </div>
                <div className="he-summary">
                  <div><b>{summary.heads}</b><span>Guests</span></div>
                  <div><b>{summary.going.length}</b><span>Going</span></div>
                  <div><b>{summary.cant.length}</b><span>Can't</span></div>
                </div>
                {summary.going.length > 0 ? (
                  <div className="guest-line">
                    {summary.going.map((r) => (
                      <span className="guest-chip" key={r.id}>
                        <Avatar name={guestName(r.handle)} size={20} />
                        {guestName(r.handle)} · party {r.party}{r.note && <small> “{r.note}”</small>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="no-guests">No responses yet — share the invitation to get things rolling.</p>
                )}
                <div className="he-actions">
                  <button className="mini-btn" onClick={() => onPreview(e.id)}><Icon name="eye" size={13} /> Preview</button>
                  <button className="mini-btn" onClick={() => { const next = window.prompt("Event title", e.title); if (next?.trim()) { setState((s) => updateEvent(s, e.id, { title: next.trim() })); toast("success", "Title updated."); } }}><Icon name="edit" size={13} /> Rename</button>
                  <button className="mini-btn" onClick={() => { setState((s) => updateEvent(s, e.id, { canceled: !e.canceled })); toast("info", e.canceled ? "Event is live again." : "Event marked canceled."); }}>{e.canceled ? "Restore" : "Cancel"}</button>
                  <button className="mini-btn danger" onClick={() => { if (window.confirm(`Delete “${e.title}” and its responses?`)) { setState((s) => removeEvent(s, e.id)); toast("info", "Event removed."); } }}>Delete</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
