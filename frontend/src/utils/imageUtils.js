// ─────────────────────────────────────────────────────────────────────────────
// SLICE TO PNG BLOB CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

export function sliceToPngBlob(slice, width, height, type = "grayscale") {
  // Normalize slice to [0, 255]
  const arr = new Uint8ClampedArray(width * height);
  let min = Infinity, max = -Infinity;

  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  for (let i = 0; i < slice.length; i++) {
    arr[i] = ((slice[i] - min) / range) * 255;
  }

  // Convert to RGBA ImageData
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (type === "mask") {
    // Mask: transparent black for 0, opaque red for non-zero
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === 0) {
        rgba[i * 4 + 0] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 0;
      } else {
        rgba[i * 4 + 0] = 255;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
    }
  } else {
    // Grayscale: same value for RGB, fully opaque
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
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
