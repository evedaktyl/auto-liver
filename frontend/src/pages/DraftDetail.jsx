import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import ScanCanvas from "../components/ScanCanvas";
import MaskCanvas from "../components/MaskCanvas";
import { inflate } from "pako";

const API = "http://localhost:8000";
const PLANES = ["axial", "coronal", "sagittal"];

export default function DraftDetail() {
  const navigate = useNavigate();
  const { draftId } = useParams();

  const [meta, setMeta] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); 
  const [shape, setShape] = useState(null);
  const [idx, setIdx] = useState({ axial: 0, coronal: 0, sagittal: 0 }); // Slider values

  const cacheScan = useRef(new Map());
  const cacheScanSlice = useRef(new Map());
  const cacheMask = useRef(new Map());
  const cacheMaskSlice = useRef(new Map());
  const cacheEditedMask = useRef(new Map());
  

  const [imgBlobs, setImgBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [maskBlobs, setMaskBlobs] = useState({ axial: null, coronal: null, sagittal: null });
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.35);

  // Brush tool
  const [editMode, setEditMode] = useState(false);
  const [brushMode, setBrushMode] = useState("brush"); 
  const [brushSize, setBrushSize] = useState(8);
  const brushRef = useRef(null);
  const [axialSize, setAxialSize] = useState({w: 0, h: 0});
  const maskRef = useRef(null);
  const [isEdited, setIsEdited] = useState(false);

  // Status
  const [isLoading, setIsLoading] = useState({});

  // Load draft meta
  useEffect(() => {
    (async () => {
      const r = await fetch(`${API}/drafts/${draftId}`);
      if (!r.ok) return;
      const m = await r.json();
      setMeta(m);
      const first = m.items?.[0]?.item_id;
      setSelectedItem(first || null);
      setIsLoading(Object.fromEntries(m.items.map(item => [item.item_id, false])));
    })();
  }, [draftId]);

  // Get scan shape + flattened volume
  useEffect(() => {
    if (!selectedItem) return;

    const key = `${draftId}:${selectedItem}`;
    if (cacheScan.current.has(key) && cacheMask.current.has(key)) {
      const { shape } = cacheScan.current.get(key);
      setShape(shape);
      setIdx({
        axial: Math.floor(shape[2] / 2),
        coronal: Math.floor(shape[1] / 2),
        sagittal: Math.floor(shape[0] / 2),
      });
      return;
    }

    (async () => {
      setIsLoading(prev => ({ ...prev, [selectedItem]: true }));
      const r = await fetch(`${API}/drafts/${draftId}/scan?item=${selectedItem}`);
      if (!r.ok) return;

      const raw = new Uint8Array(await r.arrayBuffer());
      const header = new Int32Array(raw.buffer, 0, 3);
      const [X, Y, Z] = header;
      const shape = [X, Y, Z];
      setShape(shape);

      const volume = new Float32Array(inflate(raw.subarray(12)).buffer);
      cacheScan.current.set(key, { shape, volume });

      // Load mask
      const m = await fetch(`${API}/drafts/${draftId}/mask?item=${selectedItem}`);
      if (!m.ok) return;

      const mask = new Float32Array(inflate(new Uint8Array(await m.arrayBuffer()).subarray(12)).buffer);
      cacheMask.current.set(key, mask);
      setIdx({
        axial: Math.floor(Z / 2),
        coronal: Math.floor(Y / 2),
        sagittal: Math.floor(X / 2),
      });
      setIsLoading(prev => ({ ...prev, [selectedItem]: false }));
    })();
  }, [selectedItem]);

  // Load slices
  useEffect(() => {
    if (!idx || !selectedItem) return;

    const key = `${draftId}:${selectedItem}`;
    const scan = cacheScan.current.get(key);
    const mask = cacheMask.current.get(key);
    if (!scan || !mask) return;

    const { shape, volume } = scan;
    const [X, Y, Z] = shape;

    const loadSlice = async (plane, index) => {
      const sliceKey = `${selectedItem}:${plane}:${index}`;

      // Assumes if 
      if (cacheScanSlice.current.has(sliceKey)) {
        setImgBlobs(s => ({ ...s, [plane]: cacheScanSlice.current.get(sliceKey) }));
        if (cacheMaskSlice.current.has(sliceKey)) {
          setMaskBlobs(s => ({ ...s, [plane]: cacheMaskSlice.current.get(sliceKey)}));
          return;
        }
      }

      let slice;
      let mslice;
      const width  = plane === "axial" ? Y : Z;
      const height = plane === "axial" ? X : X; 
      if (plane == "axial") {
        slice = getAxial(volume, shape, index);
        mslice = getAxial(mask, shape, index);
        setAxialSize({ w: width, h: height });
      } else if (plane == "coronal") {
        slice = getCoronal(volume,  shape, index);
        mslice = getCoronal(mask, shape, index);
      } else {
        slice = getSagittal(volume, shape, index);
        mslice = getSagittal(mask, shape, index);
      }
      
      const blob = await floatSliceToPngBlob(slice, width, height);
      const mblob = await maskSliceToPngBlob(mslice, width, height);
      cacheScanSlice.current.set(sliceKey, blob);
      cacheMaskSlice.current.set(sliceKey, mblob);
      setImgBlobs(s => ({ ...s, [plane]: blob }));
      setMaskBlobs(s => ({ ...s, [plane]: mblob }));
    };

    loadSlice("axial", idx.axial);
    loadSlice("coronal", idx.coronal);
    loadSlice("sagittal", idx.sagittal);
  }, [idx, selectedItem]);

  function getAxial(volume, [X, Y, Z], z) {
    const out = new Float32Array(X * Y);
    let k = 0;
    for (let x = 0; x < X; x++)
      for (let y = 0; y < Y; y++)
        out[k++] = volume[(x * Y + y) * Z + z];
    return out;
  }

  function getCoronal(volume, [X, Y, Z], y) {
    const out = new Float32Array(X * Z);
    let k = 0;
    for (let x = 0; x < X; x++)
      for (let z = 0; z < Z; z++)
        out[k++] = volume[(x * Y + y) * Z + z];
    return out;
  }

  function getSagittal(volume, [X, Y, Z], x) {
    const out = new Float32Array(Y * Z);
    let k = 0;
    for (let y = 0; y < Y; y++)
      for (let z = 0; z < Z; z++)
        out[k++] = volume[(x * Y + y) * Z + z];
    return out;
  }

  function rotateSlice(slice, width, height) {
    const out = new Float32Array(width * height);

    let k = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldIndex = x + (height - 1 - y) * width;
        out[k++] = slice[oldIndex];
      }
    }
    return out;
  }

  function floatSliceToPngBlob(slice, width, height) {
    // normalize slice to [0, 255]
    const arr = new Uint8ClampedArray(width * height);
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < slice.length; i++) {
      const v = slice[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;

    for (let i = 0; i < slice.length; i++) {
      arr[i] = ((slice[i] - min) / range) * 255;
    }

    // convert grayscale to ImageData
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      rgba[i * 4 + 0] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(rgba, width, height);
    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
  }

  function maskSliceToPngBlob(slice, width, height) {
    // normalize slice to [0, 255]
    const arr = new Uint8ClampedArray(width * height);
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < slice.length; i++) {
      const v = slice[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;

    for (let i = 0; i < slice.length; i++) {
      arr[i] = ((slice[i] - min) / range) * 255;
    }

    // convert grayscale to ImageData
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == 0) {
        rgba[i * 4 + 0] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 0;
      } else {
        rgba[i * 4 + 0] = 255;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(rgba, width, height);
    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
  }

  const onSlide = (plane) => async (e) => {
    const v = Number(e.target.value);
    setIdx((s) => ({ ...s, [plane]: v }));
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

  const segment = async () => {
    if (!selectedItem) return;

    const key = `${draftId}:${selectedItem}`;
    setIsLoading(prev => ({ ...prev, [selectedItem]: true }));

    // run segmentation
    await fetch(`${API}/drafts/${draftId}/segment?item=${selectedItem}`, { method: "POST" });
    
    // fetch TotalSegmentator mask output
    const m = await fetch(`${API}/drafts/${draftId}/mask?item=${selectedItem}`);
    const raw = new Uint8Array(await m.arrayBuffer());
    const newMask = new Float32Array(inflate(raw.subarray(12)).buffer);

    // replace cached mask
    cacheMask.current.set(key, newMask);
    for (const sliceKey of cacheMaskSlice.current.keys()) {
      if (sliceKey.startsWith(`${selectedItem}:`)) {
        cacheMaskSlice.current.delete(sliceKey);
      }
    }

    setIdx(idx => ({ ...idx }));
    setIsLoading(prev => ({ ...prev, [selectedItem]: false }));
  };

  const clearEdits = async () => {
    // clear cached mask slices of this item
    for (const sliceKey of cacheMaskSlice.current.keys()) {
      if (sliceKey.startsWith(`${selectedItem}:`)) {
        cacheMaskSlice.current.delete(sliceKey);
      }
    }
    
    setIdx(idx => ({ ...idx }));
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
            disabled={isLoading[selectedItem]}
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
          disabled={!isEdited || isLoading[selectedItem]}
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
                    console.log(blob);
                    cacheMaskSlice.current.set(key, blob);
                    setMaskBlobs((s) => ({ ...s, axial: blob }));
                    setIsEdited(true);
                  }}
                  />
                )}
              </div>
            )}

            {isLoading[selectedItem] && (
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
              onClick={segment}
              disabled={isLoading[selectedItem]}
              className="px-3 py-2 rounded text-[#080808] bg-[#5f9ea0] hover:bg-[#8cd3d5] disabled:bg-background-200 disabled:text-gray-500"
            >
              Run TotalSegmentator
            </button>
            <button
              onClick={saveDraft}
              disabled={isLoading[selectedItem]}
              className="px-3 py-2 rounded text-[#080808] bg-[#5f9ea0] hover:bg-[#8cd3d5] disabled:bg-background-200 disabled:text-gray-500"
            >
              Save draft
            </button>
            <button
              onClick={saveFinal}
              disabled={isLoading[selectedItem]}
              className="px-3 py-2 rounded text-[#080808] bg-[#dcdcdcff] hover:bg-gray-300 disabled:bg-gray-300 disabled:text-gray-500"
            >
              Save Final To 4090
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

            {isLoading[selectedItem] && (
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

            {isLoading[selectedItem] && (
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
