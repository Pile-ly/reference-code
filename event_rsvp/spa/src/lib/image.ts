// Client-side photo downscale (locked design decision): every upload is a
// ~1600 px JPEG, never the camera original. A modern phone photo is
// 5–15 MiB; at ~300–500 KB per downscaled shot the platform's blob quotas
// (25 MiB/blob, 250 MiB + 500 blobs per user) hold years of waterings.
//
// Flow: picked File → decode (EXIF-orientation corrected) → canvas at
// fitWithin size → JPEG re-encode → Blob for lib/blob.ts to upload. The
// re-encode also strips EXIF metadata (including GPS) as a privacy side
// effect, which is why even already-small images go through it.

/** Downscale geometry — longest edge capped, aspect kept, never upscaled.
 *  Pure so it's unit-testable (image.test.ts). */
export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** A photo we couldn't decode or re-encode (HEIC on a browser that can't
 *  read it, corrupt file, canvas failure). The UI toasts and the record is
 *  never created with a broken blob. */
export class ImageError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ImageError";
  }
}

/** Decode with EXIF orientation applied — iOS portrait photos land
 *  sideways otherwise. createImageBitmap honors `from-image`; the
 *  HTMLImageElement fallback (older Safari) relies on the browser's own
 *  orientation handling. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to the element path
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError("image failed to decode"));
    };
    img.src = url;
  });
}

/** The UX spec's pipeline: max 1600 px longest edge, JPEG quality 0.82. */
export async function downscaleToJpeg(
  file: File,
  maxEdge = 1600,
  quality = 0.82,
): Promise<Blob> {
  const source = await decode(file);
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) throw new ImageError("image has no dimensions");
  const { w, h } = fitWithin(srcW, srcH, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("canvas 2d context unavailable");
  ctx.drawImage(source, 0, 0, w, h);
  if ("close" in source) source.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new ImageError("jpeg encode failed");
  return blob;
}
