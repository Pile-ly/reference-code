/* SHELL — do not edit. Pages live in src/pages/, tokens in src/theme/. */

/* =====================================================================
   Canvas behaviour. Authors do not need to touch anything below.
   - discovers every folder in src/pages/ and orders it by numeric prefix
   - renders the header, the palette legend and each card's chrome
   - wraps every mock in a browser window / phone frame
   - the MOBILE / WEB toggle, remembered in localStorage, keys m and w
   - the LIGHT / DARK toggle, remembered in localStorage, keys l and d
   - fits every frame to its card (ResizeObserver)
   - opens one page full screen: click a card, Esc to close, arrows to move
   ===================================================================== */

import appMeta from "../app.json";

interface PageMeta {
  title?: string;
  note?: string;
}

/* ---- page discovery: a folder in src/pages/ is a card, no registration ---- */
const webHtml = import.meta.glob("../pages/*/web.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const mobileHtml = import.meta.glob("../pages/*/mobile.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const pageJson = import.meta.glob("../pages/*/page.json", {
  import: "default",
  eager: true,
}) as Record<string, PageMeta>;

interface DiscoveredPage {
  folder: string;
  order: number;
  meta: PageMeta;
  web: string | null;
  mobile: string | null;
}

function folderOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] || path;
}

function orderOf(folder: string): number {
  const match = /^(\d+)/.exec(folder);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function discoverPages(): DiscoveredPage[] {
  const folders = new Map<string, DiscoveredPage>();
  function slot(path: string): DiscoveredPage {
    const folder = folderOf(path);
    let entry = folders.get(folder);
    if (!entry) {
      entry = { folder: folder, order: orderOf(folder), meta: {}, web: null, mobile: null };
      folders.set(folder, entry);
    }
    return entry;
  }
  Object.keys(pageJson).forEach(function (path) {
    slot(path).meta = pageJson[path] || {};
  });
  Object.keys(webHtml).forEach(function (path) {
    slot(path).web = webHtml[path];
  });
  Object.keys(mobileHtml).forEach(function (path) {
    slot(path).mobile = mobileHtml[path];
  });
  return Array.from(folders.values()).sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0;
  });
}

const DEVICE_KEY = "design-canvas-device";
const THEME_KEY = "design-canvas-theme";
const TOKENS = ["bg", "surface", "text", "muted", "primary", "accent", "border"];

/* localStorage is unavailable in some contexts (private mode, file sandboxes) */
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* ignore */
  }
}
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/* ---- header: app name and tagline (from src/app.json) ---- */
function renderHeader(): void {
  const name = appMeta.name || "App";
  document.title = name;
  el("app-name").textContent = name;
  el("app-tagline").textContent = appMeta.tagline || "";
}

/* ---- palette legend: rebuilt from the tokens of the ACTIVE theme ---- */
function renderPalette(): void {
  const styles = getComputedStyle(document.documentElement);
  const legend = el("palette");
  legend.textContent = "";
  TOKENS.forEach(function (token) {
    const value = styles.getPropertyValue("--" + token).trim();
    const wrap = document.createElement("span");
    wrap.className = "swatch";
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = value;
    const meta = document.createElement("span");
    meta.className = "meta";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = token;
    const hex = document.createElement("span");
    hex.className = "hex";
    hex.textContent = value;
    meta.appendChild(name);
    meta.appendChild(hex);
    wrap.appendChild(chip);
    wrap.appendChild(meta);
    wrap.title = token + ": " + value;
    legend.appendChild(wrap);
  });
}

