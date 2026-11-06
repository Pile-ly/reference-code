// The page: polls the local server every 2 seconds, works out where the
// app stands (progress.js) and draws it. Read-only: nothing here starts,
// approves or skips anything. Every string shown comes from the word list
// of the page's language; the only text taken from the log is the app's
// name and the addresses to open.

import { FALLBACK_LANGUAGE, LANGUAGE_CODES, LANGUAGE_NAMES, chooseLanguage, fill, isRightToLeft, lookup } from './i18n.js';
import { icon } from './icons.js';
import { AFTER_ROWS, ROWS, appRoom, deriveProgress, isLocalAddress } from './progress.js';

const POLL_MS = 2000;
/** How long an answer about a local address is trusted before it is asked again. */
const CHECK_MS = 5000;
const CHECK_TIMEOUT_MS = 3000;

const store = {
  get(key) {
    try {
      return localStorage.getItem(`pilely-dashboard.${key}`);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`pilely-dashboard.${key}`, value);
    } catch {
      // Storage blocked: the choice lasts until the page is closed.
    }
  },
};

const $ = (id) => document.getElementById(id);

const view = {
  lang: FALLBACK_LANGUAGE,
  words: {},
  english: {},
  theme: ['light', 'dark'].includes(store.get('theme')) ? store.get('theme') : 'system',
  aboutOpen: store.get('aboutSeen') !== '1',
  listOpen: true,
  connected: true,
  /** address -> { up, at } for local addresses */
  reach: new Map(),
  lastDrawn: '',
};

const log = {
  roomId: undefined,
  room: undefined,
  agents: {},
  messages: [],
  after: 0,
};

const t = (path) => lookup(view.words, view.english, path);

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ---- words ----

