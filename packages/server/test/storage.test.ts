import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localStorage } from "../src/storage";

describe("local storage", () => {
  it("stores and reads back under the root, with a public URL", async () => {
    const s = localStorage(mkdtempSync(join(tmpdir(), "divvy-media-")), "https://media.example/m/");
    const url = await s.put("img/ab/abcdef.webp", Buffer.from("x"), "image/webp");
    expect(url).toBe("https://media.example/m/img/ab/abcdef.webp");
    expect((await s.read!("img/ab/abcdef.webp"))?.contentType).toBe("image/webp");
    expect(await s.read!("img/nope.webp")).toBeNull();
  });
  it("refuses path traversal and odd keys", async () => {
    const s = localStorage(mkdtempSync(join(tmpdir(), "divvy-media-")), "https://m.example");
    await expect(s.put("../etc/passwd", Buffer.from(""), "x")).rejects.toThrow();
    await expect(s.put("/abs", Buffer.from(""), "x")).rejects.toThrow();
    await expect(s.put("a/../../b", Buffer.from(""), "x")).rejects.toThrow();
  });
});