function slug(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---- a mock element, or a visible placeholder when the file is absent ---- */
function makeMock(kind: "web" | "mobile", html: string | null, folder: string): HTMLElement {
  const mock = document.createElement("div");
  mock.className = "mock " + kind;
  if (html === null) {
    console.warn(
      'Page "' + folder + '" is missing ' + kind + ".html — src/pages/" + folder + "/" + kind + ".html"
    );
    mock.innerHTML =
      '<div class="missing"><span class="file"></span><span class="hint"></span></div>';
    const file = mock.querySelector(".file") as HTMLElement;
    const hint = mock.querySelector(".hint") as HTMLElement;
    file.textContent = "missing " + kind + ".html";
    hint.textContent = "src/pages/" + folder + "/" + kind + ".html";
  } else {
    mock.innerHTML = html;
  }
  return mock;
}

/* ---- one page card: heading + framed web mock + framed phone mock ---- */
function buildCard(entry: DiscoveredPage, index: number): HTMLElement {
  const title = entry.meta.title || "Untitled page";
  const note = entry.meta.note || "";

  const page = document.createElement("section");
  page.className = "page";
  page.setAttribute("data-title", title);
  page.setAttribute("data-note", note);
  page.setAttribute("data-page", entry.folder);

  const head = document.createElement("div");
  head.className = "card-head";
  const idx = document.createElement("span");
  idx.className = "index";
  idx.textContent = String(index + 1).padStart(2, "0");
  const titles = document.createElement("div");
  titles.className = "titles";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.textContent = note;
  titles.appendChild(h2);
  titles.appendChild(p);
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "expand";
  expand.setAttribute("aria-label", "Open " + title + " full screen");
  expand.title = "Full screen";
  head.appendChild(idx);
  head.appendChild(titles);
  head.appendChild(expand);

  const webMock = makeMock("web", entry.web, entry.folder);
  const mobileMock = makeMock("mobile", entry.mobile, entry.folder);

  const webFrame = document.createElement("div");
  webFrame.className = "frame frame-web";
  const webStage = document.createElement("div");
  webStage.className = "stage";
  const bar = document.createElement("div");
  bar.className = "browser-bar";
  bar.innerHTML =
    '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
    '<span class="address"></span>';
  (bar.querySelector(".address") as HTMLElement).textContent =
    slug(document.title) + ".app/" + slug(title);
  const webScreen = document.createElement("div");
  webScreen.className = "screen";
  webScreen.appendChild(webMock);
  webStage.appendChild(bar);
  webStage.appendChild(webScreen);
  webFrame.appendChild(webStage);

  const phoneFrame = document.createElement("div");
  phoneFrame.className = "frame frame-mobile";
  const phoneStage = document.createElement("div");
  phoneStage.className = "stage";
  const status = document.createElement("div");
  status.className = "status-bar";
  status.innerHTML = '<span>9:41</span><span class="notch"></span><span>100%</span>';
  const phoneScreen = document.createElement("div");
  phoneScreen.className = "screen";
  phoneScreen.appendChild(mobileMock);
  phoneStage.appendChild(status);
  phoneStage.appendChild(phoneScreen);
  phoneFrame.appendChild(phoneStage);

  page.appendChild(head);
  page.appendChild(webFrame);
  page.appendChild(phoneFrame);
  return page;
}

/* ---- device toggle (MOBILE / WEB) ---- */
const mobileBtn = el<HTMLButtonElement>("btn-mobile");
const webBtn = el<HTMLButtonElement>("btn-web");

function setDevice(device: string, remember: boolean): void {
  const value = device === "mobile" ? "mobile" : "web";
  document.body.setAttribute("data-device", value);
  mobileBtn.setAttribute("aria-pressed", String(value === "mobile"));
  webBtn.setAttribute("aria-pressed", String(value === "web"));
  if (remember) store(DEVICE_KEY, value);
}

/* ---- theme toggle (LIGHT / DARK) ---- */
const lightBtn = el<HTMLButtonElement>("btn-light");
const darkBtn = el<HTMLButtonElement>("btn-dark");

function setTheme(theme: string, remember: boolean): void {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", value);
  lightBtn.setAttribute("aria-pressed", String(value === "light"));
  darkBtn.setAttribute("aria-pressed", String(value === "dark"));
  if (remember) store(THEME_KEY, value);
  renderPalette();
}

/* stored choice wins; otherwise fall back to the system preference once */
function initialTheme(): string {
  const saved = stored(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  return mq && mq.matches ? "dark" : "light";
}

/* ---------------------------------------------------------------------
   Fit every frame to its card. A web mock is 1280px wide and a mobile
   one 390px; each card gets the scale that makes the active frame fill
   the card's inner width (phones are capped so they stay phone-sized).
   Runs on load, on resize, and whenever the device toggles.
   --------------------------------------------------------------------- */
const WEB_W = 1280;
const MOBILE_W = 390;
const MOBILE_MAX_PX = 330;

const FRAME_H = 844;

function fit(page: Element): void {
  const node = page as HTMLElement;
  const cs = getComputedStyle(node);
  const inner = node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (!(inner > 0)) return;
  if (node.classList.contains("focused")) {
    /* full screen: the frame fills what is left of the window under the heading */
    const head = node.querySelector(".card-head") as HTMLElement | null;
    const headH = head ? head.offsetHeight + parseFloat(getComputedStyle(head).marginBottom) : 0;
    const room =
      node.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - headH;
    const tall = room > 0 ? room / FRAME_H : 1;
    node.style.setProperty("--scale-web", Math.min(inner / WEB_W, tall).toFixed(4));
    node.style.setProperty("--scale-mobile", Math.min(inner / MOBILE_W, tall).toFixed(4));
    return;
  }
  node.style.setProperty("--scale-web", (inner / WEB_W).toFixed(4));
  node.style.setProperty(
    "--scale-mobile",
    (Math.min(inner, MOBILE_MAX_PX) / MOBILE_W).toFixed(4)
  );
}

/* ---------------------------------------------------------------------
   Full screen. One page at a time takes the whole window; the toggles
   stay on top, so device and theme can still be switched while looking
   at it. Click a card to open, the same button or Esc to close, the
   left and right arrow keys to move to the neighbouring page.
   --------------------------------------------------------------------- */
function focusedPage(): HTMLElement | null {
  return document.querySelector(".page.focused");
}

function setFocused(page: HTMLElement | null): void {
  const current = focusedPage();
  if (current === page) return;
  if (current) {
    current.classList.remove("focused");
    const was = current.querySelector(".expand") as HTMLElement | null;
    if (was) was.title = "Full screen";
  }
  if (page) {
    page.classList.add("focused");
    const now = page.querySelector(".expand") as HTMLElement | null;
    if (now) now.title = "Close (Esc)";
  }
  document.body.classList.toggle("has-focus", !!page);
  fitAll();
  if (!page && current) current.scrollIntoView({ block: "nearest" });
}

function stepFocus(delta: number): void {
  const current = focusedPage();
  if (!current) return;
  const all = Array.from(document.querySelectorAll(".page")) as HTMLElement[];
  const next = all[all.indexOf(current) + delta];
  if (next) setFocused(next);
}

function fitAll(): void {
  document.querySelectorAll(".page").forEach(fit);
}

function fitFrames(): void {
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(function (entries) {
      entries.forEach(function (e) {
        fit(e.target);
      });
    });
    document.querySelectorAll(".page").forEach(function (p) {
      ro.observe(p);
    });
  } else {
    window.addEventListener("resize", fitAll);
  }
  window.addEventListener("resize", fitAll);
  new MutationObserver(fitAll).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-device"],
  });
  fitAll();
}

