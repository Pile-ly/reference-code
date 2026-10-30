import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CODES as PAGE_LANGUAGES, chooseLanguage, fill, supportedLanguage } from '../../app_progress_dashboard/i18n.js';
import { appRoom, deriveProgress } from '../../app_progress_dashboard/progress.js';
import type { Progress, RowKey, RowStatus } from '../../app_progress_dashboard/progress.js';
import { LANGUAGE_CODES } from '../src/languages.ts';

const PAGE_DIR = fileURLToPath(new URL('../../app_progress_dashboard/', import.meta.url));
const LOCALES_DIR = join(PAGE_DIR, 'locales');

const PAM = 'pam-agent-id';
const OTHER = 'other-agent-id';
const AGENTS = { [PAM]: 'pam', [OTHER]: 'kevin' };
const ROOM = { room_nanoid: 'app1', title: 'Recipe box', created_by: 'a1', is_default: false, created_time_stamp: 5 };
const DESIGN = 'http://localhost:5173/';
const DEMO = 'http://localhost:5174/';
const LIVE = 'https://recipe-box.pilely.app/';

/** The progress after Pam wrote `lines`, in order, in the app's room. */
function after(...lines: string[]): Progress {
  return deriveProgress({
    room: ROOM,
    agents: AGENTS,
    messages: lines.map((text, index) => ({ sequence: index + 1, sender_agent_id: PAM, text })),
  });
}

function statuses(progress: Progress): Record<string, RowStatus> {
  return Object.fromEntries(Object.entries(progress.rows).map(([key, row]) => [key, row.status]));
}

const IDEA = 'Idea settled: a box of family recipes';
const DESIGN_DONE = `Stage done: Make the UX. Open: ${DESIGN}`;
const DEMO_DONE = `Stage done: Build the mock demo. Open: ${DEMO}`;
const LIVE_DONE = `Stage done: Build the real app. Open: ${LIVE}`;
const BUILT = [IDEA, DESIGN_DONE, DEMO_DONE, LIVE_DONE];

// ---- the app's room ----

test('the app room is the one that is not the default room, the newest when there are several', () => {
  assert.equal(appRoom([{ room_nanoid: 'main', is_default: true }]), undefined);
  assert.equal(appRoom('nonsense'), undefined);
  const rooms = [
    { room_nanoid: 'main', is_default: true, created_time_stamp: 9 },
    { room_nanoid: 'old', is_default: false, created_time_stamp: 1 },
    { room_nanoid: 'new', is_default: false, created_time_stamp: 2 },
  ];
  assert.equal(appRoom(rooms)?.room_nanoid, 'new');
});

test('with no app room the idea is current and the label is "Chatting with Pam"', () => {
  for (const progress of [
    deriveProgress({ room: undefined, agents: AGENTS, messages: [] }),
    deriveProgress({ room: undefined, agents: AGENTS, messages: [{ sequence: 1, sender_agent_id: PAM, text: DESIGN_DONE }] }),
  ]) {
    assert.equal(progress.mode, 'talk');
    assert.equal(progress.moment, 'idea');
    assert.equal(progress.rows.idea.status, 'now');
    assert.equal(progress.step, 1);
    assert.equal(progress.total, 8);
    assert.equal(progress.percent, 0);
    assert.equal(progress.next, 'design');
    assert.equal(progress.appName, undefined);
    assert.deepEqual(progress.buttons, []);
  }
});

test('the room title is the app name', () => {
  assert.equal(after().appName, 'Recipe box');
});

test('only lines sent by the pam agent count', () => {
  const progress = deriveProgress({
    room: ROOM,
    agents: AGENTS,
    messages: [
      { sequence: 1, sender_agent_id: OTHER, text: IDEA },
      { sequence: 2, sender_agent_id: 'unknown', text: DESIGN_DONE },
    ],
  });
  assert.equal(progress.rows.idea.status, 'now');
  assert.equal(progress.rows.design.status, 'todo');
});

