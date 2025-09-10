import { useEffect, useRef, useImperativeHandle } from "react";

/**
 * AxialMaskCanvas displays and allows editing of an axial segmentation mask slice.
 *
 * Key refs:
 * - canvasRef: the <canvas> DOM element, holding the mask pixels.
 * - drawingRef: mutable flag to track whether the mouse is currently pressed.
 *
 * Props
 * @param {ImageData} imageData - Initial mask slice as ImageData (from volume array).
 * @param {number} width - Desired canvas width in pixels; defaults to imageData.width.
 * @param {number} height - Desired canvas height in pixels; defaults to imageData.height.
 * @param {number} opacity - Opacity at which the mask is drawn.
 * @param {"brush"|"erase"} mode - Drawing mode.
 * @param {number} size - Radius of brush circle in pixels.
 * @param {boolean} editable - If true, enables brush/erase with the mouse.
 * @param {React.Ref} ref - Exposes helper methods (`getPNG`, `clear`) to parent.
 * @param {function} onUpdate - Callback(blob) fired after edits (mouseup).
 *
 * Usage:
 * - Render <AxialMaskCanvas> above a scan canvas for axial view.
 * - Edits modify the in-memory mask; onUpdate pushes a blob back to parent cache.
 */
export default function AxialMaskCanvas({
  imageData,
  width,
  height,
  opacity = 0.35,
  mode = "brush",
  size = 5,
  editable = false,
  ref,
  onUpdate,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getPNG: () => canvasRef.current?.toDataURL("image/png"),
    clear: () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
    },
  }));

  // Draw initial ImageData
  useEffect(() => {
    if (!imageData) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");

    cv.width = width || imageData.width;
    cv.height = height || imageData.height;

    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
    ctx.putImageData(imageData, 0, 0);
  }, [imageData, width, height]);

  // Enable brush/erase edits
  useEffect(() => {
    if (!editable) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");

    const start = () => (drawingRef.current = true);
    const stop = () => {
      if (drawingRef.current) {
        drawingRef.current = false;
        cv.toBlob((b) => {
          if (b && onUpdate) onUpdate(b);
        });
      }
    };

    const move = (e) => {
      if (!drawingRef.current) return;
      const rect = cv.getBoundingClientRect();
      const scaleX = cv.width / rect.width;
      const scaleY = cv.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      if (mode === "brush") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(255,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fill();
    };

    cv.addEventListener("mousedown", start);
    cv.addEventListener("mouseup", stop);
    cv.addEventListener("mouseout", stop);
    cv.addEventListener("mousemove", move);

    return () => {
      cv.removeEventListener("mousedown", start);
      cv.removeEventListener("mouseup", stop);
      cv.removeEventListener("mouseout", stop);
      cv.removeEventListener("mousemove", move);
    };
  }, [mode, size, editable, onUpdate]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: "100%", height: "100%", opacity }}
    />
  );
}
