// ESLint 8.57 flat config: @next/eslint-plugin-next 14 still calls context.getAncestors, which ESLint 9 removed.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "prototype/**", "**/next-env.d.ts", "**/playwright-report/**", "**/test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
    rules: { ...nextPlugin.configs.recommended.rules, ...reactHooks.configs.recommended.rules },
  },
  {
    // The page's code runs on Next.js's Buffer polyfill, which lacks Node's BigInt reads: a check written
    // with Buffer passed every Node test and stopped every mainnet launch on 2026-10-28. Use Uint8Array
    // and DataView there (lib/txcheck.ts).
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/**/*.test.ts"],
    rules: { "no-restricted-globals": ["error", { name: "Buffer", message: "Buffer in the browser is Next.js's polyfill, without Node's BigInt reads: use Uint8Array and DataView." }] },
  },
  {
    // Phase 0 scripts are CommonJS so their `require.main === module` entry checks work.
    files: ["packages/solana/scripts/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // .cjs files (PM2 configs, brand and load-test scripts) are CommonJS by definition.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Brand scripts drive a browser; their page.evaluate callbacks run there.
    files: ["brand/**/*.cjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
);
