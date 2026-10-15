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
    modes/        Mode interface + classic + override
  main.ts         canvas render + keyboard input
tools/            version check + pre-push hook (CI and local)
```

To change a mode's rules, implement the `Mode` hooks in its file. If a rule needs a hook the engine doesn't have yet, add it to `src/core/modes/mode.ts` and call it from `game.ts`.

## Controls

← → move · ↑ rotate · ↓ soft drop · Space hard drop · P pause
