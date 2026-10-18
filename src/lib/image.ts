/**
 * Client-side image preparation for AI uploads. Full-screen PNG screenshots are
 * often 2–6 MB (8 MB+ as base64), which is slow, costly, and can exceed request
 * limits. We downscale to a size that keeps price labels readable and re-encode.
 * iPhone camera photos are 24–48MP, so they are decoded at the reduced size, never in full.
 */

export const MAX_INPUT_BYTES = 20_000_000;
export const MAX_SIDE = 2048;

/** Scale (w, h) to fit inside max×max, keeping the aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** Size a photo is decoded to: fits max×max, keeps the aspect ratio, never below 1px. */
export function targetSize(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const t = fitWithin(w, h, max);
  return { width: Math.max(1, t.width), height: Math.max(1, t.height) };
}

/** Formats this browser can't shrink still go as they are when small enough for the AI request. */
export const MAX_RAW_BYTES = 5_000_000;

const CANT_OPEN = "ما قدرت أفتح هالصورة على جهازك (صيغتها غير مدعومة أو الملف تالف). جرّب لقطة شاشة أو صورة JPG";
const OUT_OF_MEMORY = "الجهاز ما قدر يصغّر هالصورة، ذاكرته ما كفّت. سكّر كم تطبيق وجرّب مرة ثانية، أو ارفع لقطة شاشة";

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("ما قدرت أقرأ الصورة"));
    r.readAsDataURL(file);
  });
}

/** Loads only the header first (for the size); decode() then readies it off the main thread. */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load"));
  });
  img.src = src;
  await loaded;
  await img.decode?.().catch(() => {});
  return img;
}

let resizes: Promise<boolean> | null = null;
/**
 * Does createImageBitmap honour resizeWidth/resizeHeight? A browser that ignores them would
 * decode a 48MP camera photo at full size (~190MB), which is what failed on the iPhone.
 */
function bitmapResizes(): Promise<boolean> {
  resizes ??= (async () => {
    try {
      if (typeof createImageBitmap !== "function") return false;
      const c = document.createElement("canvas");
      c.width = 4;
      c.height = 4;
      const b = await createImageBitmap(c, { resizeWidth: 2, resizeHeight: 2, resizeQuality: "high" });
      const ok = b.width === 2 && b.height === 2;
      b.close();
      return ok;
    } catch {
      return false;
    }
  })();
  return resizes;
}

/** The photo decoded at (or drawable to) the target size, never a full-size bitmap. */
async function decodeSmall(file: File, img: HTMLImageElement, t: { width: number; height: number }): Promise<ImageBitmap | HTMLImageElement> {
  if (await bitmapResizes()) {
    try {
      return await createImageBitmap(file, { resizeWidth: t.width, resizeHeight: t.height, resizeQuality: "high", imageOrientation: "from-image" });
    } catch {
      // Falls back to drawing the <img> into the capped canvas below.
    }
  }
  return img;
}

/** Returns a data URL (JPEG) ready to send to the AI. */
export async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("الملف ليس صورة");
  if (file.size > MAX_INPUT_BYTES) throw new Error("الصورة أكبر من 20MB");
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src).catch(() => null);
    const t = img ? targetSize(img.naturalWidth, img.naturalHeight) : { width: 0, height: 0 };
    if (!img || !t.width) {
      // HEIC on a desktop browser, a broken file: a small one can still go as it is.
      if (file.size <= MAX_RAW_BYTES) return await readAsDataUrl(file);
      throw new Error(CANT_OPEN);
    }
    const source = await decodeSmall(file, img, t);
    const canvas = document.createElement("canvas");
    canvas.width = t.width;
    canvas.height = t.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(OUT_OF_MEMORY);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, t.width, t.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, t.width, t.height);
    if ("close" in source) source.close();
    const url = canvas.toDataURL("image/jpeg", 0.9);
    // iOS keeps canvas memory until GC; give it back now, a second photo may follow.
    canvas.width = 0;
    canvas.height = 0;
    if (!url.startsWith("data:image/jpeg")) throw new Error(OUT_OF_MEMORY);
    return url;
  } finally {
    URL.revokeObjectURL(src);
  }
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
