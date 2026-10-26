import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStorage, localStorage } from "../src/storage";

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

describe("production storage guard", () => {
  const prod = (o: Record<string, string>) => () => loadStorage({ NODE_ENV: "production", STORAGE_DRIVER: "local", ...o });
  it("refuses a relative folder, a folder inside the release, http and localhost", () => {
    expect(prod({ STORAGE_DIR: "./data/media", PUBLIC_MEDIA_BASE: "https://divvy.example/media" })).toThrow(/absolute/);
    expect(prod({ STORAGE_DIR: join(process.cwd(), "data/media"), PUBLIC_MEDIA_BASE: "https://divvy.example/media" })).toThrow(/outside the release/);
    expect(prod({ STORAGE_DIR: "/var/lib/divvy/media", PUBLIC_MEDIA_BASE: "http://divvy.example/media" })).toThrow(/https/);
    expect(prod({ STORAGE_DIR: "/var/lib/divvy/media", PUBLIC_MEDIA_BASE: "https://localhost:3000/media" })).toThrow(/public host/);
  });
  it("accepts an absolute folder outside the release with a public https base", () => {
    expect(prod({ STORAGE_DIR: "/var/lib/divvy/media", PUBLIC_MEDIA_BASE: "https://divvy.example/media" })()).toHaveProperty("driver", "local");
  });
});