test('messages are read in sequence order whatever order they arrive in', () => {
  const progress = deriveProgress({
    room: ROOM,
    agents: AGENTS,
    messages: [
      { sequence: 3, sender_agent_id: PAM, text: DESIGN_DONE },
      { sequence: 1, sender_agent_id: PAM, text: IDEA },
      { sequence: 2, sender_agent_id: PAM, text: 'Stage started: Make the UX' },
    ],
  });
  assert.equal(progress.rows.design.status, 'done');
});

// ---- the state table ----

test('Idea settled: the idea is done and the design is next', () => {
  const progress = after(IDEA);
  assert.equal(progress.rows.idea.status, 'done');
  assert.equal(progress.nextRow, 'design');
  assert.equal(progress.next, 'design');
  assert.equal(progress.mode, 'talk');
  assert.equal(progress.step, 2);
  assert.equal(progress.percent, 13);
});

test('Stage started: that stage is current and the label is "Working on it"', () => {
  for (const [stage, row, moment, next] of [
    ['Make the UX', 'design', 'dbuild', 'seeDesign'],
    ['Build the mock demo', 'demo', 'mbuild', 'seeDemo'],
    ['Build the real app', 'live', 'lbuild', 'seeLive'],
  ] as const) {
    const progress = after(IDEA, `Stage started: ${stage}`);
    assert.equal(progress.rows[row].status, 'now', stage);
    assert.equal(progress.mode, 'work');
    assert.equal(progress.moment, moment);
    assert.equal(progress.next, next);
    assert.equal(progress.nextRow, undefined);
  }
  assert.equal(after(IDEA, 'Stage started: Make the UX').step, 2);
});

test('Change asked: that stage is current until a later Stage done for it', () => {
  const asked = after(IDEA, DESIGN_DONE, 'Change asked: Make the UX. Bigger buttons');
  assert.equal(asked.rows.design.status, 'now');
  assert.equal(asked.mode, 'work');
  const redone = after(IDEA, DESIGN_DONE, 'Change asked: Make the UX. Bigger buttons', DESIGN_DONE);
  assert.equal(redone.rows.design.status, 'done');
  assert.equal(redone.mode, 'you');
  // A change to something that is not a stage is not read.
  assert.equal(after(...BUILT, 'Change asked: Make the link preview. A photo').mode, 'you');
});

test('Stage done: that stage is done, its address kept, and the label is "Your turn"', () => {
  const design = after(IDEA, 'Stage started: Make the UX', DESIGN_DONE);
  assert.equal(design.rows.design.status, 'done');
  assert.equal(design.rows.design.address, DESIGN);
  assert.equal(design.mode, 'you');
  assert.equal(design.moment, 'dready');
  assert.equal(design.next, 'demo');
  assert.equal(design.nextRow, 'demo');
  assert.deepEqual(design.buttons, [{ row: 'design', label: 'design', address: DESIGN, primary: true }]);

  const demo = after(IDEA, DESIGN_DONE, DEMO_DONE);
  assert.equal(demo.moment, 'mready');
  assert.equal(demo.rows.demo.address, DEMO);
  assert.deepEqual(
    demo.buttons.map((b) => [b.label, b.primary]),
    [
      ['demo', true],
      ['design', false],
    ],
  );

  // "Your turn" lasts until the next stage starts.
  const building = after(IDEA, DESIGN_DONE, 'Stage started: Build the mock demo');
  assert.equal(building.mode, 'work');
  assert.deepEqual(building.buttons, [{ row: 'design', label: 'design', address: DESIGN, primary: false }]);
});

test('a Stage done address is taken only when it is an http address', () => {
  assert.equal(after(IDEA, 'Stage done: Make the UX. Open: javascript:alert(1)').rows.design.address, undefined);
  assert.equal(after(IDEA, 'Stage done: Make the UX').rows.design.address, undefined);
  assert.equal(after(IDEA, 'Stage done: Make the UX. Open: http://localhost:5173/.').rows.design.address, DESIGN);
});

