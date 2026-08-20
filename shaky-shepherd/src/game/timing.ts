/**
 * Pure timing math for frame-accurate render interpolation.
 *
 * The render alpha is always measured from the last completed movement tick:
 * `alpha = (now - lastMove) / moveDelay`, clamped to [0, 1]. Because
 * `lastMove` is bumped to the tick instant after every simulation step, a
 * freshly stepped snake renders at alpha 0 (exactly the previous tick's
 * position) and advances monotonically toward alpha 1 — the renderer is never
 * ahead of the simulation, so movement can never appear to snap backwards.
 *
 * `advanceLastMove` also absorbs slow-frame drift (a stall longer than one
 * `moveDelay`) so the simulation never has to catch up with a burst of moves.
 */

/** True when `moveDelay` ms have elapsed since the last movement tick. */
export function isMoveDue(now: number, lastMove: number, moveDelay: number): boolean {
  return now - lastMove >= moveDelay;
}

/**
 * Advance `lastMove` past a completed tick. Returns the tick boundary plus one
 * `moveDelay`, or `now` when the frame was so slow that falling one more
 * `moveDelay` behind would force a catch-up burst.
 */
export function advanceLastMove(now: number, lastMove: number, moveDelay: number): number {
  const next = lastMove + moveDelay;
  return now - next > moveDelay ? now : next;
}

/** Render alpha in [0, 1] — progress between the previous and current tick. */
export function interpolationAlpha(now: number, lastMove: number, moveDelay: number, active: boolean): number {
  if (!active || moveDelay <= 0) return 0;
  return Math.min(1, Math.max(0, now - lastMove) / moveDelay);
}