/**
 * Perceptual image hashes (HANDOFF §5, "Picture").
 *
 * Pure functions over grayscale pixels so they run anywhere. The API decodes uploads with `sharp`
 * (re-encode, strip EXIF, resize to 32×32 grayscale) and passes the pixels in.
 *
 * Hashes are 64-bit values serialised as 16 hex characters. Two pictures are treated as copies when
 * the Hamming distance between their pHashes is ≤ IMAGE_HAMMING_LIMIT (6).
 */

export const HASH_SIZE = 32;

/** ITU-R BT.601 luma from interleaved RGBA (or RGB with channels = 3). */
export function toGray(data: ArrayLike<number>, channels: 3 | 4 = 4): Float64Array {
  const n = Math.floor(data.length / channels);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    out[i] = data[o]! * 0.299 + data[o + 1]! * 0.587 + data[o + 2]! * 0.114;
  }
  return out;
}

function bitsToHex(bits: ArrayLike<number>): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!).toString(16);
  }
  return hex;
}

function assertSquare(gray: ArrayLike<number>, size: number): void {
  if (gray.length !== size * size) throw new Error(`expected ${size}x${size} pixels, got ${gray.length}`);
}

let COS: Float64Array | null = null;
function cosTable(): Float64Array {
  if (COS) return COS;
  const N = HASH_SIZE;
  COS = new Float64Array(N * N);
  for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) COS[k * N + n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N));
  return COS;
}

/**
 * pHash: 2-D DCT-II of the 32×32 grayscale image, keep the 8×8 lowest frequencies, and set each bit
 * when the coefficient is above the median of those 64 (DC excluded from the median, as in the
 * reference implementation, so uniform brightness changes don't move the threshold).
 */
export function phash64(gray: ArrayLike<number>): string {
  const N = HASH_SIZE;
  assertSquare(gray, N);
  const C = cosTable();
  const K = 8;
  // Rows first (only the K lowest frequencies are needed), then columns.
  const rows = new Float64Array(N * K);
  for (let y = 0; y < N; y++)
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += gray[y * N + x]! * C[u * N + x]!;
      rows[y * K + u] = s;
    }
  const coeffs = new Float64Array(K * K);
  for (let v = 0; v < K; v++)
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rows[y * K + u]! * C[v * N + y]!;
      coeffs[v * K + u] = s;
    }
  const ac = Array.from(coeffs.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31]! + ac[32]!) / 2;
  const bits = Array.from(coeffs, (c) => (c > median ? 1 : 0));
  return bitsToHex(bits);
}

/** Average hash from the prototype (8×8 block means of 32×32, bit = mean − avg > 2). */
export function ahash64(gray: ArrayLike<number>): string {
  const N = HASH_SIZE;
  assertSquare(gray, N);
  const L = new Array<number>(64).fill(0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) L[(y >> 2) * 8 + (x >> 2)]! += gray[y * N + x]! / 16;
  const avg = L.reduce((a, b) => a + b, 0) / 64;
  return bitsToHex(L.map((v) => (v - avg > 2 ? 1 : 0)));
}

/** Difference hash on a 9×8 grayscale image (row-wise gradient sign). */
export function dhash64(gray9x8: ArrayLike<number>): string {
  if (gray9x8.length !== 72) throw new Error(`expected 9x8 pixels, got ${gray9x8.length}`);
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray9x8[y * 9 + x + 1]! > gray9x8[y * 9 + x]! ? 1 : 0);
  return bitsToHex(bits);
}

/** Number of differing bits between two hex-encoded hashes of equal length. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}
