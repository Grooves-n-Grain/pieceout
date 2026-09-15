"""Native DA2 Small adapter, sharing the pinned PyTorch stack with PatchFusion."""
import numpy as np


def disparity_to_depth(raw):
    raw = np.asarray(raw, dtype=np.float32)
    if raw.ndim != 2 or not np.isfinite(raw).all():
        raise ValueError('The depth model returned invalid values.')
    low, high = float(raw.min()), float(raw.max())
    if high - low <= max(abs(high) * 1e-7, 1e-7):
        raise ValueError('The image has no usable depth variation.')
    # Relative-depth convention only: positive, smaller nearer; not metric distance.
    return (2 - (raw - low) / (high - low)).astype(np.float32)


class DepthAnythingEngine:
    name = 'depth-anything-v2-small'

    def __init__(self, device):
        self.device = device
        self.model = None

    def unload(self):
        self.model = None

    def predict(self, image):
        import torch
        import torch.nn.functional as F
        from depth_anything_v2.dpt import DepthAnythingV2
        from huggingface_hub import hf_hub_download
        if self.model is None:
            model = DepthAnythingV2(encoder='vits', features=64, out_channels=[48, 96, 192, 384])
            checkpoint = hf_hub_download('depth-anything/Depth-Anything-V2-Small', 'depth_anything_v2_vits.pth')
            model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
            self.model = model.to(self.device).eval()
        # Bound both dimensions, including very narrow artwork. Upstream's helper
        # auto-selects CUDA even during CPU fallback, so own preprocessing explicitly.
        width, height = image.size
        scale = 518 / max(width, height)
        size = (max(14, round(width * scale / 14) * 14), max(14, round(height * scale / 14) * 14))
        rgb = np.asarray(image.convert('RGB').resize(size), dtype=np.float32) / 255
        rgb = (rgb - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            prediction = self.model(tensor)
            prediction = F.interpolate(prediction[:, None], (height, width), mode='bilinear', align_corners=False)
        return disparity_to_depth(prediction[0, 0].cpu().numpy())
