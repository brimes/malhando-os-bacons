// Shrinks a photo before it ever leaves the device: the server's 500KB cap
// is a backstop, not the normal path. A raw phone photo is routinely 3-8MB,
// which would fail the cap outright and would be wasteful to send anyway —
// the vision model does not need more than ~1280px on the longest side.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.7;

export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', JPEG_QUALITY);
  });
}
