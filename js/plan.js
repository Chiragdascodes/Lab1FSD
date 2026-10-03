/* ==========================================================================
   WE RISE — plan.js   (an ES module)

   Events, where they earn their place. The quests you spoke in Start Today
   arrive here with no hour against them; this is where they get one.

     The board  · drag and drop moves a quest between hours (dragstart,
                  dragover, dragleave, drop, dragend). The same move is on
                  the keyboard (keydown): arrows send it on, D finishes it,
                  Delete takes it off. Right-click opens the quest's own
                  menu (contextmenu); hovering it lights its hour
                  (mouseover, mouseout); a double-click finishes it
                  (dblclick). On a phone, tap the quest, then the hour.
     The line   · the live count as you write (input), a helper that comes
                  and goes with the caret (focus, blur), the hour and the
                  minutes (change), and the day locked in with the form
                  checked first (submit).

   The board is kept in Local Storage, and the first hour is the sunrise
   that Start Today found, so the two sections tell the same day.
   ========================================================================== */

const WR = (window.WR = window.WR || {});
const root = document.getElementById('plan');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const award = (key, n) => WR.award && WR.award(key, n);

var ready = false;                             /* the tiles are wired up */
const KEY = 'wr-plan-v1';
const SYS = 'wr-system-v2';                    /* Start Today's quests live here */

const LANES = [
  { id: 'unplanned', name: 'Not placed', when: 'Waiting for an hour' },
  { id: 'first', name: 'First hour', when: 'After sunrise' },
  { id: 'midday', name: 'Midday', when: '12 — 2 PM' },
  { id: 'evening', name: 'Evening', when: 'After 7 PM' }
];
const HOURS = ['first', 'midday', 'evening'];
const STARTERS = [
  'Twenty minutes of reading',
  'Train — forty-five minutes',
  'Write tomorrow’s one thing',
  'Walk, with the phone left behind'
];

/* ======================================================================
   STATE — Local Storage, and the quests from Start Today
   ====================================================================== */

const canStore = (() => {
  try { localStorage.setItem(KEY + '-probe', '1'); localStorage.removeItem(KEY + '-probe'); return true; }
  catch (e) { return false; }
})();

