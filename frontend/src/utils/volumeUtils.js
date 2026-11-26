// ─────────────────────────────────────────────────────────────────────────────
// SLICE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

export function getAxial(volume, [X, Y, Z], z) {
  // Extract slice at z index: img.dataobj[:, :, z] → X×Y array
  const out = new Float32Array(X * Y);
  let k = 0;
  for (let x = 0; x < X; x++)
    for (let y = 0; y < Y; y++)
      out[k++] = volume[(x * Y + y) * Z + z];
  return out;
}

export function getCoronal(volume, [X, Y, Z], y) {
  // Extract slice at y index: img.dataobj[:, y, :] → X×Z array
  const out = new Float32Array(X * Z);
  let k = 0;
  for (let x = 0; x < X; x++) {
    for (let z = 0; z < Z; z++) {
      const idx = x * Y * Z + y * Z + z;
      out[k++] = volume[idx];
    }
  }
  return out;
}

export function getSagittal(volume, [, Y, Z], x) {
  // Extract slice at x index: img.dataobj[x, :, :] → Y×Z array
  const out = new Float32Array(Y * Z);
  let k = 0;
  for (let y = 0; y < Y; y++) {
    for (let z = 0; z < Z; z++) {
      const idx = (x * Y + y) * Z + z;
      out[k++] = volume[idx];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLICE TRANSFORMATION
// ─────────────────────────────────────────────────────────────────────────────

export function rotateSlice(slice, width, height) {
  // Rotate 90° counter-clockwise (equivalent to np.rot90)
  // Output dimensions will be swapped: height × width
  const out = new Float32Array(width * height);
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < height; c++) {
      out[r * height + c] = slice[c * width + (width - 1 - r)];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AXIAL SLICE WRITE-BACK
// ─────────────────────────────────────────────────────────────────────────────

export function writeAxialSlice(mask, [X, Y, Z], z, alpha) {
  // Inverse of getAxial + rotateSlice. `alpha` is the alpha channel of the displayed
  // axial mask image (Y rows × X columns): pixel (row r, col c) is voxel (x=c, y=Y-1-r)
  for (let r = 0; r < Y; r++) {
    const y = Y - 1 - r;
    for (let c = 0; c < X; c++) {
      mask[(c * Y + y) * Z + z] = alpha[r * X + c] >= 128 ? 1 : 0;
    }
  }
}

export function restoreAxialSlice(mask, source, [X, Y, Z], z) {
  // Copy one axial slice from `source` (same layout as `mask`) back into `mask`
  for (let x = 0; x < X; x++) {
    for (let y = 0; y < Y; y++) {
      const i = (x * Y + y) * Z + z;
      mask[i] = source[i];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE
// ─────────────────────────────────────────────────────────────────────────────

export function extractSlice(volume, shape, plane, index) {
  const [X, Y, Z] = shape;

  let slice;
  let width = plane === "axial" ? Y : Z;
  let height = plane === "axial" ? X : (plane === "coronal" ? X : Y);

  if (plane === "axial") {
    slice = getAxial(volume, shape, index);
  } else if (plane === "coronal") {
    slice = getCoronal(volume, shape, index);
  } else {
    slice = getSagittal(volume, shape, index);
  }

  // Apply 90° CCW rotation to match backend behavior
  slice = rotateSlice(slice, width, height);
  [width, height] = [height, width];

  return { slice, width, height };
}
