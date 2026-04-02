import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import VolumeViewer from "../components/VolumeViewer";
import { useVolumeLoader } from "../hooks/useVolumeLoader";
import { useSliceRenderer } from "../hooks/useSliceRenderer";

const API = "http://localhost:8000";

export default function ScanDetail() {
  const { scanId } = useParams();

  // ─────────────────────────────────────────────────────────────────────────────
  // SCAN METADATA
  // ─────────────────────────────────────────────────────────────────────────────
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/scans/${scanId}`);
      if (!r.ok) return;
      const m = await r.json();
      setMeta(m);
    })();
  }, [scanId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // VOLUME DATA (scan + mask) - using scan endpoints
  // ─────────────────────────────────────────────────────────────────────────────
  const { volume, mask, shape, isLoading } = useVolumeLoader(scanId, null, "scans");
  const { imgBlobs, maskBlobs, idx, setIdx } = useSliceRenderer(volume, mask, shape, scanId);

  // ─────────────────────────────────────────────────────────────────────────────
  // MASK DISPLAY
  // ─────────────────────────────────────────────────────────────────────────────
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.35);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  if (!meta) {
    return <div className="p-6">Loading scan...</div>;
  }

  return (
    <div className="p-6 flex gap-4">
      {/* ───────────────────────────────────────────────────────────────────────
          SIDEBAR (fixed width, all controls)
      ─────────────────────────────────────────────────────────────────────── */}
      <aside className="w-64 min-w-64 flex-shrink-0 border border-[#282828] rounded-xl p-3 space-y-4">
        {/* Scan info */}
        <div>
          <div className="font-semibold mb-2">Scan Info</div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">ID:</span> {meta.scan_id}
            </div>
            <div>
              <span className="text-gray-400">Type:</span> {meta.scan_type}
            </div>
            <div>
              <span className="text-gray-400">Status:</span>{" "}
              {meta.segmented ? "Segmented" : "Unsegmented"}
            </div>
            <div className="truncate" title={meta.filename}>
              <span className="text-gray-400">File:</span> {meta.filename}
            </div>
          </div>
        </div>

        {/* Mask display controls */}
        <div className="border-t pt-3 space-y-2">
          <div className="font-semibold mb-2">Display</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showMask}
              onChange={(e) => setShowMask(e.target.checked)}
            />
            Show mask
          </label>
          <div className="space-y-1">
            <span className="text-sm">Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={maskOpacity}
              onChange={(e) => setMaskOpacity(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-xs text-gray-400">{Math.round(maskOpacity * 100)}%</div>
          </div>
        </div>
      </aside>

      {/* ───────────────────────────────────────────────────────────────────────
          MAIN VIEWER (read-only, responsive)
      ─────────────────────────────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0">
        <VolumeViewer
          imgBlobs={imgBlobs}
          maskBlobs={maskBlobs}
          shape={shape}
          idx={idx}
          onSlide={(plane, value) => setIdx((s) => ({ ...s, [plane]: value }))}
          isLoading={isLoading}
          showMask={showMask}
          maskOpacity={maskOpacity}
          editable={false}
        />
      </section>
    </div>
  );
}