import { COLS, Game, ROWS } from './core/game.ts';
import {
  MAX_RUNGS,
  rung,
  rungOutcome,
  rungStars,
  startRung,
  type Rung,
  type RungOutcome,
} from './core/ladder.ts';
import { MODES } from './core/modes/index.ts';
import { Session } from './core/session.ts';
import { cellsOf, colorIndex, type Kind } from './core/pieces.ts';
import { highestRung, recordGame, recordRung, rename } from './core/profile.ts';
import { fitBoard } from './ui/fit.ts';
import { GestureTracker, isAction, type Action } from './ui/gestures.ts';
import { keyAction } from './ui/keys.ts';
import { PAGE, ladderPage, ladderTop, starText } from './ui/ladder.ts';
import { onLeaveScreen } from './ui/lifecycle.ts';
import { PlayedGame } from './ui/played.ts';
import { PROFILE_KEY, loadProfile, updateProfile, writeProfile } from './ui/profile.ts';
import { clearSave, loadSave, resumable, writeSave } from './ui/save.ts';

const COLORS = ['#000', '#0ff', '#ff0', '#a0f', '#0f0', '#f00', '#00f', '#f80'];

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const well = document.querySelector<HTMLElement>('.well')!;
const nextCanvas = document.querySelector<HTMLCanvasElement>('#next')!;
const nextCtx = nextCanvas.getContext('2d')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const pauseMenu = document.querySelector<HTMLElement>('#pause-menu')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume')!;
const resumePrompt = document.querySelector<HTMLElement>('#resume-prompt')!;
const resumeSavedBtn = document.querySelector<HTMLButtonElement>('#resume-saved')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const mainMenu = document.querySelector<HTMLElement>('#menu')!;
const ladderBtn = document.querySelector<HTMLButtonElement>('#play-ladder')!;
const ladderPanel = document.querySelector<HTMLElement>('#ladder')!;
const ladderBack = document.querySelector<HTMLButtonElement>('#ladder-back')!;
const ladderCurrent = document.querySelector<HTMLButtonElement>('#ladder-current')!;
const rungList = document.querySelector<HTMLElement>('#rung-list')!;
const resultPanel = document.querySelector<HTMLElement>('#result')!;
const resultNext = document.querySelector<HTMLButtonElement>('#result-next')!;
const resultRetry = document.querySelector<HTMLButtonElement>('#result-retry')!;
const resultBack = document.querySelector<HTMLButtonElement>('#result-back')!;
const $ = (id: string) => document.querySelector<HTMLElement>(id)!;