const state = (() => {
  const base = { cards: [], intent: '', slot: 'first', minutes: 45, locked: false };
  if (!canStore) return base;
  try { return Object.assign(base, JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch (e) { return base; }
})();

function save() {
  if (!canStore) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

function spokenQuests() {
  if (!canStore) return [];
  try { return (JSON.parse(localStorage.getItem(SYS)) || {}).quests || []; }
  catch (e) { return []; }
}

/* quests spoken upstairs arrive here; anything already on the board stays */
function sync() {
  const quests = spokenQuests();
  quests.slice().reverse().forEach((q) => {
    const had = state.cards.find((c) => c.id === q.id);
    if (had) { had.text = q.text; had.done = had.done || q.done; return; }
    state.cards.unshift({ id: q.id, text: q.text, lane: 'unplanned', done: !!q.done });
  });
  if (!state.cards.length) {
    state.cards = STARTERS.map((text, i) => ({ id: 's' + i, text, lane: 'unplanned', done: false }));
  }
  save();
}
sync();
window.addEventListener('wr:quests', () => { sync(); render(); });

/* the first hour is the sunrise Start Today found */
let sunrise = '';
window.addEventListener('wr:sunrise', (e) => {
  sunrise = (e.detail && e.detail.label) || '';
  const lane = board.querySelector('[data-lane="first"] .lane-when');
  if (lane && sunrise) lane.textContent = sunrise + ' — one hour';
  line();
});

/* ======================================================================
   THE BOARD
   ====================================================================== */

const board = document.getElementById('board');
const boardStatus = document.getElementById('board-status');
const defaultStatus = boardStatus.textContent;
let held = null;                               /* the quest picked up by touch */
let dragId = null;

function laneOf(id) { return state.cards.filter((c) => c.lane === id); }
function card(id) { return state.cards.find((c) => c.id === id); }
function laneName(id) { return (LANES.find((l) => l.id === id) || {}).name || id; }

function say(msg) { boardStatus.textContent = msg || defaultStatus; }

function render(moved) {
  if (!ready) return;
  board.textContent = '';
  LANES.forEach((lane) => {
    const sec = document.createElement('section');
    sec.className = 'lane' + (lane.id === 'unplanned' ? ' lane-tray' : '');
    sec.dataset.lane = lane.id;

    const head = document.createElement('header');
    head.className = 'lane-head';
    const name = document.createElement('h4'); name.className = 'lane-name'; name.textContent = lane.name;
    const when = document.createElement('p'); when.className = 'lane-when';
    when.textContent = lane.id === 'first' && sunrise ? sunrise + ' — one hour' : lane.when;
    const n = document.createElement('span'); n.className = 'lane-n';
    const cards = laneOf(lane.id);
    n.textContent = cards.length || '';
    head.append(name, when, n);

    const list = document.createElement('ul');
    list.className = 'lane-list';
    list.setAttribute('aria-label', lane.name);
    if (!cards.length) {
      const empty = document.createElement('li');
      empty.className = 'lane-empty';
      empty.textContent = lane.id === 'unplanned' ? 'Everything has an hour.' : 'Drop a quest here';
      list.appendChild(empty);
    }
    cards.forEach((c) => list.appendChild(cardEl(c, lane)));

    sec.append(head, list);
    board.appendChild(sec);
  });

  if (moved && !reduced && window.gsap) {
    const el = board.querySelector('[data-id="' + moved + '"]');
    if (el) gsap.from(el, { duration: 0.5, y: -10, scale: 0.97, opacity: 0, ease: 'expo.out' });
  }
}

function cardEl(c, lane) {
  const li = document.createElement('li');
  li.className = 'card' + (c.done ? ' is-done' : '') + (held === c.id ? ' is-held' : '');
  li.dataset.id = c.id;
  li.draggable = true;
  li.tabIndex = 0;
  li.setAttribute('aria-label', c.text + '. ' + lane.name + (c.done ? ', done' : '') + '.');

  const grip = document.createElement('span');
  grip.className = 'card-grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.innerHTML = '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.1"/><circle cx="7" cy="3" r="1.1"/>' +
    '<circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/><circle cx="3" cy="13" r="1.1"/><circle cx="7" cy="13" r="1.1"/></svg>';

  const text = document.createElement('span');
  text.className = 'card-text';
  text.textContent = c.text;

  li.append(grip, text);
  return li;
}

/* ---- moving a quest ---- */
function move(id, lane, how) {
  const c = card(id);
  if (!c || c.lane === lane) return;
  c.lane = lane;
  save();
  render(id);
  const el = board.querySelector('[data-id="' + id + '"]');
  if (el && how === 'key') el.focus();
  if (lane !== 'unplanned') {
    say('“' + c.text + '” now sits in ' + laneName(lane).toLowerCase() + '.');
    award('plan-place', 25);
  } else {
    say('“' + c.text + '” is back on the tray.');
  }
  line();
}

function nudge(id, step) {
  const c = card(id);
  if (!c) return;
  const order = ['unplanned'].concat(HOURS);
  const at = order.indexOf(c.lane);
  const next = order[Math.min(order.length - 1, Math.max(0, at + step))];
  move(id, next, 'key');
}

function toggleDone(id) {
  const c = card(id);
  if (!c) return;
  c.done = !c.done;
  save();
  render();
  const el = board.querySelector('[data-id="' + id + '"]');
  if (el) el.focus();
  if (c.done) { say('“' + c.text + '” is done. That is the day moving.'); award('plan-done-' + id, 25); }
  else say('“' + c.text + '” is open again.');
}

function remove(id) {
  const c = card(id);
  if (!c) return;
  state.cards = state.cards.filter((x) => x !== c);
  save();
  render();
  say('“' + c.text + '” is off the board.');
  line();
}

/* ---- drag and drop ---- */
/* a mouse drags and double-clicks; a finger taps. The pointer itself says
   which one is in use. */
let touching = false;
board.addEventListener('pointerdown', (e) => { touching = e.pointerType === 'touch' || e.pointerType === 'pen'; });

board.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  dragId = el.dataset.id;
  el.classList.add('is-dragging');
  board.classList.add('is-dragging-on');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  say('Drop it on the hour it belongs to.');
});

board.addEventListener('dragover', (e) => {
  const lane = e.target.closest('.lane');
  if (!lane || !dragId) return;
  e.preventDefault();                          /* without this, no drop follows */
  e.dataTransfer.dropEffect = 'move';
  lane.classList.add('is-over');
});

board.addEventListener('dragleave', (e) => {
  const lane = e.target.closest('.lane');
  if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove('is-over');
});

board.addEventListener('drop', (e) => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  e.preventDefault();
  endDrag();
  const id = e.dataTransfer.getData('text/plain') || dragId;
  move(id, lane.dataset.lane, 'drop');
});

