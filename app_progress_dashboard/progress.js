// Works out where the app stands from the entries Pam writes in the app's
// chatroom. Pure functions only: no DOM, no network, so the same file runs
// in the page and under node:test.
//
// The entries read, each at the start of a message:
//
//   Idea settled: <the app in one sentence>
//   Stage started: <stage>
//   Stage done: <stage>. Open: <address>
//   Stage failed: <stage>. <why>
//   Change asked: <stage>. <the change>
//   Skipped: <stage>
//   Not yet: <stage>
//   Out of date: <stage>, <stage>. <what changed>
//   After building: <step> started
//   After building: <step> done. <what was decided>
//   After building: <step> not wanted
//   After building: <step> not needed
//   Stripe: <anything>
//
// <stage> is `Make the UX`, `Build the mock demo` or `Build the real app`;
// <step> is `Who can see what`, `Stripe`, `Name and link preview` or
// `What it costs to run`. Anything else is ignored, and so is every
// message not sent by an agent of type `pam`. A later entry about a stage
// replaces an earlier one, until the real app is live: from then on the
// page never goes back a step, and entries that would move a stage back
// (a change, a rebuild, out of date) leave it done.

/** The rows of the "All steps" list, in order; the bar counts all eight. */
export const ROWS = ['idea', 'design', 'demo', 'live', 'access', 'pay', 'name', 'cost'];
export const STAGE_ROWS = ['design', 'demo', 'live'];
export const AFTER_ROWS = ['access', 'pay', 'name', 'cost'];

const STAGE_NAMES = {
  'Make the UX': 'design',
  'Build the mock demo': 'demo',
  'Build the real app': 'live',
};

const AFTER_NAMES = {
  'Who can see what': 'access',
  Stripe: 'pay',
  'Name and link preview': 'name',
  'What it costs to run': 'cost',
};

/** The card's moment for a stage being made, made, or out of date. */
const WORK_MOMENT = { design: 'dbuild', demo: 'mbuild', live: 'lbuild' };
const READY_MOMENT = { design: 'dready', demo: 'mready' };
const REDO_MOMENT = { design: 'dredo', demo: 'mredo', live: 'lredo' };
/** What comes next while a stage is made, and while it waits to be made again. */
const SEE_NEXT = { design: 'seeDesign', demo: 'seeDemo', live: 'seeLive' };
const REDO_NEXT = { design: 'redoDesign', demo: 'redoDemo', live: 'redoLive' };

/**
 * The chatroom that holds the app's log: the one that is not the default
 * room. With more than one, the newest.
 */
export function appRoom(rooms) {
  if (!Array.isArray(rooms)) return undefined;
  let found;
  for (const room of rooms) {
    if (!room || typeof room !== 'object' || room.is_default !== false) continue;
    if (typeof room.room_nanoid !== 'string' || room.room_nanoid === '') continue;
    if (!found || Number(room.created_time_stamp) >= Number(found.created_time_stamp)) found = room;
  }
  return found;
}

