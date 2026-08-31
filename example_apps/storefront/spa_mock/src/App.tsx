import { FormEvent, ReactElement, useRef, useState } from "react";
import { classes, coaches, freshState, inboxPage, Role, signIn, State, submitInquiry, testimonials, type ClassInfo } from "./model";

const BIZ = "Rock Boxing Gym";
const STATS = [
  { v: "500+", k: "Members" },
  { v: "20", k: "Classes / week" },
  { v: "6", k: "Coaches" },
  { v: "4.9★", k: "Google rating" },
];
const FEATURES = [
  { icon: "spark", title: "Beginner-first", desc: "Every class scales to you. Walk in today with zero experience and leave knowing how to move." },
  { icon: "eye", title: "Real coaching", desc: "Small groups, eyes on your form, and corrections that actually stick — round after round." },
  { icon: "heart", title: "A welcoming room", desc: "No egos, no mirrors-and-flexing. Just good people getting a little sharper every session." },
  { icon: "clock", title: "Fits your week", desc: "Early mornings, evenings, and weekends. Train when it works and never fall behind." },
];

// ── Generative energetic covers (no photos, API-free) ──
const hashInt = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const WARM_HUES = [6, 16, 26, 38, 350, 300, 205];

function ClassArt({ seed }: { seed: string }) {
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
  const bars = Array.from({ length: 3 }, (_, i) => ({ x: R(-40, 640), w: R(26, 70) }));
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
function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  let n = 0; for (const c of name) n = (n * 31 + c.charCodeAt(0)) | 0;
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: AV[Math.abs(n) % AV.length] }}>{initials}</span>;
}

const ICONS: Record<string, ReactElement> = {
  glove: <><path d="M7.5 21v-2.5h9V21z" /><path d="M8 18.5V9a4 4 0 0 1 8 0v2" /><path d="M16 10.5h1.2a2.3 2.3 0 0 1 0 4.6H16" /><path d="M8 11.5H7a2 2 0 0 0 0 4h1" /></>,
  spark: <path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12z" />,
  eye: <><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  heart: <path d="M20.8 5.1a5 5 0 0 0-7.1 0L12 6.8l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.8a5 5 0 0 0 0-7.1z" />,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>,
  arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
  pin: <><path d="M20 10.5c0 6-8 11.5-8 11.5s-8-5.5-8-11.5a8 8 0 0 1 16 0z" /><circle cx="12" cy="10.5" r="2.8" /></>,
  star: <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 18.6 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></>,
};
function Icon({ name, size = 18, fill = false }: { name: keyof typeof ICONS; size?: number; fill?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

const blank = { email: "", phone: "", classId: "", question: "" };
type Page = "home" | "classes" | "contact" | "inbox";
type ToastItem = { id: number; kind: "success" | "info" | "error"; text: string };

export function App() {
  const [state, setState] = useState<State>(freshState);
  const [page, setPage] = useState<Page>("home");
  const [form, setForm] = useState(blank);
  const [shown, setShown] = useState(2);
  const [theme, setTheme] = useState(() => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"));
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const owner = state.role === "owner";

  const toast = (kind: ToastItem["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((l) => [...l, { id, kind, text }]);
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), 3200);
  };
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0 }); };
  const goContact = (classId = "") => { setForm({ ...blank, classId }); go("contact"); };
  const toggleTheme = () => { const n = theme === "dark" ? "light" : "dark"; setTheme(n); document.documentElement.setAttribute("data-theme", n); try { localStorage.setItem("storefront_theme", n); } catch { /* private */ } };
  const chooseRole = (role: Role) => {
    setState((c) => (role === "visitor" ? { ...c, role } : signIn(c, role)));
    if (role !== "owner" && page === "inbox") go("home");
    toast("info", role === "visitor" ? "Signed out — browsing as a visitor." : role === "owner" ? "Signed in as the owner." : "Signed in as Sam (member).");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try { setState((c) => submitInquiry(c, form)); setForm(blank); go("home"); toast("success", "Inquiry sent — the owner can see it in the inbox."); }
    catch (error) { toast("error", error instanceof Error ? error.message : String(error)); }
  };
  const reset = () => { setState(freshState()); go("home"); setForm(blank); setShown(2); toast("info", "Demo reset to its fixtures."); };

  const inbox = owner ? inboxPage(state, 0, shown) : undefined;
  const ROLES: { key: Role; label: string }[] = [{ key: "visitor", label: "Visitor" }, { key: "member", label: "Sam" }, { key: "owner", label: "Owner" }];
  const NAV: { key: Page; label: string }[] = [{ key: "home", label: "Home" }, { key: "classes", label: "Classes" }, { key: "contact", label: "Contact" }, ...(owner ? [{ key: "inbox" as Page, label: "Inbox" }] : [])];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <button className="brand" onClick={() => go("home")}>
            <span className="brand-mark"><Icon name="glove" size={19} /></span>
            <span className="brand-name">{BIZ}</span>
            <span className="chip">Mock</span>
          </button>
          <nav className="nav">
            {NAV.map((n) => (
              <button key={n.key} className={`nav-link ${page === n.key ? "on" : ""}`} onClick={() => (n.key === "contact" ? goContact() : go(n.key))}>{n.label}</button>
            ))}
          </nav>
          <div className="top-actions">
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            <button className="btn btn-accent btn-sm hide-sm" onClick={() => goContact()}>Ask a question</button>
          </div>
        </div>
        <div className="demo-bar">
          <div className="wrap demo-bar-inner">
            <span className="demo-label">Viewing as</span>
            <div className="segmented">
              {ROLES.map((r) => (<button key={r.key} className="segment" aria-pressed={state.role === r.key} onClick={() => chooseRole(r.key)}>{r.label}</button>))}
            </div>
            <button className="mini-btn ml-auto" onClick={reset}>Reset demo</button>
          </div>
        </div>
      </header>

      <main className="view-anim" key={page}>
        {page === "home" && <Home go={go} goContact={goContact} />}
        {page === "classes" && <Classes goContact={goContact} />}
        {page === "contact" && <Contact role={state.role} form={form} setForm={setForm} submit={submit} onSignIn={() => chooseRole("member")} />}
        {page === "inbox" && inbox && <Inbox rows={inbox.rows} hasMore={inbox.nextCursor !== undefined} onMore={() => setShown((v) => v + 2)} total={state.inquiries.length} />}
      </main>

      <footer className="foot">
        <div className="wrap">
          <b>{BIZ}</b> · Interactive mock — all state lives in this browser and resets on reload. No API, fetch, or XMLHttpRequest calls are made.
        </div>
      </footer>

      <div className="toast-stack">
        {toasts.map((t) => (<div key={t.id} className={`toast ${t.kind}`}><span className="tdot" />{t.text}</div>))}
      </div>
    </div>
  );
}

