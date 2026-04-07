import { useState, useEffect, useRef, useCallback } from "react";
import { extractSlice } from "../utils/volumeUtils";
import { sliceToPngBlob } from "../utils/imageUtils";

/**
 * Hook to extract slices from volume data and generate PNG blobs.
 *
 * @param {Float32Array} volume - The scan volume data
 * @param {Float32Array} mask - The mask volume data
 * @param {number[]} shape - Volume dimensions [X, Y, Z]
 * @param {string} itemId - Current item ID (for cache keying)
 * @returns {{ imgBlobs, maskBlobs, idx, setIdx, clearSliceCache }}
 */
export function useSliceRenderer(volume, mask, shape, itemId) {
  const [idx, setIdx] = useState({ axial: 0, coronal: 0, sagittal: 0 });
  const [imgBlobs, setImgBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [maskBlobs, setMaskBlobs] = useState({ axial: null, coronal: null, sagittal: null });

  const cacheScanSlice = useRef(new Map());
  const cacheMaskSlice = useRef(new Map());

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

      // Check cache first
      if (cacheScanSlice.current.has(sliceKey) && cacheMaskSlice.current.has(sliceKey)) {
        setImgBlobs(s => ({ ...s, [plane]: cacheScanSlice.current.get(sliceKey) }));
        setMaskBlobs(s => ({ ...s, [plane]: cacheMaskSlice.current.get(sliceKey) }));
        return;
      }

      // Extract and rotate slices
      const { slice: scanSlice, width, height } = extractSlice(volume, shape, plane, index);
      const { slice: maskSlice } = extractSlice(mask, shape, plane, index);

      // Convert to PNG blobs
      const imgBlob = await sliceToPngBlob(scanSlice, width, height, "grayscale");
      const maskBlob = await sliceToPngBlob(maskSlice, width, height, "mask");

      // Cache and update state
      cacheScanSlice.current.set(sliceKey, imgBlob);
      cacheMaskSlice.current.set(sliceKey, maskBlob);
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

  // Clear a single axial mask slice (used for "Clear Slice")
  const clearMaskSlice = useCallback((index) => {
    const sliceKey = `${itemId}:axial:${index}`;
    cacheMaskSlice.current.delete(sliceKey);
    setIdx(prev => ({ ...prev }));
  }, [itemId]);

  // Update a single mask slice in cache (for brush edits)
  const updateMaskSlice = useCallback((plane, index, blob) => {
    const sliceKey = `${itemId}:${plane}:${index}`;
    cacheMaskSlice.current.set(sliceKey, blob);
    setMaskBlobs(s => ({ ...s, [plane]: blob }));
  }, [itemId]);

  return {
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
