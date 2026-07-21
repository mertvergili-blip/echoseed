import { test, expect, clearSave, waitForTickAdvance } from "./helpers";

test.beforeEach(async ({ trackedPage: page }) => {
  await clearSave(page);
});

test("keyboard focus produces a visible outline on interactive controls", async ({ trackedPage: page }) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);

  const pauseButton = page.getByText("❚❚ Pause", { exact: true });
  await pauseButton.focus();
  const outline = await pauseButton.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("range input (temperature slider) is keyboard-focusable with an accessible name", async ({
  trackedPage: page,
}) => {
  await page.goto("/");
  await waitForTickAdvance(page, 1, 10000);
  const slider = page.locator('input[type="range"]');
  await expect(slider).toHaveAttribute("aria-label", /.+/);
  await slider.focus();
  await expect(slider).toBeFocused();
});

test("prefers-reduced-motion disables CSS transition/animation durations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(1000);
  // Trigger the toast (which normally fades in via a CSS animation) and
  // confirm its animation-duration collapses under reduced motion.
  await page.getByRole("button", { name: "Reset ⟳" }).click();
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible({ timeout: 3000 });
  const duration = await toast.evaluate((el) => getComputedStyle(el).animationDuration);
  // "0.001ms" (our override) or effectively-zero; must not be the normal 0.3s.
  expect(duration).not.toBe("0.3s");
});
