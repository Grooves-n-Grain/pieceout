import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np

from relief.settings import ReliefSettings
from relief.processing import process_depth
from relief.artifacts import write_artifacts


class SurfaceTests(unittest.TestCase):
    def test_raised_reverses_subject_but_preserves_protection(self):
        depth = np.arange(1, 26, dtype=np.float32).reshape(5, 5)
        mask = np.ones_like(depth)
        mask[:, 0] = 0
        options = dict(background_threshold=1, smoothing=0)
        recessed, _ = process_depth(depth, ReliefSettings(**options), mask)
        raised, _ = process_depth(depth, ReliefSettings(mode='raised', **options), mask)
        np.testing.assert_allclose(raised[:, 1:], 1 - recessed[:, 1:], atol=1e-7)
        self.assertTrue(np.all(raised[:, 0] == 1))
        self.assertGreater(raised[0, 1], raised[-1, -1])
        fractional, _ = process_depth(depth, ReliefSettings(mode='raised', **options), mask * 0.5)
        np.testing.assert_allclose(1 - fractional, (1 - raised) * 0.5, atol=1e-7)

    def test_preview_uses_float_surface_and_physical_dimensions(self):
        depth = np.linspace(1, 10, 600 * 300, dtype=np.float32).reshape(600, 300)
        with tempfile.TemporaryDirectory() as temp:
            settings = ReliefSettings(mode='raised', width_mm=50, depth_mm=4)
            write_artifacts(temp, depth, settings)
            preview = json.loads((Path(temp) / 'surface_preview.json').read_text())
            self.assertLessEqual(max(preview['rows'], preview['cols']), 192)
            self.assertEqual(len(preview['surface']), preview['rows'] * preview['cols'])
            self.assertEqual((preview['width_mm'], preview['height_mm'], preview['depth_mm']), (50, 100, 4))
            self.assertTrue(all(0 <= v <= 1 for v in preview['surface']))
            metadata = json.loads((Path(temp) / 'metadata.json').read_text())
            self.assertEqual(metadata['mode'], 'raised')
            self.assertEqual(metadata['physical']['z_surface_mm'], 0)

    def test_new_settings_validate_and_legacy_defaults_survive(self):
        self.assertEqual(ReliefSettings().mode, 'recessed')
        self.assertEqual(ReliefSettings().depth_model, 'patchfusion-vitb')
        for kwargs in [dict(mode='unknown'), dict(depth_model='unknown'), dict(mode=[]), dict(depth_model=None)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                ReliefSettings(**kwargs)


class EngineTests(unittest.TestCase):
    def manager(self, cuda=True, oom=False):
        from relief.engines.manager import EngineManager
        self.engines = []
        def factory(model, device):
            engine = Mock(name=model)
            engine.name = model
            engine.predict.return_value = np.arange(1, 5, dtype=np.float32).reshape(2, 2)
            if oom and device == 'cuda':
                engine.predict.side_effect = RuntimeError('CUDA out of memory')
            self.engines.append((model, device, engine))
            return engine
        return EngineManager(factory=factory, cuda_available=lambda: cuda, release_memory=lambda: None)

    def test_gpu_first_and_cpu_only_as_fallback(self):
        manager = self.manager()
        manager.predict(None, 'depth-anything-v2-small')
        self.assertEqual(self.engines[0][:2], ('depth-anything-v2-small', 'cuda'))
        self.assertEqual(manager.device, 'cuda')
        self.assertIsNone(manager.fallback_reason)
        manager = self.manager(cuda=False)
        manager.predict(None, 'patchfusion-vitb')
        self.assertEqual(self.engines[0][:2], ('depth-anything-v2-small', 'cpu'))
        self.assertIsNotNone(manager.fallback_reason)

    def test_oom_unloads_gpu_and_retries_small_cpu(self):
        manager = self.manager(oom=True)
        manager.predict(None, 'patchfusion-vitb')
        self.engines[0][2].unload.assert_called_once()
        self.assertEqual(self.engines[1][:2], ('depth-anything-v2-small', 'cpu'))
        self.assertEqual(manager.device, 'cpu')

    def test_unrelated_failure_is_not_hidden_by_fallback(self):
        manager = self.manager()
        manager.predict(None, 'patchfusion-vitb')
        self.engines[0][2].predict.side_effect = RuntimeError('checkpoint corrupt')
        with self.assertRaisesRegex(RuntimeError, 'checkpoint corrupt'):
            manager.predict(None, 'patchfusion-vitb')
        self.assertEqual(len(self.engines), 1)

    def test_disparity_adapter_preserves_order_and_rejects_flat_depth(self):
        from relief.engines.depth_anything import disparity_to_depth
        raw = np.array([[0, 1], [2, 3]], dtype=np.float32)
        result = disparity_to_depth(raw)
        self.assertTrue(np.all(result > 0))
        self.assertGreater(result[0, 0], result[1, 1])
        with self.assertRaises(ValueError):
            disparity_to_depth(np.ones((2, 2)))
