// Shrinks a phone photo before upload so it fits the 5 MB limit and the free 1 GB of storage.
// JPG and PNG larger than 1 MB are redrawn at most 1600 px on the longest side as a JPG (quality 0.82) on a white
// background (so transparent PNGs do not turn black). PDFs and small images are left alone, and the original is kept
// whenever the shrunk copy would not be smaller. Runs only in the browser.
const LIMIT = 1024 * 1024, MAX_SIDE = 1600, QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || !['image/jpeg', 'image/png'].includes(file.type) || file.size <= LIMIT) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) return file;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch { return file; }
}
