import { SoundOut } from './ui/audio.ts';
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
import { KINDS, cellsOf, colorIndex, type Kind } from './core/pieces.ts';
import { highestRung, recordGame, recordRung, rename } from './core/profile.ts';
import { CLOUD_KEY, CloudSync, cloudConfig, formatCode, type CloudStatus } from './ui/cloud.ts';
import { Effects } from './ui/effects.ts';
import { Danger, HudCount, drawGlow, feedback, inDanger, type Span } from './ui/feedback.ts';
import { fitBoard } from './ui/fit.ts';
import { Motion } from './ui/motion.ts';
import { Ambient, Shake, drawBlockGlow, rng, vfx } from './ui/vfx.ts';
import { ACTIONS, GestureTracker, isAction, type Action } from './ui/gestures.ts';
import { Guide, guideRows, isGuideKey, loadGuideClosed, writeGuideClosed } from './ui/guide.ts';
import { isMuteKey, keyAction, keyLabel } from './ui/keys.ts';
import { PAGE, ladderPage, ladderTop, starText } from './ui/ladder.ts';
import { onLeaveScreen } from './ui/lifecycle.ts';
import { PlayedGame } from './ui/played.ts';
import { KeyRepeat, heldMove } from './ui/repeat.ts';
import { PROFILE_KEY, loadProfile, updateProfile, writeProfile } from './ui/profile.ts';
import { clearSave, loadSave, resumable, writeSave } from './ui/save.ts';
import {
  ACTION_NAMES,
  DELAY_RANGE,
  INTERVAL_RANGE,
  SETTINGS_KEY,
  VOLUME_RANGE,
  bindKey,
  defaultSettings,
  ghostOpacityIn,
  inRange,
  isEffectsLevel,
  loadSettings,
  repeatTiming,
  writeSettings,
  type Settings,
} from './ui/settings.ts';
import {
  MARKS,
  PIECE_STYLES,
  PIECE_STYLE_NAMES,
  PIECE_VARS,
  blockColors,
  drawBlock,
  isPieceStyle,
  type PieceStyle,
} from './ui/skin.ts';
import { cuesFor, musicOn, type GameView } from './ui/sound.ts';

// Colors are defined once, as CSS variables in page.css; the canvases read them here.
const theme = getComputedStyle(document.documentElement);
const cssColor = (name: string) => theme.getPropertyValue(name).trim();
/** Block colors by board cell value (KINDS index + 1); 0 is empty. */
const BLOCKS = PIECE_VARS.map((v) => blockColors(cssColor(v)));
/** Base piece colors by board cell value - 1, for particles and the block glow. */
const PIECES = PIECE_VARS.map((v) => cssColor(v) || '#888');
const WELL_BG = cssColor('--well-bg') || '#000';
const GRID = cssColor('--grid') || '#222';
/** Every block of a stack that topped out, once the game-over sweep reaches it. */
const GREY = blockColors(cssColor('--stack-over') || '#5d6275');
/** The edge glow while the stack is near the top. */
const DANGER = cssColor('--danger') || '#ff4d5e';

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
const openCloudBtn = document.querySelector<HTMLButtonElement>('#open-cloud')!;
const cloudPanel = document.querySelector<HTMLElement>('#cloud')!;
const cloudOnBtn = document.querySelector<HTMLButtonElement>('#cloud-on')!;
const cloudLinkBtn = document.querySelector<HTMLButtonElement>('#cloud-link')!;
const cloudOffBtn = document.querySelector<HTMLButtonElement>('#cloud-off')!;
const cloudBackBtn = document.querySelector<HTMLButtonElement>('#cloud-back')!;
const linkInput = document.querySelector<HTMLInputElement>('#link-input')!;
const linkSubmit = document.querySelector<HTMLButtonElement>('#link-submit')!;
const guidePanel = document.querySelector<HTMLElement>('#guide')!;
const guideToggle = document.querySelector<HTMLButtonElement>('#guide-toggle')!;
const awardText = document.querySelector<HTMLElement>('#award')!;
const openSettingsBtn = document.querySelector<HTMLButtonElement>('#open-settings')!;
const settingsPanel = document.querySelector<HTMLElement>('#settings')!;
const ghostInput = document.querySelector<HTMLInputElement>('#set-ghost')!;
const ghostOpacityInput = document.querySelector<HTMLInputElement>('#set-ghost-opacity')!;
const effectsInput = document.querySelector<HTMLSelectElement>('#set-effects')!;
const delayInput = document.querySelector<HTMLInputElement>('#set-delay')!;
const intervalInput = document.querySelector<HTMLInputElement>('#set-interval')!;
const sfxInput = document.querySelector<HTMLInputElement>('#set-sfx')!;
const musicInput = document.querySelector<HTMLInputElement>('#set-music')!;
const muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;
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
/** Whether the result screen has yet to make its entrance: once, not again after Settings. */
let resultFresh = false;
/** When the result screen appeared (performance.now()). */
let resultAt = 0;
/** Taps and keys this soon after a game ends are the game's, not the result's buttons. */
const RESULT_GUARD_MS = 400;
/** What shows over the board when no game is in play. */
let screen: 'menu' | 'ladder' | 'result' | 'cloud' = 'menu';
/** The free mode last chosen, whose Best shows in the menus. */
let menuMode = 'classic';
/** The top row's rung on the ladder screen. */
let ladderTopRow = 1;
/** Reading `localStorage` itself throws where storage is blocked; save.ts catches that. */
const storage = () => window.localStorage;
/** The game's lock count at its last save. */
let savedLocks = 0;
/** Whether the system asks for reduced motion: Effects then start Reduced. */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The player's options, applied at once and stored on every change. */
let settings: Settings = loadSettings(storage, reducedMotion());
/** Effects over the board, fed by the game's events; presentation only. */
const fx = new Effects(settings.effects);
/** How the board moves between game states: slides, drops, squash and the game-over grey. */
const motion = new Motion(settings.effects);
/** The HUD score's count-up and the Lines and Level pulses. */
const hud = new HudCount(settings.effects);
/** The edge glow while any locked cell is near the top. */
const danger = new Danger(settings.effects);
/** The falling piece's columns, which score popups keep clear of; null with none in play. */
function pieceSpan(): Span | null {
  const game = session?.game;
  if (!game || game.state.over) return null;
  const p = game.state.piece;
  const xs = cellsOf(p.kind, p.rot).map(([x]) => p.x + x);
  return [Math.min(...xs), Math.max(...xs) + 1];
}
// Lock flashes, score popups and the level-up light and banner.
fx.use(
  feedback(
    {
      font: cssColor('--font-display') || 'sans-serif',
      text: cssColor('--accent') || '#ffd166',
      outline: WELL_BG,
      flash: cssColor('--text') || '#fff',
      light: cssColor('--accent') || '#ffd166',
    },
    pieceSpan,
  ),
);
/** The quad and full-clear board shake. */
const shake = new Shake(settings.effects);
/** The living well background: gradient, drifting motes, pulse on clears, hue per level. */
const ambient = new Ambient(settings.effects);
// Row breaks, the shockwave, drop streak and dust, combo sparks; shakes and pulses.
fx.use(
  vfx(
    {
      pieces: PIECES,
      flash: cssColor('--text') || '#fff',
      light: cssColor('--accent') || '#ffd166',
      dust: cssColor('--muted') || '#a3a9c2',
    },
    shake,
    ambient,
    rng(0x5eed),
  ),
);
/** The previous frame's time, for the effects clock. */
let lastFrame: number | null = null;
/** Settings covers the board, over whatever else shows; a game in play stays paused under it. */
let settingsOpen = false;
/** The action whose key Settings is waiting for, or null. */
let binding: Action | null = null;

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

