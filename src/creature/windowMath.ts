/**
 * Pure, unit-testable geometry helpers for the desktop creature window.
 * Kept separate from the Tauri-API-calling code in creature.tsx so the
 * actual math (easy to get wrong around multi-monitor coordinate systems)
 * can be verified without a running Tauri process.
 */

export interface RectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Clamp a desired window position so the window stays fully within the
 * given monitor's bounds.
 *
 * Tauri's window position/size APIs use *global* virtual-desktop
 * coordinates that span every monitor, not coordinates relative to
 * whichever monitor the window happens to be on. A monitor's own bounds
 * (from `currentMonitor()`) come back the same way: `position` is that
 * monitor's offset in the global space, which is nonzero (and can be
 * negative) for any monitor that isn't the top-left-most one. Clamping
 * against `[0, monitor.width]` instead of
 * `[monitor.position.x, monitor.position.x + monitor.width]` sends the
 * window's target position outside the actual monitor on any layout where
 * the current monitor doesn't start at the global origin — visually "losing"
 * the creature off-screen or dragging it toward whatever happens to occupy
 * that coordinate range on a different monitor.
 */
export function clampToMonitor(
  monitor: RectBounds,
  windowSize: { w: number; h: number },
  desired: { x: number; y: number },
): { x: number; y: number } {
  const minX = monitor.x;
  const maxX = monitor.x + Math.max(0, monitor.w - windowSize.w);
  const minY = monitor.y;
  const maxY = monitor.y + Math.max(0, monitor.h - windowSize.h);
  return {
    x: Math.max(minX, Math.min(maxX, desired.x)),
    y: Math.max(minY, Math.min(maxY, desired.y)),
  };
}

/**
 * Clamp a context menu's top-left position so the whole menu stays within
 * the viewport it's rendered in — important for the desktop creature's tiny
 * (~220x220) window, where a menu positioned at the raw click coordinates
 * routinely extends past the window edge and gets clipped by the window's
 * `overflow: hidden`, making the clipped items unreachable.
 */
export function clampMenuPosition(
  desired: { x: number; y: number },
  menuSize: { w: number; h: number },
  viewport: { w: number; h: number },
  margin = 4,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.w - menuSize.w - margin);
  const maxY = Math.max(margin, viewport.h - menuSize.h - margin);
  return {
    x: Math.max(margin, Math.min(maxX, desired.x)),
    y: Math.max(margin, Math.min(maxY, desired.y)),
  };
}

/**
 * How many seconds of "offline" creature-need simulation to catch up on
 * when the desktop creature window reopens after being closed, based on
 * the save file's timestamp. Capped so an absence of days/weeks/years
 * doesn't require simulating an absurd duration — needs saturate at their
 * bounds anyway (hunger maxes at 1, energy floors at 0), so anything beyond
 * the cap produces the same end state as the cap itself.
 */
export function offlineCatchupSeconds(
  savedAtMs: number,
  nowMs: number,
  maxSeconds = 6 * 3600,
): number {
  const elapsed = (nowMs - savedAtMs) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, maxSeconds);
}
