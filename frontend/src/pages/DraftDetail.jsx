import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { inflate } from "pako";
import { MousePointer2, Pencil, Eraser, Undo2, X, Zap, Save } from "lucide-react";

import VolumeViewer from "../components/VolumeViewer";
import { useVolumeLoader } from "../hooks/useVolumeLoader";
import { useSliceRenderer } from "../hooks/useSliceRenderer";
import { useEditHistory } from "../hooks/useEditHistory";

// const API="http://localhost:8000";
const API = "https://auto-liver-backend.onrender.com";

export default function DraftDetail() {
  const navigate = useNavigate();
  const { draftId } = useParams();

  const [meta, setMeta] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/drafts/${draftId}`);
      if (!r.ok) return;
      const m = await r.json();
      setMeta(m);
      setSelectedItem(m.items?.[0]?.item_id || null);
    })();
  }, [draftId]);

  const { volume, mask, shape, isLoading, cacheMask } = useVolumeLoader(draftId, selectedItem);
  const { imgBlobs, maskBlobs, idx, setIdx, clearAllMaskSlices, clearMaskSlice, updateMaskSlice, cacheMaskSlice } =
    useSliceRenderer(volume, mask, shape, selectedItem);

  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.35);

  const currentItem = meta?.items?.find(it => it.item_id === selectedItem);
  const isSegmented = currentItem?.segmented || false;

  const [actionLoading, setActionLoading] = useState(false);
  const loading = isLoading || actionLoading;

  const [brushMode, setBrushMode] = useState("view");
  const [brushSize, setBrushSize] = useState(8);
  const brushRef = useRef(null);

  const { saveState, undo, canUndo } = useEditHistory();
  const currentSliceKey = `${selectedItem}:axial:${idx.axial}`;
  const lastSavedBlob = useRef(new Map());

  const handleMaskUpdate = (blob) => {
    const currentBlob = maskBlobs.axial;
    const lastSaved = lastSavedBlob.current.get(currentSliceKey);

    if (!lastSaved && currentBlob) {
      saveState(currentSliceKey, currentBlob);
      lastSavedBlob.current.set(currentSliceKey, currentBlob);
    }

    updateMaskSlice("axial", idx.axial, blob);
    saveState(currentSliceKey, blob);
    lastSavedBlob.current.set(currentSliceKey, blob);
  };

  const clearCurrentSlice = () => {
    const currentBlob = maskBlobs.axial;
    if (currentBlob) {
      saveState(currentSliceKey, currentBlob);
    }
    clearMaskSlice(idx.axial);
  };

  const handleUndo = () => {
    const previousBlob = undo(currentSliceKey);
    if (previousBlob) {
      updateMaskSlice("axial", idx.axial, previousBlob);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo(currentSliceKey) && isSegmented) {
          handleUndo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSliceKey, isSegmented, canUndo]);

  const saveDraft = async () => {
    for (let i = 0; i < shape[2]; i++) {
      const key = `${selectedItem}:axial:${i}`;
      if (cacheMaskSlice.current.has(key)) {
        const form = new FormData();
        form.append("png", cacheMaskSlice.current.get(key), "slice.png");
        const url = `${API}/drafts/${draftId}/mask/slice?item=${selectedItem}&plane=axial&index=${i}`;
        const r = await fetch(url, { method: "PUT", body: form });
        if (!r.ok) {
          console.error("save failed");
          return;
        }
      }
    }
  };

  const saveFinal = async () => {
    try {
      await saveDraft();

      const url = `${API}/drafts/${draftId}/save?item=${selectedItem}`;
      const r = await fetch(url, { method: "POST" });
      if (!r.ok) throw new Error(`Save failed with status ${r.status}`);

      const r2 = await fetch(`${API}/drafts/${draftId}`);
      if (!r2.ok) {
        navigate(`/scans`);
        return;
      }

      const m = await r2.json();
      setMeta(m);
      setSelectedItem(m.items?.[0]?.item_id || null);
    } catch (err) {
      console.error("SaveFinal failed:", err);
    }
  };

  const segment = async () => {
    if (!selectedItem) return;

    const key = `${draftId}:${selectedItem}`;
    setActionLoading(true);

    await fetch(`${API}/drafts/${draftId}/segment/demo?item=${selectedItem}`, { method: "POST" });

    const m = await fetch(`${API}/drafts/${draftId}/mask?item=${selectedItem}`);
    const raw = new Uint8Array(await m.arrayBuffer());
    const newMask = new Float32Array(inflate(raw.subarray(12)).buffer);

    cacheMask.current.set(key, newMask);
    clearAllMaskSlices();

    const metaRes = await fetch(`${API}/drafts/${draftId}`);
    if (metaRes.ok) {
      const updatedMeta = await metaRes.json();
      setMeta(updatedMeta);
    }

    setActionLoading(false);
  };

  if (!meta || !selectedItem) {
    return <div className="p-6">Empty draft/Draft not found!</div>;
  }

  return (
    <div className="p-6 flex gap-4">
      <aside className="w-64 min-w-64 flex-shrink-0 border border-[#282828] rounded-xl p-3 space-y-4">
        <div>
          <div className="font-semibold mb-2">Scans</div>
          <ul className="space-y-1">
            {meta.items?.map((it) => (
              <li key={it.item_id}>
                <button
                  onClick={() => setSelectedItem(it.item_id)}
                  className={`w-full text-left px-2 py-1 rounded text-sm ${
                    selectedItem === it.item_id
                      ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                      : "hover:border-gray"
                  }`}
                >
                  <div>{it.item_id}</div>
                  <div className="text-xs opacity-60">
                    {it.segmented ? "segmented" : "unsegmented"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="font-semibold mb-2">Display</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showMask}
              onChange={(e) => setShowMask(e.target.checked)}
              disabled={!isSegmented}
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
              disabled={!isSegmented || !showMask}
            />
            <div className="text-xs opacity-60">{Math.round(maskOpacity * 100)}%</div>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="font-semibold mb-2">Edit Mask</div>

          <div className="grid grid-cols-3 gap-2">
            <button
              className={`px-2 py-1.5 border rounded text-sm transition flex items-center justify-center ${
                brushMode === "view"
                  ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                  : "border border-gray-600"
              }`}
              onClick={() => setBrushMode("view")}
              disabled={loading || !isSegmented}
              title="View"
            >
              <MousePointer2 size={16} />
            </button>
            <button
              className={`px-2 py-1.5 border rounded text-sm transition flex items-center justify-center ${
                brushMode === "brush"
                  ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                  : "border border-gray-600"
              }`}
              onClick={() => setBrushMode("brush")}
              disabled={loading || !isSegmented}
              title="Brush"
            >
              <Pencil size={16} />
            </button>
            <button
              className={`px-2 py-1.5 border rounded text-sm flex items-center justify-center ${
                brushMode === "erase"
                  ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                  : "border border-gray-600"
              }`}
              onClick={() => setBrushMode("erase")}
              disabled={loading || !isSegmented}
              title="Erase"
            >
              <Eraser size={16} />
            </button>
          </div>

          {brushMode !== "view" && (
            <div className="space-y-1">
              <span className="text-sm">Brush size</span>
              <input
                type="range"
                min={1}
                max={15}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs opacity-60">{brushSize}px</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleUndo}
              disabled={loading || !isSegmented || !canUndo(currentSliceKey)}
              className={`px-2 py-1.5 border rounded text-sm flex items-center justify-center ${
                loading || !isSegmented || !canUndo(currentSliceKey)
                  ? "border-gray-600 text-gray-400"
                  : "border-gray-600 hover:border-blue-400"
              }`}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={clearCurrentSlice}
              disabled={loading || !isSegmented || !canUndo(currentSliceKey)}
              className={`col-span-2 px-2 py-1.5 border rounded text-sm flex items-center justify-center gap-1 ${
                loading || !isSegmented || !canUndo(currentSliceKey)
                  ? "border-gray-600 text-gray-400"
                  : "border-gray-600 hover:border-blue-400"
              }`}
              title="Clear Slice"
            >
              <X size={16} />
              <span className="text-xs">Clear Edits</span>
            </button>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="font-semibold mb-2">Actions</div>
          <button
            onClick={segment}
            disabled={loading}
            className={`w-full px-2 py-1.5 border rounded text-xs flex items-center justify-center gap-1.5 ${
              loading
                ? "border-gray-600 text-gray-400 opacity-50"
                : "border-blue-400 bg-blue-400/5 hover:bg-blue-400/10"
            }`}
          >
            <Zap size={14} />
            <span>Run TotalSegmentator</span>
          </button>
          <button
            onClick={saveDraft}
            disabled={loading}
            className={`w-full px-2 py-1.5 border rounded text-xs flex items-center justify-center gap-1.5 ${
              loading
                ? "border-gray-600 text-gray-400 opacity-50"
                : "border-gray-600 bg-gray-500/5 hover:bg-gray-500/10"
            }`}
          >
            <Save size={14} />
            <span>Save Draft</span>
          </button>
        </div>
      </aside>

      <section className="flex-1 min-w-0">
        <VolumeViewer
          imgBlobs={imgBlobs}
          maskBlobs={maskBlobs}
          shape={shape}
          idx={idx}
          onSlide={(plane, value) => setIdx((s) => ({ ...s, [plane]: value }))}
          isLoading={loading}
          showMask={showMask}
          maskOpacity={maskOpacity}
          editable={true}
          editMode={brushMode !== "view"}
          brushMode={brushMode}
          brushSize={brushSize}
          onMaskUpdate={handleMaskUpdate}
          brushRef={brushRef}
        />
      </section>
    </div>
  );
}
