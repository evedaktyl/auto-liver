import { useEffect, useRef, useImperativeHandle } from "react";

export default function MaskCanvas({ 
  blob, 
  width, 
  height, 
  opacity=0.35, 
  mode="brush", 
  size=5, 
  editable=false, 
  ref, 
  onUpdate
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getPNG: () => canvasRef.current?.toDataURL("image/png"),
    clear: () => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
    },
  }));

  useEffect(() => {
    if (!blob) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");

    (async () => {
      const bmp = await createImageBitmap(blob);
      cv.width = width || bmp.width;
      cv.height = height || bmp.height;
      ctx.clearRect(0, 0, cv.width, cv.height);

      ctx.globalAlpha = 1;
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    })();
  }, [blob, width, height]);

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
        ctx.fillStyle = `rgba(255,0,0,1)`;
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
  }, [blob, mode, size, editable]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width: "100%", height: "100%", opacity: opacity}}
/>

}