"""Lazy PatchFusion integration. All PyTorch/upstream imports stay in this module."""
import logging
import time

import numpy as np

log = logging.getLogger(__name__)


class PatchFusionEngine:
    name = 'patchfusion-vitb'
    checkpoint = 'Zhyever/patchfusion_depth_anything_vitb14'

    def __init__(self):
        self.model = None

    def load(self):
        if self.model is not None:
            return
        import torch
        from estimator.models.patchfusion import PatchFusion
        if not torch.cuda.is_available():
            raise RuntimeError('No CUDA GPU is available. Start the relief container with NVIDIA GPU access.')
        log.info('Loading %s on %s', self.checkpoint, torch.cuda.get_device_name(0))
        self.model = PatchFusion.from_pretrained(self.checkpoint).to('cuda').eval()

    def predict(self, image):
        import torch
        import torch.nn.functional as functional
        self.load()
        started = time.monotonic()
        rgb = np.asarray(image.convert('RGB'), dtype=np.float32) / 255
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
        height, width = rgb.shape[:2]
        # Upstream tile grid requires multiples of four. Pad, then remove padding;
        # never stretch a narrow leg image into a landscape output.
        target_h = max(16, ((height + 3) // 4) * 4)
        target_w = max(16, ((width + 3) // 4) * 4)
        padded = functional.pad(tensor, (0, target_w - width, 0, target_h - height), mode='replicate')
        with torch.inference_mode():
            prediction, _ = self.model(
                mode='infer', image_lr=self.model.resizer(padded).float().to('cuda'),
                image_hr=padded.to('cuda'), cai_mode='m2', process_num=1,
                tile_cfg={'image_raw_shape': [target_h, target_w], 'patch_split_num': [2, 2]},
            )
            prediction = functional.interpolate(prediction, (target_h, target_w), mode='bilinear', align_corners=False)
            depth = prediction[0, 0, :height, :width].detach().cpu().numpy().astype(np.float32)
        log.info('Depth complete: %sx%s in %.1fs', width, height, time.monotonic() - started)
        return depth
