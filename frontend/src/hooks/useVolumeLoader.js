import { useState, useEffect, useRef } from "react";
import { inflate } from "pako";

const API = "http://localhost:8000";

/**
 * Hook to fetch and cache scan + mask volumes.
 *
 * @param {string} id - The draft ID or scan ID
 * @param {string} itemId - The selected item ID within the draft (only for drafts, null for scans)
 * @param {string} endpoint - Either "drafts" (default) or "scans"
 * @returns {{ volume, mask, shape, isLoading, cacheScan, cacheMask }}
 */
export function useVolumeLoader(id, itemId, endpoint = "drafts") {
  const [shape, setShape] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const cacheScan = useRef(new Map());
  const cacheMask = useRef(new Map());

  useEffect(() => {
    if (!id) return;
    // For drafts, itemId is required; for scans, it's not used
    if (endpoint === "drafts" && !itemId) return;

    const key = endpoint === "drafts" ? `${id}:${itemId}` : id;

    // Return cached data if available
    if (cacheScan.current.has(key) && cacheMask.current.has(key)) {
      const { shape } = cacheScan.current.get(key);
      setShape(shape);
      return;
    }

    // Fetch scan and mask
    (async () => {
      setIsLoading(true);

      // Build URLs based on endpoint type
      const scanUrl = endpoint === "drafts"
        ? `${API}/drafts/${id}/scan?item=${itemId}`
        : `${API}/scans/${id}/scan`;

      const maskUrl = endpoint === "drafts"
        ? `${API}/drafts/${id}/mask?item=${itemId}`
        : `${API}/scans/${id}/mask`;

      // Fetch scan volume
      const scanRes = await fetch(scanUrl);
      if (!scanRes.ok) {
        setIsLoading(false);
        return;
      }

      const raw = new Uint8Array(await scanRes.arrayBuffer());
      const header = new Int32Array(raw.buffer, 0, 3);
      const [X, Y, Z] = header;
      const newShape = [X, Y, Z];

      const volume = new Float32Array(inflate(raw.subarray(12)).buffer);
      cacheScan.current.set(key, { shape: newShape, volume });

      // Fetch mask volume
      const maskRes = await fetch(maskUrl);
      if (!maskRes.ok) {
        setIsLoading(false);
        return;
      }

      const maskRaw = new Uint8Array(await maskRes.arrayBuffer());
      const mask = new Float32Array(inflate(maskRaw.subarray(12)).buffer);
      cacheMask.current.set(key, mask);

      setShape(newShape);
      setIsLoading(false);
    })();
  }, [id, itemId, endpoint]);

  const key = endpoint === "drafts" ? `${id}:${itemId}` : id;
  const scanData = cacheScan.current.get(key);
  const maskData = cacheMask.current.get(key);

  return {
    volume: scanData?.volume || null,
    mask: maskData || null,
    shape,
    isLoading,
    // Expose cache refs for external manipulation (e.g., after segmentation)
    cacheScan,
    cacheMask,
  };
}