function endDrag() {
  dragId = null;
  board.classList.remove('is-dragging-on');
  board.querySelectorAll('.is-dragging, .is-over').forEach((el) => el.classList.remove('is-dragging', 'is-over'));
}
board.addEventListener('dragend', endDrag);

/* ---- the keyboard: the same moves, without a mouse ---- */
board.addEventListener('keydown', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  const id = el.dataset.id;
  if (e.key === 'ArrowRight') { e.preventDefault(); nudge(id, 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(id, -1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const sibs = [...el.closest('.lane-list').querySelectorAll('.card')];
    const to = sibs[sibs.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (to) to.focus();
  } else if (e.key === 'd' || e.key === 'D' || e.key === 'Enter') { e.preventDefault(); toggleDone(id); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); }
  else if (e.key === 'Escape') closeMenu();
});

/* ---- hovering a quest lights the hour it is in ---- */
board.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  el.closest('.lane').classList.add('is-lit');
  const c = card(el.dataset.id);
  if (c) say(c.lane === 'unplanned' ? 'Drag it to an hour, or press the right arrow.' : 'In ' + laneName(c.lane).toLowerCase() + '. Double-click when it is done.');
});
board.addEventListener('mouseout', (e) => {
  const el = e.target.closest('.card');
  if (!el || el.contains(e.relatedTarget)) return;
  el.closest('.lane').classList.remove('is-lit');
  say();
});

/* ---- a double-click finishes it ---- */
board.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.card');
  if (el) toggleDone(el.dataset.id);
});

/* ---- tap to pick up, tap to place: a phone has no drag, and a mouse
   should be left alone to drag and double-click ---- */
board.addEventListener('click', (e) => {
  const el = e.target.closest('.card');
  const lane = e.target.closest('.lane');
  if (el) {
    if (!touching) return;
    held = held === el.dataset.id ? null : el.dataset.id;
    render();
    const c = card(held);
    say(c ? 'Now tap the hour for “' + c.text + '”.' : '');
    return;
  }
  if (lane && held) { const id = held; held = null; move(id, lane.dataset.lane, 'tap'); }
});

/* ---- the quest's own menu ---- */
const menu = document.createElement('div');
menu.className = 'pm-menu';
menu.setAttribute('role', 'menu');
menu.hidden = true;
root.querySelector('.tile-board').appendChild(menu);
let menuFor = null;

function closeMenu() {
  menu.hidden = true;
  menuFor = null;
}

function openMenu(id, x, y) {
  const c = card(id);
  if (!c) return;
  menuFor = id;
  menu.textContent = '';
  const items = HOURS.filter((h) => h !== c.lane).map((h) => ({ label: 'Move to ' + laneName(h).toLowerCase(), run: () => move(id, h, 'menu') }));
  if (c.lane !== 'unplanned') items.push({ label: 'Back to the tray', run: () => move(id, 'unplanned', 'menu') });
  items.push({ label: c.done ? 'Mark as not done' : 'Mark as done', run: () => toggleDone(id) });
  items.push({ label: 'Take it off the board', run: () => remove(id), danger: true });
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = 'pm-item' + (it.danger ? ' is-danger' : '');
    b.textContent = it.label;
    b.addEventListener('click', () => { it.run(); closeMenu(); });
    menu.appendChild(b);
  });
  menu.hidden = false;
  const box = root.querySelector('.tile-board').getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(x - box.left, box.width - w - 8) + 'px';
  menu.style.top = Math.min(y - box.top, box.height - h - 8) + 'px';
  menu.querySelector('.pm-item').focus();
}

board.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  e.preventDefault();                          /* our menu, not the browser's */
  openMenu(el.dataset.id, e.clientX, e.clientY);
});
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('scroll', () => { if (!menu.hidden) closeMenu(); }, true);

/* ======================================================================
   THE ONE LINE
   ====================================================================== */

const form = document.getElementById('intent-form');
const text = document.getElementById('intent-text');
const wrap = document.getElementById('ta-wrap');
const count = document.getElementById('intent-count');
const hint = document.getElementById('intent-hint');
const slot = document.getElementById('intent-slot');
const mins = document.getElementById('intent-mins');
const minsOut = document.getElementById('intent-mins-out');
const intentLine = document.getElementById('intent-line');
const intentStatus = document.getElementById('intent-status');
const calm = intentStatus.textContent;

text.value = state.intent;
slot.value = state.slot;
mins.value = state.minutes;
minsOut.textContent = state.minutes;