test('Stage failed: that stage reads as not started and its row shows Next', () => {
  const progress = after(IDEA, DESIGN_DONE, 'Stage started: Build the mock demo', 'Stage failed: Build the mock demo. The build broke');
  assert.equal(progress.rows.demo.status, 'todo');
  assert.equal(progress.nextRow, 'demo');
  assert.notEqual(progress.mode, 'work');
});

test('Skipped: that stage is not needed and counts as done for the bar', () => {
  const progress = after(IDEA, 'Skipped: Make the UX');
  assert.equal(progress.rows.design.status, 'skip');
  assert.equal(progress.percent, 25);
  assert.equal(progress.nextRow, 'demo');
  assert.equal(progress.next, 'demo');
  // A later Stage done supersedes it.
  assert.equal(after(IDEA, 'Skipped: Make the UX', DESIGN_DONE).rows.design.status, 'done');
});

test('Not yet: that stage reads as not started and its row shows Next', () => {
  const progress = after(IDEA, DESIGN_DONE, 'Not yet: Build the mock demo');
  assert.equal(progress.rows.demo.status, 'todo');
  assert.equal(progress.nextRow, 'demo');
  assert.equal(progress.mode, 'you');
});

test('Out of date: each named stage needs an update, amber, until a later Stage done; the old address stays openable', () => {
  const stale = after(IDEA, DESIGN_DONE, DEMO_DONE, 'Out of date: Make the UX, Build the mock demo. The idea changed');
  assert.equal(stale.rows.design.status, 'redo');
  assert.equal(stale.rows.demo.status, 'redo');
  assert.equal(stale.mode, 'warn');
  assert.equal(stale.moment, 'dredo');
  assert.equal(stale.next, 'redoDesign');
  assert.equal(stale.rows.demo.address, DEMO);
  // Out of date is not a step backwards: the bar does not shrink.
  assert.equal(stale.percent, after(IDEA, DESIGN_DONE, DEMO_DONE).percent);

  const demoOnly = after(IDEA, DESIGN_DONE, DEMO_DONE, 'Out of date: Build the mock demo. The screens changed');
  assert.equal(demoOnly.moment, 'mredo');
  assert.equal(demoOnly.step, 3);
  assert.deepEqual(
    demoOnly.buttons.map((b) => [b.label, b.primary, b.address]),
    [
      ['design', true, DESIGN],
      ['oldDemo', false, DEMO],
    ],
  );

  const rebuilt = after(IDEA, DESIGN_DONE, DEMO_DONE, 'Out of date: Build the mock demo. The screens changed', DEMO_DONE);
  assert.equal(rebuilt.rows.demo.status, 'done');
  assert.equal(rebuilt.mode, 'you');
});

test('After building: a step done is done, a step not wanted is not needed', () => {
  const progress = after(...BUILT, 'After building: Who can see what done. Only family can edit', 'After building: Name and link preview not wanted');
  assert.equal(progress.rows.access.status, 'done');
  assert.equal(progress.rows.name.status, 'skip');
  assert.equal(progress.rows.cost.status, 'now');
  assert.equal(progress.mode, 'talk');
  assert.equal(progress.moment, 'cost');
});

// ---- Payments ----

test('Payments: not needed when Stripe is not wanted', () => {
  assert.equal(after(...BUILT, 'After building: Stripe not wanted').rows.pay.status, 'skip');
});

test('Payments: not needed when a later step is settled with no Stripe entry', () => {
  assert.equal(after(...BUILT, 'After building: Name and link preview done. recipes.pilely.app').rows.pay.status, 'skip');
  assert.equal(after(...BUILT, 'After building: What it costs to run not wanted').rows.pay.status, 'skip');
});

