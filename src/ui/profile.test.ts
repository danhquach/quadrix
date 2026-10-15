import { describe, expect, it } from 'vitest';
import { PROFILE_VERSION, newProfile, recordGame, rename, toProfileText } from '../core/profile.ts';
import { PROFILE_KEY, loadProfile, updateProfile, writeProfile } from './profile.ts';
import type { SaveStorage } from './save.ts';

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

describe('profile storage', () => {
  it('writes and loads a profile', () => {
    const store = memory();
    const p = recordGame(rename(newProfile(), 'Ada'), 'classic', 900, 9);
    writeProfile(() => store, p);
    expect(store.data.get(PROFILE_KEY)).toBe(toProfileText(p));
    expect(loadProfile(() => store)).toEqual({ profile: p, stored: true });
  });

  it('gives a new, storable profile on first launch or when the stored one is corrupt', () => {
    for (const text of [undefined, '{oops']) {
      const store = memory();
      if (text) store.data.set(PROFILE_KEY, text);
      expect(loadProfile(() => store)).toEqual({ profile: newProfile(), stored: true });
    }
  });

  it('keeps an in-memory profile, flagged not stored, when storage throws or is missing', () => {
    const denied = (): SaveStorage => {
      throw new Error('SecurityError');
    };
    for (const storage of [() => throwing, denied, () => null]) {
      expect(loadProfile(storage)).toEqual({ profile: newProfile(), stored: false });
      expect(() => writeProfile(storage, newProfile())).not.toThrow();
    }
  });

  it('never writes back a profile from a later version', () => {
    const store = memory();
    const later = JSON.stringify({ v: PROFILE_VERSION + 1, name: 'Ada', future: [1, 2] });
    store.data.set(PROFILE_KEY, later);
    const loaded = loadProfile(() => store);
    expect(loaded).toEqual({ profile: rename(newProfile(), 'Ada'), stored: false });
    const p = updateProfile(
      () => store,
      loaded.profile,
      (q) => recordGame(q, 'classic', 5, 1),
    );
    expect(p.gamesPlayed).toBe(1);
    expect(store.data.get(PROFILE_KEY)).toBe(later);
  });

  it("applies a change to the stored profile, keeping another tab's records", () => {
    const store = memory();
    const stale = newProfile();
    writeProfile(() => store, recordGame(newProfile(), 'classic', 900, 9)); // the other tab
    const p = updateProfile(
      () => store,
      stale,
      (q) => recordGame(q, 'override', 50, 2),
    );
    expect(p.best.classic).toEqual({ score: 900, lines: 9 });
    expect(p.best.override).toEqual({ score: 50, lines: 2 });
    expect(p.gamesPlayed).toBe(2);
    expect(loadProfile(() => store).profile).toEqual(p);
  });

  it('applies a change in memory when storage throws or is missing', () => {
    const current = rename(newProfile(), 'Ada');
    for (const storage of [() => throwing, () => null]) {
      const p = updateProfile(storage, current, (q) => recordGame(q, 'classic', 10, 1));
      expect(p).toEqual(recordGame(current, 'classic', 10, 1));
    }
  });
});
