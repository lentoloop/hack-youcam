import { IMAGE_LIMITS, type NormalizedImage } from "../contracts";
import { ServiceError } from "./adapters";
export async function sha256(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function jpegDimensions(b: Uint8Array): {
  width: number;
  height: number;
} {
  const invalid = () =>
    new ServiceError(
      "invalid_image",
      "Provide a valid JPEG within the SD image limits.",
    );
  if (b[0] !== 255 || b[1] !== 216) throw invalid();
  let p = 2;
  while (p < b.length) {
    if (b[p++] !== 255) throw invalid();
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = (b[p] << 8) | b[p + 1];
    if (len < 2 || p + len > b.length) throw invalid();
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (len < 8) throw invalid();
      const height = (b[p + 3] << 8) | b[p + 4],
        width = (b[p + 5] << 8) | b[p + 6];
      if (
        Math.min(width, height) < IMAGE_LIMITS.minShortSide ||
        Math.max(width, height) > IMAGE_LIMITS.maxLongSide
      )
        throw invalid();
      return { width, height };
    }
    p += len;
  }
  throw invalid();
}
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const invalid = () => new ServiceError("invalid_image", "Provide a valid JPEG within the SD image limits.");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  const segments: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      segments.push(bytes.subarray(start, offset));
      const clean = new Uint8Array(segments.reduce((size, segment) => size + segment.length, 0));
      let position = 0;
      for (const segment of segments) { clean.set(segment, position); position += segment.length; }
      return clean;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push(bytes.subarray(start, offset));
      continue;
    }
    if (offset + 2 > bytes.length) throw invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalid();
    offset += length;
    if ((marker < 0xe1 || marker > 0xef) && marker !== 0xfe) {
      segments.push(bytes.subarray(start, offset));
    }
    if (marker === 0xda) {
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        if (bytes[next] === 0x00 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
          offset = next + 1;
          continue;
        }
        break;
      }
      segments.push(bytes.subarray(scanStart, offset));
    }
  }
  throw invalid();
}
export async function normalizeImage(file: File): Promise<NormalizedImage> {
  if (
    file.type !== "image/jpeg" ||
    file.size > IMAGE_LIMITS.maxBytes ||
    file.size === 0
  )
    throw new ServiceError("invalid_image", "Upload a JPEG of at most 5 MiB.");
  const bytes = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
  return {
    bytes,
    contentType: "image/jpeg",
    ...jpegDimensions(bytes),
    sha256: await sha256(bytes),
  };
}