async function loadWords(code) {
  const response = await fetch(`locales/${code}.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`no word list for ${code}`);
  return response.json();
}

async function setLanguage(code) {
  let words;
  try {
    words = await loadWords(code);
  } catch {
    code = FALLBACK_LANGUAGE;
    words = view.english;
  }
  view.lang = code;
  view.words = words;
  document.documentElement.lang = code;
  document.documentElement.dir = isRightToLeft(code) ? 'rtl' : 'ltr';
  view.lastDrawn = '';
  drawFrame();
  draw();
}

// ---- theme ----

function applyTheme() {
  if (view.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', view.theme);
  for (const button of $('theme').children) button.setAttribute('aria-pressed', String(button.dataset.theme === view.theme));
}

// ---- the parts that change only with the language ----

function drawFrame() {
  const help = $('help');
  help.replaceChildren(icon('help'));
  help.setAttribute('aria-label', t('help'));
  help.title = t('help');
  help.setAttribute('aria-expanded', String(view.aboutOpen));

  const picker = $('language');
  picker.setAttribute('aria-label', t('language'));
  picker.value = view.lang;

  const theme = $('theme');
  theme.setAttribute('aria-label', t('theme.label'));
  for (const button of theme.children) {
    const label = t(`theme.${button.dataset.theme}`);
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  $('about-title').replaceChildren(icon('info'), el('span', {}, t('about.title')));
  $('got-it').textContent = t('about.gotIt');
  $('about-body').textContent = t('about.body');
  $('about-points').replaceChildren(...['p1', 'p2', 'p3', 'p4'].map((key) => el('li', {}, t(`about.${key}`))));
  $('about').hidden = !view.aboutOpen;

  $('footer').replaceChildren(icon('chat'), el('span', {}, t('footer')));
}

function buildControls() {
  const picker = $('language');
  picker.replaceChildren(...LANGUAGE_CODES.map((code) => el('option', { value: code, lang: code }, LANGUAGE_NAMES[code])));
  picker.addEventListener('change', () => {
    store.set('lang', picker.value);
    setLanguage(picker.value);
  });

  const theme = $('theme');
  theme.replaceChildren(
    ...[
      ['system', 'desktop'],
      ['light', 'sun'],
      ['dark', 'moon'],
    ].map(([name, glyph]) => {
      const button = el('button', { type: 'button', 'data-theme': name }, icon(glyph));
      button.addEventListener('click', () => {
        view.theme = name;
        store.set('theme', name);
        applyTheme();
      });
      return button;
    }),
  );

  $('help').addEventListener('click', () => {
    view.aboutOpen = !view.aboutOpen;
    drawFrame();
    if (view.aboutOpen) $('got-it').focus();
  });
  $('got-it').addEventListener('click', () => {
    view.aboutOpen = false;
    store.set('aboutSeen', '1');
    drawFrame();
    $('help').focus();
  });
  $('steps-toggle').addEventListener('click', () => {
    view.listOpen = !view.listOpen;
    view.lastDrawn = '';
    draw();
  });

  // Every link opens in a new tab, so the user never loses this page. The links carry
  // target="_blank", but some embedded browsers ignore it and load the link here instead,
  // so a plain click opens the tab itself. Modified clicks (cmd, ctrl, shift, middle) keep
  // the browser's own behaviour; if the new tab is blocked, the link's target still applies.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const opened = window.open(link.href, '_blank');
    if (!opened) return;
    opened.opener = null;
    event.preventDefault();
  });
}

// ---- local addresses that may have stopped ----

/** False when a local address was checked and nothing answered; true otherwise. */
function isUp(address) {
  if (!isLocalAddress(address)) return true;
  return view.reach.get(address)?.up !== false;
}

async function checkAddress(address) {
  const known = view.reach.get(address);
  if (known && (known.pending || Date.now() - known.at < CHECK_MS)) return;
  view.reach.set(address, { up: known?.up, at: known?.at ?? 0, pending: true });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS);
  let up;
  try {
    // An opaque answer is still an answer: something is serving there.
    await fetch(address, { mode: 'no-cors', cache: 'no-store', signal: abort.signal });
    up = true;
  } catch {
    up = false;
  } finally {
    clearTimeout(timer);
  }
  view.reach.set(address, { up, at: Date.now(), pending: false });
  if (known?.up !== up) draw();
}

function checkAddresses(progress) {
  for (const key of ROWS) {
    const address = progress.rows[key].address;
    if (address && isLocalAddress(address)) checkAddress(address);
  }
}

// ---- drawing ----

const MODE_ICON = { work: 'spinner', you: 'eye', talk: 'chat', warn: 'warning', fin: 'star' };
const ROW_ICON = { done: 'check', now: 'spinner', redo: 'refresh', skip: 'minus', todo: 'circle' };

/** What a row's address reads as: host and path, without the scheme. */
function shortAddress(address) {
  try {
    const url = new URL(address);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return address;
  }
}

function drawCard(progress) {
  const card = $('card');
  card.className = `panel card mode-${progress.mode}`;

  const turn = el(
    'div',
    { class: 'whose-turn' },
    icon(MODE_ICON[progress.mode], progress.mode === 'work' ? 'spin' : undefined),
    el('span', {}, t(`label.${progress.mode}`) + (progress.mode !== 'fin' ? ` · ${fill(t('step'), { n: progress.step, t: progress.total })}` : '')),
  );

  let caption = fill(t('there'), { p: progress.percent });
  if (progress.next) caption += ` · ${fill(t('nextUp'), { s: t(`next.${progress.next}`) })}`;

  const notes = [];
  const buttons = progress.buttons.map((button) => {
    const up = isUp(button.address);
    if (!up && (button.row === 'design' || button.row === 'demo')) notes.push(t(`down.${button.row}`));
    const label = t(`button.${button.label}`);
    if (!up) {
      return el('a', { class: `button${button.primary ? ' primary' : ''}`, role: 'link', 'aria-disabled': 'true' }, el('span', {}, label));
    }
    return el(
      'a',
      {
        class: `button${button.primary ? ' primary' : ''}`,
        href: button.address,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: t('newTab'),
      },
      el('span', {}, label),
      icon('external'),
    );
  });

  // replaceChildren turns an undefined argument into the text "undefined", so empty parts are dropped first.
  const parts = [
    turn,
    el('div', { class: 'card-title' }, t(`moment.${progress.moment}.title`)),
    el('div', { class: 'card-body' }, t(`moment.${progress.moment}.body`)),
    el(
      'div',
      {
        class: 'bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(progress.percent),
        'aria-label': fill(t('there'), { p: progress.percent }),
      },
      el('div', { class: 'bar-fill', style: `width:${progress.percent}%` }),
    ),
    el('div', { class: 'muted caption' }, caption),
    buttons.length ? el('div', { class: 'buttons' }, buttons) : undefined,
    ...notes.map((note) => el('div', { class: 'muted down-note' }, note)),
    // Once the app is live, say that changes go through Pam and are not tracked here; only when every
    // setup step is settled does the note say the page can be closed.
    progress.rows.live.status === 'done'
      ? el(
          'div',
          { class: 'after-live' },
          icon('info'),
          el(
            'div',
            {},
            el('div', { class: 'after-live-title' }, t(progress.moment === 'done' ? 'afterLive.setTitle' : 'afterLive.title')),
            el('div', {}, t(progress.moment === 'done' ? 'afterLive.setBody' : 'afterLive.body')),
          ),
        )
      : undefined,
  ];
  card.replaceChildren(...parts.filter(Boolean));
}

function drawRow(progress, key) {
  const row = progress.rows[key];
  const status = row.status;
  const parts = [el('span', { class: 'row-name' }, t(`row.${key}`))];
  if (row.address && ['done', 'redo', 'now'].includes(status)) {
    if (isUp(row.address)) {
      parts.push(
        ' ',
        el('bdi', { dir: 'ltr' }, el('a', { class: 'address', href: row.address, target: '_blank', rel: 'noopener noreferrer', title: t('newTab') }, shortAddress(row.address))),
      );
    } else {
      parts.push(' ', el('span', { class: 'address down' }, `· ${t('notRunning')}`));
    }
  }
  if (key === 'pay' && status === 'todo') parts.push(' ', el('span', { class: 'muted' }, t('payHint')));

  let pill;
  if (status === 'todo') pill = key === progress.nextRow ? el('span', { class: 'pill pill-next' }, t('pill.next')) : el('span');
  else pill = el('span', { class: `pill pill-${status}` }, t(`pill.${status}`));

  return el(
    'div',
    { class: `row row-${status}` },
    el('span', { class: 'row-icon' }, icon(ROW_ICON[status], status === 'now' ? 'spin' : undefined)),
    el('span', { class: 'row-text' }, parts),
    pill,
  );
}

function drawSteps(progress) {
  const toggle = $('steps-toggle');
  toggle.setAttribute('aria-expanded', String(view.listOpen));
  toggle.replaceChildren(el('span', {}, t('steps.all')), icon(view.listOpen ? 'chevronUp' : 'chevronDown'));

  const list = $('steps-list');
  list.hidden = !view.listOpen;
  if (!view.listOpen) return list.replaceChildren();
  const rows = [];
  for (const key of ROWS) {
    if (key === AFTER_ROWS[0]) rows.push(el('div', { class: 'muted section' }, t('steps.after')));
    rows.push(drawRow(progress, key));
  }
  list.replaceChildren(...rows);
}

function draw() {
  const progress = deriveProgress({ room: log.room, agents: log.agents, messages: log.messages });
  checkAddresses(progress);

  // Redraw only when something visible changed, so focus and hover survive a poll.
  const reach = [...view.reach].map(([address, known]) => [address, known.up]);
  const key = JSON.stringify([progress, view.connected, view.lang, view.listOpen, reach]);
  if (key === view.lastDrawn) return;
  view.lastDrawn = key;

  const name = progress.appName ?? t('appName');
  $('app-name').textContent = name;
  document.title = progress.appName ? `${progress.appName} · ${t('pageTitle')}` : t('pageTitle');
  $('status').classList.toggle('offline', !view.connected);
  $('status-dot').replaceChildren(icon('dot'));
  $('status-text').textContent = view.connected ? t('live') : t('offline');

  drawCard(progress);
  drawSteps(progress);
}

// ---- polling ----

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function poll() {
  try {
    const [rooms, agents] = await Promise.all([getJson('/api/rooms'), getJson('/api/agents')]);
    const room = appRoom(rooms);
    const roomId = room?.room_nanoid;
    if (roomId !== log.roomId) {
      log.roomId = roomId;
      log.messages = [];
      log.after = 0;
    }
    if (roomId) {
      const fresh = await getJson(`/api/messages?room=${encodeURIComponent(roomId)}&after=${log.after}`);
      for (const message of Array.isArray(fresh) ? fresh : []) {
        const sequence = Number(message?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence <= log.after) continue;
        log.messages.push(message);
        log.after = sequence;
      }
    }
    log.room = room;
    log.agents = agents && typeof agents === 'object' ? agents : {};
    view.connected = true;
  } catch {
    // Keep what is shown; the next poll tries again.
    view.connected = false;
  }
  try {
    draw();
  } catch {
    // A state that cannot be drawn leaves the last drawing; polling goes on.
  } finally {
    setTimeout(poll, POLL_MS);
  }
}

async function start() {
  buildControls();
  applyTheme();
  try {
    view.english = await loadWords(FALLBACK_LANGUAGE);
  } catch {
    view.english = {};
  }
  const started = document.querySelector('meta[name="pilely-dashboard-lang"]')?.getAttribute('content') ?? '';
  const lang = chooseLanguage({
    saved: store.get('lang'),
    started: started.trim().toLowerCase(),
    browser: navigator.languages?.length ? navigator.languages : [navigator.language],
  });
  await setLanguage(lang);
  poll();
}

start();
