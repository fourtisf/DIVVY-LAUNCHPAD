import { describe, expect, it } from "vitest";
import { ahash64, hamming, IMAGE_HAMMING_LIMIT, phash64, toGray } from "../src";

/** Box-filter downscale of a square grayscale image (stands in for sharp's resize in tests). */
function resize(src: Float64Array, from: number, to: number): Float64Array {
  const out = new Float64Array(to * to);
  const f = from / to;
  for (let y = 0; y < to; y++)
    for (let x = 0; x < to; x++) {
      let s = 0, n = 0;
      for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++)
        for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) {
          s += src[yy * from + xx]!;
          n++;
        }
      out[y * to + x] = s / n;
    }
  return out;
}

/** A test "meme": gradient background, a big disc and two eyes. */
function face(size: number, opts: { cx?: number; eye?: number } = {}): Float64Array {
  const g = new Float64Array(size * size);
  const cx = (opts.cx ?? 0.5) * size, cy = 0.58 * size, r = 0.32 * size;
  const eye = (opts.eye ?? 0.07) * size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 60 + (140 * (x + y)) / (2 * size);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) v = 200;
      for (const ex of [cx - 0.12 * size, cx + 0.12 * size]) if ((x - ex) ** 2 + (y - 0.5 * size) ** 2 < eye * eye) v = 20;
      g[y * size + x] = v;
    }
  return g;
}

function checker(size: number, cells: number): Float64Array {
  const g = new Float64Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) g[y * size + x] = (Math.floor((x * cells) / size) + Math.floor((y * cells) / size)) % 2 ? 230 : 25;
  return g;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("phash64", () => {
  const original = face(256);
  const h0 = phash64(resize(original, 256, 32));

  it("is a 64-bit hex string and stable", () => {
    expect(h0).toMatch(/^[0-9a-f]{16}$/);
    expect(phash64(resize(original, 256, 32))).toBe(h0);
  });

  it("sees resized copies as the same picture", () => {
    const small = resize(original, 256, 128);
    expect(hamming(h0, phash64(resize(small, 128, 32)))).toBeLessThanOrEqual(IMAGE_HAMMING_LIMIT);
    const tiny = resize(original, 256, 64);
    expect(hamming(h0, phash64(resize(tiny, 64, 32)))).toBeLessThanOrEqual(IMAGE_HAMMING_LIMIT);
  });

  it("sees brightness, contrast and light noise changes as the same picture", () => {
    const brighter = original.map((v) => Math.min(255, v + 25));
    const flatter = original.map((v) => 128 + (v - 128) * 0.7);
    const rnd = seeded(7);
    const noisy = original.map((v) => v + (rnd() - 0.5) * 20);
    for (const img of [brighter, flatter, noisy]) expect(hamming(h0, phash64(resize(img, 256, 32)))).toBeLessThanOrEqual(IMAGE_HAMMING_LIMIT);
  });

  it("sees recoloured copies as the same picture after the luma conversion", () => {
    // Same picture tinted: RGB channels scaled differently, then converted to luma.
    const rgba = (img: Float64Array, k: [number, number, number]) => {
      const out = new Float64Array(img.length * 4);
      img.forEach((v, i) => {
        out[i * 4] = Math.min(255, v * k[0]);
        out[i * 4 + 1] = Math.min(255, v * k[1]);
        out[i * 4 + 2] = Math.min(255, v * k[2]);
        out[i * 4 + 3] = 255;
      });
      return out;
    };
    const a = phash64(resize(toGray(rgba(original, [1, 1, 1])), 256, 32));
    const b = phash64(resize(toGray(rgba(original, [1.1, 0.85, 1.2])), 256, 32));
    expect(hamming(a, b)).toBeLessThanOrEqual(IMAGE_HAMMING_LIMIT);
  });

  it("tells different pictures apart", () => {
    const other = phash64(resize(checker(256, 6), 256, 32));
    expect(hamming(h0, other)).toBeGreaterThan(IMAGE_HAMMING_LIMIT);
    const moved = phash64(resize(face(256, { cx: 0.3, eye: 0.11 }), 256, 32));
    expect(hamming(h0, moved)).toBeGreaterThan(IMAGE_HAMMING_LIMIT);
  });

  it("rejects input of the wrong size", () => {
    expect(() => phash64(new Float64Array(10))).toThrow();
  });
});

describe("ahash64 (prototype parity)", () => {
  it("matches for resized copies and differs for other pictures", () => {
    const a = ahash64(resize(face(256), 256, 32));
    expect(hamming(a, ahash64(resize(resize(face(256), 256, 64), 64, 32)))).toBeLessThanOrEqual(IMAGE_HAMMING_LIMIT);
    expect(hamming(a, ahash64(resize(checker(256, 6), 256, 32)))).toBeGreaterThan(IMAGE_HAMMING_LIMIT);
  });
});

describe("hamming", () => {
  it("counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("00000000000000f0", "0000000000000010")).toBe(3);
    expect(() => hamming("00", "000")).toThrow();
  });
});
