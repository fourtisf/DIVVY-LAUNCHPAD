/**
 * Image pipeline: decode, re-encode (strips EXIF and anything else), hash.
 * pHash runs on a 32×32 grayscale downscale using the shared implementation.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { HASH_SIZE, phash64 } from "@divvy/shared";

export interface ProcessedImage {
  /** Re-encoded WebP, max 512px, opaque, no metadata. */
  webp: Buffer;
  /** SHA-256 of the uploaded bytes (exact-duplicate check). */
  sha256: string;
  phash: string;
}

/** Refuse images that decode to more than this many pixels (decompression bombs). */
const MAX_PIXELS = 40_000_000;
/** Decoded formats accepted, read from the file itself (the client's content type isn't trusted). */
const FORMATS = new Set(["png", "jpeg", "webp", "gif"]);
/**
 * Transparency is flattened onto the app's background before hashing AND before storing, so the
 * picture people see is the picture that was checked (audit: a white image whose alpha channel
 * carries a copied logo hashed as blank but showed the logo on dark backgrounds).
 */
const BACKGROUND = "#0A0F0D";

export class UnsupportedImageError extends Error {}

export async function grayPixels(input: Buffer): Promise<Uint8Array> {
  const raw = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS })
    .flatten({ background: BACKGROUND })
    .grayscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS }).metadata();
  if (!meta.format || !FORMATS.has(meta.format)) throw new UnsupportedImageError(String(meta.format));
  const webp = await sharp(input, { animated: false, limitInputPixels: MAX_PIXELS })
    .rotate() // apply EXIF orientation before metadata is dropped
    .flatten({ background: BACKGROUND })
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
