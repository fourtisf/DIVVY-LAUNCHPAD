/**
 * Image pipeline: decode, re-encode (strips EXIF and anything else), hash.
 * pHash runs on a 32×32 grayscale downscale using the shared implementation.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { HASH_SIZE, phash64 } from "@divvy/shared";

export interface ProcessedImage {
  /** Re-encoded WebP, max 512px, no metadata. */
  webp: Buffer;
  /** SHA-256 of the uploaded bytes (exact-duplicate check). */
  sha256: string;
  phash: string;
}

/** Refuse images that decode to more than this many pixels (decompression bombs). */
const MAX_PIXELS = 40_000_000;

export async function grayPixels(input: Buffer): Promise<Uint8Array> {
  const raw = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const webp = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS })
    .rotate() // apply EXIF orientation before metadata is dropped
    .resize(512, 512, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  return {
    webp,
    sha256: createHash("sha256").update(input).digest("hex"),
    phash: phash64(await grayPixels(input)),
  };
}

export const sha256Hex = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
