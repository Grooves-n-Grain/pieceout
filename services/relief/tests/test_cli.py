import os
import subprocess
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image


class CLITests(unittest.TestCase):
    def test_cached_depth_exports_without_inference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            depth = np.linspace(1, 10, 400, dtype=np.float32).reshape(20, 20)
            np.save(root / 'depth.npy', depth)
            command = [os.sys.executable, '-m', 'relief.cli', '--depth', str(root / 'depth.npy'),
                       '--output', str(root / 'output'), '--width-mm', '35', '--depth-mm', '2']
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            np.testing.assert_array_equal(np.load(root / 'output/raw_depth.npy'), depth)
            self.assertTrue((root / 'output/relief_16bit.png').exists())

    def test_mismatched_mask_fails_without_export(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            np.save(root / 'depth.npy', np.arange(400).reshape(20, 20) + 1)
            Image.new('L', (5, 5), 255).save(root / 'mask.png')
            result = subprocess.run([os.sys.executable, '-m', 'relief.cli', '--depth', str(root / 'depth.npy'),
                                     '--mask', str(root / 'mask.png'), '--output', str(root / 'out')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('dimensions', result.stderr)
            self.assertFalse((root / 'out/relief_16bit.png').exists())
