import { defineConfig } from "vitest/config";

// The integration tests share one test database, so files run one after another.
export default defineConfig({ test: { fileParallelism: false } });
