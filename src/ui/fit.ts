export interface BoardFit {
  /** Cell edge in device pixels (the canvas backing store). Always a whole number. */
  deviceCell: number;
  /** Backing-store size in device pixels. */
  pxWidth: number;
  pxHeight: number;
  /** Displayed size in CSS pixels: the backing store divided by the pixel ratio, so one canvas pixel is one screen pixel. */
  cssWidth: number;
  cssHeight: number;
}

/**
 * The largest board of `cols` × `rows` whole-device-pixel cells that fits in an
 * `availW` × `availH` CSS-pixel box at device pixel ratio `dpr`.
 * Whole device pixels per cell keep block edges sharp at any ratio.
 */
export function fitBoard(
  availW: number,
  availH: number,
  cols: number,
  rows: number,
  dpr: number,
): BoardFit {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const w = Number.isFinite(availW) && availW > 0 ? availW : 0;
  const h = Number.isFinite(availH) && availH > 0 ? availH : 0;
  const deviceCell = Math.max(1, Math.floor(Math.min((w * ratio) / cols, (h * ratio) / rows)));
  const pxWidth = deviceCell * cols;
  const pxHeight = deviceCell * rows;
  return {
    deviceCell,
    pxWidth,
    pxHeight,
    cssWidth: pxWidth / ratio,
    cssHeight: pxHeight / ratio,
  };
}