/** Write text only when it changes, so the status live region is not re-announced every frame. */
function setText(id: string, text: string): void {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

let session: Session | null = null;
/** The rung of the game in play or just finished, or null for a free game. */
let rungNow: Rung | null = null;
/** How the last game ended, shown on the result screen. */
let result: { game: Game; outcome: RungOutcome; stars: number } | null = null;
/** When the result screen appeared (performance.now()). */
let resultAt = 0;
/** Taps and keys this soon after a game ends are the game's, not the result's buttons. */
const RESULT_GUARD_MS = 400;
/** What shows over the board when no game is in play. */
let screen: 'menu' | 'ladder' | 'result' = 'menu';
/** The free mode last chosen, whose Best shows in the menus. */
let menuMode = 'classic';
/** The top row's rung on the ladder screen. */
let ladderTopRow = 1;
/** Reading `localStorage` itself throws where storage is blocked; save.ts catches that. */
const storage = () => window.localStorage;
/** The game's lock count at its last save. */
let savedLocks = 0;

const loaded = loadProfile(storage);
/**
 * Where the profile is written: nowhere if storage couldn't be read or holds a later
 * version, so it is never blanked or downgraded.
 */
const profileStorage = loaded.stored ? storage : () => null;
let profile = loaded.profile;
// Store at once: creates the profile on first launch and writes back repaired fields.
writeProfile(profileStorage, profile);
nameInput.value = profile.name;
const playedGame = new PlayedGame();

/** An unfinished game from before a reload, offered until the player resumes or discards it. */
let saved: Game | null = loadSave(storage, highestRung(profile));

/** Add a played game to the profile; a rung counts toward totals only. */
function recordPlayed(game: Game): void {
  const { mode, score, lines } = game.state;
  const id = game.rung === null ? mode.id : null;
  profile = updateProfile(profileStorage, profile, (p) => recordGame(p, id, score, lines));
}

/** Record the session's game, once, when it ends: game over, Quit, Restart or a new Start. */
function endSession(): void {
  if (playedGame.end() && session) recordPlayed(session.game);
}

/** Save the game in progress (on every lock and on pause), or clear the save once it's over. */
function persist(): void {
  if (!session) return;
  writeSave(storage, session.game);
  savedLocks = session.game.locks;
}

/** Save if a piece locked since the last save. */
function persistOnLock(): void {
  if (session && session.game.locks !== savedLocks) {
    playedGame.played();
    persist();
  }
}

/** Board cell edge in canvas (device) pixels; set by fit(). */
let cell = 1;

/**
 * Size both canvases' backing stores to their displayed size × devicePixelRatio and
 * redraw at once (resizing clears a canvas). Game state is untouched.
 */
function fit(): void {
  const dpr = window.devicePixelRatio || 1;
  const box = well.getBoundingClientRect();
  // Leave room for the 1px outline on every side, plus a device pixel for snapping
  // below, so .well never clips it.
  const margin = 2 + 2 / dpr;
  const f = fitBoard(box.width - margin, box.height - margin, COLS, ROWS, dpr);
  cell = f.deviceCell;
  canvas.width = f.pxWidth;
  canvas.height = f.pxHeight;
  canvas.style.width = `${f.cssWidth}px`;
  canvas.style.height = `${f.cssHeight}px`;
  // Centre on whole device pixels so the browser never resamples the board.
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  canvas.style.left = `${snap(box.left + (box.width - f.cssWidth) / 2) - box.left}px`;
  canvas.style.top = `${snap(box.top + (box.height - f.cssHeight) / 2) - box.top}px`;
  const next = nextCanvas.getBoundingClientRect();
  nextCanvas.width = Math.round(next.width * dpr);
  nextCanvas.height = Math.round(next.height * dpr);
  render();
}

/**
 * Refit when the pixel ratio alone changes (moving screens, browser zoom). A small
 * range rather than an exact match, since CSS may round a fractional ratio.
 */
function watchPixelRatio(): void {
  const dpr = window.devicePixelRatio || 1;
  matchMedia(
    `(min-resolution: ${dpr - 0.001}dppx) and (max-resolution: ${dpr + 0.001}dppx)`,
  ).addEventListener(
    'change',
    () => {
      fit();
      watchPixelRatio();
    },
    { once: true },
  );
}

/** Play `game`, ending any game in play; with the 3-2-1 countdown first if `countdown`. */
function begin(game: Game, countdown: boolean): void {
  endSession();
  saved = null;
  result = null;
  rungNow = game.rung === null ? null : rung(game.rung);
  session = new Session(game, performance.now());
  if (countdown) {
    session.pause();
    session.resume(performance.now());
  }
  persist();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** A free game in mode `id` (Classic if unknown). */
function playMode(id: string | undefined, countdown = false): void {
  const mode = (id !== undefined && Object.hasOwn(MODES, id) ? MODES[id] : null) ?? MODES.classic!;
  menuMode = mode.id;
  begin(new Game(mode), countdown);
}

/** Rung `index`, if unlocked, after a countdown that shows its goal. */
function playRung(index: number): void {
  if (!Number.isSafeInteger(index) || index < 1 || index > highestRung(profile)) return;
  begin(startRung(rung(index)), true);
}

/** Continue the game saved before a reload, paused: Resume counts down as usual. */
function resumeSaved(): void {
  if (!saved) return;
  // Another tab may have reset the profile since the offer appeared.
  if (!resumable(saved, highestRung(profile))) {
    discardSaved();
    return;
  }
  if (saved.rung === null) menuMode = saved.state.mode.id;
  rungNow = saved.rung === null ? null : rung(saved.rung);
  result = null;
  session = new Session(saved, performance.now());
  session.pause();
  savedLocks = session.game.locks;
  if (saved.locks > 0) playedGame.played();
  saved = null;
}

function discardSaved(): void {
  if (saved && saved.locks > 0) recordPlayed(saved);
  saved = null;
  clearSave(storage);
}

/** A new game from the pause menu: it gets the 3-2-1 countdown, like Resume. */
function restart(): void {
  if (!session) return;
  const game = session.game;
  if (game.rung === null) playMode(game.state.mode.id, true);
  else playRung(game.rung);
}

/** Drop any gesture or held button in progress. */
function stopInput(): void {
  stopRepeat();
  gestures.cancel();
  touchId = null;
}

/** Leave the game in play: back to the ladder from a rung, else to the main menu. */
function quit(): void {
  const wasRung = rungNow !== null;
  endSession();
  session = null;
  clearSave(storage);
  stopInput();
  if (wasRung) openLadder();
  else screen = 'menu';
}

/** End the game in play once it's decided (rung passed or failed, game over); else save on lock. */
function settle(): void {
  if (!session) return;
  const game = session.game;
  const outcome = rungNow
    ? rungOutcome(rungNow, game.state)
    : game.state.over
      ? 'failed'
      : 'playing';
  if (outcome === 'playing') {
    persistOnLock();
    return;
  }
  if (game.locks !== savedLocks) playedGame.played();
  let stars = 0;
  if (rungNow && outcome === 'passed') {
    const r = rungNow;
    const earned = rungStars(r, game.locks);
    stars = earned;
    profile = updateProfile(profileStorage, profile, (p) => recordRung(p, r.index, earned));
  }
  endSession();
  session = null;
  clearSave(storage);
  stopInput();
  result = { game, outcome, stars };
  screen = 'result';
  resultAt = performance.now();
  showResult();
}

/** Fill the result screen for `result`. */
function showResult(): void {
  if (!result) return;
  const { game, outcome, stars } = result;
  const s = game.state;
  const r = rungNow;
  if (!r) {
    setText('#result-title', 'Game over');
    setText('#result-stars', '');
    setText('#result-detail', `Score ${s.score}`);
  } else if (outcome === 'passed') {
    setText('#result-title', 'Passed');
    setText('#result-stars', starText(stars));
    setText('#result-detail', `Rung ${r.index} · ${game.locks} pieces`);
  } else {
    setText('#result-title', 'Failed');
    setText('#result-stars', '');
    setText('#result-detail', `Rung ${r.index} · ${s.lines} / ${r.goalLines} lines`);
  }
  $('#result-stars').setAttribute('aria-label', `${stars} of 3 stars`);
  $('#result-stars').hidden = stars === 0;
  resultNext.hidden = !r || outcome !== 'passed' || r.index >= MAX_RUNGS;
  resultRetry.textContent = r ? 'Retry' : 'Play again';
  resultBack.textContent = r ? 'Ladder' : 'Menu';
  // After a pass Next leads on; at the last rung, back to the ladder instead.
  resultBack.hidden = r !== null && !resultNext.hidden;
}

/** Show the ladder at the page holding the current rung. */
function openLadder(): void {
  screen = 'ladder';
  rungNow = null;
  result = null;
  ladderTopRow = ladderTop(highestRung(profile));
  renderLadder();
  renderOverlay();
  scrollToCurrent();
}

let currentSeen: IntersectionObserver | null = null;

/** Build the ladder page from ladderTopRow. Current shows while the current rung is out of view. */
function renderLadder(): void {
  const highest = highestRung(profile);
  const page = ladderPage(profile.stars, highest, ladderTopRow);
  ladderTopRow = page.top;
  const items: HTMLElement[] = [];
  const pager = (label: string, top: number): HTMLElement => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pager';
    btn.dataset.top = String(top);
    btn.textContent = label;
    li.append(btn);
    return li;
  };
  if (page.higher) items.push(pager('Higher rungs', page.top + PAGE));
  for (const row of page.rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rung ${row.state}`;
    btn.dataset.rung = String(row.index);
    const name = document.createElement('span');
    name.textContent = `Rung ${row.index}`;
    const stars = document.createElement('span');
    stars.className = 'stars';
    stars.textContent = row.state === 'locked' ? 'Locked' : starText(row.stars);
    btn.append(name, stars);
    const status =
      row.state === 'locked' ? 'locked' : row.stars ? `${row.stars} of 3 stars` : 'not passed';
    btn.setAttribute('aria-label', `Rung ${row.index}, ${status}`);
    btn.disabled = row.state === 'locked';
    if (row.state === 'current') btn.setAttribute('aria-current', 'step');
    li.append(btn);
    items.push(li);
  }
  if (page.lower) items.push(pager('Lower rungs', Math.max(1, page.top - PAGE)));
  rungList.replaceChildren(...items);

  currentSeen?.disconnect();
  const current = rungList.querySelector('.current');
  ladderCurrent.style.visibility = current ? 'hidden' : 'visible';
  if (current) {
    currentSeen = new IntersectionObserver(
      ([e]) => {
        ladderCurrent.style.visibility = e?.isIntersecting ? 'hidden' : 'visible';
      },
      { root: rungList, threshold: 0.5 },
    );
    currentSeen.observe(current);
  }
}

/** Scroll the ladder list so the current rung sits in its middle. */
function scrollToCurrent(): void {
  const current = rungList.querySelector<HTMLElement>('.current');
  if (!current) return;
  rungList.scrollTop = current.offsetTop - (rungList.clientHeight - current.offsetHeight) / 2;
}

/** Pause and drop any gesture or held button in progress. */
function pause(): void {
  if (!session) return;
  session.pause();
  persist();
  stopInput();
}

function drawCell(
  c: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  color: number,
  ox = 0,
  oy = 0,
): void {
  if (y < 0) return;
  const gap = Math.max(1, Math.round(size / 30));
  c.fillStyle = COLORS[color] ?? '#fff';
  c.fillRect(ox + x * size + gap, oy + y * size + gap, size - 2 * gap, size - 2 * gap);
}

/** The next piece, centred in its preview box. */
function renderNext(kind: Kind | null): void {
  const { width, height } = nextCanvas;
  nextCtx.clearRect(0, 0, width, height);
  if (!kind) return;
  const cells = cellsOf(kind, 0);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
  const size = Math.floor(Math.min(width / 4, height / 2));
  const ox = Math.floor((width - w * size) / 2) - minX * size;
  const oy = Math.floor((height - h * size) / 2) - minY * size;
  for (const [x, y] of cells) drawCell(nextCtx, size, x, y, colorIndex(kind), ox, oy);
}

/** Show a menu, handing keyboard focus to `first`, or hide it and take focus back. */
function showMenu(menu: HTMLElement, show: boolean, first: HTMLElement): void {
  if (menu.hidden !== show) return;
  menu.hidden = !show;
  // Pausing to type a name leaves the focus in the name field.
  if (show && document.activeElement !== nameInput) first.focus({ preventScroll: true });
  else if (menu.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

/**
 * Show what covers the board: with no game in play the resume offer (answered first, as
 * a new game would overwrite it) or the menu, ladder or result screen; in play the pause
 * menu or countdown, with a rung's goal.
 */
function renderOverlay(): void {
  const phase = session?.phase ?? 'running';
  const offer = !session && saved !== null;
  const idle = !session && !offer;
  const shown = !session || phase !== 'running';
  if (overlay.hidden === shown) overlay.hidden = !shown;
  // The result leaves the final board in sight.
  overlay.classList.toggle('see-through', idle && screen === 'result');
  showMenu(resumePrompt, offer, resumeSavedBtn);
  showMenu(pauseMenu, phase === 'paused', resumeBtn);
  showMenu(mainMenu, idle && screen === 'menu', ladderBtn);
  showMenu(
    ladderPanel,
    idle && screen === 'ladder',
    rungList.querySelector<HTMLElement>('.current') ?? ladderBack,
  );
  showMenu(resultPanel, idle && screen === 'result', resultNext.hidden ? resultRetry : resultNext);
  setText('#countdown', phase === 'countdown' ? String(session!.countdown(performance.now())) : '');
  const r = session && phase !== 'running' ? rungNow : null;
  setText(
    '#goal-text',
    r ? `Rung ${r.index}: clear ${r.goalLines} lines · ★★★ within ${r.stars.three} pieces` : '',
  );
}

/** Set `hidden` only when it changes. */
function setHidden(id: string, hidden: boolean): void {
  const el = $(id);
  if (el.hidden !== hidden) el.hidden = hidden;
}

function render(): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderOverlay();
  // The game in play, or the finished one under its result.
  const game = session?.game ?? (screen === 'result' ? result?.game : null) ?? null;
  const r = game ? rungNow : null;
  setHidden('#best-row', r !== null);
  setHidden('#rung-row', r === null);
  setHidden('#goal-row', r === null);
  if (r) {
    setText('#rung', String(r.index));
    setText('#goal', `${Math.min(game!.state.lines, r.goalLines)} / ${r.goalLines}`);
  }
  const modeId = game?.state.mode.id ?? menuMode;
  // The game in progress shows as Best as soon as it beats the record.
  const best = Math.max(profile.best[modeId]?.score ?? 0, game?.state.score ?? 0);
  setText('#best', String(best));
  if (!game) {
    renderNext(null);
    setText('#score', '0');
    setText('#lines', '0');
    setText('#level', '1');
    setText('#pause', 'Pause');
    setText('#status', '');
    return;
  }
  const s = game.state;
  const phase = session?.phase ?? 'running';
  setText('#score', String(s.score));
  setText('#lines', String(s.lines));
  setText('#level', String(s.level));
  setText('#pause', phase === 'paused' ? 'Resume' : 'Pause');
  // No planning while paused: the board and next piece stay hidden until play resumes.
  if (phase !== 'running') {
    renderNext(null);
    setText('#status', phase === 'paused' ? 'Paused' : 'Get ready');
    return;
  }
  s.board.forEach((row, y) => row.forEach((c, x) => c && drawCell(ctx, cell, x, y, c)));
  const live = session !== null && !s.over;
  if (live) {
    for (const [cx, cy] of cellsOf(s.piece.kind, s.piece.rot)) {
      drawCell(ctx, cell, s.piece.x + cx, s.piece.y + cy, colorIndex(s.piece.kind));
    }
  }
  renderNext(live ? s.next : null);
  if (!session) setText('#status', $('#result-title').textContent ?? '');
  else setText('#status', r ? `Rung ${r.index}` : s.mode.name);
}

function loop(now: number): void {
  session?.tick(now);
  settle();
  render();
  requestAnimationFrame(loop);
}

const gestures = new GestureTracker();

/** Apply one player action, whatever its source. */
function act(action: Action): void {
  if (!session || session.game.state.over) return;
  if (action === 'pause') {
    if (session.phase === 'paused') session.resume(performance.now());
    else pause();
    return;
  }
  session.act(action, performance.now());
  settle();
}

document.addEventListener('keydown', (e) => {
  // Typing a name is not playing: its keys stay in the field.
  if (e.target === nameInput) return;
  if (!session || session.game.state.over) {
    // A key held through the end of a game must not repeat onto the result's buttons.
    if (e.repeat) e.preventDefault();
    return;
  }
  const { action, preventDefault } = keyAction(
    e.key,
    session.phase,
    e.repeat,
    e.ctrlKey || e.metaKey || e.altKey,
  );
  if (action) act(action);
  if (preventDefault) e.preventDefault();
});

onLeaveScreen(document, window, pause);

resumeBtn.addEventListener('click', () => session?.resume(performance.now()));
document.querySelector('#restart')!.addEventListener('click', restart);
document.querySelector('#quit')!.addEventListener('click', quit);
resumeSavedBtn.addEventListener('click', resumeSaved);
document.querySelector('#discard-saved')!.addEventListener('click', discardSaved);
ladderBtn.addEventListener('click', openLadder);
for (const btn of mainMenu.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
  btn.addEventListener('click', () => playMode(btn.dataset.mode));
}
ladderBack.addEventListener('click', () => {
  screen = 'menu';
});
ladderCurrent.addEventListener('click', () => {
  ladderTopRow = ladderTop(highestRung(profile));
  renderLadder();
  scrollToCurrent();
  rungList.querySelector<HTMLElement>('.current')?.focus({ preventScroll: true });
});
rungList.addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('button') : null;
  if (!btn || btn.disabled) return;
  if (btn.dataset.rung) {
    playRung(Number(btn.dataset.rung));
    return;
  }
  const up = Number(btn.dataset.top) > ladderTopRow;
  ladderTopRow = Number(btn.dataset.top);
  renderLadder();
  // Paging up lands next to the rungs just left, at the bottom; paging down at the top.
  rungList.scrollTop = up ? rungList.scrollHeight : 0;
  // Focus stays at the same end of the list as the scroll.
  const pagers = rungList.querySelectorAll<HTMLElement>('.pager');
  pagers[up ? pagers.length - 1 : 0]?.focus({ preventScroll: true });
});
/** A result button pressed too soon after the game ended: a hard drop tapped twice, say. */
const tooSoon = (): boolean => performance.now() - resultAt < RESULT_GUARD_MS;
resultNext.addEventListener('click', () => {
  if (rungNow && !tooSoon()) playRung(rungNow.index + 1);
});
resultRetry.addEventListener('click', () => {
  if (tooSoon()) return;
  if (rungNow) playRung(rungNow.index);
  else playMode(result?.game.state.mode.id);
});
resultBack.addEventListener('click', () => {
  if (tooSoon()) return;
  if (rungNow) openLadder();
  else screen = 'menu';
});

// Board gestures follow the primary pointer only; extra fingers are ignored. A new
// primary pointer means every earlier one has lifted, so it always starts afresh.
let touchId: number | null = null;
well.addEventListener('pointerdown', (e) => {
  // A mouse acts with its main button only, so right or middle clicks do nothing.
  // While paused the overlay's buttons take the touch instead.
  if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (session?.phase !== 'running') return;
  touchId = e.pointerId;
  gestures.down(e.clientX, e.clientY, e.timeStamp, cell / (window.devicePixelRatio || 1));
  e.preventDefault();
  try {
    well.setPointerCapture(e.pointerId);
  } catch {
    // Pointer already gone; its up or cancel ends the gesture.
  }
});
well.addEventListener('pointermove', (e) => {
  if (e.pointerId !== touchId) return;
  for (const a of gestures.move(e.clientX, e.clientY, e.timeStamp)) act(a);
});
well.addEventListener('pointerup', (e) => {
  if (e.pointerId !== touchId) return;
  touchId = null;
  for (const a of gestures.up(e.clientX, e.clientY, e.timeStamp)) act(a);
});
well.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== touchId) return;
  touchId = null;
  gestures.cancel();
});
well.addEventListener('contextmenu', (e) => e.preventDefault());

// On-screen buttons act on press, not release. preventDefault keeps focus off them,
// so Space can't also click one; tabindex="-1" keeps them out of the Tab order.
// A click with no pointer (detail 0) is assistive tech activating the button.
// Move and soft drop repeat while held, like a held key. One repeat at a time: the
// latest repeating press owns it, and only that pointer's release stops it, so
// rotate or hard drop can be tapped mid-slide.
const REPEAT_DELAY_MS = 170;
const REPEAT_MS = 50;
const REPEATS: ReadonlySet<Action> = new Set(['left', 'right', 'softDrop']);
let repeatTimer: ReturnType<typeof setTimeout> | undefined;
let repeatPointer: number | null = null;
function stopRepeat(): void {
  clearTimeout(repeatTimer);
  repeatTimer = undefined;
  repeatPointer = null;
}
function repeat(action: Action, delay: number): void {
  repeatTimer = setTimeout(() => {
    if (!session || session.phase !== 'running' || session.game.state.over) {
      stopRepeat();
      return;
    }
    act(action);
    repeat(action, REPEAT_MS);
  }, delay);
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
  const action = btn.dataset.action;
  if (!isAction(action)) continue;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    act(action);
    if (REPEATS.has(action)) {
      stopRepeat();
      repeatPointer = e.pointerId;
      repeat(action, REPEAT_DELAY_MS);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    btn.addEventListener(type, (e) => {
      if (e.pointerId === repeatPointer) stopRepeat();
    });
  }
  btn.addEventListener('click', (e) => {
    if (e.detail === 0) act(action);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// touch-action: none (page.css) stops pinch zoom elsewhere; Safari zooms through its own gesture events.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const resizes = new ResizeObserver(fit);
resizes.observe(well);
resizes.observe(nextCanvas);
watchPixelRatio();
fit();

// The cleaned name goes back into the field (value is text, never markup).
nameInput.addEventListener('change', () => {
  profile = updateProfile(profileStorage, profile, (p) => rename(p, nameInput.value));
  nameInput.value = profile.name;
});
nameInput.addEventListener('keydown', (e) => {
  // Escape cancels the edit; Enter commits it (blur fires change).
  if (e.key === 'Escape') nameInput.value = profile.name;
  if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
});
// Pieces don't fall while the player types.
nameInput.addEventListener('focus', () => {
  if (session?.phase === 'running' && !session.game.state.over) pause();
});
// Another tab changed the profile: show its records and name.
window.addEventListener('storage', (e) => {
  if (e.key !== PROFILE_KEY || !loaded.stored) return;
  const fresh = loadProfile(storage);
  if (!fresh.stored) return;
  profile = fresh.profile;
  if (document.activeElement !== nameInput) nameInput.value = profile.name;
  if (!session && screen === 'ladder') renderLadder();
});
requestAnimationFrame(loop);