/** Show a profile changed elsewhere (another tab, a cloud merge): name and ladder. */
function showProfile(): void {
  if (document.activeElement !== nameInput) nameInput.value = profile.name;
  if (!session && screen === 'ladder') renderLadder();
}

/**
 * Cloud save, when the build has a project and the profile is stored here (tokens and
 * merges need storage). Syncs never block play: failures show in the status and retry.
 */
const config = cloudConfig(import.meta.env);
const cloud =
  config && loaded.stored
    ? new CloudSync(config, {
        storage,
        fetch: (input, init) => window.fetch(input, init),
        profile: () => {
          const fresh = loadProfile(storage);
          return fresh.stored ? fresh.profile : null;
        },
        update: (change) => {
          profile = updateProfile(profileStorage, profile, change);
          showProfile();
        },
        now: () => Date.now(),
        locks: navigator.locks ?? null,
        onStatus: () => renderCloud(),
      })
    : null;
openCloudBtn.hidden = !cloud;

/** An unfinished game from before a reload, offered until the player resumes or discards it. */
let saved: Game | null = loadSave(storage, highestRung(profile));

/** Add a played game to the profile; a rung counts toward totals only. */
function recordPlayed(game: Game): void {
  const { mode, score, lines } = game.state;
  const id = game.rung === null ? mode.id : null;
  profile = updateProfile(profileStorage, profile, (p) => recordGame(p, id, score, lines));
  // A passed rung is recorded just before this, so one sync carries both.
  void cloud?.sync();
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
  // Leave room for the frame (page.css) on every side, plus a device pixel for snapping
  // below, so .well never clips it.
  const frame = parseFloat(getComputedStyle(canvas).outlineWidth) || 0;
  const margin = 2 * frame + 2 / dpr;
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
  // Inside the box's border, which the backing store doesn't cover.
  nextCanvas.width = Math.round(nextCanvas.clientWidth * dpr);
  nextCanvas.height = Math.round(nextCanvas.clientHeight * dpr);
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
  fx.clear();
  motion.clear();
  shake.clear();
  ambient.clear();
  session = new Session(game, performance.now());
  if (countdown) {
    session.pause();
    session.resume(performance.now());
  }
  persist();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  guide.start();
  renderGuide();
  // The board and HUD slide and fade in (page.css times it by the Effects setting).
  replay(canvas, 'enter');
  replay($('.hud'), 'enter');
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
  fx.clear();
  motion.clear();
  shake.clear();
  ambient.clear();
  session = new Session(saved, performance.now());
  session.pause();
  savedLocks = session.game.locks;
  if (saved.locks > 0) playedGame.played();
  saved = null;
  guide.start();
  renderGuide();
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
  // First, while the game is still in play: a game that just ended plays its last events.
  const events = session.game.takeEvents();
  fx.handle(events);
  motion.observe(session.game, events);
  showAward();
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
  resultFresh = true;
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
  // Now, not on the next frame: a hidden tab gets no frames, but its audio plays on.
  sound.music(false);
}

