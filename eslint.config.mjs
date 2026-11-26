import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a value that is deliberately left unused (e.g. dropped from a rest spread).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // These three check code for the React Compiler, which this app doesn't enable. They flag
      // deliberate patterns (resetting a dialog when it opens, a ref to the latest callback for
      // canvas gestures, Date.now() in a server page), so they stay visible as warnings.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([".chk-*", ".next/**", "out/**", "node_modules/**", ".local/**", ".e2e/**", "next-env.d.ts", "drizzle/**"]),
]);
