import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so they're bundled in; npm dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  noExternal: [/^@divvy\//, "bn.js"],
  // Bundled CommonJS code (bn.js, parts of the Raydium SDK) calls require() and reads __filename;
  // give the ESM bundle both. Without __filename, the bundled `bindings` package (under bigint-buffer)
  // leaves a broken Error.prepareStackTrace behind, and the next error's stack crashes the process.
  banner: {
    js: [
      'import { createRequire as __divvyCreateRequire } from "node:module";',
      'import { fileURLToPath as __divvyFileURLToPath } from "node:url";',
      "const require = __divvyCreateRequire(import.meta.url);",
      "const __filename = __divvyFileURLToPath(import.meta.url);",
      'const __dirname = __divvyFileURLToPath(new URL(".", import.meta.url));',
    ].join(" "),
  },
  external: ["@prisma/client"],
});
