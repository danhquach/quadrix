import { describe, expect, it } from 'vitest';
import { Game } from '../core/game.ts';
import { rung, startRung } from '../core/ladder.ts';
import { MODES } from '../core/modes/index.ts';
import { SNAPSHOT_VERSION, toSnapshot } from '../core/snapshot.ts';
import { SAVE_KEY, clearSave, loadSave, resumable, writeSave, type SaveStorage } from './save.ts';

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: SaveStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

function game(): Game {
  const g = new Game(MODES.classic!, 5);
  g.hardDrop();
  return g;
}

describe('save', () => {
  it('writes, loads and clears a game', () => {
    const store = memory();
    const g = game();
    writeSave(() => store, g);
    expect(store.data.get(SAVE_KEY)).toBe(toSnapshot(g));
    expect(loadSave(() => store, 1)!.save()).toEqual(g.save());
    clearSave(() => store);
    expect(store.data.has(SAVE_KEY)).toBe(false);
  });

  it('loads nothing when there is no save', () => {
    expect(loadSave(() => memory(), 1)).toBeNull();
  });

  it('clears the save when the game is over', () => {
    const store = memory();
    const g = game();
    writeSave(() => store, g);
    while (!g.state.over) g.hardDrop();
    writeSave(() => store, g);
    expect(store.data.has(SAVE_KEY)).toBe(false);
  });

  it('removes a corrupt or older save instead of loading it', () => {
    const current = `"v":${SNAPSHOT_VERSION}`;
    // A version 1 save: no piece count or rung yet.
    const v1 = JSON.parse(toSnapshot(game())) as Record<string, unknown>;
    delete v1.pieces;
    delete v1.rung;
    const older = [
      toSnapshot(game()).replace(current, `"v":${SNAPSHOT_VERSION - 1}`),
      JSON.stringify({ ...v1, v: 1 }),
    ];
    for (const text of ['{oops', '{"v":0}', ...older]) {
      const store = memory();
      store.data.set(SAVE_KEY, text);
      expect(loadSave(() => store, 1)).toBeNull();
      expect(store.data.has(SAVE_KEY)).toBe(false);
    }
  });

  it('never throws when storage throws or is missing (private mode, blocked data)', () => {
    const denied = (): SaveStorage => {
      throw new Error('SecurityError');
    };
    for (const storage of [() => throwing, denied, () => null]) {
      expect(loadSave(storage, 1)).toBeNull();
      expect(() => writeSave(storage, game())).not.toThrow();
      expect(() => clearSave(storage)).not.toThrow();
    }
  });

  it('offers a rung save only while that rung is unlocked, and removes it otherwise', () => {
    const g = startRung(rung(5));
    for (const [highest, kept] of [
      [5, true],
      [6, true],
      [4, false],
      [1, false],
    ] as const) {
      const store = memory();
      writeSave(() => store, g);
      expect(loadSave(() => store, highest)?.rung ?? null).toBe(kept ? 5 : null);
      expect(store.data.has(SAVE_KEY)).toBe(kept);
    }
    expect(resumable(g, 5)).toBe(true);
    expect(resumable(g, 4)).toBe(false);
    expect(resumable(game(), 1)).toBe(true);
  });
});
