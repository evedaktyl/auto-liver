import { useEffect, useRef } from "react";

export default function ScanCanvas({ blob }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!blob) return;
    let cancel = false;

    (async () => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");

      const bmp = await createImageBitmap(blob);
      if (cancel) return;

      cv.width = bmp.width;
      cv.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);

      cv.style.width = "100%";
      cv.style.height = "100%";
    })();

    return () => { cancel = true };
  }, [blob]);

  return <canvas ref={ref} className="w-full h-full border rounded" />;
}
