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

| Script          | What it does                    |
| --------------- | ------------------------------- |
| `npm run dev`   | Vite dev server                 |
| `npm test`      | Unit tests (engine only)        |
| `npm run lint`  | Type check                      |
| `npm run build` | Type check + production build   |

## Layout

```
src/
  core/           pure engine, no DOM (unit-tested)
    game.ts       board, movement, locking, line clears
    pieces.ts     shapes, rotation, seeded 7-bag
    modes/        Mode interface + classic + override
  main.ts         canvas render + keyboard input
```

To change a mode's rules, implement the `Mode` hooks in its file. If a rule needs a hook the engine doesn't have yet, add it to `src/core/modes/mode.ts` and call it from `game.ts`.

## Controls

← → move · ↑ rotate · ↓ soft drop · Space hard drop · P pause
