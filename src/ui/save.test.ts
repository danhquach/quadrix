import { describe, expect, it } from 'vitest';
import { Game } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { toSnapshot } from '../core/snapshot.ts';
import { SAVE_KEY, clearSave, loadSave, writeSave, type SaveStorage } from './save.ts';

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
    expect(loadSave(() => store)!.save()).toEqual(g.save());
    clearSave(() => store);
    expect(store.data.has(SAVE_KEY)).toBe(false);
  });

  it('loads nothing when there is no save', () => {
    expect(loadSave(() => memory())).toBeNull();
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
    for (const text of ['{oops', '{"v":0}', toSnapshot(game()).replace('"v":1', '"v":0')]) {
      const store = memory();
      store.data.set(SAVE_KEY, text);
      expect(loadSave(() => store)).toBeNull();
      expect(store.data.has(SAVE_KEY)).toBe(false);
    }
  });

  it('never throws when storage throws or is missing (private mode, blocked data)', () => {
    const denied = (): SaveStorage => {
      throw new Error('SecurityError');
    };
    for (const storage of [() => throwing, denied, () => null]) {
      expect(loadSave(storage)).toBeNull();
      expect(() => writeSave(storage, game())).not.toThrow();
      expect(() => clearSave(storage)).not.toThrow();
    }
  });
});
