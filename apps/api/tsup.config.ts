import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so they're bundled in; npm dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  noExternal: [/^@divvy\//, "bn.js"],
  // Bundled CommonJS code (bn.js, parts of the Raydium SDK) calls require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __divvyCreateRequire } from "node:module"; const require = __divvyCreateRequire(import.meta.url);' },
  external: ["@prisma/client", "sharp"],
});