test('Payments: open, with its hint, until then', () => {
  const live = after(...BUILT);
  assert.equal(live.rows.pay.status, 'todo');
  const checked = after(...BUILT, 'After building: Who can see what done. Only family');
  assert.equal(checked.rows.pay.status, 'now');
  assert.equal(checked.moment, 'pay');
  // A Stripe entry keeps it open even once a later step is settled.
  const stripe = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'Stripe: account linked',
    'After building: Name and link preview done. recipes',
  );
  assert.equal(stripe.rows.pay.status, 'now');
  assert.equal(after(...BUILT, 'After building: Stripe done. Monthly plan').rows.pay.status, 'done');
});

test('Payments: not needed for an app that takes no payments', () => {
  const progress = after(...BUILT, 'After building: Who can see what done. Only family', 'After building: Stripe not needed');
  assert.equal(progress.rows.pay.status, 'skip');
  assert.equal(progress.rows.name.status, 'now');
  assert.equal(progress.moment, 'name');
});

test('After building: a started step is current, and Payments passed over with no Stripe entry is not needed', () => {
  const progress = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'After building: What it costs to run started',
  );
  assert.equal(progress.rows.pay.status, 'skip');
  assert.equal(progress.rows.name.status, 'todo');
  assert.equal(progress.rows.cost.status, 'now');
  assert.equal(progress.moment, 'cost');
  assert.equal(progress.percent, Math.round((6 / 8) * 100));
});

test('After building: a started step wins over Payments put off, which stays open', () => {
  const progress = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'Stripe: later',
    'After building: Name and link preview started',
  );
  assert.equal(progress.rows.pay.status, 'todo');
  assert.equal(progress.rows.name.status, 'now');
  assert.equal(progress.moment, 'name');
  // Once the started step is settled, the step left open is current again.
  const settled = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'Stripe: later',
    'After building: Name and link preview started',
    'After building: Name and link preview done. recipes',
  );
  assert.equal(settled.rows.pay.status, 'now');
});

// ---- live and everything's set ----

test('between the live app and the first After building entry: "Your app is live", "Your turn"', () => {
  const progress = after(...BUILT);
  assert.equal(progress.mode, 'you');
  assert.equal(progress.moment, 'live');
  assert.equal(progress.rows.live.address, LIVE);
  assert.equal(progress.next, 'access');
  assert.equal(progress.nextRow, 'access');
  assert.equal(progress.percent, 50);
  assert.deepEqual(
    progress.buttons.map((b) => [b.label, b.primary, b.address]),
    [
      ['live', true, LIVE],
      ['demo', false, DEMO],
    ],
  );
});

test('after building has started, the app is the one thing to open', () => {
  const progress = after(...BUILT, 'After building: Who can see what done. Only family');
  assert.deepEqual(progress.buttons, [{ row: 'live', label: 'live', address: LIVE, primary: false }]);
});

test('every row done or not needed: "Everything\'s set", "Done"', () => {
  const progress = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'After building: Stripe not wanted',
    'After building: Name and link preview done. recipes',
    'After building: What it costs to run done. A few dollars',
  );
  const expected: Record<RowKey, RowStatus> = {
    idea: 'done',
    design: 'done',
    demo: 'done',
    live: 'done',
    access: 'done',
    pay: 'skip',
    name: 'done',
    cost: 'done',
  };
  assert.deepEqual(statuses(progress), expected);
  assert.equal(progress.mode, 'fin');
  assert.equal(progress.moment, 'done');
  assert.equal(progress.percent, 100);
  assert.equal(progress.next, undefined);
  assert.equal(progress.nextRow, undefined);
  assert.deepEqual(progress.buttons, [{ row: 'live', label: 'live', address: LIVE, primary: true }]);
});

test('after building settled with a stage never logged: the live card, the stage row shows Next', () => {
  const progress = after(
    IDEA,
    LIVE_DONE,
    'After building: Who can see what done. Only family',
    'After building: Stripe not wanted',
    'After building: Name and link preview done. recipes',
    'After building: What it costs to run done. A few dollars',
  );
  assert.equal(progress.mode, 'you');
  assert.equal(progress.moment, 'live');
  assert.equal(progress.nextRow, 'design');
  assert.deepEqual(progress.buttons, [{ row: 'live', label: 'live', address: LIVE, primary: true }]);
});