function Home({ go, goContact }: { go: (p: Page) => void; goContact: (id?: string) => void }) {
  return (
    <>
      <section className="hero">
        <div className="hero-bg"><ClassArt seed="rock-hero-band" /></div>
        <div className="wrap hero-inner">
          <span className="eyebrow accent">Neighborhood boxing gym</span>
          <h1 className="hero-title">Train with purpose.<br />Hit with confidence.</h1>
          <p className="hero-sub">Beginner-friendly boxing classes in a focused, welcoming gym. Real coaching, small groups, and a room that's genuinely glad you showed up.</p>
          <div className="hero-cta">
            <button className="btn btn-accent btn-lg" onClick={() => go("classes")}>Explore classes <Icon name="arrow" size={17} /></button>
            <button className="btn btn-ghost-light btn-lg" onClick={() => goContact()}>Ask a question</button>
          </div>
          <div className="hero-badge"><Icon name="spark" size={14} fill /> Your first class is free</div>
        </div>
      </section>

      <section className="stat-band">
        <div className="wrap stat-grid">
          {STATS.map((s) => (<div className="stat" key={s.k}><b>{s.v}</b><span>{s.k}</span></div>))}
        </div>
      </section>

      <section className="wrap block">
        <div className="section-head"><span className="eyebrow accent">Why train here</span><h2>Built for people, not just fighters.</h2></div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <span className="feature-ic"><Icon name={f.icon as keyof typeof ICONS} size={20} /></span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap block">
        <div className="section-head row">
          <div><span className="eyebrow accent">Classes</span><h2>Find your round.</h2></div>
          <button className="btn btn-ghost" onClick={() => go("classes")}>All classes <Icon name="arrow" size={15} /></button>
        </div>
        <div className="class-grid">
          {classes.slice(0, 3).map((c) => (<ClassCard key={c.id} info={c} onInquire={() => goContact(c.id)} />))}
        </div>
      </section>

      <section className="wrap block">
        <div className="section-head"><span className="eyebrow accent">The corner</span><h2>Coaches who watch every round.</h2></div>
        <div className="coach-grid">
          {coaches.map((co) => (
            <div className="coach" key={co.id}>
              <Avatar name={co.name} size={50} />
              <div><b>{co.name}</b><small>{co.title}</small><p>{co.bio}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap block">
        <div className="section-head"><span className="eyebrow accent">In their words</span><h2>People stick around.</h2></div>
        <div className="quote-grid">
          {testimonials.map((tm) => (
            <figure className="quote" key={tm.author}>
              <div className="stars">{[0, 1, 2, 3, 4].map((i) => (<Icon key={i} name="star" size={14} fill />))}</div>
              <blockquote>“{tm.quote}”</blockquote>
              <figcaption><b>{tm.author}</b><span>{tm.detail}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="wrap">
        <div className="cta-band">
          <div className="cta-art"><ClassArt seed="rock-cta-band" /></div>
          <div className="cta-copy">
            <h2>Your first class is on us.</h2>
            <p>Come see the room, meet a coach, and throw your first combination. No pressure, no contract.</p>
            <div className="hero-cta">
              <button className="btn btn-accent btn-lg" onClick={() => goContact()}>Ask a question <Icon name="arrow" size={17} /></button>
              <button className="btn btn-ghost-light btn-lg" onClick={() => go("classes")}>See the schedule</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ClassCard({ info, onInquire }: { info: ClassInfo; onInquire: () => void }) {
  return (
    <article className="class-card">
      <div className="cover"><ClassArt seed={info.id} /><span className="level-chip">{info.level}</span></div>
      <div className="cc-body">
        <h3>{info.name}</h3>
        <div className="cc-meta"><span><Icon name="clock" size={13} /> {info.schedule}</span><span className="dot" /><span>Coach {info.coach}</span><span className="dot" /><span>{info.duration}</span></div>
        <p>{info.desc}</p>
        <button className="btn btn-outline btn-block" onClick={onInquire}>Inquire <Icon name="arrow" size={15} /></button>
      </div>
    </article>
  );
}

function Classes({ goContact }: { goContact: (id?: string) => void }) {
  return (
    <section className="wrap block">
      <div className="page-head"><span className="eyebrow accent">Classes</span><h1>Every class is coached, structured, and scaled for where you are today.</h1></div>
      <div className="class-grid">
        {classes.map((c) => (<ClassCard key={c.id} info={c} onInquire={() => goContact(c.id)} />))}
      </div>
    </section>
  );
}

function Contact({ role, form, setForm, submit, onSignIn }: { role: Role; form: typeof blank; setForm: (f: typeof blank) => void; submit: (e: FormEvent) => void; onSignIn: () => void }) {
  return (
    <section className="wrap block contact-wrap">
      <div className="contact-info">
        <span className="eyebrow accent">Get in touch</span>
        <h1>Have a question?<br />We'd love to hear from you.</h1>
        <p className="lede">Tell us what you're curious about and we'll get back to you — usually within a day.</p>
        <ul className="info-list">
          <li><span className="ic"><Icon name="clock" size={16} /></span><div><b>Hours</b><small>Mon–Fri 6 AM–9 PM · Sat 9 AM–2 PM</small></div></li>
          <li><span className="ic"><Icon name="pin" size={16} /></span><div><b>Where</b><small>214 Mill Street, Riverside</small></div></li>
          <li><span className="ic"><Icon name="mail" size={16} /></span><div><b>Response</b><small>A real person replies, usually same day</small></div></li>
        </ul>
      </div>
      <div className="contact-form-card">
        {role === "visitor" ? (
          <div className="gate">
            <span className="gate-ic"><Icon name="mail" size={22} /></span>
            <h3>Sign in to send a question</h3>
            <p>Inquiries come from a signed-in account so we know who to reply to. This mock uses the role selector above instead of real sign-in.</p>
            <button className="btn btn-accent" onClick={onSignIn}>Mock sign in</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h3 className="form-title">Send an inquiry</h3>
            <label className="field-l">About
              <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">General question</option>
                {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>
            <label className="field-l">Email
              <input type="email" value={form.email} placeholder="you@example.com" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field-l">Phone <span className="opt">optional</span>
              <input value={form.phone} placeholder="555-0100" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="field-l">Your question
              <textarea value={form.question} placeholder="What would you like to know?" onChange={(e) => setForm({ ...form, question: e.target.value })} />
            </label>
            <button className="btn btn-accent btn-block btn-lg" type="submit">Send inquiry <Icon name="arrow" size={16} /></button>
            <p className="privacy"><Icon name="check" size={13} /> Goes straight to the owner — never shared with other members.</p>
          </form>
        )}
      </div>
    </section>
  );
}

function Inbox({ rows, hasMore, onMore, total }: { rows: import("./model").Inquiry[]; hasMore: boolean; onMore: () => void; total: number }) {
  return (
    <section className="wrap block">
      <div className="page-head"><span className="eyebrow accent">Owner only</span><h1>Inbox</h1><p className="lede">A read-only list of the inquiries members have sent. No statuses or replies are invented here — it mirrors the documented fields.</p></div>
      <div className="inbox-count">{total} {total === 1 ? "inquiry" : "inquiries"}</div>
      <div className="inbox-list">
        {rows.map((q) => (
          <article className="inquiry" key={q.id}>
            <Avatar name={q.handle} size={40} />
            <div className="iq-body">
              <div className="iq-head"><b>@{q.handle}</b><a href={`mailto:${q.email}`}>{q.email}</a>{q.phone && <span className="iq-phone"><Icon name="phone" size={12} /> {q.phone}</span>}{q.classId && <span className="chip">{classes.find((c) => c.id === q.classId)?.name}</span>}</div>
              <p>{q.question}</p>
            </div>
          </article>
        ))}
      </div>
      {hasMore && <div className="load-more"><button className="btn btn-ghost" onClick={onMore}>Load more</button></div>}
    </section>
  );
}
