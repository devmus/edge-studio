import math
import time
from PIL import Image, ImageDraw
from edge_script import frame, inputs, result

config = inputs()
lux = float(config.get("lux", 0))
duration = config.get("durationSeconds", 5)
started = time.monotonic()
while duration is None or time.monotonic() - started < float(duration):
    update = inputs(wait=False)
    if update is not None:
        lux = float(update.get("lux", lux))
    image = Image.new("RGB", (240, 240), "black")
    draw = ImageDraw.Draw(image)
    radius = 24 + int(8 * (1 + math.sin((time.monotonic() - started) * 3)))
    draw.ellipse((120 - radius, 85 - radius, 120 + radius, 85 + radius), fill="yellow")
    draw.text((50, 145), f"Light: {lux:.2f} lux", fill="white")
    draw.rectangle((20, 180, 20 + min(200, max(0, int(lux))), 200), fill="orange")
    frame(image)
    time.sleep(0.1)
result({"lux": lux})
