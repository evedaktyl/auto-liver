// Builds the mask surface mesh off the main thread.
//
// Request:  { id, cropKey, crop?, affine, method, smoothing, iterations }
//   `crop` (from cropMask) only needs to be sent when `cropKey` changes.
// Response: { id, positions, indices } or { id, error }

import { extractSurface, toWorld, smoothMesh } from "../utils/meshing";

let crop = null;
let cropKey = null;
// Unsmoothed mesh in world space, reused while only the smoothing settings change
let base = null;
let baseKey = null;

self.onmessage = ({ data: msg }) => {
  try {
    if (msg.crop) {
      crop = msg.crop;
      cropKey = msg.cropKey;
    }
    if (!crop || cropKey !== msg.cropKey) {
      throw new Error("Mesh worker has no mask data for this request");
    }

    const key = `${msg.cropKey}:${msg.method}`;
    if (baseKey !== key) {
      base = extractSurface(crop, msg.method);
      toWorld(base, msg.affine);
      baseKey = key;
    }

    const positions = smoothMesh(base.positions, base.indices, msg.smoothing, msg.iterations);
    const indices = base.indices.slice();
    self.postMessage({ id: msg.id, positions, indices }, [positions.buffer, indices.buffer]);
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err?.message || err) });
  }
};