test('once the app is live a change does not go back a step: rows stay done, the card stays where it was', () => {
  const before = after(...BUILT, 'After building: Who can see what done. Only family');
  const progress = after(
    ...BUILT,
    'After building: Who can see what done. Only family',
    'Change asked: Build the real app. Go live with payments',
    'Stage started: Build the real app',
  );
  assert.deepEqual(statuses(progress), statuses(before));
  assert.equal(progress.mode, before.mode);
  assert.equal(progress.moment, before.moment);
  assert.equal(progress.percent, before.percent);
  assert.equal(progress.buttons[0]?.address, LIVE);
});

test('once the app is live a redesign marks nothing out of date', () => {
  const progress = after(
    ...BUILT,
    'Change asked: Make the UX. A new home screen',
    'Out of date: Build the mock demo, Build the real app. The home screen changed',
    `Stage done: Make the UX. Open: ${DESIGN}`,
  );
  assert.equal(progress.rows.design.status, 'done');
  assert.equal(progress.rows.demo.status, 'done');
  assert.equal(progress.rows.live.status, 'done');
  assert.equal(progress.mode, 'you');
  assert.equal(progress.moment, 'live');
});

test('before the app is live a change still shows the stage being worked on', () => {
  const progress = after(IDEA, DESIGN_DONE, DEMO_DONE, 'Change asked: Build the mock demo. A green button');
  assert.equal(progress.rows.demo.status, 'now');
  assert.equal(progress.mode, 'work');
});

// ---- languages ----

test('the page carries the platform\'s sixteen languages', () => {
  assert.deepEqual(PAGE_LANGUAGES, [...LANGUAGE_CODES]);
});

test('the language: picked before, else started with, else the browser\'s, else English', () => {
  assert.equal(chooseLanguage({ saved: 'fr', started: 'ja', browser: ['de'] }), 'fr');
  assert.equal(chooseLanguage({ saved: 'xx', started: 'ja', browser: ['de'] }), 'ja');
  assert.equal(chooseLanguage({ saved: null, started: '', browser: ['pt-BR', 'en'] }), 'pt');
  assert.equal(chooseLanguage({ saved: null, started: 'klingon', browser: ['xx', 'zh-Hant-TW'] }), 'zh');
  assert.equal(chooseLanguage({ browser: ['nn-NO'] }), 'nb');
  assert.equal(chooseLanguage({ browser: ['no'] }), 'nb');
  assert.equal(chooseLanguage({ browser: ['xx'] }), 'en');
  assert.equal(chooseLanguage({}), 'en');
  assert.equal(supportedLanguage('AR'), 'ar');
  assert.equal(fill('step {n} of {t}', { n: 2, t: 8 }), 'step 2 of 8');
  assert.equal(fill('{x} stays', {}), '{x} stays');
});

type Words = { [key: string]: string | Words };

function leaves(words: Words, prefix = ''): [string, string][] {
  return Object.entries(words).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : leaves(value, path);
  });
}

const readLocale = (code: string): Words => JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8')) as Words;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('there is one word list per language and nothing else', () => {
  const files = readdirSync(LOCALES_DIR).sort();
  assert.deepEqual(files, [...LANGUAGE_CODES].map((code) => `${code}.json`).sort());
});

test('every word list has exactly English\'s keys and placeholders, and no empty string', () => {
  const english = new Map(leaves(readLocale('en')));
  for (const code of LANGUAGE_CODES) {
    const words = new Map(leaves(readLocale(code)));
    assert.deepEqual([...words.keys()].sort(), [...english.keys()].sort(), `${code}.json keys`);
    for (const [path, text] of words) {
      assert.notEqual(text.trim(), '', `${code}.json: ${path} is empty`);
      assert.deepEqual(placeholders(text), placeholders(english.get(path)!), `${code}.json: ${path} placeholders`);
    }
  }
});

