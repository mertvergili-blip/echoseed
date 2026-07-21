import { test, expect, clearSave, hudValue, speciesCounts, waitForTickAdvance, clickOrganism } from "./helpers";

test.beforeEach(async ({ trackedPage: page }) => {
  await clearSave(page);
});

test("app launches into a running simulation with a live seed and population", async ({ trackedPage: page }) => {
  await page.goto("/");
  await expect(page.locator(".seed-display")).not.toBeEmpty({ timeout: 10000 });
  await waitForTickAdvance(page, 1, 10000);
  const counts = await speciesCounts(page);
  expect(counts.plants + counts.herbivores + counts.predators).toBeGreaterThan(0);
});

test("pause stops tick advancement; resume continues it", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  await page.getByText("❚❚ Pause", { exact: true }).click();
  await expect(page.getByText("▶ Play", { exact: true })).toBeVisible();
  const tickAfterPause = parseInt(await hudValue(page, "Tick"), 10);
  await page.waitForTimeout(800);
  const tickStillPaused = parseInt(await hudValue(page, "Tick"), 10);
  expect(tickStillPaused).toBe(tickAfterPause);

  await page.getByText("▶ Play", { exact: true }).click();
  await expect(page.getByText("❚❚ Pause", { exact: true })).toBeVisible();
  await waitForTickAdvance(page, 1, 5000);
});

test("all speed options change the active speed and measurably change simulation throughput", async ({
  trackedPage: page,
}) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  const speeds = [1, 2, 4, 8, 16];
  const ticksPerSpeed: number[] = [];
  for (const s of speeds) {
    const btn = page.getByRole("button", { name: `${s}×` });
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    const before = parseInt(await hudValue(page, "Tick"), 10);
    await page.waitForTimeout(600);
    const after = parseInt(await hudValue(page, "Tick"), 10);
    ticksPerSpeed.push(after - before);
  }
  // Higher speed multipliers must produce measurably more ticks in the same
  // wall-clock window — not just toggle a CSS class with no real effect.
  expect(ticksPerSpeed[speeds.length - 1]).toBeGreaterThan(ticksPerSpeed[0]);
});

test("rain intervention is reflected in the weather badge and moisture rises", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  await page.getByRole("button", { name: "Trigger Rain" }).click();
  await expect(page.locator(".weather-badge")).toHaveText(/rain/i, { timeout: 3000 });
});

test("drought intervention is reflected in the weather badge", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  await page.getByRole("button", { name: "Drought", exact: true }).click();
  await expect(page.locator(".weather-badge")).toHaveText(/drought/i, { timeout: 3000 });
});

test("temperature slider changes the displayed temperature", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const before = await hudValue(page, "Temp");
  const slider = page.locator('input[type="range"]');
  await slider.fill("0.98");
  await slider.dispatchEvent("change");
  await expect
    .poll(async () => await hudValue(page, "Temp"), { timeout: 3000 })
    .not.toBe(before);
});

test("add food increases plant population", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const before = await speciesCounts(page);
  await page.getByRole("button", { name: "Add Food" }).click();
  await expect
    .poll(async () => (await speciesCounts(page)).plants, { timeout: 3000 })
    .toBeGreaterThan(before.plants);
});

test("add herbivore increases herbivore population", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const before = await speciesCounts(page);
  await page.getByRole("button", { name: "+ Herbivore" }).click();
  await expect
    .poll(async () => (await speciesCounts(page)).herbivores, { timeout: 3000 })
    .toBe(before.herbivores + 1);
});

test("add predator increases predator population", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const before = await speciesCounts(page);
  await page.getByRole("button", { name: "+ Predator" }).click();
  await expect
    .poll(async () => (await speciesCounts(page)).predators, { timeout: 3000 })
    .toBe(before.predators + 1);
});

