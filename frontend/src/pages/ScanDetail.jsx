import { useParams } from "react-router-dom";
import { useRef, useEffect, useState } from "react";

const PLANES = ["axial", "coronal", "sagittal"];
const API_BASE = "http://localhost:8000/scans";

const planeMax = (shape, plane) =>
    plane === "axial" ? shape[2] :
    plane === "coronal" ? shape[1] :
    shape[0];

/* Draws a single Blob to a <canvas> */
function CanvasView({ blob }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!blob) return;
        let revokedUrl = null;
        let cancelled = false;

        (async () => {
            const draw = async () => {
                if ("createImageBitmap" in window) {
                    const bitmap = await createImageBitmap(blob);
                    return { width: bitmap.width, height: bitmap.height, bitmap };
                } else {
                    const url = URL.createObjectURL(blob);
                    revokedUrl = url;
                    const img = await new Promise((res, rej) => {
                        const i = new Image();
                        i.onload = () => res(i);
                        i.onerror = rej;
                        i.src = url;
                    });
                    return { width: img.naturalWidth, height: img.naturalHeight, img };
                }
            };

            try {
                const result = await draw();
                if (cancelled) return;
                const cv = ref.current;
                const ctx = cv.getContext("2d");

                cv.width = result.width;
                cv.height = result.height;
                if (result.bitmap) ctx.drawImage(result.bitmap, 0, 0);
                else ctx.drawImage(result.img, 0, 0);

                cv.style.width = "100%";
                cv.style.height = "auto";
                cv.style.display = "block";
            } catch {

            } finally {
                if (revokedUrl) URL.revokeObjectURL(revokedUrl);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [blob]);

    return <canvas ref={ref} className="border rounded" />;
}

export default function ScanDetail() {
    const { scanId } = useParams();

    const [shape, setShape] = useState(null);
    const [idx, setIdx] = useState({ axial: 0, coronal: 0, sagittal: 0 });
    const [blobs, setBlobs] = useState({ axial: null, coronal: null, sagittal: null });

    const cacheRef = useRef(new Map());
    const abortRef = useRef({});
    const throttleRef = useRef({});

    useEffect(() => {
        let active = true;
        fetch(`${API_BASE}/${scanId}/preview`)
            .then(r => {
                if (!r.ok) throw new Error("Failed to load preview");
                return r.json();
            })
            .then(meta => {
                if (!active) return;
                const { shape: shp, indices } = meta;
                setShape(shp);
                setIdx(indices);

                PLANES.forEach(plane => {
                    fetchSlice(plane, indices[plane]);
                });
            })
            .catch(() => {});
        return () => { active = false; };
    }, [scanId]);

    const fetchSlice = (plane, index) => {
        const key = `${plane}-${index}`;
        if (cacheRef.current.has(key)) {
            setBlobs(prev => ({ ...prev, [plane]: cacheRef.current.get(key) }));
            return;
        }
        
        if (abortRef.current[plane]) abortRef.current[plane].abort();
        const controller = new AbortController();
        abortRef.current[plane] = controller;

        const url = `${API_BASE}/${scanId}/slice.png?plane=${plane}&index=${index}`;
        fetch(url, { signal: controller.signal })
            .then(r => r.blob())
            .then(blob => {
                cacheRef.current.set(key, blob);
                setBlobs(prev => ({ ...prev, [plane]: blob }));

                // Prefetch neighbors to smooth scrubbing
                prefetchNeighbor(plane, index + 1);
                prefetchNeighbor(plane, index - 1);
            })
            .catch(() => {});
    };

    const prefetchNeighbor = (plane, index) => {
        if (!shape) return;
        const max = planeMax(shape, plane);
        if (index < 0 || index >= max) return;
        const key = `${plane}-${index}`;
        if (cacheRef.current.has(key)) return;
        fetch(`${API_BASE}/${scanId}/slice.png?plane=${plane}&index=${index}`)
        .then(r => r.blob())
        .then(blob => cacheRef.current.set(key, blob))
        .catch(() => {});
    };

    // Slider change
    const onSlide = (plane) => (e) => {
        const value = Number(e.target.value);
        setIdx(prev => ({ ...prev, [plane]: value }));

        if (throttleRef.current[plane]) clearTimeout(throttleRef.current[plane]);

        // Throttle to ~80ms (I CHANGED TO 0ms because I want it smooth)
        throttleRef.current[plane] = setTimeout(() => {
        fetchSlice(plane, value);
        }, 0);
    };

    const segment = async () => {
        try {
            const res = await fetch(`http://localhost:8000/scans/${scanId}/segment`, {
                method: 'POST',
                body: null
            });
            if (!res.ok) throw new Error("Segmentation failed!");
        } catch (err) {
            console.error(err);
        }
    }

    if (!shape) return <div className="p-6">Loading...</div>;

    return (
        <div className="p-6 space-y-6">
            <div className="flex gap-4">
                <div className="w-1/3"><CanvasView blob={blobs.axial} /></div>
                <div className="w-1/3"><CanvasView blob={blobs.coronal} /></div>
                <div className="w-1/3"><CanvasView blob={blobs.sagittal} /></div>
            </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Axial */}
        <div>
          <label className="block text-sm font-medium mb-1">Axial (Z)</label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={planeMax(shape, "axial") - 1}
            value={idx.axial}
            onChange={onSlide("axial")}
          />
          <div className="text-xs mt-1">Slice {idx.axial} / {planeMax(shape, "axial")-1}</div>
        </div>

        {/* Coronal */}
        <div>
          <label className="block text-sm font-medium mb-1">Coronal (Y)</label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={planeMax(shape, "coronal") -1}
            value={idx.coronal}
            onChange={onSlide("coronal")}
          />
          <div className="text-xs mt-1">Slice {idx.coronal} / {planeMax(shape, "coronal")-1}</div>
        </div>

        {/* Sagittal */}
        <div>
          <label className="block text-sm font-medium mb-1">Sagittal (X)</label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={planeMax(shape, "sagittal")-1}
            value={idx.sagittal}
            onChange={onSlide("sagittal")}
          />
          <div className="text-xs mt-1">Slice {idx.sagittal} / {planeMax(shape, "sagittal")-1}</div>
        </div>
      </div>
    </div>
    )
}