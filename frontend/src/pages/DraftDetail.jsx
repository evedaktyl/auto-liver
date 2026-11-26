import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { inflate, deflate } from "pako";
import { MousePointer2, Pencil, Eraser, Undo2, X, Zap, Save, CheckCircle, Layers, Box, RotateCcw } from "lucide-react";

import VolumeViewer from "../components/VolumeViewer";
import Mask3DView from "../components/Mask3DView";
import { useVolumeLoader } from "../hooks/useVolumeLoader";
import { useSliceRenderer } from "../hooks/useSliceRenderer";
import { useEditHistory } from "../hooks/useEditHistory";

const API = "http://localhost:8000";

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
  const { imgBlobs, maskBlobs, idx, setIdx, clearAllMaskSlices, clearMaskSlice, updateMaskSlice, maskVersion } =
    useSliceRenderer(volume, mask, shape, selectedItem);

  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.35);

  const currentItem = meta?.items?.find(it => it.item_id === selectedItem);
  const isSegmented = currentItem?.segmented || false;

  // 3D view
  const [viewMode, setViewMode] = useState("2d");
  const [surfaceMethod, setSurfaceMethod] = useState("marchingCubes");
  const [smoothing, setSmoothing] = useState("taubin");
  const [smoothIterations, setSmoothIterations] = useState(10);
  const [meshOpacity, setMeshOpacity] = useState(1);
  const [wireframe, setWireframe] = useState(false);
  const view3DRef = useRef(null);
  const is3D = viewMode === "3d" && isSegmented;

  // Voxel-to-world geometry of the selected scan
  const [geometry, setGeometry] = useState(null);
  useEffect(() => {
    if (!selectedItem) return;
    let cancelled = false;
    (async () => {
      const r = await fetch(`${API}/drafts/${draftId}/geometry?item=${selectedItem}`);
      if (!r.ok || cancelled) return;
      const g = await r.json();
      if (!cancelled) setGeometry({ ...g, itemId: selectedItem });
    })();
    return () => { cancelled = true; };
  }, [draftId, selectedItem]);
  const currentGeometry = geometry?.itemId === selectedItem ? geometry : null;

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
        if (canUndo(currentSliceKey) && isSegmented && !is3D) {
          handleUndo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSliceKey, isSegmented, is3D, canUndo]);

  // Upload the edited mask volume. Throws if the backend rejects it.
  const saveDraft = async () => {
    // An unsegmented item has no mask on the backend to update
    if (!isSegmented || !mask || !shape) return;

    // Payload: int32 [X, Y, Z] header + zlib-compressed uint8 voxels
    const voxels = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) voxels[i] = mask[i] > 0 ? 1 : 0;
    const compressed = deflate(voxels);
    const body = new Uint8Array(12 + compressed.length);
    body.set(new Uint8Array(new Int32Array(shape).buffer), 0);
    body.set(compressed, 12);

    const url = `${API}/drafts/${draftId}/mask?item=${selectedItem}`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    if (!r.ok) throw new Error(`Saving the mask failed with status ${r.status}`);
  };

  const handleSaveDraft = async () => {
    setActionLoading(true);
    try {
      // Let the loading overlay paint before the blocking compression starts
      await new Promise((resolve) => setTimeout(resolve, 30));
      await saveDraft();
    } catch (err) {
      console.error("SaveDraft failed:", err);
    } finally {
      setActionLoading(false);
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

    await fetch(`${API}/drafts/${draftId}/segment?item=${selectedItem}`, { method: "POST" });

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
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`px-2 py-1.5 border rounded text-sm flex items-center justify-center gap-1.5 ${
                !is3D
                  ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                  : "border border-gray-600"
              }`}
              onClick={() => setViewMode("2d")}
              title="Slice views"
            >
              <Layers size={16} />
              <span>2D</span>
            </button>
            <button
              className={`px-2 py-1.5 border rounded text-sm flex items-center justify-center gap-1.5 ${
                is3D
                  ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                  : "border border-gray-600"
              } ${!isSegmented ? "text-gray-400 opacity-50" : ""}`}
              onClick={() => {
                setViewMode("3d");
                setBrushMode("view");
              }}
              disabled={!isSegmented}
              title={isSegmented ? "3D view of the mask" : "Segment the scan to view the mask in 3D"}
            >
              <Box size={16} />
              <span>3D</span>
            </button>
          </div>

          {!is3D && (
            <>
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
            </>
          )}
        </div>

        {is3D && (
          <div className="border-t pt-3 space-y-2">
            <div className="font-semibold mb-2">3D View</div>

            <div className="space-y-1">
              <span className="text-sm">Surface</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["voxels", "Voxels", "Exact voxel faces of the mask"],
                  ["marchingCubes", "Marching cubes", "Surface interpolated between voxels"],
                ].map(([value, label, title]) => (
                  <button
                    key={value}
                    className={`px-2 py-1.5 border rounded text-xs ${
                      surfaceMethod === value
                        ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                        : "border border-gray-600"
                    }`}
                    onClick={() => setSurfaceMethod(value)}
                    title={title}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-sm">Smoothing</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["none", "None", "No smoothing"],
                  ["laplacian", "Laplacian", "Strong smoothing; shrinks the surface slightly"],
                  ["taubin", "Taubin", "Smoothing that preserves volume"],
                ].map(([value, label, title]) => (
                  <button
                    key={value}
                    className={`px-0.5 py-1.5 border rounded text-[11px] ${
                      smoothing === value
                        ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400"
                        : "border border-gray-600"
                    }`}
                    onClick={() => setSmoothing(value)}
                    title={title}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {smoothing !== "none" && (
              <div className="space-y-1">
                <span className="text-sm">Iterations</span>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={smoothIterations}
                  onChange={(e) => setSmoothIterations(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs opacity-60">{smoothIterations}</div>
              </div>
            )}

            <div className="space-y-1">
              <span className="text-sm">Opacity</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={meshOpacity}
                onChange={(e) => setMeshOpacity(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs opacity-60">{Math.round(meshOpacity * 100)}%</div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wireframe}
                onChange={(e) => setWireframe(e.target.checked)}
              />
              Wireframe
            </label>

            <button
              onClick={() => view3DRef.current?.resetView()}
              className="w-full px-2 py-1.5 border border-gray-600 hover:border-blue-400 rounded text-xs flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={14} />
              <span>Reset view</span>
            </button>
          </div>
        )}

        {!is3D && (
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
        )}

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
            onClick={handleSaveDraft}
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
          <button
            onClick={saveFinal}
            disabled={loading}
            className={`w-full px-2 py-1.5 border rounded text-xs flex items-center justify-center gap-1.5 ${
              loading
                ? "border-gray-600 text-gray-400 opacity-50"
                : "border-green-500 bg-green-500/5 hover:bg-green-500/10"
            }`}
          >
            <CheckCircle size={14} />
            <span>Save Final to Store</span>
          </button>
        </div>
      </aside>

      <section className="flex-1 min-w-0">
        {is3D ? (
          <Mask3DView
            ref={view3DRef}
            mask={mask}
            shape={shape}
            geometry={currentGeometry}
            maskVersion={maskVersion}
            method={surfaceMethod}
            smoothing={smoothing}
            iterations={smoothIterations}
            opacity={meshOpacity}
            wireframe={wireframe}
            isLoading={loading}
          />
        ) : (
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
        )}
      </section>
    </div>
  );
}
