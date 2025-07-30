from pathlib import Path
import threading

COUNTER_PATH = Path("data/scan_id_counter.txt")
COUNTER_LOCK = threading.lock()

def get_next_scan_id() -> int:
    with COUNTER_LOCK:
        if not COUNTER_PATH.exists():
            COUNTER_PATH.write_text("0")
        current_id = int(COUNTER_PATH.read_text())
        next_id = current_id + 1
        COUNTER_PATH.write_text(str(next_id))
        return next_id
    
    