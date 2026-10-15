import { describe, expect, it } from 'vitest';
import {
  GUIDE_KEY,
  GUIDE_ROWS,
  Guide,
  guideRows,
  isGuideKey,
  loadGuideClosed,
  writeGuideClosed,
  type GuideStorage,
} from './guide.ts';
import { DEFAULT_KEYS, actionForKey, keyAction } from './keys.ts';

function memory(
  initial: Record<string, string> = {},
): GuideStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: GuideStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('GUIDE_ROWS', () => {
  it('lists every game key, and each one does what its row says', () => {
    for (const row of GUIDE_ROWS) {
      for (const { key } of row.keys) {
        if (row.action === 'guide') expect(isGuideKey(key, false)).toBe(true);
        // ← and → share the Move row.
        else if (key === 'ArrowRight') expect(actionForKey(key)).toBe('right');
        else expect(actionForKey(key)).toBe(row.action);
      }
    }
    const listed = GUIDE_ROWS.flatMap((r) => r.keys.map((k) => k.key));
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      ' ',
      'p',
      'Escape',
      '?',
    ]) {
      expect(listed).toContain(key);
    }
  });

  it('holds plain labels only: no markup characters', () => {
    for (const row of GUIDE_ROWS) {
      for (const text of [row.text, ...row.keys.map((k) => k.label)]) {
        expect(text).not.toMatch(/[<>&"]/);
      }
    }
  });
});

describe('guideRows', () => {
  it('shows the keys bound now, and each one does what its row says', () => {
    const keys = { ...DEFAULT_KEYS, left: 'a', right: 'd', pause: 'q' };
    const rows = guideRows(keys);
    expect(rows[0]!.keys.map((k) => k.label)).toEqual(['A', 'D']);
    expect(rows.find((r) => r.action === 'pause')!.keys.map((k) => k.label)).toEqual(['Q', 'Esc']);
    for (const row of rows) {
      for (const { key } of row.keys) {
        if (row.action === 'guide') continue;
        if (key === 'd') expect(actionForKey(key, keys)).toBe('right');
        else expect(actionForKey(key, keys)).toBe(row.action);
      }
    }
  });
});

describe('isGuideKey', () => {
  it('is ? alone', () => {
    expect(isGuideKey('?', false)).toBe(true);
    for (const key of ['/', 'h', 'H', 'F1', 'Shift', '？', '__proto__']) {
      expect(isGuideKey(key, false)).toBe(false);
    }
  });

  it('leaves ? with Ctrl, Cmd or Alt to the browser', () => {
    expect(isGuideKey('?', true)).toBe(false);
  });

  it('is never a game action, so it neither moves the piece nor pauses', () => {
    for (const phase of ['running', 'paused', 'countdown'] as const) {
      expect(keyAction('?', phase, false)).toEqual({ action: null, preventDefault: false });
    }
  });
});

describe('loadGuideClosed / writeGuideClosed', () => {
  it('round-trips the closed marker', () => {
    const s = memory();
    expect(loadGuideClosed(() => s)).toBe(false);
    writeGuideClosed(() => s);
    expect(s.data.get(GUIDE_KEY)).toBe('closed');
    expect(loadGuideClosed(() => s)).toBe(true);
  });

  it('reads missing storage, blocked storage or a failing write as not closed', () => {
    expect(loadGuideClosed(() => null)).toBe(false);
    expect(loadGuideClosed(() => throwing)).toBe(false);
    expect(
      loadGuideClosed(() => {
        throw new Error('SecurityError');
      }),
    ).toBe(false);
    expect(() => writeGuideClosed(() => throwing)).not.toThrow();
    expect(() => writeGuideClosed(() => null)).not.toThrow();
  });

  it.each([
    '',
    'Closed',
    'closed ',
    ' closed',
    `closed${String.fromCodePoint(0x200b)}`, // zero-width space
    `${String.fromCodePoint(0x202e)}closed`, // right-to-left override
    'сlosed', // Cyrillic с
    'true',
    '1',
    '{"closed":true}',
    '{"__proto__":{"closed":true}}',
    '<img src=x onerror=alert(1)>',
    'closed'.repeat(100_000),
  ])('reads a hostile or unexpected value %j as not closed', (value) => {
    expect(loadGuideClosed(() => memory({ [GUIDE_KEY]: value }))).toBe(false);
  });

  it('leaves Object.prototype alone', () => {
    loadGuideClosed(() => memory({ [GUIDE_KEY]: '{"__proto__":{"polluted":1}}' }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('Guide', () => {
  it('opens on the first Start for a keyboard player', () => {
    const g = new Guide(false, true);
    expect(g.visible).toBe(false);
    expect(g.linkVisible).toBe(true);
    g.start();
    expect(g.visible).toBe(true);
  });

  it('stays closed on later Starts once closed', () => {
    const g = new Guide(false, true);
    g.start();
    g.close();
    expect(g.visible).toBe(false);
    g.start();
    expect(g.visible).toBe(false);
  });

  it('stays closed on Start after a reload that remembers the close', () => {
    const g = new Guide(true, true);
    g.start();
    expect(g.visible).toBe(false);
  });

  it('keeps showing on later Starts while never closed', () => {
    const g = new Guide(false, true);
    g.start();
    g.start();
    expect(g.visible).toBe(true);
  });

  it('toggles with ? or the link, and a toggle that hides it counts as a close', () => {
    const g = new Guide(true, true);
    expect(g.toggle()).toBe(false);
    expect(g.visible).toBe(true);
    expect(g.toggle()).toBe(true);
    expect(g.visible).toBe(false);
    g.start();
    expect(g.visible).toBe(false);
  });

  it('never shows to a touch-only player, nor offers the link', () => {
    const g = new Guide(false, false);
    g.start();
    expect(g.visible).toBe(false);
    expect(g.linkVisible).toBe(false);
  });

  it('shows once a key press reveals a keyboard (iPad with a keyboard, no trackpad)', () => {
    const g = new Guide(false, false);
    g.start();
    g.keyboardSeen();
    expect(g.visible).toBe(true);
    expect(g.linkVisible).toBe(true);
  });

  it('opens on ? even before a keyboard was detected', () => {
    const g = new Guide(true, false);
    expect(g.toggle()).toBe(false);
    expect(g.visible).toBe(true);
  });
});
