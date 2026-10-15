import { COLS, Game, ROWS } from './core/game.ts';
import { MODES } from './core/modes/index.ts';
import { cellsOf, colorIndex } from './core/pieces.ts';

const COLORS = ['#000', '#0ff', '#ff0', '#a0f', '#0f0', '#f00', '#00f', '#f80'];
const CELL = 30;

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const modeSelect = document.querySelector<HTMLSelectElement>('#mode')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const $ = (id: string) => document.querySelector<HTMLElement>(id)!;

let game: Game | null = null;
let paused = false;
let lastDrop = 0;

function start(): void {
  const mode = MODES[modeSelect.value] ?? MODES.classic!;
  game = new Game(mode);
  paused = false;
  lastDrop = performance.now();
  $('#status').textContent = mode.name;
  startBtn.blur();
}

function drawCell(x: number, y: number, color: number): void {
  if (y < 0) return;
  ctx.fillStyle = COLORS[color] ?? '#fff';
  ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
}

function render(): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
  if (!game) return;
  const s = game.state;
  s.board.forEach((row, y) => row.forEach((c, x) => c && drawCell(x, y, c)));
  if (!s.over) {
    for (const [cx, cy] of cellsOf(s.piece.kind, s.piece.rot)) {
      drawCell(s.piece.x + cx, s.piece.y + cy, colorIndex(s.piece.kind));
    }
  }
  $('#score').textContent = String(s.score);
  $('#lines').textContent = String(s.lines);
  $('#level').textContent = String(s.level);
  if (s.over) $('#status').textContent = 'Game over';
  else if (paused) $('#status').textContent = 'Paused';
  else $('#status').textContent = s.mode.name;
}

function loop(now: number): void {
  if (game && !paused && !game.state.over && now - lastDrop >= game.state.mode.gravityMs(game.state.level)) {
    game.step();
    lastDrop = now;
  }
  render();
  requestAnimationFrame(loop);
}

document.addEventListener('keydown', (e) => {
  if (!game || game.state.over) return;
  if (e.key === 'p' || e.key === 'P') paused = !paused;
  if (paused) return;
  switch (e.key) {
    case 'ArrowLeft':
      game.move(-1);
      break;
    case 'ArrowRight':
      game.move(1);
      break;
    case 'ArrowUp':
      game.rotate();
      break;
    case 'ArrowDown':
      if (game.step()) game.state.score += 1;
      lastDrop = performance.now();
      break;
    case ' ':
      game.hardDrop();
      break;
    default:
      return;
  }
  e.preventDefault();
});

startBtn.addEventListener('click', start);
requestAnimationFrame(loop);
