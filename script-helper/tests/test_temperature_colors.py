import importlib.util
import math
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("temperature_colors", Path(__file__).resolve().parents[1] / "examples" / "temperature-colors" / "main.py")
temperature_colors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(temperature_colors)


class TemperatureColorsTests(unittest.TestCase):
    def test_temperature_value_reads_message_and_preserves_current_value(self):
        self.assertEqual(temperature_colors.temperature_value({"message": 12.5}), 12.5)
        self.assertEqual(temperature_colors.temperature_value({"message": "18.75"}, 12.5), 18.75)
        self.assertEqual(temperature_colors.temperature_value({}, 18.75), 18.75)
        for value in (None, math.nan, math.inf, "not-a-number"):
            with self.assertRaises((TypeError, ValueError)):
                temperature_colors.temperature_value({"message": value})

    def test_temperature_style_uses_ten_four_degree_bands(self):
        expected = [
            (-1, "#2648a1"),
            (4, "#2878c8"),
            (8, "#28a9d6"),
            (12, "#35c9b0"),
            (16, "#61c96f"),
            (20, "#a8d65e"),
            (24, "#f0dc55"),
            (28, "#f4ad45"),
            (32, "#ed754c"),
            (36, "#d83b3b"),
            (40, "#d83b3b"),
        ]
        for temperature, background in expected:
            self.assertEqual(temperature_colors.temperature_style(temperature)[0], background)

    def test_changed_temperature_ignores_repeated_values(self):
        self.assertIsNone(temperature_colors.changed_temperature({"message": 12.5}, 12.5))
        self.assertEqual(temperature_colors.changed_temperature({"message": 12.6}, 12.5), 12.6)


if __name__ == "__main__":
    unittest.main()
