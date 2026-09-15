"""One resident model, GPU-first selection and explicit CPU fallback provenance."""
import gc

MODELS = ('patchfusion-vitb', 'depth-anything-v2-small')


def cuda_available():
    import torch
    return torch.cuda.is_available()


def release_memory():
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def make_engine(model, device):
    if model == 'patchfusion-vitb':
        from .patchfusion import PatchFusionEngine
        return PatchFusionEngine()
    from .depth_anything import DepthAnythingEngine
    return DepthAnythingEngine(device)


class EngineManager:
    def __init__(self, factory=make_engine, cuda_available=cuda_available, release_memory=release_memory):
        self.factory = factory
        self.cuda_available = cuda_available
        self.release_memory = release_memory
        self.active = None
        self.key = None
        self.name = 'patchfusion-vitb'
        self.device = None
        self.fallback_reason = None

    def _select(self, model, device):
        if self.key != (model, device):
            if self.active is not None:
                self.active.unload()
                self.active = None
                self.key = None
                self.release_memory()
            self.active = self.factory(model, device)
            self.key = (model, device)
        self.name, self.device = model, device

    def predict(self, image, model='patchfusion-vitb'):
        if model not in MODELS:
            raise ValueError('Choose a supported depth model.')
        self.fallback_reason = None
        if self.cuda_available():
            self._select(model, 'cuda')
            try:
                return self.active.predict(image)
            except RuntimeError as exc:
                if 'out of memory' not in str(exc).lower():
                    raise
                self.fallback_reason = 'GPU memory was insufficient; used Depth Anything V2 Small on CPU.'
        else:
            self.fallback_reason = 'CUDA was unavailable; used Depth Anything V2 Small on CPU.'
        # Leave the exception handler first so its traceback releases GPU tensors.
        self._select('depth-anything-v2-small', 'cpu')
        return self.active.predict(image)

    def predict_for(self, image, model):
        return self.predict(image, model)
