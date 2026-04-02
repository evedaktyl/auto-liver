import ScanCanvas from "./ScanCanvas";
import MaskCanvas from "./MaskCanvas";

/**
 * VolumeViewer - Shared 3-plane medical image viewer (axial, coronal, sagittal).
 *
 * Props:
 * @param {Object} imgBlobs - { axial, coronal, sagittal } scan slice blobs
 * @param {Object} maskBlobs - { axial, coronal, sagittal } mask slice blobs
 * @param {number[]} shape - Volume dimensions [X, Y, Z]
 * @param {Object} idx - Current slice indices { axial, coronal, sagittal }
 * @param {function} onSlide - Callback (plane, value) when slider changes
 * @param {boolean} isLoading - Show loading spinner overlay
 *
 * Mask display:
 * @param {boolean} showMask - Whether to show mask overlay
 * @param {number} maskOpacity - Mask opacity (0-1)
 *
 * Edit mode (optional - for DraftDetail):
 * @param {boolean} editable - Enable brush editing on axial view
 * @param {boolean} editMode - Whether edit mode is active
 * @param {string} brushMode - "brush" or "erase"
 * @param {number} brushSize - Brush radius in pixels
 * @param {function} onMaskUpdate - Callback (blob) when mask is edited
 * @param {React.Ref} brushRef - Ref for MaskCanvas imperative methods
 */
export default function VolumeViewer({
  imgBlobs,
  maskBlobs,
  shape,
  idx,
  onSlide,
  isLoading,
  showMask = true,
  maskOpacity = 0.35,
  editable = false,
  editMode = false,
  brushMode = "brush",
  brushSize = 8,
  onMaskUpdate,
  brushRef,
}) {
  const LoadingOverlay = () => (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent border-white"></div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* ─────────────────────────────────────────────────────────────────────
          AXIAL VIEW (main, larger)
      ───────────────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-3">
        <div className="relative h-[60vh]">
          <ScanCanvas blob={imgBlobs.axial} />
          {showMask && (
            <div className="absolute inset-0">
              <MaskCanvas
                blob={maskBlobs.axial}
                mode={brushMode}
                size={brushSize}
                editable={editable && editMode}
                opacity={maskOpacity}
                ref={brushRef}
                onUpdate={onMaskUpdate}
              />
            </div>
          )}
          {isLoading && <LoadingOverlay />}
        </div>

        {/* Axial slider */}
        <div className="mt-2">
          <label className="text-sm">Axial (Z)</label>
          <input
            type="range"
            className="w-full"
            min={0}
            max={shape ? shape[2] - 1 : 0}
            value={idx.axial}
            onChange={(e) => onSlide("axial", Number(e.target.value))}
          />
          <div className="text-xs text-white">
            {shape ? `Slice ${idx.axial} / ${shape[2] - 1}` : "Loading..."}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          CORONAL + SAGITTAL VIEWS (side stack on large, horizontal on small)
      ───────────────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-4">
        {/* Coronal View */}
        <div>
          <div className="relative h-[29vh]">
            <ScanCanvas blob={imgBlobs.coronal} />
            <div className="absolute inset-0">
              {showMask && (
                <MaskCanvas
                  blob={maskBlobs.coronal}
                  mode={brushMode}
                  size={brushSize}
                  opacity={maskOpacity}
                  editable={false}
                />
              )}
              {isLoading && <LoadingOverlay />}
            </div>
          </div>
          <div className="mt-2">
            <label className="text-sm">Coronal (Y)</label>
            <input
              type="range"
              className="w-full"
              min={0}
              max={shape ? shape[1] - 1 : 0}
              value={idx.coronal}
              onChange={(e) => onSlide("coronal", Number(e.target.value))}
            />
          </div>
        </div>

        {/* Sagittal View */}
        <div>
          <div className="relative h-[29vh]">
            <ScanCanvas blob={imgBlobs.sagittal} />
            <div className="absolute inset-0">
              {showMask && (
                <MaskCanvas
                  blob={maskBlobs.sagittal}
                  mode={brushMode}
                  size={brushSize}
                  opacity={maskOpacity}
                  editable={false}
                />
              )}
              {isLoading && <LoadingOverlay />}
            </div>
          </div>
          <div className="mt-2">
            <label className="text-sm">Sagittal (X)</label>
            <input
              type="range"
              className="w-full"
              min={0}
              max={shape ? shape[0] - 1 : 0}
              value={idx.sagittal}
              onChange={(e) => onSlide("sagittal", Number(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
