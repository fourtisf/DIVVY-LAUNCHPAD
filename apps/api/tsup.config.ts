import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so they're bundled in; npm dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  noExternal: [/^@divvy\//],
  external: ["@prisma/client", "sharp"],
});