/* ---- boot ---- */
export function boot(): void {
  renderHeader();

  const canvas = el("canvas");
  const pages = discoverPages();
  if (!pages.length) {
    console.warn("No pages found in src/pages/ — add a folder with page.json, web.html and mobile.html.");
    const empty = document.createElement("div");
    empty.className = "no-pages";
    empty.innerHTML =
      "<strong>No pages yet.</strong><span>Copy <code>src/page_template/</code> to " +
      "<code>src/pages/01-&lt;slug&gt;/</code> and it appears here.</span>";
    canvas.appendChild(empty);
  }
  pages.forEach(function (entry, index) {
    canvas.appendChild(buildCard(entry, index));
  });

  /* a click anywhere on a card opens it; the button in its heading closes it */
  canvas.addEventListener("click", function (event) {
    const target = event.target as HTMLElement | null;
    const page = target ? (target.closest(".page") as HTMLElement | null) : null;
    if (!page) return;
    if (page.classList.contains("focused")) {
      if (target && target.closest(".expand")) setFocused(null);
      return;
    }
    setFocused(page);
  });

  setDevice(stored(DEVICE_KEY) === "mobile" ? "mobile" : "web", false);
  setTheme(initialTheme(), false);

  mobileBtn.addEventListener("click", function () {
    setDevice("mobile", true);
  });
  webBtn.addEventListener("click", function () {
    setDevice("web", true);
  });
  lightBtn.addEventListener("click", function () {
    setTheme("light", true);
  });
  darkBtn.addEventListener("click", function () {
    setTheme("dark", true);
  });

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = ((target && target.tagName) || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || (target && target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (key === "m") setDevice("mobile", true);
    if (key === "w") setDevice("web", true);
    if (key === "l") setTheme("light", true);
    if (key === "d") setTheme("dark", true);
    if (key === "escape") setFocused(null);
    if (key === "arrowright") stepFocus(1);
    if (key === "arrowleft") stepFocus(-1);
  });

  fitFrames();
}
