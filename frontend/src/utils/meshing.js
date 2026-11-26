// Surface extraction and smoothing for binary mask volumes.
// Pure functions with no DOM access, so they can run inside a Web Worker.

import { edgeTable, triTable } from "three/examples/jsm/objects/MarchingCubes.js";

// ─────────────────────────────────────────────────────────────────────────────
// CROP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crop a mask volume to the bounding box of its non-zero voxels, padded by one
 * empty voxel on every side so the surface is always closed.
 *
 * @param {ArrayLike<number>} mask - Volume in C order: mask[(x*Y + y)*Z + z]
 * @param {number[]} shape - [X, Y, Z]
 * @returns {{ data: Uint8Array, dims: number[], offset: number[] } | null}
 *   `offset` is the volume index of crop voxel (0,0,0). Null if the mask is empty.
 */
export function cropMask(mask, [X, Y, Z]) {
  let x0 = X, x1 = -1, y0 = Y, y1 = -1, z0 = Z, z1 = -1;

  let i = 0;
  for (let x = 0; x < X; x++) {
    for (let y = 0; y < Y; y++) {
      for (let z = 0; z < Z; z++, i++) {
        if (mask[i] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          if (z < z0) z0 = z;
          if (z > z1) z1 = z;
        }
      }
    }
  }
  if (x1 < 0) return null;

  const nx = x1 - x0 + 3, ny = y1 - y0 + 3, nz = z1 - z0 + 3;
  const data = new Uint8Array(nx * ny * nz);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const src = (x * Y + y) * Z;
      const dst = ((x - x0 + 1) * ny + (y - y0 + 1)) * nz + 1 - z0;
      for (let z = z0; z <= z1; z++) {
        if (mask[src + z] > 0) data[dst + z] = 1;
      }
    }
  }

  return { data, dims: [nx, ny, nz], offset: [x0 - 1, y0 - 1, z0 - 1] };
}

// ─────────────────────────────────────────────────────────────────────────────
// SURFACE EXTRACTION (indexed meshes, positions in voxel index coordinates)
// ─────────────────────────────────────────────────────────────────────────────