/** `value` when it is an http(s) address, else undefined. */
export function openableAddress(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** True for an address served from this machine, which may stop answering. */
export function isLocalAddress(address) {
  try {
    const host = new URL(address).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** The name from `names` that `text` starts with, as a whole name, and what follows it. */
function leadingName(text, names) {
  for (const name of Object.keys(names)) {
    if (!text.startsWith(name)) continue;
    const rest = text.slice(name.length);
    if (rest === '' || /^[\s.,;:]/.test(rest)) return { key: names[name], rest };
  }
  return undefined;
}

function addressIn(rest) {
  const match = /\bOpen:\s*(\S+)/.exec(rest);
  return match ? openableAddress(match[1].replace(/[.,;)]+$/, '')) : undefined;
}

function blankRows() {
  const rows = {};
  for (const key of ROWS) rows[key] = { status: 'todo' };
  return rows;
}

/** Applies the Pam entries of `messages`, oldest first, to fresh rows. */
function readLog(messages) {
  const rows = blankRows();
  let afterBuildingSeen = false;
  let stripeSeen = false;
  let somethingAfterIdea = false;
  // The after-building step Pam said last that she started.
  let started;

  // Once the real app is live the page never goes back a step: a later change,
  // redesign or rebuild leaves the design, demo and live rows done.
  let live = false;

  const stage = (key, status) => {
    somethingAfterIdea = true;
    if (live && status !== 'done') return;
    rows[key].status = status;
    if (key === 'live' && status === 'done') live = true;
  };

  for (const message of messages) {
    const text = typeof message?.text === 'string' ? message.text.trim() : '';
    let m;
    if (text.startsWith('Idea settled:')) {
      rows.idea.status = 'done';
    } else if ((m = /^Stage started:\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), STAGE_NAMES);
      if (found) stage(found.key, 'now');
    } else if ((m = /^Change asked:\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), STAGE_NAMES);
      if (found) stage(found.key, 'now');
    } else if ((m = /^Stage done:\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), STAGE_NAMES);
      if (found) {
        stage(found.key, 'done');
        const address = addressIn(found.rest);
        if (address) rows[found.key].address = address;
      }
    } else if ((m = /^(Stage failed|Not yet):\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), STAGE_NAMES);
      if (found) stage(found.key, 'todo');
    } else if ((m = /^Skipped:\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), STAGE_NAMES);
      if (found) stage(found.key, 'skip');
    } else if ((m = /^Out of date:\s*/.exec(text))) {
      const list = text.slice(m[0].length).split('.')[0] ?? '';
      for (const name of list.split(',')) {
        const found = leadingName(name.trim(), STAGE_NAMES);
        if (found) stage(found.key, 'redo');
      }
    } else if ((m = /^After building:\s*/.exec(text))) {
      const found = leadingName(text.slice(m[0].length), AFTER_NAMES);
      if (!found) continue;
      afterBuildingSeen = true;
      somethingAfterIdea = true;
      if (found.key === 'pay') stripeSeen = true;
      const rest = found.rest.trim().toLowerCase();
      if (rest.startsWith('not wanted') || rest.startsWith('not needed')) rows[found.key].status = 'skip';
      else if (rest.startsWith('done')) rows[found.key].status = 'done';
      else if (rest.startsWith('started')) started = found.key;
    } else if (text.startsWith('Stripe:')) {
      stripeSeen = true;
    }
  }

  // Nothing is made before the idea is settled, so any later entry means it was.
  if (somethingAfterIdea) rows.idea.status = 'done';

  // Payments: not needed once a later step is started or settled and nothing
  // was ever said about Stripe.
  if (!stripeSeen && rows.pay.status === 'todo') {
    const later = AFTER_ROWS.slice(AFTER_ROWS.indexOf('pay') + 1);
    if (later.some((key) => key === started || rows[key].status === 'done' || rows[key].status === 'skip')) rows.pay.status = 'skip';
  }

  return { rows, afterBuildingSeen, started };
}

const isSettled = (status) => status === 'done' || status === 'skip';

/** The first row after `from` (a row key, or undefined for the start) that is still to do. */
function firstTodo(rows, from) {
  const start = from ? ROWS.indexOf(from) + 1 : 0;
  return ROWS.slice(start).find((key) => rows[key].status === 'todo');
}

/**
 * Buttons for what can be opened, primary first: at most one primary and
 * at most two in all. `primary` is the stage to open right now, if any.
 */