function drawCell(
  c: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  color: number,
  ox = 0,
  oy = 0,
  grey = false,
): void {
  const colors = grey ? GREY : BLOCKS[color - 1];
  const kind = KINDS[color - 1];
  if (y < 0 || !colors || !kind) return;
  drawBlock(c, ox + x * size, oy + y * size, size, colors, MARKS[kind], settings.pieceStyle);
}

/** The empty well: background, its ambient light and faint grid lines on the cell edges. */
function drawWell(): void {
  ctx.fillStyle = WELL_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ambient.draw(ctx, cell);
  ctx.fillStyle = GRID;
  for (let x = 1; x < COLS; x++) ctx.fillRect(x * cell, 0, 1, canvas.height);
  for (let y = 1; y < ROWS; y++) ctx.fillRect(0, y * cell, canvas.width, 1);
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
  // Room for a 4×2 piece plus a margin all round.
  const size = Math.floor(Math.min(width / 5, height / 3));
  const ox = Math.floor((width - w * size) / 2) - minX * size;
  const oy = Math.floor((height - h * size) / 2) - minY * size;
  for (const [x, y] of cells) drawCell(nextCtx, size, x, y, colorIndex(kind), ox, oy);
}

/** Show a menu, handing keyboard focus to `first`, or hide it and take focus back. */
function showMenu(menu: HTMLElement, show: boolean, first: HTMLElement): void {
  if (menu.hidden !== show) return;
  menu.hidden = !show;
  // A leaving panel still shows while it fades: inert, it can't take focus or clicks.
  menu.inert = !show;
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
  // The result waits for the game-over grey to sweep the stack, then fades in.
  const settling = idle && screen === 'result' && motion.greying();
  const shown = (!session && !settling) || phase !== 'running' || settingsOpen;
  if (overlay.hidden === shown) overlay.hidden = overlay.inert = !shown;
  showMenu(settingsPanel, settingsOpen, ghostInput);
  // The other panels wait under Settings until it closes.
  const under = !settingsOpen;
  // The result leaves the final board in sight.
  overlay.classList.toggle('see-through', idle && screen === 'result' && !settingsOpen);
  if (settingsOpen) resultFresh = false;
  overlay.classList.toggle('enter', resultFresh && idle && screen === 'result' && !settling);
  showMenu(resumePrompt, under && offer, resumeSavedBtn);
  showMenu(pauseMenu, under && phase === 'paused', resumeBtn);
  showMenu(mainMenu, under && idle && screen === 'menu', ladderBtn);
  showMenu(
    ladderPanel,
    under && idle && screen === 'ladder',
    rungList.querySelector<HTMLElement>('.current') ?? ladderBack,
  );
  showMenu(
    resultPanel,
    under && idle && screen === 'result' && !settling,
    resultNext.hidden ? resultRetry : resultNext,
  );
  showMenu(
    cloudPanel,
    under && idle && screen === 'cloud',
    cloudOnBtn.hidden ? cloudLinkBtn : cloudOnBtn,
  );
  setText('#countdown', phase === 'countdown' ? String(session!.countdown(performance.now())) : '');
  const r = session && phase !== 'running' && !settingsOpen ? rungNow : null;
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
  // The game in play, or the finished one under its result.
  const game = session?.game ?? (screen === 'result' ? result?.game : null) ?? null;
  ambient.setLevel(game?.state.level ?? 1);
  drawWell();
  renderOverlay();
  shakeBoard();
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
    danger.set(false);
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
  const live = session !== null && !s.over;
  danger.set(live && inDanger(s.board));
  const changed = hud.observe(game);
  setText('#score', String(hud.score));
  setText('#lines', String(s.lines));
  setText('#level', String(s.level));
  if (changed.lines) pulse('#lines');
  if (changed.level) pulse('#level');
  setText('#pause', phase === 'paused' ? 'Resume' : 'Pause');
  // No planning while paused: the overlay covers the board (it is drawn under it, so the
  // pause blurs it away and the resume reveals it) and the next piece stays hidden.
  const still = phase !== 'running';
  fx.draw(ctx, 'background', cell);
  if (settings.effects === 'full') {
    const shift = (y: number) => Math.round(motion.rowShift(y) * cell);
    drawBlockGlow(ctx, cell, s.board, PIECES, shift, (y) => motion.greyed(y));
  }
  drawStack(s.board);
  fx.draw(ctx, 'board', cell);
  if (live) drawPiece(game);
  fx.draw(ctx, 'effects', cell);
  drawGlow(ctx, cell, danger.alpha, DANGER);
  renderNext(live && !still ? s.next : null);
  if (still) setText('#status', phase === 'paused' ? 'Paused' : 'Get ready');
  else if (!session) setText('#status', $('#result-title').textContent ?? '');
  else setText('#status', r ? `Rung ${r.index}` : s.mode.name);
}

