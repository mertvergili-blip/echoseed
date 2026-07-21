import { defineConfig, devices } from "@playwright/test";

/**
 * Persistent smoke-test suite for the ECHOSEED browser build. Exercises real
 * user flows against the Vite dev server and asserts on actual simulation
 * state changes (population counts, HUD values, DOM state), not just that
 * elements exist. Any console error, unhandled rejection, or failed network
 * request fails the test — see tests/e2e/helpers.ts.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // each test drives a fresh simulation; keep it simple and deterministic
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30000,
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium",
          // Without these, the software (swiftshader) WebGL renderer used in
          // this sandboxed/GPU-less environment loses its context after
          // enough sequential page loads within one browser process —
          // surfaces as PixiJS "Could not retrieve shader source (WebGL
          // context may be lost)" partway through a full test run. These
          // flags matched what worked reliably across many page loads during
          // manual verification earlier in development.
          args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
        },
      },
    },
  ],
  webServer: {
    command: "pnpm dev -- --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
