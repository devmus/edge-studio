"""Small JSON-lines SDK for installed scripts. No application credentials are exposed."""
import base64
import json
import queue
import sys
import threading

_inputs = queue.Queue(maxsize=8)
_started = False


def _read():
    for line in sys.stdin:
        _inputs.put(json.loads(line))


def inputs(wait=True):
    """Get first/latest inputs. With wait=False return None if no update is waiting."""
    global _started
    if not _started:
        _started = True
        threading.Thread(target=_read, daemon=True).start()
    try:
        value = _inputs.get(block=wait)
        while not _inputs.empty():
            value = _inputs.get_nowait()
        return value
    except queue.Empty:
        return None


def result(value):
    print(json.dumps({"type": "result", "value": value}, allow_nan=False), flush=True)


def log(message):
    print(json.dumps({"type": "log", "message": str(message)}), flush=True)


def frame(image):
    """Send a Pillow 240x240 image through the runner's exclusive display session."""
    if image.size != (240, 240):
        raise ValueError("Expected a 240x240 image")
    print(json.dumps({"type": "frame", "rgb": base64.b64encode(image.convert("RGB").tobytes()).decode("ascii")}), flush=True)
