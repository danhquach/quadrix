# Quadrix

**Play:** https://danhquach.github.io/quadrix/ (deployed from `main`)

Falling-block puzzle game for the browser. Two modes:

- **Classic**: 10x20 board, bag randomizer, line clears score 100/300/500/800 x level, level up every 10 lines. Every level is faster: 800 ms a row at level 1, easing off toward a 50 ms floor reached at level 21. From level 6, every 5 levels (6, 11, 16 … 46) two 5-block pieces join the bag, a mirror pair together, until all 18 are in; a "New pieces!" banner announces them, and they arrive from the next bag. Ladder rungs use the same speed but deal the 7 standard pieces only.
- **Override**: rules TBD. Currently Classic with its original speed (800 ms, 70 ms faster a level down to 80 ms) and the 7 standard pieces only; see `src/core/modes/override.ts`.

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
    pieces.ts     shapes (7 tetrominoes, 18 pentominoes), rotation, seeded bag
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
    sound.ts      which sounds each frame plays; the effect and music notes
    audio.ts      Web Audio playback: effects, music loop, mute, volumes
  main.ts         canvas render + keyboard, touch and button input
supabase/         cloud save backend: migrations, SQL tests (PGlite), setup README
tools/            version check + pre-push hook (CI and local)
```

To change a mode's rules, implement the `Mode` hooks in its file. If a rule needs a hook the engine doesn't have yet, add it to `src/core/modes/mode.ts` and call it from `game.ts`.

## Sound

- Effects for move, rotate, lock, line clear (longer and higher for bigger clears), level up and game over; one music loop that plays only while a game runs, so it stops on pause and carries on after the countdown.
- Mute: the Mute button beside Settings, or M at any time. Mute, effects volume and music volume are stored with the settings; Reset to defaults keeps the mute choice. M can't be bound: a binding on M stored by an earlier version falls back to the default keys.
- No sound plays before the player's first click, tap or key press (browser autoplay rules).
- No audio files: every sound, the music included, is original and synthesized in code at runtime (`src/ui/sound.ts`, `src/ui/audio.ts`), so the repo carries no third-party audio and nothing to license.

## Controls

- Keyboard: ← → move · ↑ rotate · ↓ soft drop · Space hard drop · P / Esc pause · M mute · ? controls guide (shown beside the board on the first Start until closed)
- Held keys: ← → and ↓ repeat on the game's own timing, the same on every computer (the computer's key repeat is ignored): one move on press, then after 167 ms one move every 33 ms. With ← and → both held, the last one pressed wins; releasing it falls back to the other after a fresh delay. A key held through a pause waits a fresh delay when play resumes. ↑ and Space act once per press.
- Touch, on the board: tap rotate · drag sideways to move one column per cell · drag down to soft drop · flick down to hard drop
- Touch buttons (touch screens only; ← → ↓ repeat while held): ← → ↓ ⤓ ↻ under the board in portrait, beside it in landscape; Pause sits next to Start
- Pause: the menu covers the board (Resume, Restart, Quit); Resume and Restart count down 3-2-1 before pieces fall. The game also pauses itself when the tab or app goes to the background, the device locks or the window loses focus.
- Reload: the game in progress is saved on every lock and on pause. After a reload (or iOS evicting the tab) the page offers Resume game? (Resume, Discard); Resume continues paused, exactly where it was. Game over, Discard and Quit clear the save; if storage is unavailable, play goes on without it. Start stays disabled until the player answers the offer. The save is per browser, not per tab: two tabs playing at once overwrite each other's save.
- Profile: created on first launch as "Player" and kept in `localStorage` (`quadrix.profile`, versioned). It records the best score and most lines per mode, games played, total lines, and best stars per ladder rung (the highest rung unlocked follows from them). Edit the name in the Name field (Enter saves, Escape cancels; focusing it pauses the game): it is trimmed, cut to 16 characters, and stripped of control, bidi, zero-width and blank characters; a name with no letter, digit or emoji falls back to "Player". Best shows the record for the selected mode, or the current score once it beats it. A game counts when it ends (game over, Quit, Restart, a new Start, or Discard of a saved game) once a piece has locked. Invalid stored fields are reset one by one; if storage is unavailable the profile lives in memory for the visit. Every change is applied to the profile as stored at that moment, so games recorded in two tabs both count. A profile saved by a later version is read but never written back.
