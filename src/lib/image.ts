/**
 * Client-side image preparation for AI uploads. Full-screen PNG screenshots are
 * often 2–6 MB (8 MB+ as base64), which is slow, costly, and can exceed request
 * limits. We downscale to a size that keeps price labels readable and re-encode.
 */

export const MAX_INPUT_BYTES = 20_000_000;
export const MAX_SIDE = 2048;

/** Scale (w, h) to fit inside max×max, keeping the aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("ما قدرت أقرأ الصورة"));
    r.readAsDataURL(file);
  });
}

/** Returns a data URL (JPEG) ready to send to the AI. Falls back to the original file. */
export async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("الملف ليس صورة");
  if (file.size > MAX_INPUT_BYTES) throw new Error("الصورة أكبر من 20MB");
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.9);
    if (url.startsWith("data:image/jpeg")) return url;
  } catch {
    // Older browsers / unsupported formats: send the original if it is small enough.
  }
  if (file.size > 5_000_000) throw new Error("ما قدرت أصغّر الصورة، جرّب لقطة أصغر");
  return readAsDataUrl(file);
}

/** Longest side of the small preview stored with a chat message (the AI still gets the full image). */
export const THUMB_SIDE = 240;
export const MAX_THUMB_CHARS = 60_000;

/** Small JPEG preview for the chat bubble; null if it can't be made small enough. */
export async function makeThumbnail(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, THUMB_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    return url.startsWith("data:image/jpeg") && url.length <= MAX_THUMB_CHARS ? url : null;
  } catch {
    return null;
  }
}
