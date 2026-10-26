import { describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { withLock } from "../src/lock";
import { roundHour } from "../src/jobs";

describe("roundHour", () => {
  it("floors to the top of the UTC hour", () => {
    expect(roundHour(new Date("2026-10-26T09:59:59.999Z")).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });
});

const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
describe.skipIf(!process.env.REDIS_URL)("withLock (needs REDIS_URL)", () => {
  it("lets only one caller in at a time", async () => {
    const a = new Redis(url), b = new Redis(url);
    const key = "test-" + Date.now();
    let inner: string | null = "unset";
    const outer = await withLock(a, key, 5000, async () => {
      inner = await withLock(b, key, 5000, async () => "second");
      return "first";
    });
    expect(outer).toBe("first");
    expect(inner).toBeNull();
    expect(await withLock(b, key, 5000, async () => "after")).toBe("after");
    await a.quit();
    await b.quit();
  });
});
