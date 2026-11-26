import { useState, useEffect, useRef, useCallback } from "react";
import { extractSlice, writeAxialSlice, restoreAxialSlice } from "../utils/volumeUtils";
import { sliceToPngBlob, pngBlobToAlpha } from "../utils/imageUtils";

/**
 * Hook to extract slices from volume data and generate PNG blobs.
 * Axial mask edits are written back into the mask volume.
 *
 * @param {Float32Array} volume - The scan volume data
 * @param {Float32Array} mask - The mask volume data
 * @param {number[]} shape - Volume dimensions [X, Y, Z]
 * @param {string} itemId - Current item ID (for cache keying)
 * @returns {{ maskVersion, imgBlobs, maskBlobs, idx, setIdx, clearAllMaskSlices,
 *   clearMaskSlice, updateMaskSlice, cacheMaskSlice }}
 */
export function useSliceRenderer(volume, mask, shape, itemId) {
  const [idx, setIdx] = useState({ axial: 0, coronal: 0, sagittal: 0 });
  const [imgBlobs, setImgBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [maskBlobs, setMaskBlobs] = useState({ axial: null, coronal: null, sagittal: null });

  const cacheScanSlice = useRef(new Map());
  const cacheMaskSlice = useRef(new Map());

  // Incremented whenever the mask volume's voxels change
  const [maskVersion, setMaskVersion] = useState(0);
  // mask volume → Uint8Array copy of it before edits
  const pristineMasks = useRef(new WeakMap());
  // sliceKey → counter, so a slow PNG decode never overwrites a newer edit
  const writeTokens = useRef(new Map());

  // Reset slice indices when shape changes
  useEffect(() => {
    if (!shape) return;
    const [X, Y, Z] = shape;
    setIdx({
      axial: Math.floor(Z / 2),
      coronal: Math.floor(Y / 2),
      sagittal: Math.floor(X / 2),
    });
  }, [shape]);

  // Generate slice blobs when idx changes
  useEffect(() => {
    if (!volume || !mask || !shape || !itemId) return;

    const loadSlice = async (plane, index) => {
      const sliceKey = `${itemId}:${plane}:${index}`;

      // Scan and mask slices are cached separately: edits invalidate mask slices only
      let imgBlob = cacheScanSlice.current.get(sliceKey);
      if (!imgBlob) {
        const { slice, width, height } = extractSlice(volume, shape, plane, index);
        imgBlob = await sliceToPngBlob(slice, width, height, "grayscale");
        cacheScanSlice.current.set(sliceKey, imgBlob);
      }

      let maskBlob = cacheMaskSlice.current.get(sliceKey);
      if (!maskBlob) {
        const { slice, width, height } = extractSlice(mask, shape, plane, index);
        maskBlob = await sliceToPngBlob(slice, width, height, "mask");
        // Keep an edit that landed while encoding
        if (cacheMaskSlice.current.has(sliceKey)) {
          maskBlob = cacheMaskSlice.current.get(sliceKey);
        } else {
          cacheMaskSlice.current.set(sliceKey, maskBlob);
        }
      }

      setImgBlobs(s => ({ ...s, [plane]: imgBlob }));
      setMaskBlobs(s => ({ ...s, [plane]: maskBlob }));
    };

    loadSlice("axial", idx.axial);
    loadSlice("coronal", idx.coronal);
    loadSlice("sagittal", idx.sagittal);
  }, [volume, mask, shape, itemId, idx]);

  // Clear all mask slices for current item (used after segmentation or "Clear All")
  const clearAllMaskSlices = useCallback(() => {
    for (const sliceKey of cacheMaskSlice.current.keys()) {
      if (sliceKey.startsWith(`${itemId}:`)) {
        cacheMaskSlice.current.delete(sliceKey);
      }
    }
    setIdx(prev => ({ ...prev }));
  }, [itemId]);

  // Snapshot of a mask volume before its first edit
  const getPristine = useCallback((maskVolume) => {
    let snapshot = pristineMasks.current.get(maskVolume);
    if (!snapshot) {
      snapshot = new Uint8Array(maskVolume.length);
      for (let i = 0; i < maskVolume.length; i++) snapshot[i] = maskVolume[i] > 0 ? 1 : 0;
      pristineMasks.current.set(maskVolume, snapshot);
    }
    return snapshot;
  }, []);

  // Drop cached coronal/sagittal mask slices so they are re-extracted from the volume
  const invalidateDerivedMaskSlices = useCallback(() => {
    for (const sliceKey of cacheMaskSlice.current.keys()) {
      if (sliceKey.startsWith(`${itemId}:coronal:`) || sliceKey.startsWith(`${itemId}:sagittal:`)) {
        cacheMaskSlice.current.delete(sliceKey);
      }
    }
  }, [itemId]);

  // Revert a single axial mask slice to the unedited mask (used for "Clear Edits")
  const clearMaskSlice = useCallback((index) => {
    const sliceKey = `${itemId}:axial:${index}`;
    writeTokens.current.set(sliceKey, (writeTokens.current.get(sliceKey) || 0) + 1);

    const snapshot = mask && pristineMasks.current.get(mask);
    if (snapshot && shape) {
      restoreAxialSlice(mask, snapshot, shape, index);
      invalidateDerivedMaskSlices();
      setMaskVersion(v => v + 1);
    }

    cacheMaskSlice.current.delete(sliceKey);
    setIdx(prev => ({ ...prev }));
  }, [itemId, mask, shape, invalidateDerivedMaskSlices]);

  // Update a single mask slice (brush edits and undo): cache the blob for display
  // and write it into the mask volume
  const updateMaskSlice = useCallback((plane, index, blob) => {
    const sliceKey = `${itemId}:${plane}:${index}`;
    cacheMaskSlice.current.set(sliceKey, blob);
    setMaskBlobs(s => ({ ...s, [plane]: blob }));

    if (plane !== "axial" || !mask || !shape) return;

    const token = (writeTokens.current.get(sliceKey) || 0) + 1;
    writeTokens.current.set(sliceKey, token);

    (async () => {
      const { alpha, width, height } = await pngBlobToAlpha(blob);
      // Superseded by a newer edit or a clear while decoding
      if (writeTokens.current.get(sliceKey) !== token) return;
      if (width !== shape[0] || height !== shape[1]) {
        console.error("Mask slice size does not match volume; edit not applied to volume");
        return;
      }

      getPristine(mask);
      writeAxialSlice(mask, shape, index, alpha);
      invalidateDerivedMaskSlices();
      setMaskVersion(v => v + 1);
      setIdx(prev => ({ ...prev }));
    })();
  }, [itemId, mask, shape, getPristine, invalidateDerivedMaskSlices]);

  return {
    maskVersion,
    imgBlobs,
    maskBlobs,
    idx,
    setIdx,
    clearAllMaskSlices,
    clearMaskSlice,
    updateMaskSlice,
    cacheMaskSlice,
  };
}
