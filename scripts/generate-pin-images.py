"""Generate Lucide-style map-pin PNG assets for the app.

Draws a teardrop pin shape (rounded top, pointed bottom, white center circle)
at 4× resolution and downscales for anti-aliasing.

Uses a composite approach: filled circle + filled triangle (same color) for
the body, plus a white center circle. This avoids arc-angle convention issues.

Usage: python3 scripts/generate-pin-images.py
Output: assets/map/question-pin.png, assets/map/question-pin-start.png
"""

import math
from PIL import Image, ImageDraw

PIN_W, PIN_H = 96, 116  # target pixel dimensions
SCALE = 4  # supersampling factor


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def darker(hex_color: str, factor: float = 0.82) -> str:
    """Darken a hex color by a factor."""
    r, g, b = hex_to_rgb(hex_color)
    r = max(0, min(255, int(r * factor)))
    g = max(0, min(255, int(g * factor)))
    b = max(0, min(255, int(b * factor)))
    return f"#{r:02x}{g:02x}{b:02x}"


def draw_pin(fill_color: str) -> Image.Image:
    """Draw a single map-pin icon at 4× resolution, then downscale.

    The pin shape is a teardrop: a circle at the top with sides that taper
    to a point at the bottom, plus a smaller white circle (the "eye").
    """
    sw, sh = PIN_W * SCALE, PIN_H * SCALE

    img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    fill_rgb = hex_to_rgb(fill_color)
    outline_rgb = hex_to_rgb(darker(fill_color, 0.78))

    # --- Geometry (in target pixels; scaled up below) ---
    cx = PIN_W / 2  # 48 — horizontal center
    cy = 42.0  # vertical center of the upper circle
    radius = 30.0  # radius of the upper circle
    tip_y = 114.0  # bottom point of the teardrop
    eye_radius = 10.0  # white center circle radius
    eye_cy = 38.0  # vertical center of the eye
    outline_width = 2.5  # stroke width

    # Scale up
    cx_s = cx * SCALE
    cy_s = cy * SCALE
    radius_s = radius * SCALE
    tip_y_s = tip_y * SCALE
    eye_radius_s = eye_radius * SCALE
    eye_cy_s = eye_cy * SCALE
    outline_s = outline_width * SCALE

    # --- Tangent points where lines from the tip meet the circle ---
    # The tip is directly below the circle center.
    dist = tip_y_s - cy_s  # vertical distance from circle center to tip
    if dist <= radius_s:
        raise ValueError("Tip is inside the circle — adjust geometry")

    half_span = math.asin(radius_s / dist)  # half-angle of the tangent cone

    # In image coords (y-down), the direction from center to tip is
    # straight down: angle = pi/2 from the positive x-axis.
    # Tangent points are at pi/2 +/- half_span.
    t1_angle = math.pi / 2 - half_span  # right tangent (lower-right of circle)
    t2_angle = math.pi / 2 + half_span  # left tangent (lower-left of circle)

    t1_x = cx_s + radius_s * math.cos(t1_angle)
    t1_y = cy_s + radius_s * math.sin(t1_angle)
    t2_x = cx_s + radius_s * math.cos(t2_angle)
    t2_y = cy_s + radius_s * math.sin(t2_angle)

    # --- Draw body: circle + triangle, both filled with the same color ---

    # Filled circle (upper body)
    circle_bbox = [
        cx_s - radius_s,
        cy_s - radius_s,
        cx_s + radius_s,
        cy_s + radius_s,
    ]
    draw.ellipse(circle_bbox, fill=fill_rgb)

    # Filled triangle (lower taper) — same color, blends seamlessly
    triangle = [(t1_x, t1_y), (t2_x, t2_y), (cx_s, tip_y_s)]
    draw.polygon(triangle, fill=fill_rgb)

    # --- Draw outline ---

    # Circle outline (only the visible upper portion)
    # PIL's arc draws clockwise from 3 o'clock.
    # t1 is lower-right (~30°), t2 is lower-left (~150°).
    # We want the arc going over the TOP: from t1 (~30°) clockwise
    # through top (270°) to t2 (~150° + 360° = 510°).
    t1_deg = math.degrees(t1_angle)
    t2_deg = math.degrees(t2_angle)
    # t1_deg is ~62°, t2_deg is ~118° (both in the lower half).
    # The top arc is from t2_deg (118°) clockwise to t1_deg + 360° (422°).
    arc_start = t2_deg  # left tangent, going clockwise over the top
    arc_end = t1_deg + 360  # right tangent, wrapping around

    arc_bbox = [
        cx_s - radius_s,
        cy_s - radius_s,
        cx_s + radius_s,
        cy_s + radius_s,
    ]
    draw.arc(arc_bbox, arc_start, arc_end, fill=outline_rgb, width=int(outline_s))

    # Triangle edges (left side and right side — the base is hidden inside the circle)
    draw.line(
        [(t1_x, t1_y), (cx_s, tip_y_s)],
        fill=outline_rgb,
        width=int(outline_s),
    )
    draw.line(
        [(t2_x, t2_y), (cx_s, tip_y_s)],
        fill=outline_rgb,
        width=int(outline_s),
    )

    # --- White center circle ("eye") ---
    eye_bbox = [
        cx_s - eye_radius_s,
        eye_cy_s - eye_radius_s,
        cx_s + eye_radius_s,
        eye_cy_s + eye_radius_s,
    ]
    draw.ellipse(eye_bbox, fill=(255, 255, 255))

    # Subtle inner ring for depth
    ring_rgb = (210, 210, 210)
    draw.ellipse(eye_bbox, outline=ring_rgb, width=max(1, int(outline_s * 0.4)))

    # --- Downscale with Lanczos for anti-aliasing ---
    return img.resize((PIN_W, PIN_H), Image.LANCZOS)


def main() -> None:
    red_pin = draw_pin("#e46f4d")
    red_pin.save("assets/map/question-pin.png")
    print("Saved assets/map/question-pin.png (red)")

    blue_pin = draw_pin("#4a90d9")
    blue_pin.save("assets/map/question-pin-start.png")
    print("Saved assets/map/question-pin-start.png (blue)")


if __name__ == "__main__":
    main()