/**
 * Move the board by the shake's offset; CSS pixels, so it is the same on every screen.
 * A pause or countdown shows the board still.
 */
function shakeBoard(): void {
  const [x, y] = session && session.phase !== 'running' ? [0, 0] : shake.offset();
  const t = x || y ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` : '';
  if (canvas.style.transform !== t) canvas.style.transform = t;
}

/** The locked blocks, as the motion has them: dropping after a clear, squashed, greyed. */
function drawStack(board: readonly (readonly number[])[]): void {
  for (const { y, colors } of motion.held())
    colors.forEach((c, x) => c && drawCell(ctx, cell, x, y, c));
  board.forEach((row, y) => {
    const oy = Math.round(motion.rowShift(y) * cell);
    const grey = motion.greyed(y);
    row.forEach((c, x) => c && !motion.hides(x, y) && drawCell(ctx, cell, x, y, c, 0, oy, grey));
  });
  const squash = motion.squashed();
  if (!squash) return;
  const xs = squash.cells.map(([x]) => x);
  const ys = squash.cells.map(([, y]) => y);
  // Scaled about the bottom centre of the piece, where it hit.
  const px = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cell;
  const py = (Math.max(...ys) + 1) * cell;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(squash.sx, squash.sy);
  ctx.translate(-px, -py);
  for (const [x, y] of squash.cells) drawCell(ctx, cell, x, y, colorIndex(squash.kind));
  ctx.restore();
}

/** The falling piece and its ghost, sliding and fading in as the motion has them. */
function drawPiece(game: Game): void {
  const p = game.state.piece;
  const color = colorIndex(p.kind);
  const cells = cellsOf(p.kind, p.rot);
  const look = motion.piece();
  const dx = Math.round(look.dx * cell);
  const dy = Math.round(look.dy * cell);
  // The ghost goes under the piece; a resting piece covers it, so skip it there. It
  // marks where the piece lands now, so for the moment the stack drops after a clear it
  // may sit inside the rows still dropping.
  const ghost = game.ghost();
  if (settings.ghost && ghost.y !== p.y) {
    const g = motion.ghost(settings.ghostOpacity / 100);
    ctx.globalAlpha = g.alpha;
    const gx = Math.round(g.dx * cell);
    for (const [cx, cy] of cells) drawCell(ctx, cell, ghost.x + cx, ghost.y + cy, color, gx);
  }
  ctx.globalAlpha = look.alpha;
  ctx.save();
  if (look.scale !== 1) {
    // Scaled about the centre of the piece's cells.
    const xs = cells.map(([x]) => p.x + x);
    const ys = cells.map(([, y]) => p.y + y);
    const px = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cell + dx;
    const py = ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * cell + dy;
    ctx.translate(px, py);
    ctx.scale(look.scale, look.scale);
    ctx.translate(-px, -py);
  }
  for (const [cx, cy] of cells) drawCell(ctx, cell, p.x + cx, p.y + cy, color, dx, dy);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Restart `el`'s CSS animation `name`, even when it is already playing. */
function replay(el: HTMLElement, name: string): void {
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
}

/** Replay a HUD number's pulse. */
function pulse(id: string): void {
  replay($(id), 'pulse');
}

/** The game and lock count whose award last showed, so each lock shows once. */
let awardGame: Game | null = null;
let awardLocks = 0;

/**
 * Tell screen readers what the last lock scored ("Quad", "Combo 2"), once per lock. The
 * board shows it as a popup (src/ui/feedback.ts).
 */
function showAward(): void {
  const game = session?.game;
  if (!game) return;
  const fresh = game === awardGame && game.locks !== awardLocks;
  awardGame = game;
  awardLocks = game.locks;
  const labels = game.award?.labels ?? [];
  if (!fresh || labels.length === 0) return;
  awardText.textContent = labels.join('\n');
}

const sound = new SoundOut();
/** The game as the last frame left it, for its sounds. */
let heard: GameView | null = null;

/** Play what this frame's moves, locks and clears sound like, and run the music with the game. */
function playSounds(): void {
  const game = session?.game;
  const view: GameView | null = game
    ? {
        game,
        locks: game.locks,
        lines: game.state.lines,
        level: game.state.level,
        over: game.state.over,
        x: game.state.piece.x,
        rot: game.state.piece.rot,
      }
    : null;
  if (view) for (const cue of cuesFor(heard, view)) sound.play(cue);
  heard = view;
  sound.music(musicOn(settings.muted, session?.phase ?? null, game?.state.over ?? true));
}

// Browsers allow sound only after the player's first click, tap or key press.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
  document.addEventListener(type, () => sound.unlock(), { capture: true });
}

function loop(now: number): void {
  session?.tick(now);
  const running = session?.phase === 'running' && !session.game.state.over;
  for (const move of keyRepeat.tick(now, running)) act(move);
  // Settle hands this frame's events to the effects, so they start this frame.
  settle();
  // A pause or countdown freezes every effect where it is.
  const frozen = session !== null && session.phase !== 'running';
  fx.frame(now - (lastFrame ?? now), frozen);
  motion.frame(now - (lastFrame ?? now), frozen);
  hud.frame(now - (lastFrame ?? now), frozen);
  danger.frame(now - (lastFrame ?? now), frozen);
  shake.frame(now - (lastFrame ?? now), frozen);
  ambient.frame(now - (lastFrame ?? now), frozen);
  lastFrame = now;
  playSounds();
  render();
  requestAnimationFrame(loop);
}

const gestures = new GestureTracker();
/** Held ← → ↓ keys, repeated on the game's own timing. */
const keyRepeat = new KeyRepeat(repeatTiming(settings));

/** Apply one player action, whatever its source. */
function act(action: Action): void {
  // Under Settings the game stays paused: the Pause button and pad don't reach it.
  if (!session || session.game.state.over || settingsOpen) return;
  if (action === 'pause') {
    if (session.phase === 'paused') session.resume(performance.now());
    else pause();
    return;
  }
  session.act(action, performance.now());
  settle();
}

document.addEventListener('keydown', (e) => {
  // Typing a name or link code is not playing: its keys stay in the field.
  if (e.target === nameInput || e.target === linkInput) return;
  guide.keyboardSeen();
  // M mutes or unmutes at any time, unless Settings is waiting for a key to bind.
  if (!binding && isMuteKey(e.key, e.ctrlKey || e.metaKey || e.altKey)) {
    e.preventDefault();
    if (!e.repeat) toggleMute();
    return;
  }
  if (settingsOpen) {
    settingsKey(e);
    return;
  }
  // Esc on the title screen opens Settings; in a game it pauses.
  if (e.key === 'Escape' && !session && saved === null && screen === 'menu') {
    e.preventDefault();
    if (!e.repeat) openSettings();
    return;
  }
  // `?` shows or hides the guide at any time, without moving the piece or pausing.
  if (isGuideKey(e.key, e.ctrlKey || e.metaKey || e.altKey)) {
    e.preventDefault();
    if (!e.repeat) toggleGuide();
    return;
  }
  renderGuide();
  const modified = e.ctrlKey || e.metaKey || e.altKey;
  // macOS drops the keyup of a key released while Cmd is down, so a modifier forgets held keys.
  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') keyRepeat.clear();
  // Held in any phase, even between games, so a key already down repeats once play starts.
  const held = heldMove(e.key, modified, settings.keys);
  if (held && !e.repeat) keyRepeat.press(held, performance.now());
  if (!session || session.game.state.over) {
    // A key held through the end of a game must not repeat onto the result's buttons.
    if (e.repeat) e.preventDefault();
    return;
  }
  const { action, preventDefault } = keyAction(
    e.key,
    session.phase,
    e.repeat,
    modified,
    settings.keys,
  );
  if (action) act(action);
  if (preventDefault) e.preventDefault();
});

// Released whatever has focus: a held key must not keep repeating after its keyup.
document.addEventListener('keyup', (e) => {
  const held = heldMove(e.key, false, settings.keys);
  if (held) keyRepeat.release(held, performance.now());
});

onLeaveScreen(document, window, () => {
  // Keyups are lost while another window has focus, so held keys are forgotten.
  keyRepeat.clear();
  pause();
});

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

// Keyboard controls guide, for the keys bound now. Its rows are built as text nodes, never markup.
const guide = new Guide(loadGuideClosed(storage), matchMedia('(any-pointer: fine)').matches);
function renderGuideKeys(): void {
  document.querySelector('#guide-keys')!.replaceChildren(
    ...guideRows(settings.keys).map((row) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      for (const { label } of row.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = label;
        dt.append(kbd);
      }
      const dd = document.createElement('dd');
      dd.textContent = row.text;
      div.append(dt, dd);
      return div;
    }),
  );
}
renderGuideKeys();

function renderGuide(): void {
  if (guidePanel.hidden === guide.visible) guidePanel.hidden = guidePanel.inert = !guide.visible;
  if (guideToggle.hidden === guide.linkVisible) guideToggle.hidden = !guide.linkVisible;
  guideToggle.setAttribute('aria-expanded', String(guide.visible));
}

function toggleGuide(): void {
  if (guide.toggle()) writeGuideClosed(storage);
  renderGuide();
}

// Like the Pause button, the guide's buttons never take focus, so Space can't press them.
for (const btn of [guideToggle, document.querySelector<HTMLButtonElement>('#guide-close')!]) {
  btn.addEventListener('pointerdown', (e) => e.preventDefault());
}
guideToggle.addEventListener('click', toggleGuide);
document.querySelector('#guide-close')!.addEventListener('click', () => {
  guide.close();
  writeGuideClosed(storage);
  renderGuide();
});
// A mouse or trackpad connected later means a keyboard is likely too.
matchMedia('(any-pointer: fine)').addEventListener('change', (e) => {
  if (e.matches) guide.keyboardSeen();
  renderGuide();
});
renderGuide();

const resizes = new ResizeObserver(fit);
resizes.observe(well);
resizes.observe(nextCanvas);
watchPixelRatio();
fit();

// The cleaned name goes back into the field (value is text, never markup).
nameInput.addEventListener('change', () => {
  profile = updateProfile(profileStorage, profile, (p) => rename(p, nameInput.value));
  nameInput.value = profile.name;
  void cloud?.sync();
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
// Another tab changed the profile: show its records and name. Or it turned cloud save on or off.
window.addEventListener('storage', (e) => {
  if (e.key === CLOUD_KEY && cloud) {
    cloud.reload();
    renderCloud();
  }
  if (e.key !== PROFILE_KEY || !loaded.stored) return;
  const fresh = loadProfile(storage);
  if (!fresh.stored) return;
  profile = fresh.profile;
  showProfile();
});

// Cloud save panel. The link code is shown as text only, and never leaves the panel.
const CLOUD_STATUS: Record<CloudStatus, string> = {
  off: 'Off on this device',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline · will retry',
  error: 'Sync error · tries again after your next game',
  'signed-out': 'Signed out · turn on again, or enter a link code to rejoin your save',
};
/** An action in flight: its buttons wait. */
let cloudBusy = false;
let codeTimer: ReturnType<typeof setTimeout> | undefined;

function renderCloud(): void {
  if (!cloud) return;
  const on = cloud.on;
  setText('#cloud-status', CLOUD_STATUS[cloud.status]);
  cloudOnBtn.hidden = on;
  cloudLinkBtn.hidden = !on;
  cloudOffBtn.hidden = !on;
  for (const btn of [cloudOnBtn, cloudLinkBtn, cloudOffBtn, linkSubmit]) btn.disabled = cloudBusy;
  if (!on) showCode('');
}

/** Show a link code (formatted), or clear it with ''. */
function showCode(code: string): void {
  clearTimeout(codeTimer);
  setText('#link-code', code ? formatCode(code) : '');
}

/** Run a panel action once at a time, then show its message. */
async function cloudAction(action: (c: CloudSync) => Promise<string>): Promise<void> {
  if (!cloud || cloudBusy) return;
  cloudBusy = true;
  setText('#cloud-note', '');
  renderCloud();
  try {
    setText('#cloud-note', await action(cloud));
  } finally {
    cloudBusy = false;
    renderCloud();
  }
}

const OFFLINE_NOTE = "Can't reach cloud save. Try again.";
const ERROR_NOTE = 'Cloud save is unavailable. Try again later.';

openCloudBtn.addEventListener('click', () => {
  screen = 'cloud';
  setText('#cloud-note', '');
  renderCloud();
});
cloudBackBtn.addEventListener('click', () => {
  showCode('');
  linkInput.value = '';
  screen = 'menu';
});
cloudOnBtn.addEventListener('click', () =>
  cloudAction(async (c) => {
    const r = await c.enable();
    return r === 'on' ? '' : r === 'offline' ? OFFLINE_NOTE : ERROR_NOTE;
  }),
);
cloudLinkBtn.addEventListener('click', () =>
  cloudAction(async (c) => {
    const r = await c.createCode();
    if ('error' in r) return r.error === 'offline' ? OFFLINE_NOTE : ERROR_NOTE;
    showCode(r.code);
    codeTimer = setTimeout(() => {
      setText('#link-code', '');
      setText('#cloud-note', 'The code expired.');
    }, r.expiresAt - Date.now());
    return 'Enter this code on the other device within 10 minutes.';
  }),
);
const LINK_NOTES = {
  linked: 'Linked. Progress from both devices is kept.',
  invalid: 'Wrong or expired code.',
  rate_limited: 'Too many tries. Wait 10 minutes.',
  offline: OFFLINE_NOTE,
  error: "Couldn't link. Try again.",
} as const;
function submitLink(): void {
  void cloudAction(async (c) => {
    const r = await c.redeem(linkInput.value);
    if (r === 'linked') linkInput.value = '';
    return LINK_NOTES[r];
  });
}
linkSubmit.addEventListener('click', submitLink);
linkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitLink();
});
cloudOffBtn.addEventListener('click', () =>
  cloudAction(async (c) => {
    await c.disable();
    return 'Off here. Your progress stays on this device. To rejoin this save, enter a link code from another device.';
  }),
);

// Settings panel. Every change applies at once and is stored; text reaches the page as text only.
const keyButtons = new Map<Action, HTMLButtonElement>();
document.querySelector('#set-keys')!.replaceChildren(
  ...ACTIONS.flatMap((action) => {
    const name = document.createElement('span');
    name.textContent = ACTION_NAMES[action];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      binding = binding === action ? null : action;
      setText('#settings-note', binding ? 'Press a key. Esc cancels.' : '');
      renderSettings();
    });
    keyButtons.set(action, btn);
    return [name, btn];
  }),
);

// The Styles tab: one choice per piece style, each with a sample of its blocks.
const styleInputs = new Map<PieceStyle, HTMLInputElement>();
/** The sample: a T beside an S, in cells. */
const SAMPLE: readonly [Kind, number, number][] = [
  ['T', 0, 0],
  ['T', 1, 0],
  ['T', 2, 0],
  ['T', 1, 1],
  ['S', 4, 0],
  ['S', 5, 0],
  ['S', 3, 1],
  ['S', 4, 1],
];
document.querySelector('#set-styles')!.replaceChildren(
  ...PIECE_STYLES.map((style) => {
    const label = document.createElement('label');
    label.className = 'style-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'piece-style';
    input.value = style;
    input.addEventListener('change', () => {
      if (input.checked && isPieceStyle(input.value))
        changeSettings({ ...settings, pieceStyle: input.value });
    });
    styleInputs.set(style, input);
    const sample = document.createElement('canvas');
    sample.className = 'style-sample';
    sample.setAttribute('aria-hidden', 'true');
    const size = 28;
    sample.width = 6 * size + 8;
    sample.height = 2 * size + 8;
    const c = sample.getContext('2d');
    if (c) {
      c.fillStyle = WELL_BG;
      c.fillRect(0, 0, sample.width, sample.height);
      for (const [kind, x, y] of SAMPLE) {
        const colors = BLOCKS[colorIndex(kind) - 1]!;
        drawBlock(c, 4 + x * size, 4 + y * size, size, colors, MARKS[kind], style);
      }
    }
    const name = document.createElement('span');
    name.textContent = PIECE_STYLE_NAMES[style];
    label.append(input, sample, name);
    return label;
  }),
);

// Settings tabs: arrow keys, Home and End move between them, as usual for tabs.
const tabs = [...document.querySelectorAll<HTMLButtonElement>('#settings [role="tab"]')];
function selectTab(tab: HTMLButtonElement, focus: boolean): void {
  // A key waiting to be bound on General gives up when its tab goes.
  if (binding && tab.getAttribute('aria-selected') !== 'true') {
    binding = null;
    setText('#settings-note', '');
    renderSettings();
  }
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = $(`#${t.getAttribute('aria-controls')}`);
    if (panel.hidden === on) panel.hidden = !on;
  }
  if (focus) tab.focus({ preventScroll: true });
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab, false));
  tab.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(tab);
    const n = tabs.length;
    const to =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % n]
        : e.key === 'ArrowLeft'
          ? tabs[(i - 1 + n) % n]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[n - 1]
              : undefined;
    if (!to) return;
    e.preventDefault();
    // Moving between tabs, not a key for Settings to bind.
    e.stopPropagation();
    selectTab(to, true);
  });
}

