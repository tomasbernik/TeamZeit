import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  prettier,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["services/api/**/*.ts", "*.config.{js,ts}", "database/scripts/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
);