function line() {
  if (!ready) return;
  const planned = state.cards.filter((c) => c.lane !== 'unplanned').length;
  const when = slot.value === 'first' ? (sunrise ? 'the first hour, from ' + sunrise : 'the first hour')
    : slot.value === 'midday' ? 'the middle of the day' : 'the evening';
  const said = text.value.trim();
  intentLine.textContent = said
    ? '“' + said + '” — ' + mins.value + ' minutes, in ' + when + '. ' +
      (planned ? planned + (planned === 1 ? ' quest is' : ' quests are') + ' on the board.' : 'Nothing is on the board yet.')
    : 'Pick an hour and write your line.';
}

/* ---- input: the count, live ---- */
text.addEventListener('input', () => {
  const n = text.value.length;
  if (n) wrap.classList.remove('is-bad');
  count.textContent = n + '/90';
  count.classList.toggle('is-near', n > 72);
  wrap.classList.toggle('is-filled', n > 0);
  line();
});

/* ---- focus and blur: the helper comes and goes ---- */
text.addEventListener('focus', () => {
  wrap.classList.add('is-focus');
  if (wrap.classList.contains('is-bad')) return;   /* leave the complaint up */
  hint.textContent = 'One sentence. The shorter it is, the harder it is to argue with.';
});
text.addEventListener('blur', () => {
  wrap.classList.remove('is-focus');
  const n = text.value.trim().length;
  hint.textContent = n && n < 8 ? 'A few more words.' : 'Say it in one sentence. Eight characters is enough to start.';
  if (state.intent !== text.value) { state.intent = text.value; save(); }
});

/* ---- change: the hour, and the minutes ---- */
slot.addEventListener('change', () => {
  state.slot = slot.value;
  save();
  line();
  intentStatus.textContent = 'Set to ' + slot.options[slot.selectedIndex].text.toLowerCase() + '.';
  const lane = board.querySelector('[data-lane="' + slot.value + '"]');
  if (lane && !reduced && window.gsap) gsap.fromTo(lane, { backgroundColor: 'rgba(44,122,75,0.1)' }, { backgroundColor: 'rgba(44,122,75,0)', duration: 1.2 });
});
mins.addEventListener('input', () => { minsOut.textContent = mins.value; line(); });
mins.addEventListener('change', () => {
  state.minutes = +mins.value;
  save();
  intentStatus.textContent = mins.value + ' minutes, held for this and nothing else.';
});

/* ---- submit: checked here, not by the browser ---- */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const said = text.value.trim();
  const planned = state.cards.filter((c) => c.lane !== 'unplanned').length;
  if (said.length < 8) {
    wrap.classList.add('is-bad');
    intentStatus.textContent = 'The day needs a line.';
    text.focus();
    hint.textContent = 'Write the line first — eight characters or more.';
    if (!reduced && window.gsap) gsap.fromTo(wrap, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
    return;
  }
  if (!planned) {
    intentStatus.textContent = 'Put at least one quest into an hour, then lock it in.';
    say('Drag a quest into an hour to finish the day.');
    if (!reduced && window.gsap) gsap.fromTo(board, { x: -5 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
    return;
  }
  wrap.classList.remove('is-bad');
  state.intent = said;
  state.locked = true;
  save();
  line();
  intentStatus.textContent = 'Locked in. ' + mins.value + ' minutes in ' +
    slot.options[slot.selectedIndex].text.toLowerCase() + ', and ' + planned +
    (planned === 1 ? ' quest' : ' quests') + ' with an hour against ' + (planned === 1 ? 'it' : 'them') + '.';
  award('plan-locked', 50);
  if (WR.heartbeat) WR.heartbeat();
  if (!reduced && window.gsap) gsap.fromTo(intentLine, { opacity: 0.4, y: 6 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' });
});

document.getElementById('intent-clear').addEventListener('click', () => {
  text.value = '';
  count.textContent = '0/90';
  wrap.classList.remove('is-filled', 'is-bad');
  state.cards.forEach((c) => { c.lane = 'unplanned'; });
  state.intent = '';
  state.locked = false;
  save();
  render();
  line();
  intentStatus.textContent = calm;
  say();
});

ready = true;
render();
line();

/* the tiles arrive as the section does */
if (!reduced && window.gsap && window.ScrollTrigger) {
  gsap.from(root.querySelectorAll('.sys-head > *, .tile'), {
    scrollTrigger: { trigger: root, start: 'top 72%' },
    duration: 1.1, y: 28, opacity: 0, stagger: 0.07, ease: 'expo.out', clearProps: 'all'
  });
}
