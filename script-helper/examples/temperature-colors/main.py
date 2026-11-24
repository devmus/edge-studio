import math
import time


WIDTH = 240
HEIGHT = 240
UPDATE_POLL_SECONDS = 0.1
TEMPERATURE_STYLES = (
    (4, "#2648a1", "white"),
    (8, "#2878c8", "white"),
    (12, "#28a9d6", "black"),
    (16, "#35c9b0", "black"),
    (20, "#61c96f", "black"),
    (24, "#a8d65e", "black"),
    (28, "#f0dc55", "black"),
    (32, "#f4ad45", "black"),
    (36, "#ed754c", "black"),
)
HOTTEST_STYLE = ("#d83b3b", "white")


def temperature_value(payload, current=None):
    if not isinstance(payload, dict):
        raise ValueError("Inputs must be a JSON object")
    value = payload.get("message", current)
    if value is None:
        raise ValueError("Input message must be a finite temperature")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Input message must be a finite temperature")
    return value


def temperature_style(temperature):
    for upper_bound, background, text in TEMPERATURE_STYLES:
        if temperature < upper_bound:
            return background, text
    return HOTTEST_STYLE


def changed_temperature(payload, current):
    updated = temperature_value(payload, current)
    return updated if updated != current else None


def render_temperature(temperature, image_module, draw_module, font):
    background, text_color = temperature_style(temperature)
    image = image_module.new("RGB", (WIDTH, HEIGHT), background)
    draw = draw_module.Draw(image)
    label = f"{temperature:.1f} C"
    left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
    draw.text(
        ((WIDTH - (right - left)) / 2, (HEIGHT - (bottom - top)) / 2 - top),
        label,
        font=font,
        fill=text_color,
    )
    return image


def main():
    from PIL import Image, ImageDraw, ImageFont
    from edge_script import frame, inputs, result

    config = inputs()
    temperature = temperature_value(config)
    duration = config.get("durationSeconds", 5)
    if duration is not None:
        duration = float(duration)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("durationSeconds must be a positive finite number or null")

    font = ImageFont.load_default(size=48)
    started = time.monotonic()
    frame(render_temperature(temperature, Image, ImageDraw, font))
    result({"temperature": temperature})

    while duration is None or time.monotonic() - started < duration:
        update = inputs(wait=False)
        if update is not None:
            updated_temperature = changed_temperature(update, temperature)
            if updated_temperature is not None:
                temperature = updated_temperature
                frame(render_temperature(temperature, Image, ImageDraw, font))
                result({"temperature": temperature})
        time.sleep(UPDATE_POLL_SECONDS)

    result({"temperature": temperature})


if __name__ == "__main__":
    main()
