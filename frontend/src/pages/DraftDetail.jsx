import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import JSZip from "jszip";
import { saveAs } from "file-saver";

import ScanCanvas from "../components/ScanCanvas";
import MaskCanvas from "../components/MaskCanvas";

// const API="http://localhost:8000";
const API = "https://entities-result-cash-recommends.trycloudflare.com";

const PLANES = ["axial", "coronal", "sagittal"];

export default function DraftDetail() {
  const navigate = useNavigate();
  const { draftId } = useParams();

  const [meta, setMeta] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); 
  const [shape, setShape] = useState(null);
  const [idx, setIdx] = useState({ axial: 0, coronal: 0, sagittal: 0 }); // Slider values

  const [imgBlobs, setImgBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [maskBlobs, setMaskBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.35);

  const cacheImg = useRef(new Map());
  const cacheMask = useRef(new Map());

  // Brush tool
  const [editMode, setEditMode] = useState(false);
  const [brushMode, setBrushMode] = useState("brush"); 
  const [brushSize, setBrushSize] = useState(8);
  const brushRef = useRef(null);
  const [axialSize, setAxialSize] = useState({w: 0, h: 0});
  const maskRef = useRef(null);
  const [isEdited, setIsEdited] = useState(false);

  // Status
  const [isLoading, setIsLoading] = useState(false);

  // Load draft meta
  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/drafts/${draftId}`);
      if (!r.ok) return;
      const m = await r.json();
      setMeta(m);
      const first = m.items?.[0]?.item_id;
      setSelectedItem(first || null);
    })();
  }, [draftId]);

  // Get shape and fetch middle slices of the selected item
  useEffect(() => {
    if (!selectedItem) return;
    (async () => {
      const r = await fetch(`${API}/drafts/${draftId}/item-shape?item=${selectedItem}`);
      if (!r.ok) return;

      const serverShape = await r.json();
      setShape(serverShape.shape);

      const [x, y, z] = serverShape.shape;
      const mid = {
          axial: Math.floor(z / 2),
          coronal: Math.floor(y / 2),
          sagittal: Math.floor(x / 2),
      };
      setIdx(mid);

      fetchSlice("axial", mid.axial);
      fetchSlice("coronal", mid.coronal);
      fetchSlice("sagittal", mid.sagittal);
      fetchMaskSlice("axial", mid.axial);
      fetchMaskSlice("coronal", mid.coronal);
      fetchMaskSlice("sagittal", mid.sagittal);
    })();
  }, [selectedItem]);

  const fetchSlice = async (plane, index) => {
    const key = `${selectedItem}:${plane}:${index}`;
    if (cacheImg.current.has(key)) {
      setImgBlobs((s) => ({ ...s, [plane]: cacheImg.current.get(key) }));
      return;
    }
    const url = `${API}/drafts/${draftId}/slice.png?item=${selectedItem}&plane=${plane}&index=${index}`;
    const r = await fetch(url);
    const b = await r.blob();
    cacheImg.current.set(key, b);
    setImgBlobs((s) => ({ ...s, [plane]: b }));

    // Get axial view width and height once
    if (plane === "axial" && axialSize.w === 0) {
      const bmp = await createImageBitmap(b);
      setAxialSize({ w: bmp.width, h: bmp.height });
    }
  };

  const fetchMaskSlice = async (plane, index) => {
    const key = `${selectedItem}:${plane}:${index}`;
    if (cacheMask.current.has(key)) {
      setMaskBlobs((s) => ({ ...s, [plane]: cacheMask.current.get(key) }));
      return;
    }
    const url = `${API}/drafts/${draftId}/mask/slice.png?item=${selectedItem}&plane=${plane}&index=${index}&alpha=1`;
    const r = await fetch(url);
    if (!r.ok) { setMaskBlobs((s) => ({ ...s, [plane]: null })); return; }
    const b = await r.blob();
    cacheMask.current.set(key, b);
    setMaskBlobs((s) => ({ ...s, [plane]: b }));
  };

  const onSlide = (plane) => async (e) => {
    const v = Number(e.target.value);
    setIdx((s) => ({ ...s, [plane]: v }));
    await fetchSlice(plane, v);
    if (showMask) await fetchMaskSlice(plane, v);
  };

  const saveDraft = async () => {
    // Write all axial slices in cacheMask for current selectedItem to drafts/workspace
    for (let i = 0; i < shape[0]; i++) {
      const key = `${selectedItem}:axial:${i}`;
      if (cacheMask.current.has(key)) {
        const form = new FormData();
        form.append("png", cacheMask.current.get(key), "slice.png");
        const url = `${API}/drafts/${draftId}/mask/slice?item=${selectedItem}&plane=axial&index=${i}`;
        const r = await fetch(url, { method: "PUT", body: form });
        if (!r.ok) { console.error("save failed"); return; }
      }
    }
    setIsEdited(false);
  }

  const saveFinal = async () => {
    try {
      await saveDraft();

      // Move draft to permanent folder
      const url = `${API}/drafts/${draftId}/save?item=${selectedItem}`;
      const r = await fetch(url, { method: "POST" });

      if (!r.ok) { throw new Error(`Save failed with status ${r.status}`); }

      // Refetch meta. 
      const r2 = await fetch(`${API}/drafts/${draftId}`);
      if (!r2.ok) {
        // Zero items remaining in draft (draft folder deleted)
        navigate(`/scans`);
        return;
      }

      // Refresh to show remaining items in draft
      const m = await r2.json();
      setMeta(m);
      setSelectedItem(m.items?.[0]?.item_id || null);
    } catch (err) {
      console.error("SaveFinal failed:", err);
      return null;
    }
  }

  const saveToDesktop = async () => {
    const zip = new JSZip();
    const scansFolder = zip.folder("scans");
    const masksFolder = zip.folder("masks");

    const addBlob = (folder, name, blob) => {
      if (!blob) return;
      folder.file(name, blob);
    };

    for (const plane of ["axial", "coronal", "sagittal"]) {
      addBlob(scansFolder, `${plane}.png`, imgBlobs[plane]);
      addBlob(masksFolder, `${plane}_mask.png`, maskBlobs[plane]);
    }

    zip.file(
      "info.txt",
      `Exported from demo ${new Date().toISOString()}\nDraft ID: ${draftId}\n`
    );

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${draftId}_scans.zip`);
  };

  const segmentOne = async () => {
    if (!selectedItem) return;
    setIsLoading(true);
    await fetch(`${API}/drafts/${draftId}/segment?item=${selectedItem}`, { method: "POST" });
    // refresh current mask slices
    await clearEdits();
    await fetchMaskSlice("axial", idx.axial);
    await fetchMaskSlice("coronal", idx.coronal);
    await fetchMaskSlice("sagittal", idx.sagittal);
    
    setIsLoading(false);

    const r = await fetch(`${API}/drafts/${draftId}`);
    if (!r.ok) return;
    const m = await r.json();
    setMeta(m);
  };

  const clearEdits = async () => {
    // Clear cached mask slices of this item
    for (const key of cacheMask.current.keys()) {
      if (key.split(":")[0].includes(`${selectedItem}`)) {
        cacheMask.current.delete(key);
      }
    }
    await fetchMaskSlice("axial", idx.axial);
    setIsEdited(false);
  }

  if (!meta || !selectedItem) return <div className="p-6">Empty draft/Draft not found!</div>;

  return (
    <div className="p-6 grid grid-cols-12 gap-4">
      {/* Sidebar: items in this draft */}
      <aside className="col-span-2 border border-[#282828] rounded-xl p-3">
        <div className="font-semibold mb-2">Scans</div>
        <ul className="space-y-1">
          {meta.items?.map(it => (
            <li key={it.item_id}>
              <button
                onClick={() => setSelectedItem(it.item_id)}
                className={`w-full text-left px-2 py-1 rounded ${selectedItem===it.item_id ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400" : "hover:border-gray"}`}
              >
                {it.item_id} · {it.segmented ? "segmented" : "unsegmented"}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t pt-3 space-y-2">
        <label className="flex items-center gap-2">
          <input
            id="editMaskButton"
            type="checkbox"
            checked={editMode}
            onChange={(e)=>setEditMode(e.target.checked)}
            disabled={isLoading}
          />
          Edit mask (axial)
        </label>

        {editMode && (
          <>
            <div className="flex gap-2">
              <button
                className={`px-2 py-1 border rounded transition ${brushMode === "brush" ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400" : "border border-gray-600"}`}
                onClick={()=>setBrushMode("brush")}
              >
                Brush
              </button>
              <button
                className={`px-2 py-1 border rounded ${brushMode === "erase" ? "border-blue-400 bg-blue-400/5 ring-1 ring-blue-400" : "border border-gray-600"}`}
                onClick={()=>setBrushMode("erase")}
              >
                Erase
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm">Size</span>
              <input
                type="range" min={1} max={15}
                value={brushSize}
                onChange={(e)=>setBrushSize(Number(e.target.value))}
                className="w-full"
              />
              <span className="text-sm">{brushSize}px</span>
            </div>
          </>
        )}
        <button
          id="clearEditsButton"
          onClick={clearEdits}
          disabled={!isEdited || isLoading}
          className="w-full px-3 py-2 rounded bg-[#5f9ea0] text-[#080808] disabled:bg-background-200 disabled:text-gray-500"
        >
          Clear Edits
        </button>
      </div>

      </aside>

      {/* Main viewer */}
      <section className="col-span-10 grid grid-cols-5 gap-4">
        {/* Axial */}
        <div className="col-span-3">
          <div className="relative h-[60vh]">
            <ScanCanvas
              blob={imgBlobs.axial}
            />
            {showMask && (
              <div className="absolute inset-0">
                {showMask && (
                  <MaskCanvas
                  blob={maskBlobs.axial}
                  mode={brushMode}
                  size={brushSize}
                  editable={editMode}
                  opacity={maskOpacity}
                  ref={brushRef}
                  onUpdate={(blob) => {
                    const key = `${selectedItem}:axial:${idx.axial}`;
                    cacheMask.current.set(key, blob);
                    setMaskBlobs((s) => ({ ...s, axial: blob }));
                    setIsEdited(true);
                  }}
                  />
                )}
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent border-white"></div>
              </div>
            )}
          </div>

          {/* Axial slider */}
          <div className="mt-2">
            <label className="text-sm">Axial (Z)</label>
            <input
              type="range" className="w-full"
              min={0} max={shape ? shape[2] - 1 : 0}
              value={idx.axial} onChange={onSlide("axial")}
            />
            <div className="text-xs text-white">
              {shape
                ? `Slice ${idx.axial} / ${shape[2] - 1}`
                : "Loading..."}
            </div>
          </div>
          {/* Mask controls */}
          <div className="col-span-5 mt-2 flex items-center gap-4">
            <button
              onClick={segmentOne}
              disabled={isLoading}
              className="px-3 py-2 rounded text-[#080808] bg-[#5f9ea0] hover:bg-[#8cd3d5] disabled:bg-background-200 disabled:text-gray-500"
            >
              Run TotalSegmentator
            </button>
            <button
              onClick={saveDraft}
              disabled={isLoading}
              className="px-3 py-2 rounded text-[#080808] bg-[#5f9ea0] hover:bg-[#8cd3d5] disabled:bg-background-200 disabled:text-gray-500"
            >
              Save draft
            </button>
            <button
              onClick={saveFinal}
              className="hidden px-3 py-2 rounded text-[#080808] bg-[#dcdcdcff] hover:bg-gray-300 disabled:bg-gray-300 disabled:text-gray-500"
            >
              Save Final
            </button>
            <button onClick={saveToDesktop}>
              <img src="/export.png" className="w-6 h-6">
              </img>
            </button>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showMask} onChange={(e)=>setShowMask(e.target.checked)} />
                Show mask
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm">Opacity</span>
                <input type="range" min={0} max={1} step={0.05}
                      value={maskOpacity}
                      onChange={(e)=>setMaskOpacity(Number(e.target.value))}
                      className="w-40" />
                <span className="text-sm">{Math.round(maskOpacity*100)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Side stack: slightly stretched boxes */}
        <div className="col-span-2 flex flex-col gap-4">
          {/* Coronal View */}
          <div className=" relative h-[29vh]">
            <ScanCanvas
              blob={imgBlobs.coronal}
            />
            <div className="absolute inset-0">
            {showMask && (
              <MaskCanvas
              blob={maskBlobs.coronal}
              mode={brushMode}
              size={brushSize}
              opacity={maskOpacity}
              ref={maskRef}
              />
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent border-white"></div>
              </div>
            )}
            </div>
          </div>
          
          {/* Sagittal View */}
          <div className=" relative h-[29vh]">
            <ScanCanvas 
              blob={imgBlobs.sagittal}
            />
            <div className="absolute inset-0">
            {showMask && (
              <MaskCanvas
              blob={maskBlobs.sagittal}
              mode={brushMode}
              size={brushSize}
              opacity={maskOpacity}
              ref={maskRef}
              />
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent border-white"></div>
              </div>
            )}
            </div>
          </div>

          {/* Sliders for side stack */}
          <div>
            <label className="text-sm">Coronal (Y)</label>
            <input
              type="range" className="w-full"
              min={0} max={shape ? shape[1] - 1 : 0}
              value={idx.coronal} onChange={onSlide("coronal")}
            />
          </div>
          <div>
            <label className="text-sm">Sagittal (X)</label>
            <input
              type="range" className="w-full"
              min={0} max={shape ? shape[0] - 1 : 0}
              value={idx.sagittal} onChange={onSlide("sagittal")}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
