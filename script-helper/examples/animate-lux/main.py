import math
import time


WIDTH = 240
HEIGHT = 240
RADIUS = 40
FRAME_SECONDS = 0.1
LUX_COLOR_BANDS = (
    (5, "#4ea8de"),
    (10, "#48cae4"),
    (15, "#80ed99"),
    (20, "#f9e56d"),
    (25, "#f4a261"),
)
BRIGHTEST_LUX_COLOR = "#e76f51"


def lux_value(payload, current=None):
    if not isinstance(payload, dict):
        raise ValueError("Inputs must be a JSON object")
    value = payload.get("lux", current)
    if value is None:
        raise ValueError("Input lux must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Input lux must be a finite number")
    return value


def circle_color(lux):
    for upper_bound, color in LUX_COLOR_BANDS:
        if lux < upper_bound:
            return color
    return BRIGHTEST_LUX_COLOR


def next_position(x, y, velocity_x, velocity_y, elapsed):
    x += velocity_x * elapsed
    y += velocity_y * elapsed
    if x <= RADIUS:
        x, velocity_x = RADIUS, abs(velocity_x)
    elif x >= WIDTH - RADIUS:
        x, velocity_x = WIDTH - RADIUS, -abs(velocity_x)
    if y <= RADIUS:
        y, velocity_y = RADIUS, abs(velocity_y)
    elif y >= HEIGHT - RADIUS:
        y, velocity_y = HEIGHT - RADIUS, -abs(velocity_y)
    return x, y, velocity_x, velocity_y


def main():
    from PIL import Image, ImageDraw, ImageFont
    from edge_script import frame, inputs, result

    config = inputs()
    lux = lux_value(config)
    duration = config.get("durationSeconds", 5)
    if duration is not None:
        duration = float(duration)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("durationSeconds must be a positive finite number or null")

    x, y = float(RADIUS), float(RADIUS)
    velocity_x, velocity_y = 58.0, 47.0
    started = previous = time.monotonic()
    font = ImageFont.load_default(size=20)
    result({"lux": lux})

    while duration is None or time.monotonic() - started < duration:
        frame_started = time.monotonic()
        update = inputs(wait=False)
        if update is not None:
            lux = lux_value(update, lux)
            result({"lux": lux})

        now = time.monotonic()
        x, y, velocity_x, velocity_y = next_position(x, y, velocity_x, velocity_y, now - previous)
        previous = now

        image = Image.new("RGB", (WIDTH, HEIGHT), "black")
        draw = ImageDraw.Draw(image)
        draw.ellipse((x - RADIUS, y - RADIUS, x + RADIUS, y + RADIUS), fill=circle_color(lux), outline="white", width=2)
        label = f"{lux:.2f}"
        left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
        draw.text((x - (right - left) / 2, y - (bottom - top) / 2 - top), label, font=font, fill="black")
        frame(image)
        time.sleep(max(0, FRAME_SECONDS - (time.monotonic() - frame_started)))

    result({"lux": lux})


if __name__ == "__main__":
    main()
