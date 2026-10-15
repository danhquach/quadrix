# Quadrix

Falling-block puzzle game for the browser. Two modes:

- **Classic**: standard rules. 10x20 board, 7-bag randomizer, line clears score 100/300/500/800 x level, level up every 10 lines.
- **Override**: rules TBD. Currently identical to Classic; see `src/core/modes/override.ts`.

## Run

```bash
npm install
npm run dev
```

## Scripts

| Script                  | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `npm run dev`           | Vite dev server                                              |
| `npm test`              | Unit tests (engine, lint guards, CSP, version checks)        |
| `npm run lint`          | Type check + ESLint + Prettier check                         |
| `npm run format`        | Prettier, write                                              |
| `npm run build`         | Type check + production build (with the CSP meta tag)        |
| `npm run check:version` | This branch's version is higher than `origin/main`'s         |
| `npm run prepare`       | Points git at `.githooks` (runs on `npm install` / `npm ci`) |

## CI and deploy

- Every PR and every push to `main` runs `.github/workflows/ci.yml`: lint, unit tests, build. `Lint, test, build` is the single required check on `main`.
- Every PR raises `package.json`'s version over `main`'s (`npm version patch --no-git-tag-version`). CI checks it (Dependabot's PRs are let through), and the pre-push hook refuses a push that doesn't (`git push --no-verify` skips the hook).
- Once the check is green on `main`, the build deploys to GitHub Pages.
- Lint guards (`eslint.config.js`, proven by `src/lint.test.ts`): no `Math.random` outside `src/core/pieces.ts`; no `innerHTML` or other HTML/eval sinks; `src/core/**` uses no DOM, storage or UI imports.

## Layout

```
src/
  core/           pure engine, no DOM (unit-tested)
    game.ts       board, movement, locking, line clears
    pieces.ts     shapes, rotation, seeded 7-bag
    session.ts    gravity clock, pause and resume countdown
    snapshot.ts   versioned save format for a game in progress, validated on read
    modes/        Mode interface + classic + override
  ui/             pure UI helpers, no DOM (unit-tested)
    fit.ts        board sizing to whole device pixels
    gestures.ts   touch gesture recognition
    keys.ts       keyboard map
    lifecycle.ts  auto-pause when the game leaves the screen
    save.ts       keeps the unfinished game in localStorage
  main.ts         canvas render + keyboard, touch and button input
tools/            version check + pre-push hook (CI and local)
```

To change a mode's rules, implement the `Mode` hooks in its file. If a rule needs a hook the engine doesn't have yet, add it to `src/core/modes/mode.ts` and call it from `game.ts`.

## Controls

- Keyboard: ← → move · ↑ rotate · ↓ soft drop · Space hard drop · P / Esc pause
- Touch, on the board: tap rotate · drag sideways to move one column per cell · drag down to soft drop · flick down to hard drop
- Touch buttons (touch screens only; ← → ↓ repeat while held): ← → ↓ ⤓ ↻ under the board in portrait, beside it in landscape; Pause sits next to Start
- Pause: the menu covers the board (Resume, Restart, Quit); Resume and Restart count down 3-2-1 before pieces fall. The game also pauses itself when the tab or app goes to the background, the device locks or the window loses focus.
- Reload: the game in progress is saved on every lock and on pause. After a reload (or iOS evicting the tab) the page offers Resume game? (Resume, Discard); Resume continues paused, exactly where it was. Game over, Discard and Quit clear the save; if storage is unavailable, play goes on without it. Start stays disabled until the player answers the offer. The save is per browser, not per tab: two tabs playing at once overwrite each other's save.
