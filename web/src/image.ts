import { IMAGE_LIMITS } from "../../contracts";
export function resizedDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    Math.min(width, height) < IMAGE_LIMITS.minShortSide
  )
    throw new Error(
      "Use a larger photo: short side must be at least 480 pixels.",
    );
  const ratio = Math.min(1, IMAGE_LIMITS.maxLongSide / Math.max(width, height));
  const size = {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
  if (Math.min(size.width, size.height) < IMAGE_LIMITS.minShortSide)
    throw new Error("Photo is too narrow. Retake without a panoramic frame.");
  return size;
}
export async function prepareImage(file: File) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const size = resizedDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    Object.assign(canvas, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing unavailable.");
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not encode photo.")),
          "image/jpeg",
          quality,
        ),
      );
      if (blob.size <= IMAGE_LIMITS.maxBytes) return { blob, ...size };
    }
    throw new Error("Photo is too large. Choose another photo.");
  } finally {
    bitmap.close();
  }
}
