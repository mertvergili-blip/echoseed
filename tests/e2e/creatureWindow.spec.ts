import { test, expect, clearSave, waitForTickAdvance } from "./helpers";

test.beforeEach(async ({ trackedPage: page }) => {
  await clearSave(page);
});

test("Desktop Creature button opens a popup that renders without errors", async ({ trackedPage: page, context }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: /Desktop Creature/ }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("networkidle");

  // The popup must actually be the creature view, not a blank/error page.
  await expect(popup.locator(".creature-stage")).toBeVisible({ timeout: 5000 });
  await popup.waitForTimeout(1500);
  const status = await popup.locator(".creature-status").textContent();
  expect(status?.length ?? 0).toBeGreaterThan(0);

  await popup.close();
});

test("right-clicking the creature opens a context menu with all five actions", async ({ trackedPage: page, context }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: /Desktop Creature/ }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("networkidle");
  await popup.waitForTimeout(1000);

  await popup.locator(".creature-stage").click({ button: "right", position: { x: 100, y: 100 } });
  const menu = popup.locator(".creature-menu");
  await expect(menu).toBeVisible();
  const items = await menu.locator("button").allTextContents();
  expect(items.some((t) => /Feed/.test(t))).toBe(true);
  expect(items.some((t) => /Pet/.test(t))).toBe(true);
  expect(items.some((t) => /Sleep/.test(t))).toBe(true);
  expect(items.some((t) => /Return/.test(t))).toBe(true);
  expect(items.some((t) => /Open Terrarium/.test(t))).toBe(true);

  await popup.close();
});

test("clicking Feed in the menu actually reduces hunger (not swallowed by drag handling)", async ({
  trackedPage: page,
  context,
}) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: /Desktop Creature/ }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("networkidle");
  await popup.waitForTimeout(1000);

  const statusBefore = await popup.locator(".creature-status").textContent();
  await popup.locator(".creature-stage").click({ button: "right", position: { x: 100, y: 100 } });
  await popup.locator(".creature-menu button", { hasText: "Feed" }).click();
  await popup.waitForTimeout(300);
  const statusAfter = await popup.locator(".creature-status").textContent();

  // The menu must close after the action (proves the click was actually handled).
  await expect(popup.locator(".creature-menu")).toHaveCount(0);
  expect(statusAfter).not.toBe(statusBefore);

  await popup.close();
});