test('every key the page state can name is in the word lists', () => {
  const english = new Map(leaves(readLocale('en')));
  const journeys = [
    [],
    [IDEA],
    [IDEA, 'Stage started: Make the UX'],
    [IDEA, DESIGN_DONE],
    [IDEA, DESIGN_DONE, 'Out of date: Make the UX. x'],
    [IDEA, DESIGN_DONE, 'Stage started: Build the mock demo'],
    [IDEA, DESIGN_DONE, DEMO_DONE],
    [IDEA, DESIGN_DONE, DEMO_DONE, 'Out of date: Build the mock demo. x'],
    [IDEA, DESIGN_DONE, DEMO_DONE, 'Stage started: Build the real app'],
    [...BUILT, 'Out of date: Build the real app. x'],
    [...BUILT],
    [...BUILT, 'After building: Who can see what done. x'],
    [...BUILT, 'Stripe: x', 'After building: Who can see what done. x', 'After building: Name and link preview done. x'],
    [...BUILT, 'After building: Who can see what done. x', 'After building: Stripe not wanted'],
    [...BUILT, 'After building: Who can see what done. x', 'After building: Stripe not wanted', 'After building: Name and link preview done. x'],
    [...BUILT, 'After building: Stripe not wanted', 'After building: Name and link preview not wanted', 'After building: Who can see what done. x', 'After building: What it costs to run done. x'],
  ];
  for (const lines of journeys) {
    const progress = after(...lines);
    const keys = [`label.${progress.mode}`, `moment.${progress.moment}.title`, `moment.${progress.moment}.body`];
    if (progress.next) keys.push(`next.${progress.next}`);
    for (const button of progress.buttons) keys.push(`button.${button.label}`);
    for (const [row, { status }] of Object.entries(progress.rows)) {
      keys.push(`row.${row}`);
      if (status !== 'todo') keys.push(`pill.${status}`);
    }
    for (const key of keys) assert.ok(english.has(key), `${key} (after ${lines.length} lines)`);
  }
});

test('no shown string names a teammate, an agent, an artifact, a chatroom, a handle or a command', () => {
  const forbidden = ['agent', 'artifact', 'chatroom', 'chat room', 'handle', 'command', 'angela', 'kevin', 'oscar', 'dwight', '.pilely', 'pilely.ts', '@', 'stage done', 'stage started', 'after building'];
  for (const code of LANGUAGE_CODES) {
    for (const [path, text] of leaves(readLocale(code))) {
      const lower = text.toLowerCase();
      for (const word of forbidden) assert.ok(!lower.includes(word), `${code}.json: ${path} contains "${word}"`);
    }
  }
});

// ---- the shipped files ----

test('the page carries the language tag the server fills', () => {
  const html = readFileSync(join(PAGE_DIR, 'index.html'), 'utf8');
  assert.match(html, /<meta\s+name="pilely-dashboard-lang"\s+content=""/);
});

test('the page loads nothing from the internet', () => {
  const files = readdirSync(PAGE_DIR, { recursive: true, encoding: 'utf8' }).filter((name) => /\.(html|js|css|json|ts)$/.test(name));
  assert.ok(files.length > 16);
  for (const name of files) {
    const text = readFileSync(join(PAGE_DIR, name), 'utf8');
    assert.doesNotMatch(text, /(src|href)\s*=\s*["']https?:/i, `${name} loads from the internet`);
    assert.doesNotMatch(text, /@import|url\(\s*["']?https?:/i, `${name} loads from the internet`);
  }
});

test('every link the page draws opens in a new tab', () => {
  const app = readFileSync(join(PAGE_DIR, 'app.js'), 'utf8');
  const links = app.match(/href: [^,]+,[^)]*/g) ?? [];
  assert.ok(links.length >= 2);
  for (const link of links) assert.match(link, /target: '_blank'/, `a link without a new tab: ${link}`);
  // A plain click opens the tab itself, for browsers that ignore target="_blank".
  assert.match(app, /window\.open\(link\.href, '_blank'\)/);
});
