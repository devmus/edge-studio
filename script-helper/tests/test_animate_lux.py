import importlib.util
import math
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("animate_lux", Path(__file__).resolve().parents[1] / "examples" / "animate-lux" / "main.py")
animate_lux = importlib.util.module_from_spec(spec)
spec.loader.exec_module(animate_lux)


class AnimateLuxTests(unittest.TestCase):
    def test_lux_value_accepts_numeric_updates_and_preserves_the_current_value(self):
        self.assertEqual(animate_lux.lux_value({"lux": 12.5}), 12.5)
        self.assertEqual(animate_lux.lux_value({"lux": "18.75"}, 12.5), 18.75)
        self.assertEqual(animate_lux.lux_value({}, 18.75), 18.75)
        for value in (None, math.nan, math.inf, "not-a-number"):
            with self.assertRaises((TypeError, ValueError)):
                animate_lux.lux_value({"lux": value})

    def test_position_moves_diagonally_and_reflects_at_each_screen_edge(self):
        self.assertEqual(animate_lux.next_position(80, 80, 10, 20, 1), (90, 100, 10, 20))
        self.assertEqual(animate_lux.next_position(199, 100, 10, 20, 1), (200, 120, -10, 20))
        self.assertEqual(animate_lux.next_position(100, 199, 10, 20, 1), (110, 200, 10, -20))
        self.assertEqual(animate_lux.next_position(41, 41, -10, -20, 1), (40, 40, 10, 20))

    def test_circle_color_uses_six_five_lux_bands(self):
        self.assertEqual(animate_lux.circle_color(-1), "#4ea8de")
        self.assertEqual(animate_lux.circle_color(4.99), "#4ea8de")
        self.assertEqual(animate_lux.circle_color(5), "#48cae4")
        self.assertEqual(animate_lux.circle_color(10), "#80ed99")
        self.assertEqual(animate_lux.circle_color(15), "#f9e56d")
        self.assertEqual(animate_lux.circle_color(20), "#f4a261")
        self.assertEqual(animate_lux.circle_color(25), "#e76f51")
        self.assertEqual(animate_lux.circle_color(30), "#e76f51")


if __name__ == "__main__":
    unittest.main()