function renderSettings(): void {
  ghostInput.checked = settings.ghost;
  ghostOpacityInput.value = String(settings.ghostOpacity);
  setText('#set-ghost-opacity-value', `${settings.ghostOpacity}%`);
  for (const [style, input] of styleInputs) input.checked = settings.pieceStyle === style;
  effectsInput.value = settings.effects;
  delayInput.value = String(settings.delayMs);
  intervalInput.value = String(settings.intervalMs);
  sfxInput.value = String(settings.sfxVolume);
  musicInput.value = String(settings.musicVolume);
  setText('#set-delay-value', `${settings.delayMs} ms`);
  setText('#set-sfx-value', `${settings.sfxVolume}%`);
  setText('#set-music-value', `${settings.musicVolume}%`);
  muteBtn.setAttribute('aria-pressed', String(settings.muted));
  setText(
    '#set-interval-value',
    settings.intervalMs === 0 ? 'Instant' : `${settings.intervalMs} ms`,
  );
  for (const [action, btn] of keyButtons) {
    const waiting = binding === action;
    const label = waiting ? 'Press a key' : keyLabel(settings.keys[action]);
    // Waiting shows as … so the button keeps its width; the note and label say the rest.
    const shown = waiting ? '…' : label;
    if (btn.textContent !== shown) btn.textContent = shown;
    btn.setAttribute('aria-pressed', String(waiting));
    btn.setAttribute('aria-label', `${ACTION_NAMES[action]}: ${label}`);
  }
}

