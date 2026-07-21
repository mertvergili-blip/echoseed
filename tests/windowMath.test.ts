import { describe, it, expect } from "vitest";
import { clampToMonitor, clampMenuPosition, offlineCatchupSeconds } from "../src/creature/windowMath";

describe("clampToMonitor", () => {
  it("keeps a window within a monitor at the global origin", () => {
    const monitor = { x: 0, y: 0, w: 1920, h: 1080 };
    const size = { w: 220, h: 220 };
    expect(clampToMonitor(monitor, size, { x: -50, y: -50 })).toEqual({ x: 0, y: 0 });
    expect(clampToMonitor(monitor, size, { x: 5000, y: 5000 })).toEqual({ x: 1700, y: 860 });
    expect(clampToMonitor(monitor, size, { x: 900, y: 500 })).toEqual({ x: 900, y: 500 });
  });

  it("keeps a window within a secondary monitor offset to the right (positive offset)", () => {
    // A monitor positioned to the right of the primary display, e.g. a
    // 1920-wide primary with a second 1920x1080 monitor starting at x=1920.
    const monitor = { x: 1920, y: 0, w: 1920, h: 1080 };
    const size = { w: 220, h: 220 };
    // A naive [0, monitor.w] clamp would put this at x=0, which is on the
    // WRONG monitor entirely.
    expect(clampToMonitor(monitor, size, { x: 100, y: 100 })).toEqual({ x: 1920, y: 100 });
    expect(clampToMonitor(monitor, size, { x: 10000, y: 10000 })).toEqual({ x: 3620, y: 860 });
  });

  it("keeps a window within a monitor with a negative offset (positioned above/left of primary)", () => {
    const monitor = { x: -1920, y: -200, w: 1920, h: 1080 };
    const size = { w: 220, h: 220 };
    expect(clampToMonitor(monitor, size, { x: -3000, y: -3000 })).toEqual({ x: -1920, y: -200 });
    expect(clampToMonitor(monitor, size, { x: -1000, y: -100 })).toEqual({ x: -1000, y: -100 });
  });

  it("never produces a window larger than the monitor even if windowSize exceeds monitor size", () => {
    const monitor = { x: 0, y: 0, w: 100, h: 100 };
    const size = { w: 220, h: 220 };
    const r = clampToMonitor(monitor, size, { x: 50, y: 50 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

describe("clampMenuPosition", () => {
  it("leaves the menu untouched when it fits entirely within the viewport", () => {
    const r = clampMenuPosition({ x: 10, y: 10 }, { w: 150, h: 190 }, { w: 800, h: 600 });
    expect(r).toEqual({ x: 10, y: 10 });
  });

  it("pulls the menu back on-screen for a click near the bottom-right of a small window", () => {
    // This is the desktop creature's real scenario: a ~220x220 window and a
    // menu roughly 150x190 — a click in the lower-right quadrant would
    // otherwise position the menu almost entirely off the visible area.
    const r = clampMenuPosition({ x: 200, y: 200 }, { w: 150, h: 190 }, { w: 220, h: 220 });
    expect(r.x + 150).toBeLessThanOrEqual(220);
    expect(r.y + 190).toBeLessThanOrEqual(220);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps at least the margin from the top-left for a click at the origin", () => {
    const r = clampMenuPosition({ x: 0, y: 0 }, { w: 150, h: 190 }, { w: 220, h: 220 }, 4);
    expect(r.x).toBeGreaterThanOrEqual(4);
    expect(r.y).toBeGreaterThanOrEqual(4);
  });

  it("does not produce a negative position even when the menu is larger than the viewport", () => {
    const r = clampMenuPosition({ x: 50, y: 50 }, { w: 300, h: 300 }, { w: 220, h: 220 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
});

describe("offlineCatchupSeconds", () => {
  it("returns 0 for no elapsed time or a save timestamp in the future", () => {
    const now = 1_000_000;
    expect(offlineCatchupSeconds(now, now)).toBe(0);
    expect(offlineCatchupSeconds(now + 5000, now)).toBe(0);
  });

  it("returns the exact elapsed seconds when under the cap", () => {
    const now = 1_000_000;
    const savedAt = now - 90_000; // 90 seconds ago
    expect(offlineCatchupSeconds(savedAt, now, 3600)).toBeCloseTo(90, 5);
  });

  it("caps very long absences instead of returning an unbounded value", () => {
    const now = Date.now();
    const savedAt = now - 1000 * 3600 * 24 * 30; // 30 days ago
    const result = offlineCatchupSeconds(savedAt, now, 6 * 3600);
    expect(result).toBe(6 * 3600);
  });

  it("handles non-finite or malformed timestamps safely", () => {
    expect(offlineCatchupSeconds(NaN, Date.now())).toBe(0);
    expect(offlineCatchupSeconds(Date.now(), NaN)).toBe(0);
  });
});
