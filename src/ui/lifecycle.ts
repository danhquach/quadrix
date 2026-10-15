/** The page's visibility flag plus its events; `document` in the app, a stub in tests. */
export interface Page extends EventTarget {
  readonly hidden: boolean;
}

/**
 * Call `leave` whenever the game leaves the screen: the tab or app goes to the
 * background or the device locks (visibilitychange to hidden), the page is closed or
 * bfcached (pagehide), or another window takes focus (blur).
 */
export function onLeaveScreen(page: Page, win: EventTarget, leave: () => void): void {
  page.addEventListener('visibilitychange', () => {
    if (page.hidden) leave();
  });
  win.addEventListener('pagehide', leave);
  win.addEventListener('blur', leave);
}