/** Use `next` from now on: the repeat timing, the sound, the guide and the panel follow it. */
function applySettings(next: Settings): void {
  settings = next;
  fx.level = settings.effects;
  motion.level = settings.effects;
  hud.level = settings.effects;
  danger.level = settings.effects;
  shake.level = settings.effects;
  ambient.level = settings.effects;
  // page.css times every UI transition by it.
  document.documentElement.dataset.effects = settings.effects;
  keyRepeat.setTiming(repeatTiming(settings));
  sound.setLevels(settings.muted, settings.sfxVolume, settings.musicVolume);
  renderSettings();
  renderGuideKeys();
}

function changeSettings(next: Settings): void {
  applySettings(next);
  writeSettings(storage, settings);
}

function toggleMute(): void {
  changeSettings({ ...settings, muted: !settings.muted });
}

/** Open Settings over whatever shows; a game in play pauses under it. */
function openSettings(): void {
  if (session && session.phase !== 'paused' && !session.game.state.over) pause();
  keyRepeat.clear();
  settingsOpen = true;
  binding = null;
  selectTab(tabs[0]!, false);
  setText('#settings-note', '');
  renderSettings();
  renderOverlay();
}

function closeSettings(): void {
  settingsOpen = false;
  binding = null;
  renderOverlay();
}

