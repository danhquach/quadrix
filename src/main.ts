import { COLS, Game, ROWS } from './core/game.ts';
import { MODES } from './core/modes/index.ts';
import { Session } from './core/session.ts';
import { cellsOf, colorIndex, type Kind } from './core/pieces.ts';
import { recordGame, rename } from './core/profile.ts';
import { fitBoard } from './ui/fit.ts';
import { GestureTracker, isAction, type Action } from './ui/gestures.ts';
import { keyAction } from './ui/keys.ts';
import { onLeaveScreen } from './ui/lifecycle.ts';
import { PlayedGame, hasLocked } from './ui/played.ts';
import { PROFILE_KEY, loadProfile, updateProfile, writeProfile } from './ui/profile.ts';
import { clearSave, loadSave, writeSave } from './ui/save.ts';

const COLORS = ['#000', '#0ff', '#ff0', '#a0f', '#0f0', '#f00', '#00f', '#f80'];

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const well = document.querySelector<HTMLElement>('.well')!;
const nextCanvas = document.querySelector<HTMLCanvasElement>('#next')!;
const nextCtx = nextCanvas.getContext('2d')!;
const modeSelect = document.querySelector<HTMLSelectElement>('#mode')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const pauseMenu = document.querySelector<HTMLElement>('#pause-menu')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume')!;
const resumePrompt = document.querySelector<HTMLElement>('#resume-prompt')!;
const resumeSavedBtn = document.querySelector<HTMLButtonElement>('#resume-saved')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const $ = (id: string) => document.querySelector<HTMLElement>(id)!;

/** Write text only when it changes, so the status live region is not re-announced every frame. */
function setText(id: string, text: string): void {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

let session: Session | null = null;
/** Reading `localStorage` itself throws where storage is blocked; save.ts catches that. */
const storage = () => window.localStorage;
/** An unfinished game from before a reload, offered until the player resumes or discards it. */
let saved: Game | null = loadSave(storage);
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

/** Add a played game to the profile. */
function recordPlayed(game: Game): void {
  const { mode, score, lines } = game.state;
  profile = updateProfile(profileStorage, profile, (p) => recordGame(p, mode.id, score, lines));
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

function start(): void {
  const mode = MODES[modeSelect.value] ?? MODES.classic!;
  endSession();
  saved = null;
  session = new Session(new Game(mode), performance.now());
  persist();
  setText('#status', mode.name);
  startBtn.blur();
}

/** Continue the game saved before a reload, paused: Resume counts down as usual. */
function resumeSaved(): void {
  if (!saved) return;
  modeSelect.value = saved.state.mode.id;
  session = new Session(saved, performance.now());
  session.pause();
  savedLocks = session.game.locks;
  if (hasLocked(saved.state)) playedGame.played();
  saved = null;
}

function discardSaved(): void {
  if (saved && hasLocked(saved.state)) recordPlayed(saved);
  saved = null;
  clearSave(storage);
  startBtn.disabled = false;
  startBtn.focus();
}

/** A new game from the pause menu: it gets the 3-2-1 countdown, like Resume. */
function restart(): void {
  start();
  session!.pause();
  session!.resume(performance.now());
}

/** Back to the title state: no game. */
function quit(): void {
  endSession();
  session = null;
  clearSave(storage);
  stopRepeat();
  gestures.cancel();
  setText('#status', '');
  startBtn.focus();
}

/** Pause and drop any gesture or held button in progress. */
function pause(): void {
  if (!session) return;
  session.pause();
  persist();
  stopRepeat();
  gestures.cancel();
  touchId = null;
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
  if (show && document.activeElement !== nameInput) first.focus();
  else if (menu.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

/** Show the resume offer, the pause menu or the countdown over the board, or none. */
function renderOverlay(): void {
  const phase = session?.phase ?? 'running';
  const offer = !session && saved !== null;
  const shown = offer || phase !== 'running';
  if (overlay.hidden === shown) overlay.hidden = !shown;
  // Start would overwrite the offered game, so the player answers the offer first.
  if (startBtn.disabled !== offer) startBtn.disabled = offer;
  showMenu(resumePrompt, offer, resumeSavedBtn);
  showMenu(pauseMenu, phase === 'paused', resumeBtn);
  setText('#countdown', phase === 'countdown' ? String(session!.countdown(performance.now())) : '');
}

function render(): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderOverlay();
  const modeId = session?.game.state.mode.id ?? modeSelect.value;
  // The game in progress shows as Best as soon as it beats the record.
  const best = Math.max(profile.best[modeId]?.score ?? 0, session?.game.state.score ?? 0);
  setText('#best', String(best));
  if (!session) {
    renderNext(null);
    setText('#score', '0');
    setText('#lines', '0');
    setText('#level', '1');
    setText('#pause', 'Pause');
    return;
  }
  const s = session.game.state;
  const phase = session.phase;
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
  if (!s.over) {
    for (const [cx, cy] of cellsOf(s.piece.kind, s.piece.rot)) {
      drawCell(ctx, cell, s.piece.x + cx, s.piece.y + cy, colorIndex(s.piece.kind));
    }
  }
  renderNext(s.over ? null : s.next);
  setText('#status', s.over ? 'Game over' : s.mode.name);
}

function loop(now: number): void {
  session?.tick(now);
  persistOnLock();
  if (session?.game.state.over) endSession();
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
  persistOnLock();
}

document.addEventListener('keydown', (e) => {
  // Typing a name is not playing: its keys stay in the field.
  if (e.target === nameInput) return;
  if (!session || session.game.state.over) return;
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

startBtn.addEventListener('click', start);
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
});
requestAnimationFrame(loop);
