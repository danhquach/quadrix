import { describe, expect, it } from 'vitest';
import { onLeaveScreen, type Page } from './lifecycle.ts';

function setup() {
  const page = Object.assign(new EventTarget(), { hidden: false }) as Page & { hidden: boolean };
  const win = new EventTarget();
  let left = 0;
  onLeaveScreen(page, win, () => left++);
  return { page, win, count: () => left };
}

describe('onLeaveScreen', () => {
  it('fires when the page becomes hidden (tab switch, app switch, lock)', () => {
    const { page, count } = setup();
    page.hidden = true;
    page.dispatchEvent(new Event('visibilitychange'));
    expect(count()).toBe(1);
  });

  it('ignores the page becoming visible again', () => {
    const { page, count } = setup();
    page.dispatchEvent(new Event('visibilitychange'));
    expect(count()).toBe(0);
  });

  it('fires on pagehide and window blur', () => {
    const { win, count } = setup();
    win.dispatchEvent(new Event('pagehide'));
    win.dispatchEvent(new Event('blur'));
    expect(count()).toBe(2);
  });

  it('ignores unrelated events', () => {
    const { page, win, count } = setup();
    for (const t of ['focus', 'pageshow', 'resize']) {
      page.dispatchEvent(new Event(t));
      win.dispatchEvent(new Event(t));
    }
    expect(count()).toBe(0);
  });
});
