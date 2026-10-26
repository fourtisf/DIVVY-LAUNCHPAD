// ESLint 8.57 flat config: @next/eslint-plugin-next 14 still calls context.getAncestors, which ESLint 9 removed.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "prototype/**", "**/next-env.d.ts"] },
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
    // Phase 0 scripts are CommonJS so their `require.main === module` entry checks work.
    files: ["packages/solana/scripts/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