function buttonsFor(rows, moment, primary) {
  // A result being changed or out of date stays openable until it is made again.
  const opens = (key) => ['done', 'redo', 'now'].includes(rows[key].status) && Boolean(rows[key].address);
  const button = (key) => ({
    row: key,
    label: rows[key].status === 'redo' && key !== 'live' ? `old${key[0].toUpperCase()}${key.slice(1)}` : key,
    address: rows[key].address,
    primary: key === primary,
  });
  // Once the app is live and past its first look, the app is the one thing to open.
  if (opens('live') && (AFTER_ROWS.includes(moment) || moment === 'done')) return [button('live')];
  const keys = ['live', 'demo', 'design'].filter(opens).slice(0, 2);
  if (primary && opens(primary) && !keys.includes(primary)) keys.unshift(primary);
  return keys
    .slice(0, 2)
    .map(button)
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * The whole page state.
 *
 *   room      the app's room record, or undefined when there is none yet
 *   agents    { <agent_id>: <type> }
 *   messages  the room's saved messages, any order
 *
 * Returns:
 *
 *   appName   the room's title, or undefined
 *   rows      { <row>: { status: done|now|redo|skip|todo, address? } }
 *   nextRow   the row that shows "Next": the first one to do when nothing is current
 *   mode      talk | work | you | warn | fin  (the whose-turn label)
 *   moment    which title and body the card shows
 *   next      which "Next: …" phrase the caption shows, or undefined
 *   step, total, percent
 *   buttons   [{ row, label, address, primary }]
 */
export function deriveProgress({ room, agents, messages }) {
  const pamIds = new Set(
    Object.entries(agents && typeof agents === 'object' ? agents : {})
      .filter(([, type]) => type === 'pam')
      .map(([id]) => id),
  );
  const pamLines = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && pamIds.has(message.sender_agent_id))
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));

  const { rows, afterBuildingSeen, started } = room ? readLog(pamLines) : { rows: blankRows(), afterBuildingSeen: false };
  const appName = room && typeof room.title === 'string' && room.title.trim() !== '' ? room.title.trim() : undefined;

  let mode;
  let moment;
  let next;
  let primary;
  const working = STAGE_ROWS.find((key) => rows[key].status === 'now');
  const outOfDate = STAGE_ROWS.find((key) => rows[key].status === 'redo');
  const lastMade = [...STAGE_ROWS].reverse().find((key) => rows[key].status === 'done');

  if (rows.idea.status !== 'done') {
    rows.idea.status = 'now';
    mode = 'talk';
    moment = 'idea';
    next = firstTodo(rows, 'idea');
  } else if (working) {
    mode = 'work';
    moment = WORK_MOMENT[working];
    next = SEE_NEXT[working];
  } else if (outOfDate) {
    mode = 'warn';
    moment = REDO_MOMENT[outOfDate];
    next = REDO_NEXT[outOfDate];
    primary = lastMade;
  } else if (rows.live.status === 'done') {
    if (ROWS.every((key) => isSettled(rows[key].status))) {
      mode = 'fin';
      moment = 'done';
      primary = 'live';
    } else {
      // Settled after-building rows with a stage row still to do (a stage the
      // log never mentions) leave no after-building row to point at. The step
      // Pam last started wins over an earlier one left open (put off, or
      // passed over without an entry).
      const current = !afterBuildingSeen
        ? undefined
        : started && !isSettled(rows[started].status)
          ? started
          : AFTER_ROWS.find((key) => !isSettled(rows[key].status));
      if (!current) {
        mode = 'you';
        moment = 'live';
        next = firstTodo(rows, 'live');
        primary = 'live';
      } else {
        rows[current].status = 'now';
        mode = 'talk';
        moment = current;
        next = firstTodo(rows, current);
      }
    }
  } else if (lastMade) {
    mode = 'you';
    moment = READY_MOMENT[lastMade];
    next = firstTodo(rows, lastMade);
    primary = lastMade;
  } else {
    mode = 'talk';
    moment = 'ready';
    next = firstTodo(rows, 'idea');
  }

  const counted = ROWS.filter((key) => ['done', 'skip', 'redo'].includes(rows[key].status)).length;
  const currentIndex = ROWS.findIndex((key) => rows[key].status === 'now' || rows[key].status === 'redo');
  const total = ROWS.length;
  const nextRow = currentIndex < 0 && mode !== 'fin' ? firstTodo(rows) : undefined;

  return {
    appName,
    rows,
    nextRow,
    mode,
    moment,
    next,
    step: currentIndex >= 0 ? currentIndex + 1 : Math.min(counted + 1, total),
    total,
    percent: Math.round((counted / total) * 100),
    buttons: buttonsFor(rows, moment, primary),
  };
}
