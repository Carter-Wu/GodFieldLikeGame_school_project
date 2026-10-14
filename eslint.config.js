import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  // legacy/ is the old prototype kept for reference; supabase/functions/ is
  // Deno TypeScript, which this config doesn't parse.
  { ignores: ["dist/", "legacy/", "supabase/functions/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{js,ts,tsx}", "tests/**/*.{js,ts,tsx}", "*.{js,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      // Phaser ships a UMD global declaration that TypeScript resolves even
      // without an import -- but Vite bundles it as ESM, so the global
      // doesn't exist at runtime (blank screen, no error at build time).
      // Force the explicit import instead.
      "no-restricted-globals": ["error", { name: "Phaser", message: 'Import it instead: import Phaser from "phaser".' }],
    },
  },
  {
    files: ["scripts/**/*.js", "*.config.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