/** A key while Settings is open: the key being bound, else Esc closes it. */
function settingsKey(e: KeyboardEvent): void {
  // Browser shortcuts stay the browser's, and a lone modifier waits for its key.
  if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))
    return;
  if (!binding) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!e.repeat) closeSettings();
    }
    return;
  }
  // Tab moves on, as usual, and gives up the binding.
  if (e.key === 'Tab') {
    binding = null;
    setText('#settings-note', '');
    renderSettings();
    return;
  }
  e.preventDefault();
  if (e.repeat) return;
  if (e.key === 'Escape') {
    binding = null;
    setText('#settings-note', '');
    renderSettings();
    return;
  }
  const r = bindKey(settings, binding, e.key);
  if ('error' in r) {
    // Still waiting: the player can try another key.
    setText('#settings-note', r.error);
    return;
  }
  binding = null;
  setText('#settings-note', '');
  changeSettings(r.settings);
}

ghostInput.addEventListener('change', () =>
  changeSettings({ ...settings, ghost: ghostInput.checked }),
);
effectsInput.addEventListener('change', () => {
  // The options are the page's own, but the value is checked like stored data anyway.
  if (isEffectsLevel(effectsInput.value))
    changeSettings({ ...settings, effects: effectsInput.value });
});
/** What the sliders show, applied while dragging and stored once the drag ends. */
function sliderSettings(): Settings {
  return {
    ...settings,
    ghostOpacity: ghostOpacityIn(Number(ghostOpacityInput.value)) ?? settings.ghostOpacity,
    delayMs: inRange(Number(delayInput.value), DELAY_RANGE) ?? settings.delayMs,
    intervalMs: inRange(Number(intervalInput.value), INTERVAL_RANGE) ?? settings.intervalMs,
    sfxVolume: inRange(Number(sfxInput.value), VOLUME_RANGE) ?? settings.sfxVolume,
    musicVolume: inRange(Number(musicInput.value), VOLUME_RANGE) ?? settings.musicVolume,
  };
}
for (const slider of [ghostOpacityInput, delayInput, intervalInput, sfxInput, musicInput]) {
  slider.addEventListener('input', () => applySettings(sliderSettings()));
  slider.addEventListener('change', () => changeSettings(sliderSettings()));
}
// A sample at the new effects volume.
sfxInput.addEventListener('change', () => sound.play('lock'));
// Like Pause, Mute never takes focus, so Space can't press it mid-game.
muteBtn.addEventListener('pointerdown', (e) => e.preventDefault());
muteBtn.addEventListener('click', toggleMute);
document.querySelector('#settings-reset')!.addEventListener('click', () => {
  binding = null;
  setText('#settings-note', 'Defaults restored.');
  // Mute is the HUD's and M's, not the panel's: Reset never makes a muted game loud.
  changeSettings({ ...defaultSettings(reducedMotion()), muted: settings.muted });
});
document.querySelector('#settings-back')!.addEventListener('click', closeSettings);
document.querySelector('#pause-settings')!.addEventListener('click', openSettings);
// Like Pause, the header button never takes focus, so Space can't press it mid-game.
openSettingsBtn.addEventListener('pointerdown', (e) => e.preventDefault());
openSettingsBtn.addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
// Another tab changed the settings: use them here too.
window.addEventListener('storage', (e) => {
  // A null key is storage cleared there.
  if (e.key !== SETTINGS_KEY && e.key !== null) return;
  // Held keys may now be other actions, so their keyups would be missed.
  keyRepeat.clear();
  binding = null;
  applySettings(loadSettings(storage, reducedMotion()));
});
applySettings(settings);

// Sync when the game leaves the screen (progress made here) and comes back (progress
// made on other devices meanwhile), and when the connection returns.
document.addEventListener('visibilitychange', () => void cloud?.sync());
window.addEventListener('online', () => void cloud?.sync());
void cloud?.sync();
renderCloud();
requestAnimationFrame(loop);