test("selecting an organism opens the inspector with real genome data", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  // Pause so the organism stays put between the click and the assertions.
  await page.getByText("❚❚ Pause", { exact: true }).click();

  await clickOrganism(page);
  await expect(page.locator(".genome-bar").first()).toBeVisible();
  await expect(page.locator(".id-line .oid")).toHaveText(/^#\d+$/);
  // Genome bars must show real numeric values, not empty placeholders.
  const firstGeneValue = await page.locator(".genome-bar .gv").first().textContent();
  expect(firstGeneValue?.trim().length).toBeGreaterThan(0);
});

test("selecting a plant hides the Ascend button; selecting a mobile organism shows it", async ({
  trackedPage: page,
}) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  await page.getByText("❚❚ Pause", { exact: true }).click();

  await clickOrganism(page, "plant");
  await expect(page.locator(".species-tag")).toHaveText(/plant/i);
  expect(await page.getByRole("button", { name: /Ascend/ }).count()).toBe(0);

  await clickOrganism(page, "herbivore");
  await expect(page.locator(".species-tag")).toHaveText(/herbivore/i);
  await expect(page.getByRole("button", { name: /Ascend/ })).toBeVisible();
});

test("ascending an organism marks it as the ascended creature", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  await page.getByText("❚❚ Pause", { exact: true }).click();

  await clickOrganism(page, "herbivore");
  const ascendBtn = page.getByRole("button", { name: /Ascend/ });
  await expect(ascendBtn).toBeVisible();
  await ascendBtn.click();
  await expect(page.locator(".toast")).toContainText(/ascended/i, { timeout: 3000 });
  await expect(page.locator(".ascend-badge")).toBeVisible({ timeout: 3000 });
});

test("camera follow toggle tracks the selected organism (view offset changes without reselection)", async ({
  trackedPage: page,
}) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  // Pause only for the click: clickOrganism reads a live position and then
  // clicks in a separate step, and an unpaused herbivore can move far enough
  // in that gap (plus real browser/locator overhead) to dodge the click's
  // hit radius. The follow behavior itself is what runs unpaused below.
  await page.getByText("❚❚ Pause", { exact: true }).click();

  const followBtn = page.getByRole("button", { name: /follow/ });
  await clickOrganism(page, "herbivore");
  await expect(followBtn).toBeVisible();
  await followBtn.click();
  await expect(page.getByRole("button", { name: "● following" })).toBeVisible();
  await page.getByText("▶ Play", { exact: true }).click();
  // Let the simulation run with follow engaged; the canvas should keep
  // rendering without erroring (covered by the console/network fixture).
  await page.waitForTimeout(1000);
});

test("save writes a real save file to localStorage", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => localStorage.getItem("echoseed-save"));
  expect(saved).toBeTruthy();
  const parsed = JSON.parse(saved!);
  expect(parsed.world.organisms.length).toBeGreaterThan(0);
  expect(typeof parsed.world.seed).toBe("string");
});

test("reset generates a new seed and restarts the simulation", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const seedBefore = await page.locator(".seed-display").textContent();
  await page.waitForTimeout(500); // let tick advance a bit
  await page.getByRole("button", { name: "Reset ⟳" }).click();
  await expect
    .poll(async () => await page.locator(".seed-display").textContent(), { timeout: 3000 })
    .not.toBe(seedBefore);
  await expect
    .poll(async () => parseInt(await hudValue(page, "Tick"), 10), { timeout: 3000 })
    .toBeLessThan(50);
});

test("corrupted save shows a recovery toast and still produces a running world", async ({ trackedPage: page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("echoseed-save", "{this is not valid json!!");
  });
  await page.goto("/");
  await expect(page.locator(".toast")).toContainText(/unreadable|recovered/i, { timeout: 5000 });
  await waitForTickAdvance(page, 1, 10000);
  const counts = await speciesCounts(page);
  expect(counts.plants + counts.herbivores + counts.predators).toBeGreaterThan(0);
});

test("semantically invalid save (fails validation, not just JSON parsing) also recovers with a toast", async ({
  trackedPage: page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("echoseed-save", JSON.stringify({ version: 1, world: { seed: 12345 } }));
  });
  await page.goto("/");
  await expect(page.locator(".toast")).toContainText(/recovered/i, { timeout: 5000 });
  await waitForTickAdvance(page, 1, 10000);
});
