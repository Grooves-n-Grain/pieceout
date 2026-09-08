import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from relief.settings import ReliefSettings
from relief.processing import process_depth
from relief.artifacts import write_artifacts


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.depth = np.full((21, 21), 20, dtype=np.float32)
        self.depth[5:16, 5:16] = np.linspace(2, 8, 121).reshape(11, 11)
        self.mask = np.zeros_like(self.depth)
        self.mask[5:16, 5:16] = 1

    def test_background_is_untouched_after_all_controls(self):
        settings = ReliefSettings(gamma=0.7, contrast=0.5, smoothing=2, background_threshold=1)
        surface, coverage = process_depth(self.depth, settings, self.mask)
        self.assertTrue(np.all(surface[self.mask == 0] == 1))
        self.assertTrue(np.all((surface >= 0) & (surface <= 1)))
        self.assertLess(surface[10, 10], 1)
        np.testing.assert_array_equal(coverage, self.mask)

    def test_nearest_subject_is_deepest_recess_and_background_is_surface(self):
        surface, _ = process_depth(self.depth, ReliefSettings(smoothing=0), self.mask)
        self.assertEqual(surface[5, 5], 0)
        self.assertEqual(surface[0, 0], 1)
        self.assertLess(surface[5, 5], surface[15, 15])
        z = (surface - 1) * 6
        self.assertAlmostEqual(float(z.min()), -6)
        self.assertEqual(float(z.max()), 0)

    def test_normalization_uses_subject_not_distant_background(self):
        first, _ = process_depth(self.depth, ReliefSettings(), self.mask)
        changed = self.depth.copy()
        changed[self.mask == 0] = 100000
        second, _ = process_depth(changed, ReliefSettings(), self.mask)
        np.testing.assert_array_equal(first, second)

    def test_fractional_mask_is_not_normalized_away(self):
        full, _ = process_depth(self.depth, ReliefSettings(), self.mask)
        half, _ = process_depth(self.depth, ReliefSettings(), self.mask * 0.5)
        np.testing.assert_allclose(1 - half, (1 - full) * 0.5, atol=1e-7)

    def test_threshold_excludes_far_background(self):
        surface, mask = process_depth(self.depth, ReliefSettings(background_threshold=0.5))
        self.assertTrue(np.all(mask[:5] == 0))
        self.assertTrue(np.all(surface[:5] == 1))

    def test_invalid_pixels_are_repaired_without_mutating_raw(self):
        self.depth[10, 10] = np.nan
        self.depth[11, 10] = np.inf
        surface, _ = process_depth(self.depth, ReliefSettings(), self.mask)
        self.assertTrue(np.isfinite(surface).all())
        self.assertTrue(np.isnan(self.depth[10, 10]))

    def test_degenerate_inputs_fail_clearly(self):
        for depth, mask in [(np.ones((3, 3)), None), (np.full((3, 3), np.nan), None),
                            (self.depth, np.zeros_like(self.mask)), (self.depth, np.ones((2, 2)))]:
            with self.subTest(shape=depth.shape), self.assertRaises(ValueError):
                process_depth(depth, ReliefSettings(), mask)

    def test_controls_reject_invalid_values(self):
        for kwargs in [dict(gamma=0), dict(smoothing=-1), dict(width_mm=float('nan')),
                       dict(near_percentile=99, far_percentile=1), dict(depth_mm=0),
                       dict(background_threshold=1.1)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                ReliefSettings(**kwargs)

    def test_export_is_true_16bit_and_preserves_surface(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            write_artifacts(folder, self.depth, ReliefSettings(width_mm=40, depth_mm=6), self.mask)
            encoded = (folder / 'relief_16bit.png').read_bytes()
            self.assertEqual(encoded[:8], b'\x89PNG\r\n\x1a\n')
            width, height, bits, color = struct.unpack('>IIBB', encoded[16:26])
            self.assertEqual((width, height, bits, color), (21, 21, 16, 0))
            pixels = np.asarray(Image.open(folder / 'relief_16bit.png'))
            self.assertTrue(np.all(pixels[self.mask == 0] == 65535))
            surface = np.load(folder / 'relief_float.npy', allow_pickle=False)
            np.testing.assert_array_equal(pixels, np.rint(surface * 65535).astype(np.uint16))
            metadata = json.loads((folder / 'metadata.json').read_text())
            self.assertEqual(metadata['physical']['width_mm'], 40)
            self.assertEqual(metadata['physical']['z_surface_mm'], 0)
            self.assertEqual(metadata['physical']['z_min_mm'], -6)

    def test_small_masked_subject_exports_against_flat_background(self):
        depth = np.full((100, 100), 100, dtype=np.float32)
        depth[:5, :5] = np.linspace(1, 10, 25).reshape(5, 5)
        mask = np.zeros_like(depth)
        mask[:5, :5] = 1
        with tempfile.TemporaryDirectory() as temp:
            write_artifacts(Path(temp), depth, ReliefSettings(background_threshold=1), mask)
            self.assertTrue((Path(temp) / 'depth_preview.png').exists())
