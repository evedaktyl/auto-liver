import io, numpy as np
from PIL import Image

def slice_to_png_bytes(arr: np.ndarray) -> bytes:
    a = arr.astype(np.float32)
    vmin, vmax = np.nanmin(a), np.nanmax(a)
    if vmax > vmin:
        a = (a - vmin) / (vmax - vmin)
    a = (a * 255).clip(0,255).astype(np.uint8)
    im = Image.fromarray(a)
    buf = io.BytesIO(); im.save(buf, format="PNG"); buf.seek(0)
    return buf.getvalue()

def mask_to_rgba_png_bytes(mask_bool: np.ndarray, color="FF0000", alpha=0.5) -> bytes:
    h, w = mask_bool.shape
    r = int(color[0:2],16); g = int(color[2:4],16); b = int(color[4:6],16)
    a = int(max(0,min(1,alpha))*255)
    rgba = np.zeros((h,w,4), dtype=np.uint8)
    rgba[mask_bool, 0] = r; rgba[mask_bool, 1] = g; rgba[mask_bool, 2] = b; rgba[mask_bool, 3] = a
    from PIL import Image
    im = Image.fromarray(rgba, mode="RGBA")
    import io
    buf = io.BytesIO(); im.save(buf, format="PNG"); buf.seek(0)
    return buf.getvalue()
