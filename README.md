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

| Script                  | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server                                                       |
| `npm test`              | Unit tests (engine, lint guards, CSP, version checks, cloud save SQL) |
| `npm run lint`          | Type check + ESLint + Prettier check                                  |
| `npm run format`        | Prettier, write                                                       |
| `npm run build`         | Type check + production build (with the CSP meta tag)                 |
| `npm run check:version` | This branch's version is higher than `origin/main`'s                  |
| `npm run prepare`       | Points git at `.githooks` (runs on `npm install` / `npm ci`)          |

## CI and deploy

- Every PR and every push to `main` runs `.github/workflows/ci.yml`: lint, unit tests, build. `Lint, test, build` is the single required check on `main`.
- Every PR raises `package.json`'s version over `main`'s (`npm version patch --no-git-tag-version`). CI checks it (Dependabot's PRs are let through), and the pre-push hook refuses a push that doesn't (`git push --no-verify` skips the hook).
- Once the check is green on `main`, the build deploys to GitHub Pages.
- Cloud save: with the Actions variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, the build can reach that Supabase project (its origin joins the CSP's `connect-src`); with neither, it ships without cloud save. Backend setup: `supabase/README.md`.
- Lint guards (`eslint.config.js`, proven by `src/lint.test.ts`): no `Math.random` outside `src/core/pieces.ts`; no `innerHTML` or other HTML/eval sinks; `src/core/**` uses no DOM, storage or UI imports.

## Layout

```
src/
  core/           pure engine, no DOM (unit-tested)
    game.ts       board, movement, locking, line clears
    pieces.ts     shapes, rotation, seeded 7-bag
    profile.ts    player profile: name, bests, rung stars, totals; validated on read; merge
    session.ts    gravity clock, pause and resume countdown
    snapshot.ts   versioned save format for a game in progress, validated on read
    modes/        Mode interface + classic + override
  ui/             pure UI helpers, no DOM (unit-tested)
    cloud.ts      cloud save client: anonymous sign-in, sync and merge, device link codes
    fit.ts        board sizing to whole device pixels
    gestures.ts   touch gesture recognition
    keys.ts       keyboard map
    lifecycle.ts  auto-pause when the game leaves the screen
    played.ts     when a game counts toward the profile (once, at its end)
    profile.ts    keeps the player profile in localStorage
    save.ts       keeps the unfinished game in localStorage
  main.ts         canvas render + keyboard, touch and button input
supabase/         cloud save backend: migrations, SQL tests (PGlite), setup README
tools/            version check + pre-push hook (CI and local)
```

To change a mode's rules, implement the `Mode` hooks in its file. If a rule needs a hook the engine doesn't have yet, add it to `src/core/modes/mode.ts` and call it from `game.ts`.

## Controls

- Keyboard: ← → move · ↑ rotate · ↓ soft drop · Space hard drop · P / Esc pause · ? controls guide (shown beside the board on the first Start until closed)
- Touch, on the board: tap rotate · drag sideways to move one column per cell · drag down to soft drop · flick down to hard drop
- Touch buttons (touch screens only; ← → ↓ repeat while held): ← → ↓ ⤓ ↻ under the board in portrait, beside it in landscape; Pause sits next to Start
- Pause: the menu covers the board (Resume, Restart, Quit); Resume and Restart count down 3-2-1 before pieces fall. The game also pauses itself when the tab or app goes to the background, the device locks or the window loses focus.
- Reload: the game in progress is saved on every lock and on pause. After a reload (or iOS evicting the tab) the page offers Resume game? (Resume, Discard); Resume continues paused, exactly where it was. Game over, Discard and Quit clear the save; if storage is unavailable, play goes on without it. Start stays disabled until the player answers the offer. The save is per browser, not per tab: two tabs playing at once overwrite each other's save.
- Profile: created on first launch as "Player" and kept in `localStorage` (`quadrix.profile`, versioned). It records the best score and most lines per mode, games played, total lines, and best stars per ladder rung (the highest rung unlocked follows from them). Edit the name in the Name field (Enter saves, Escape cancels; focusing it pauses the game): it is trimmed, cut to 16 characters, and stripped of control, bidi, zero-width and blank characters; a name with no letter, digit or emoji falls back to "Player". Best shows the record for the selected mode, or the current score once it beats it. A game counts when it ends (game over, Quit, Restart, a new Start, or Discard of a saved game) once a piece has locked. Invalid stored fields are reset one by one; if storage is unavailable the profile lives in memory for the visit. Every change is applied to the profile as stored at that moment, so games recorded in two tabs both count. A profile saved by a later version is read but never written back.
