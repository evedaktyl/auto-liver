// ─────────────────────────────────────────────────────────────────────────────
// PNG BLOB TO ALPHA CHANNEL
// ─────────────────────────────────────────────────────────────────────────────

export async function pngBlobToAlpha(blob) {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return { alpha, width, height };
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE TO PNG BLOB CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

const CT_ABDOMEN_WINDOW = [-160, 240]; // level 40 HU, width 400
const WINDOW_SAMPLES = 200000;

/**
 * Intensity range [low, high] to display a whole scan volume with, so brightness
 * stays consistent from slice to slice.
 *
 * CT in Hounsfield units gets the standard abdominal soft-tissue window. Anything
 * else (MRI, or CT not stored in HU) gets the 1st to 99.5th percentile of the volume.
 */
export function computeDisplayWindow(volume, scanType) {
  const step = Math.max(1, Math.floor(volume.length / WINDOW_SAMPLES));
  const samples = new Float32Array(Math.ceil(volume.length / step));
  for (let i = 0, k = 0; i < volume.length; i += step) samples[k++] = volume[i];
  samples.sort();

  // Air is about -1000 HU; a CT without strongly negative values is not in HU
  if (scanType === "CT" && samples[0] < -500) return CT_ABDOMEN_WINDOW;

  const percentile = (p) => samples[Math.floor(p * (samples.length - 1))];
  return [percentile(0.01), percentile(0.995)];
}

/**
 * @param {Float32Array} slice - width × height values
 * @param {"grayscale"|"mask"} type
 * @param {number[]} [displayWindow] - [low, high] mapped to black/white for
 *   grayscale; defaults to the slice's own min/max
 */
export function sliceToPngBlob(slice, width, height, type = "grayscale", displayWindow = null) {
  // Zero-initialised: transparent black
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (type === "mask") {
    // Opaque red for non-zero voxels
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] > 0) {
        rgba[i * 4 + 0] = 255;
        rgba[i * 4 + 3] = 255;
      }
    }
  } else {
    let low, high;
    if (displayWindow) {
      [low, high] = displayWindow;
    } else {
      low = Infinity;
      high = -Infinity;
      for (let i = 0; i < slice.length; i++) {
        const v = slice[i];
        if (v < low) low = v;
        if (v > high) high = v;
      }
    }
    const scale = 255 / (high - low || 1);

    // Values outside the window are clamped to black/white by the clamped array
    for (let i = 0; i < slice.length; i++) {
      const v = (slice[i] - low) * scale;
      rgba[i * 4 + 0] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  }

  // Render to canvas and export as PNG blob
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(rgba, width, height);
  ctx.putImageData(imgData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
