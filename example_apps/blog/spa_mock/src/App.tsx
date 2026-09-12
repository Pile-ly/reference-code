import { JSX, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { addComment, BlogState, deletePost, freshState, likePost, Post, publish, Role, saveDraft, setRole, updatePost } from "./model";

const BLOG_TITLE = "Field Notes";
const BLOG_TAGLINE = "Considered notes on making, reading, and paying attention.";
const OWNER = "Mira";

type View = "feed" | "post";
type Fields = { title: string; subtitle: string; body: string };
type Composer = { mode: "new" | "draft" | "edit"; draftId?: string; postId?: string; fields: Fields } | null;
type ToastItem = { id: number; kind: "success" | "error" | "info"; text: string };

const emptyFields: Fields = { title: "", subtitle: "", body: "" };

// ── Generative covers: a text blog with no image assets still gets a unique,
//    artsy banner per post. The category sets the hue family; the post id seeds
//    an abstract composition (see CoverArt), so every cover is stable and yet
//    no two look alike.
const CATEGORY_HUE: Record<string, number> = {
  Meta: 16, Craft: 36, Garden: 96, Reading: 198, Notes: 216, Kitchen: 26, Essays: 300, Tools: 186, City: 256,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hashInt = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const hueFor = (post: Post) => (post.category && CATEGORY_HUE[post.category] != null ? CATEGORY_HUE[post.category] : hashInt(post.id) % 360);
// Small seeded PRNG so each post's generative cover is stable across renders.
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const readMins = (body: string) => Math.max(1, Math.round(body.trim().split(/\s+/).length / 180));
const formatDate = (date?: string) => { if (!date) return "Just now"; const [y, m, d] = date.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const authorMeta = (name: string) => {
  const n = (name || "").toLowerCase();
  if (n === "mira") return { cls: "owner", initials: "M" };
  if (n === "sam") return { cls: "member", initials: "S" };
  if (n === "lena") return { cls: "reader", initials: "L" };
  return { cls: "reader", initials: (n[0] || "?").toUpperCase() };
};

const ICONS: Record<string, JSX.Element> = {
  back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
  heart: <path d="M20.8 5.1a5 5 0 0 0-7.1 0L12 6.8l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.8a5 5 0 0 0 0-7.1z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />,
};

function Icon({ name, size = 18, fill = false }: { name: keyof typeof ICONS; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function Avatar({ name, size = 34, ghost = false }: { name?: string; size?: number; ghost?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (ghost) return <span className="avatar ghost" style={style}>?</span>;
  const m = authorMeta(name || "");
  return <span className={`avatar ${m.cls}`} style={style}>{m.initials}</span>;
}

// An abstract, generative banner drawn entirely in SVG — layered "aurora" light
// blobs over a category-hued ground, a per-post motif, then film grain and a
// vignette for a printed-poster feel. `slice` lets the same art fill both the
// square-ish tile and the wide detail banner.
function CoverArt({ post }: { post: Post }) {
  const uid = "cv" + post.id.replace(/[^a-zA-Z0-9]/g, "");
  const hue = hueFor(post);
  const rng = mulberry32(hashInt(post.id) ^ 0x9e3779b9);
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
  let motifEls: JSX.Element[] = [];
  if (motif === "waves") {
    const shades = [H(hue, 60, 38), H(hue, 66, 50), H(hue, 74, 64)];
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
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bgA} /><stop offset="1" stopColor={bgB} />
        </linearGradient>
        {blobs.map((b) => (
          <radialGradient key={b.id} id={b.id}>
            <stop offset="0" stopColor={b.color} stopOpacity="0.95" /><stop offset="1" stopColor={b.color} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${uid}vg`} cx="50%" cy="38%" r="76%">
          <stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.34" />
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

function Cover({ post, className = "" }: { post: Post; className?: string }) {
  return (
    <div className={`cover ${className}`}>
      <CoverArt post={post} />
      {post.category && <span className="cat-chip">{post.category}</span>}
    </div>
  );
}

function MetaRow({ post, withAuthor = false }: { post: Post; withAuthor?: boolean }) {
  return (
    <div className="metarow">
      {withAuthor && (<><Avatar name={post.author} size={26} /><span className="author">{post.author}</span><span className="dot" /></>)}
      <span>{formatDate(post.date)}</span>
      <span className="dot" />
      <span>{readMins(post.body)} min read</span>
      <span className="meta-i"><Icon name="heart" size={13} /> {post.likes.length}</span>
      {post.comments.length > 0 && <span className="meta-i"><Icon name="chat" size={13} /> {post.comments.length}</span>}
    </div>
  );
}

const ROLES: { key: Role; label: string; name?: string; ghost?: boolean }[] = [
  { key: "public", label: "Visitor", ghost: true },
  { key: "member", label: "Sam", name: "sam" },
  { key: "owner", label: "Mira", name: "mira" },
];

export function App() {
  const [state, setState] = useState<BlogState>(freshState);
  const [view, setView] = useState<View>("feed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [comment, setComment] = useState("");
  const [composer, setComposer] = useState<Composer>(null);
  const [composerTab, setComposerTab] = useState<"write" | "preview">("write");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [theme, setTheme] = useState(() => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"));
  const toastSeq = useRef(0);

  const owner = state.role === "owner";
  const currentActor = owner ? "mira" : state.role === "member" ? "sam" : null;
  const post = selectedId ? state.posts.find((p) => p.id === selectedId) ?? null : null;

  const toast = (kind: ToastItem["kind"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list, { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2600);
  };
  const run = (fn: () => BlogState, ok?: string) => {
    try { setState(fn()); if (ok) toast("success", ok); }
    catch (error) { toast("error", error instanceof Error ? error.message : String(error)); }
  };

  const toTop = () => window.scrollTo({ top: 0, behavior: "auto" });
  const openPost = (id: string) => { setSelectedId(id); setView("post"); setComment(""); toTop(); };
  const openFeed = () => { setView("feed"); setComment(""); toTop(); };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("blog-mock-theme", next); } catch { /* private mode */ }
  };
  const changeRole = (role: Role) => {
    setState(setRole(state, role)); setComposer(null);
    toast("info", role === "owner" ? "Signed in as Mira (owner)." : role === "member" ? "Signed in as Sam (member)." : "Signed out — browsing as a visitor.");
  };
  const resetDemo = () => { setState(freshState()); setView("feed"); setFilter("All"); setSelectedId(null); setComposer(null); toast("info", "Demo reset to its fixtures."); };

  const like = (p: Post) => {
    if (!currentActor) return toast("info", "Sign in as a member to like this post.");
    if (p.likes.includes(currentActor)) return;
    run(() => likePost(state, p.id), "Liked.");
  };
  const submitComment = () => { if (!post) return; run(() => addComment(state, post.id, comment), "Comment added."); setComment(""); };
  const removePost = (id: string) => { run(() => deletePost(state, id), "Post deleted."); openFeed(); };

  const openComposer = (next: NonNullable<Composer>) => { setComposer(next); setComposerTab("write"); };
  const closeComposer = () => setComposer(null);
  const setFields = (patch: Partial<Fields>) => setComposer((c) => (c ? { ...c, fields: { ...c.fields, ...patch } } : c));
  const saveDraftAction = () => { if (!composer) return; run(() => saveDraft(state, composer.fields, composer.draftId), "Draft saved privately."); closeComposer(); };
  const publishAction = () => { if (!composer) return; run(() => publish(state, composer.fields, composer.draftId), "Post published."); closeComposer(); openFeed(); };
  const updateAction = () => { if (!composer?.postId) return; run(() => updatePost(state, composer.postId!, composer.fields), "Post updated."); closeComposer(); };

  const categories = ["All", ...Array.from(new Set(state.posts.map((p) => p.category).filter((c): c is string => !!c)))];
  const featured = filter === "All" ? state.posts[0] : null;
  const gridPosts = filter === "All" ? state.posts.slice(1) : state.posts.filter((p) => p.category === filter);

  const personaHint =
    state.role === "public" ? <>You're browsing as a <b>signed-out visitor</b>. Every post is public to read — sign in to like or comment.</>
      : state.role === "member" ? <>Signed in as <b>Sam</b>, a member. You can like posts and join the conversation.</>
        : <>You're <b>Mira</b>, the author. Write and publish posts, keep private drafts, and edit or remove anything.</>;

  return (
    <div className="shell">
      <header className="header">
        <div className="wrap">
          <div className="brand-row">
            <div className="brand" onClick={openFeed} role="button" tabIndex={0}>
              <div className="brand-mark">F</div>
              <span className="brand-name">{BLOG_TITLE}</span>
              <span className="chip">Mock</span>
            </div>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle light or dark theme" title="Toggle theme">
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <button className="icon-btn" onClick={resetDemo} title="Reset the demo" style={{ width: "auto", padding: "0 13px", fontSize: 12.5, fontWeight: 600 }}>Reset</button>
          </div>
          <div className="persona">
            <span className="persona-label">Viewing as</span>
            <div className="segmented" role="group" aria-label="Choose a viewing role">
              {ROLES.map((r) => (
                <button key={r.key} className="segment" aria-pressed={state.role === r.key} onClick={() => changeRole(r.key)}>
                  <Avatar name={r.name} ghost={r.ghost} size={24} />
                  <span className="plabel">{r.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="wrap" style={{ paddingTop: 16 }}>
        <p className="persona-hint" key={state.role}>{personaHint}</p>
      </div>

      <main className="view-anim" key={view === "post" && post ? `post-${post.id}` : "feed"}>
        {view === "post" && post ? (
          <div className="wrap-read">
            <button className="backlink" onClick={openFeed}><Icon name="back" size={16} /> All posts</button>
            <Cover post={post} className="detail-cover" />
            <div className="post-head">
              {post.category && <div className="eyebrow">{post.category}</div>}
              <h1 className="post-title">{post.title}</h1>
              {post.subtitle && <p className="post-subtitle">{post.subtitle}</p>}
              <div className="byline">
                <Avatar name={post.author} size={40} />
                <div className="who">
                  <b>{post.author}</b>
                  <small>{formatDate(post.date)} · {readMins(post.body)} min read</small>
                </div>
                {owner && (
                  <div className="owner-tools">
                    <button className="mini-btn" onClick={() => openComposer({ mode: "edit", postId: post.id, fields: { title: post.title, subtitle: post.subtitle, body: post.body } })}><Icon name="edit" size={13} /> Edit</button>
                    <button className="mini-btn danger" onClick={() => removePost(post.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>

            <div className="post-body"><Markdown remarkPlugins={[remarkGfm]}>{post.body}</Markdown></div>

            <div className="engage">
              {(() => {
                const liked = !!currentActor && post.likes.includes(currentActor);
                return (
                  <button className={`like-btn ${liked ? "liked" : ""}`} disabled={liked} onClick={() => like(post)}>
                    <span className="heart" key={liked ? "on" : "off"}><Icon name="heart" size={16} fill={liked} /></span>
                    {liked ? "Liked" : "Like"} · {post.likes.length}
                  </button>
                );
              })()}
              {!currentActor && <span className="muted-note">Sign in to like this post.</span>}
            </div>

            <h2 className="comments-head">{post.comments.length} {post.comments.length === 1 ? "comment" : "comments"}</h2>
            {post.comments.map((c) => (
              <div className="comment" key={c.id}>
                <Avatar name={c.author} size={34} />
                <div>
                  <div className="who"><b>{cap(c.author)}</b></div>
                  <p className="body">{c.body}</p>
                </div>
              </div>
            ))}

            {currentActor ? (
              <div className="composer-inline">
                <Avatar name={currentActor} size={34} />
                <div style={{ flex: 1 }}>
                  <textarea aria-label="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add to the conversation…" />
                  <div className="composer-actions">
                    <button className="btn btn-sm" disabled={!comment.trim()} onClick={submitComment}>Comment</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="signin-nudge">
                <Icon name="lock" size={18} />
                <span className="txt"><b>Sign in to join in.</b> Members can like and comment — switch to Sam or Mira above.</span>
              </div>
            )}
            <div style={{ height: 24 }} />
          </div>
        ) : (
          <div className="wrap">
            <section className="masthead">
              <h1>{BLOG_TITLE}</h1>
              <div className="rule" />
              <p className="tagline">{BLOG_TAGLINE} <b>Written by {OWNER}.</b></p>
            </section>

            {featured && (
              <button className="feature" onClick={() => openPost(featured.id)}>
                <Cover post={featured} />
                <div className="feature-text">
                  <div className="eyebrow">Latest</div>
                  <h2 className="feature-title">{featured.title}</h2>
                  <p className="feature-sub">{featured.subtitle}</p>
                  <MetaRow post={featured} withAuthor />
                </div>
              </button>
            )}

            <div className="catbar">
              {categories.map((c) => (
                <button key={c} className="cat-pill" aria-pressed={filter === c} onClick={() => setFilter(c)}>{c}</button>
              ))}
            </div>

            {gridPosts.length === 0 ? (
              <div className="empty">No posts in “{filter}” yet.</div>
            ) : (
              <div className="grid">
                {gridPosts.map((p) => (
                  <button key={p.id} className="tile" onClick={() => openPost(p.id)}>
                    <Cover post={p} />
                    <h3 className="tile-title">{p.title}</h3>
                    <p className="tile-sub">{p.subtitle}</p>
                    <MetaRow post={p} />
                  </button>
                ))}
              </div>
            )}

            {owner && (
              <section>
                <div className="section-head"><Icon name="lock" size={13} /> Drafts · only you can see these</div>
                {state.drafts.length === 0 ? (
                  <div className="empty">No drafts yet. Start one with “Write”.</div>
                ) : (
                  state.drafts.map((d) => (
                    <button key={d.id} className="draft-card" onClick={() => openComposer({ mode: "draft", draftId: d.id, fields: { title: d.title, subtitle: d.subtitle, body: d.body } })}>
                      <span className="lock"><Icon name="lock" size={16} /></span>
                      <span><b>{d.title || "Untitled draft"}</b><small>{d.subtitle || "Draft"}</small></span>
                      <span className="go"><Icon name="arrow" size={16} /></span>
                    </button>
                  ))
                )}
              </section>
            )}
            <div style={{ height: 24 }} />
          </div>
        )}
      </main>

      <footer className="footer">
        <div className="wrap">
          <b>Interactive mock — no backend.</b> Every change lives in this browser and resets on reload or with Reset.
        </div>
      </footer>

      {owner && !composer && (
        <button className="write-fab" onClick={() => openComposer({ mode: "new", fields: emptyFields })}>
          <Icon name="plus" size={18} /> Write
        </button>
      )}

      {composer && (
        <div className="scrim" onClick={closeComposer}>
          <div className="composer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="composer-top">
              <div>
                <h2>{composer.mode === "edit" ? "Edit post" : composer.mode === "draft" ? "Edit draft" : "Write a post"}</h2>
                <p className="kicker">{composer.mode === "edit" ? "Update the published post" : "Drafts stay private until you publish"}</p>
              </div>
              <button className="icon-btn" onClick={closeComposer} aria-label="Close composer"><Icon name="x" /></button>
            </div>
            <div className="composer-body">
              <div className="field">
                <label>Title</label>
                <input className="title-input" value={composer.fields.title} onChange={(e) => setFields({ title: e.target.value })} placeholder="A memorable title" />
              </div>
              <div className="field">
                <label>Subtitle</label>
                <input value={composer.fields.subtitle} onChange={(e) => setFields({ subtitle: e.target.value })} placeholder="One line that makes someone want to read" />
              </div>
              <div className="field">
                <label>Body</label>
                <div className="tabs">
                  <button aria-pressed={composerTab === "write"} onClick={() => setComposerTab("write")}>Write</button>
                  <button aria-pressed={composerTab === "preview"} onClick={() => setComposerTab("preview")}>Preview</button>
                </div>
                {composerTab === "write" ? (
                  <textarea value={composer.fields.body} onChange={(e) => setFields({ body: e.target.value })} placeholder="Write in Markdown… headings, **bold**, > quotes and - lists all work." />
                ) : (
                  <div className="preview-box post-body">
                    {composer.fields.body.trim() ? <Markdown remarkPlugins={[remarkGfm]}>{composer.fields.body}</Markdown> : <div className="placeholder">Nothing to preview yet.</div>}
                  </div>
                )}
              </div>
              <div className="composer-foot">
                {composer.mode === "edit" ? (
                  <>
                    <button className="btn btn-accent" disabled={!composer.fields.title.trim()} onClick={updateAction}>Save changes</button>
                    <button className="btn btn-ghost" onClick={closeComposer}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" onClick={saveDraftAction}>Save draft</button>
                    <span className="spacer" />
                    <button className="btn btn-accent" disabled={!composer.fields.title.trim()} onClick={publishAction}>Publish</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}><span className="tdot" />{t.text}</div>
        ))}
      </div>
    </div>
  );
}