// Corner offsets of each voxel face, counter-clockwise seen from outside
const VOXEL_FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/** Exact voxel boundary: one quad per face between a filled and an empty voxel. */
function voxelSurface({ data, dims: [nx, ny, nz], offset: [ox, oy, oz] }) {
  const positions = [];
  const indices = [];
  const cy = ny + 1, cz = nz + 1;
  const cornerIndex = new Int32Array((nx + 1) * cy * cz).fill(-1);

  const corner = (i, j, k) => {
    const key = (i * cy + j) * cz + k;
    let v = cornerIndex[key];
    if (v < 0) {
      v = positions.length / 3;
      // Voxel centres sit on integer coordinates, so corners are at ±0.5
      positions.push(i - 0.5 + ox, j - 0.5 + oy, k - 0.5 + oz);
      cornerIndex[key] = v;
    }
    return v;
  };

  // The one-voxel padding guarantees every filled voxel has in-bounds neighbours
  for (let x = 1; x < nx - 1; x++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let z = 1; z < nz - 1; z++) {
        if (!data[(x * ny + y) * nz + z]) continue;
        for (const { n, c } of VOXEL_FACES) {
          if (data[((x + n[0]) * ny + (y + n[1])) * nz + (z + n[2])]) continue;
          const a = corner(x + c[0][0], y + c[0][1], z + c[0][2]);
          const b = corner(x + c[1][0], y + c[1][1], z + c[1][2]);
          const d = corner(x + c[2][0], y + c[2][1], z + c[2][2]);
          const e = corner(x + c[3][0], y + c[3][1], z + c[3][2]);
          indices.push(a, b, d, a, d, e);
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

// Marching cubes edge e runs from cube corner EDGE_ORIGIN[e] along axis EDGE_AXIS[e]
// (corner and edge numbering as in the lookup tables: Bourke / Lorensen & Cline)
const EDGE_ORIGIN = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1],
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
];
const EDGE_AXIS = [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];

/** Marching cubes at iso 0.5 on the binary grid, with vertices shared between cells. */
function marchingCubesSurface({ data, dims: [nx, ny, nz], offset: [ox, oy, oz] }) {
  const positions = [];
  const indices = [];
  const edgeVertex = new Map(); // grid edge id → vertex index
  const tri = [0, 0, 0];

  const dx = ny * nz, dy = nz;

  for (let x = 0; x < nx - 1; x++) {
    for (let y = 0; y < ny - 1; y++) {
      let q = (x * ny + y) * nz;
      for (let z = 0; z < nz - 1; z++, q++) {
        // A corner's bit is set when it lies outside the mask
        let cube = 0;
        if (!data[q]) cube |= 1;
        if (!data[q + dx]) cube |= 2;
        if (!data[q + dx + dy]) cube |= 4;
        if (!data[q + dy]) cube |= 8;
        if (!data[q + 1]) cube |= 16;
        if (!data[q + dx + 1]) cube |= 32;
        if (!data[q + dx + dy + 1]) cube |= 64;
        if (!data[q + dy + 1]) cube |= 128;
        if (edgeTable[cube] === 0) continue;

        const row = cube * 16;
        for (let t = 0; t < 16 && triTable[row + t] !== -1; t += 3) {
          for (let k = 0; k < 3; k++) {
            const e = triTable[row + t + k];
            const o = EDGE_ORIGIN[e];
            const axis = EDGE_AXIS[e];
            const px = x + o[0], py = y + o[1], pz = z + o[2];
            const key = ((px * ny + py) * nz + pz) * 3 + axis;

            let v = edgeVertex.get(key);
            if (v === undefined) {
              v = positions.length / 3;
              // Binary data: the surface crosses each edge at its midpoint
              positions.push(
                px + ox + (axis === 0 ? 0.5 : 0),
                py + oy + (axis === 1 ? 0.5 : 0),
                pz + oz + (axis === 2 ? 0.5 : 0),
              );
              edgeVertex.set(key, v);
            }
            tri[k] = v;
          }
          // Table winding faces outward when set bits mean "outside"
          indices.push(tri[0], tri[1], tri[2]);
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * @param {{ data: Uint8Array, dims: number[], offset: number[] }} crop - from cropMask
 * @param {"voxels"|"marchingCubes"} method
 * @returns {{ positions: Float32Array, indices: Uint32Array }} outward-facing triangles
 */
export function extractSurface(crop, method) {
  return method === "voxels" ? voxelSurface(crop) : marchingCubesSurface(crop);
}

// ─────────────────────────────────────────────────────────────────────────────
// VOXEL → WORLD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transform positions in place from voxel indices to world mm with a 4×4
 * row-major affine. Triangle winding is reversed if the affine mirrors space,
 * so faces keep pointing outward.
 */
export function toWorld({ positions, indices }, affine) {
  const [a, b, c] = affine;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    positions[i] = a[0] * x + a[1] * y + a[2] * z + a[3];
    positions[i + 1] = b[0] * x + b[1] * y + b[2] * z + b[3];
    positions[i + 2] = c[0] * x + c[1] * y + c[2] * z + c[3];
  }

  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (det < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOOTHING
// ─────────────────────────────────────────────────────────────────────────────

const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

// Move every vertex by `factor` towards (or, if negative, away from) the average
// of its neighbours. Neighbours are gathered per triangle, which weights them
// equally on a closed surface.
function relax(positions, indices, factor, sum, count) {
  sum.fill(0);
  count.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    for (let k = 0; k < 3; k++) {
      const pa = positions[a3 + k], pb = positions[b3 + k], pc = positions[c3 + k];
      sum[a3 + k] += pb + pc;
      sum[b3 + k] += pa + pc;
      sum[c3 + k] += pa + pb;
    }
    count[a] += 2;
    count[b] += 2;
    count[c] += 2;
  }
  for (let v = 0; v < count.length; v++) {
    const n = count[v];
    if (!n) continue;
    for (let k = 0; k < 3; k++) {
      const j = v * 3 + k;
      positions[j] += factor * (sum[j] / n - positions[j]);
    }
  }
}

/**
 * Smooth a mesh without changing its connectivity.
 *
 * - "laplacian": simple neighbour averaging; smooths quickly but shrinks the shape.
 * - "taubin": alternates a shrinking and an inflating pass, which removes
 *   stair-stepping while largely preserving volume.
 *
 * @returns {Float32Array} new positions (the input is not modified)
 */
export function smoothMesh(positions, indices, mode, iterations) {
  const out = new Float32Array(positions);
  if (mode !== "laplacian" && mode !== "taubin") return out;

  const sum = new Float64Array(out.length);
  const count = new Uint32Array(out.length / 3);
  for (let it = 0; it < iterations; it++) {
    relax(out, indices, TAUBIN_LAMBDA, sum, count);
    if (mode === "taubin") relax(out, indices, TAUBIN_MU, sum, count);
  }
  return out;
}
