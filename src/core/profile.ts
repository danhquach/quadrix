import { MODES } from './modes/index.ts';
import { MAX_COUNT } from './snapshot.ts';

/** Bump when the stored format changes, and add the step from the old version to MIGRATIONS. */
export const PROFILE_VERSION = 1;

export const DEFAULT_NAME = 'Player';

/** Longest name, in code points, after cleaning. */
export const MAX_NAME_LENGTH = 16;

/** Most rungs a profile records stars for: far beyond play, and keeps the stored text small. */
export const MAX_RUNGS = 100_000;

/** Longest profile text accepted: the stars string at its cap plus room for everything else. */
export const MAX_PROFILE_CHARS = MAX_RUNGS + 4096;

/** Raw input is cut to this many UTF-16 units before cleaning, so huge pastes stay cheap. */
const MAX_RAW_NAME = 256;

export interface ModeBest {
  /** Best score in one game. */
  score: number;
  /** Most lines in one game. */
  lines: number;
}

/** What the game remembers about its player between visits. */
export interface Profile {
  name: string;
  /** Per mode id, every mode in MODES present. */
  best: Record<string, ModeBest>;
  /**
   * Best stars per passed rung: character i ('1'..'3') is rung i + 1. Rungs are passed
   * in order, so the highest rung unlocked is its length + 1 (see highestRung).
   */
  stars: string;
  gamesPlayed: number;
  totalLines: number;
}

/** Steps that upgrade stored data: MIGRATIONS[n] turns version n into n + 1. */
export type Migrations = Record<number, (old: Record<string, unknown>) => Record<string, unknown>>;
export const MIGRATIONS: Migrations = {};

export function newProfile(): Profile {
  return { name: DEFAULT_NAME, best: bests({}), stars: '', gamesPlayed: 0, totalLines: 0 };
}

/**
 * Letters and symbols that draw nothing (or a placeholder box): Hangul fillers, the
 * braille blank, the object replacement character and the combining grapheme joiner. Not format characters, so \p{C} misses them.
 */
const BLANKS = /[\u115f\u1160\u3164\uffa0\u2800\ufffc]|\u034f/gu;

/**
 * `raw` as a display name: compatibility look-alikes folded (NFKC), whitespace runs made
 * one space, control, format (bidi overrides, zero-width), private-use, unassigned and
 * blank characters removed, combining marks kept to two per character (none leading),
 * trimmed and cut to MAX_NAME_LENGTH code points. DEFAULT_NAME if no letter, digit or
 * symbol such as an emoji is left.
 */
export function cleanName(raw: string): string {
  const name = raw
    .slice(0, MAX_RAW_NAME)
    .normalize('NFKC')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .replace(/\p{C}/gu, '')
    .replace(BLANKS, '')
    .replace(/(^| )\p{M}+/gu, '$1')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
  const cut = Array.from(name).slice(0, MAX_NAME_LENGTH).join('').trim();
  return /[\p{L}\p{N}\p{So}]/u.test(cut) ? cut : DEFAULT_NAME;
}

export function rename(p: Profile, raw: string): Profile {
  return { ...p, name: cleanName(raw) };
}

/** Count a finished (or abandoned) game in `mode`. Unknown modes are ignored. */
export function recordGame(p: Profile, mode: string, score: number, lines: number): Profile {
  if (!Object.hasOwn(MODES, mode)) return p;
  const prev = p.best[mode]!;
  score = readCount(score);
  lines = readCount(lines);
  return {
    ...p,
    best: {
      ...p.best,
      [mode]: { score: Math.max(prev.score, score), lines: Math.max(prev.lines, lines) },
    },
    gamesPlayed: add(p.gamesPlayed, 1),
    totalLines: add(p.totalLines, lines),
  };
}

/** Highest rung the player may start. */
export function highestRung(p: Profile): number {
  return Math.min(p.stars.length + 1, MAX_RUNGS);
}

/**
 * Record passing rung `index` with `stars`: unlocks the next rung, and a retry only ever
 * raises a rung's stars. A rung above the highest unlocked is ignored.
 */
export function recordRung(p: Profile, index: number, stars: 1 | 2 | 3): Profile {
  if (!Number.isSafeInteger(index) || index < 1 || index > p.stars.length + 1) return p;
  if (index > MAX_RUNGS || ![1, 2, 3].includes(stars)) return p;
  const old = Number(p.stars[index - 1] ?? 0);
  if (stars <= old) return p;
  return { ...p, stars: p.stars.slice(0, index - 1) + stars + p.stars.slice(index) };
}

/** The profile as JSON text for storage. */
export function toProfileText(p: Profile): string {
  return JSON.stringify({ v: PROFILE_VERSION, ...p });
}

/**
 * The profile stored as `text` (null: none yet). Everything read is untrusted: each
 * field is checked against an allow-list and reset on its own when invalid, so one bad
 * field never costs the rest (a damaged stars string keeps its valid start). Text that
 * is not a JSON object gives a new profile. Older versions are upgraded through
 * `migrations` first. `newer` marks data from a later version: the fields this version
 * knows are read, but writing it back would drop the rest, so the caller must not.
 */
export function parseProfile(
  text: string | null,
  migrations = MIGRATIONS,
): { profile: Profile; newer: boolean } {
  if (text == null || text.length > MAX_PROFILE_CHARS)
    return { profile: newProfile(), newer: false };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { profile: newProfile(), newer: false };
  }
  if (!isPlain(data)) return { profile: newProfile(), newer: false };
  const newer = typeof data.v === 'number' && data.v > PROFILE_VERSION;
  const p = migrate(data, migrations);
  const profile = {
    name: typeof p.name === 'string' ? cleanName(p.name) : DEFAULT_NAME,
    best: bests(isPlain(p.best) ? p.best : {}),
    stars: readStars(p.stars),
    gamesPlayed: readCount(p.gamesPlayed),
    totalLines: readCount(p.totalLines),
  };
  return { profile, newer };
}

/** Run upgrade steps from the data's version up to the current one, while steps exist. */
function migrate(data: Record<string, unknown>, migrations: Migrations): Record<string, unknown> {
  let v = data.v;
  while (Number.isSafeInteger(v) && (v as number) < PROFILE_VERSION) {
    const step = Object.hasOwn(migrations, v as number) ? migrations[v as number]! : null;
    if (!step) break;
    data = step(data);
    if (!isPlain(data)) return {};
    v = (v as number) + 1;
  }
  return data;
}

/**
 * One entry per known mode, read from `stored` where valid. Only MODES' own ids are
 * looked up, so keys such as `__proto__` in the stored data are never touched.
 */
function bests(stored: Record<string, unknown>): Record<string, ModeBest> {
  const out: Record<string, ModeBest> = {};
  for (const id of Object.keys(MODES)) {
    const b = Object.hasOwn(stored, id) ? stored[id] : null;
    out[id] = isPlain(b)
      ? { score: readCount(b.score), lines: readCount(b.lines) }
      : { score: 0, lines: 0 };
  }
  return out;
}

/** The valid start of a stars string: each character '1'..'3', at most MAX_RUNGS. */
function readStars(v: unknown): string {
  if (typeof v !== 'string') return '';
  let n = 0;
  while (n < v.length && n < MAX_RUNGS && v[n]! >= '1' && v[n]! <= '3') n++;
  return v.slice(0, n);
}

function readCount(v: unknown): number {
  return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNT
    ? (v as number)
    : 0;
}

function add(a: number, b: number): number {
  return Math.min(MAX_COUNT, a + b);
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}
