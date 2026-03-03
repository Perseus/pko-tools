/**
 * Pixel diff utility for visual regression testing.
 * Compares two RGBA pixel buffers and returns mismatch statistics.
 * Inspired by pko-map-lab's parityHarness.js:diffRgbaImages().
 */

export interface PixelDiffResult {
  /** Number of pixels that differ beyond threshold. */
  mismatchCount: number;
  /** Ratio of mismatched pixels to total pixels (0..1). */
  mismatchRatio: number;
  /** Maximum absolute channel difference across all pixels. */
  maxDiff: number;
  /** Root mean square error across all channels. */
  rmse: number;
  /** Total number of pixels compared. */
  totalPixels: number;
}

/**
 * Compare two RGBA pixel buffers.
 * @param a - First image RGBA pixels (Uint8Array of length width*height*4)
 * @param b - Second image RGBA pixels (same dimensions)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param channelThreshold - Per-channel difference threshold for mismatch (default 2)
 */
export function diffImages(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  channelThreshold = 2,
): PixelDiffResult {
  const totalPixels = width * height;
  const expectedLength = totalPixels * 4;

  if (a.length !== expectedLength || b.length !== expectedLength) {
    throw new Error(
      `Buffer size mismatch: expected ${expectedLength} bytes (${width}x${height}x4), ` +
        `got a=${a.length}, b=${b.length}`,
    );
  }

  let mismatchCount = 0;
  let maxDiff = 0;
  let sumSquaredError = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    let pixelMismatch = false;

    for (let c = 0; c < 4; c++) {
      const diff = Math.abs(a[offset + c] - b[offset + c]);
      sumSquaredError += diff * diff;
      if (diff > maxDiff) maxDiff = diff;
      if (diff > channelThreshold) pixelMismatch = true;
    }

    if (pixelMismatch) mismatchCount++;
  }

  const totalChannels = totalPixels * 4;
  const mse = totalChannels > 0 ? sumSquaredError / totalChannels : 0;
  const rmse = Math.sqrt(mse);

  return {
    mismatchCount,
    mismatchRatio: totalPixels > 0 ? mismatchCount / totalPixels : 0,
    maxDiff,
    rmse,
    totalPixels,
  };
}

/**
 * Default pass threshold: mismatchRatio < 1%.
 */
export function isWithinThreshold(
  result: PixelDiffResult,
  maxMismatchRatio = 0.01,
): boolean {
  return result.mismatchRatio < maxMismatchRatio;
}
