import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Deliberately used at a few untrusted-data boundaries with explicit
      // `unknown` narrowing already in place (see src/sim/save.ts) — the
      // codebase avoids `any` elsewhere, so a blanket ban isn't necessary,
      // but keep it a warning rather than silence it entirely.
      "@typescript-eslint/no-explicit-any": "warn",
      // Sim/worker/render code intentionally leaves some function
      // parameters unused (event handler signatures, protocol shapes);
      // catch genuinely unused *variables* without flagging those.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // react-hooks rules only make sense for actual React source, not tests
    // or scripts. Applying them to tests/e2e in particular produces a false
    // positive: Playwright's fixture API has a callback parameter literally
    // named `use` (test.extend({ trackedPage: async ({page}, use) => ... })),
    // and eslint-plugin-react-hooks flags any identifier named `use` as if
    // it were React's use() hook, regardless of context.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Test files legitimately construct deliberately malformed/wrong-shaped
    // data to exercise corruption-handling and validation code paths (e.g.
    // "assign a string where a number belongs, then confirm it's sanitized
    // correctly"). Typing those fixtures precisely would fight the test's
    // actual purpose. `any` in *application* code (src/**) stays a warning.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
