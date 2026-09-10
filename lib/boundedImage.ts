/** Bound streaming downloads, including chunked responses without Content-Length.
 * Do not relay active SVG/HTML documents from user-controlled storage as images.
 */
export async function readBoundedImage(response: Response, maxBytes = 16 * 1024 * 1024): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(contentType) || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: bytes.buffer, contentType };
}
