import { test as base, expect, type Page } from "@playwright/test";

/**
 * Extended Playwright test that fails automatically on any console error,
 * page error (unhandled exception/rejection), or failed network request.
 * Individual tests only need to assert on the actual behavior they're
 * checking; this catches everything else that would otherwise pass silently.
 *
 * A tiny allowlist exists for noise that isn't a real bug (see ALLOWED_*
 * below) — kept minimal and each entry justified in a comment, not a
 * catch-all escape hatch.
 */

const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // React 18 StrictMode intentionally double-invokes effects in dev to surface
  // cleanup bugs; this is expected noise from the framework, not an app bug.
  /Warning: ReactDOM\.render is no longer supported/,
];

interface ConsoleIssue {
  type: string;
  text: string;
}

type Fixtures = {
  trackedPage: Page;
};

export const test = base.extend<Fixtures>({
  trackedPage: async ({ page }, use) => {
    const issues: ConsoleIssue[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (ALLOWED_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
      issues.push({ type: "console.error", text });
    });
    page.on("pageerror", (err) => {
      issues.push({ type: "pageerror", text: err.message });
    });
    page.on("requestfailed", (req) => {
      // Ignore aborted requests from navigations we triggered ourselves.
      const failure = req.failure();
      if (failure && /net::ERR_ABORTED/.test(failure.errorText)) return;
      failedRequests.push(`${req.method()} ${req.url()} — ${failure?.errorText ?? "unknown"}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await use(page);

    const problems = [
      ...issues.map((i) => `[${i.type}] ${i.text}`),
      ...failedRequests.map((f) => `[network] ${f}`),
    ];
    expect(problems, `Unexpected console/network issues:\n${problems.join("\n")}`).toEqual([]);
  },
});

export { expect };

/** Reset persisted state so each test starts from a genuinely fresh world. */
export async function clearSave(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("echoseed-save");
    } catch {
      /* ignore */
    }
  });
}

/** Read a HUD chip's numeric value by its label text (e.g. "Tick", "Gen"). */
export async function hudValue(page: Page, label: string): Promise<string> {
  const chip = page.locator(".hud-chip", { has: page.locator(".label", { hasText: label }) });
  return (await chip.locator(".val").first().textContent())?.trim() ?? "";
}

/** Read the live population counts from the HUD species chip. */
export async function speciesCounts(page: Page): Promise<{ plants: number; herbivores: number; predators: number }> {
  const chip = page.locator(".hud-chip", { has: page.locator(".dot.plant") });
  const vals = await chip.locator(".val").allTextContents();
  return {
    plants: parseInt(vals[0] ?? "0", 10),
    herbivores: parseInt(vals[1] ?? "0", 10),
    predators: parseInt(vals[2] ?? "0", 10),
  };
}

export async function waitForTickAdvance(page: Page, minDelta = 1, timeoutMs = 5000): Promise<void> {
  const start = parseInt(await hudValue(page, "Tick"), 10);
  await expect
    .poll(async () => parseInt(await hudValue(page, "Tick"), 10), { timeout: timeoutMs })
    .toBeGreaterThanOrEqual(start + minDelta);
}

const SPECIES_IDX: Record<"plant" | "herbivore" | "predator", number> = {
  plant: 0,
  herbivore: 1,
  predator: 2,
};

/**
 * Click an actual live organism of the given species (any species if
 * omitted) via the app's e2e test hook (window.__echoseedTestHook — see
 * App.tsx), rather than scanning blind screen positions and hoping one
 * lands on a sprite. Organism sprites are canvas pixels, not DOM nodes, so
 * there's no locator that can find "an organism" directly; the old
 * approach (click ~40-80 pseudo-random points) was slow and could burn a
 * whole test timeout on bad luck even though hits weren't rare. This
 * reads the live organism list and the renderer's own world->screen
 * transform, so the click lands on a real target every time.
 */
export async function clickOrganism(
  page: Page,
  species?: "plant" | "herbivore" | "predator",
): Promise<{ id: number; species: "plant" | "herbivore" | "predator" }> {
  const target = await page.evaluate((wantedIdx) => {
    const hook = window.__echoseedTestHook;
    if (!hook) return null;
    const o = hook.organisms.find((o) => wantedIdx == null || o.species === wantedIdx);
    if (!o) return null;
    const p = hook.screenPointFromWorld(o.x, o.y);
    return { id: o.id, species: o.species, x: p.x, y: p.y };
  }, species != null ? SPECIES_IDX[species] : undefined);
  if (!target) throw new Error(`clickOrganism: no ${species ?? "organism"} available to click`);
  const speciesNames = ["plant", "herbivore", "predator"] as const;
  // Click the canvas itself, not the .stage wrapper div: the app's click
  // handler computes screen coords relative to the canvas's own
  // bounding rect (see onStageClick in App.tsx), and screenPointFromWorld
  // returns coords in that same space. Clicking .stage instead would be
  // off by .stage's border width — small, but pointless to tolerate when
  // exactness is free here.
  await page.locator(".stage canvas").first().click({ position: { x: target.x, y: target.y } });
  return { id: target.id, species: speciesNames[target.species] };
}
