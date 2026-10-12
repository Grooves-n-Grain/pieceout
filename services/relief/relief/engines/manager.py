"""One resident model, GPU-first selection and explicit CPU fallback provenance."""
import gc
import logging
import os
import threading
import time
import urllib.request

log = logging.getLogger(__name__)

MODELS = ('patchfusion-vitb', 'depth-anything-v2-small')
GPU_LOST = ('An NVIDIA GPU is attached but CUDA cannot use it, so depth runs on CPU. '
            'Restart the relief service to restore GPU access.')


def cuda_available():
    import torch
    return torch.cuda.is_available()


def gpu_attached():
    # The NVIDIA container runtime injects this node only when a GPU is assigned.
    return os.path.exists('/dev/nvidiactl')


def release_memory():
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def free_gpu():
    """Ask another GPU tenant to unload (RELIEF_FREE_GPU_URL, e.g. llama-swap's /unload). True if it agreed."""
    url = os.environ.get('RELIEF_FREE_GPU_URL', '').strip()
    if not url:
        return False
    try:
        with urllib.request.urlopen(url, timeout=30):
            pass
    except (OSError, ValueError) as exc:
        log.warning('Could not free GPU memory through %s: %s', url, exc)
        return False
    import torch
    # The other process may still be exiting; wait until free memory stops growing.
    free, deadline = -1, time.monotonic() + 10
    while time.monotonic() < deadline:
        now = torch.cuda.mem_get_info()[0]
        if now <= free:
            break
        free = now
        time.sleep(0.5)
    log.info('Asked %s to unload; %.1f GB of GPU memory is free', url, free / 2**30)
    return True


def configured_idle_seconds():
    try:
        return max(0.0, float(os.environ.get('RELIEF_IDLE_UNLOAD_MINUTES', '0')) * 60)
    except ValueError:
        return 0.0


def is_oom(exc):
    return 'out of memory' in str(exc).lower()


def make_engine(model, device):
    if model == 'patchfusion-vitb':
        from .patchfusion import PatchFusionEngine
        return PatchFusionEngine()
    from .depth_anything import DepthAnythingEngine
    return DepthAnythingEngine(device)


class EngineManager:
    def __init__(self, factory=make_engine, cuda_available=cuda_available, release_memory=release_memory,
                 gpu_attached=gpu_attached, free_gpu=free_gpu, idle_seconds=None, timer=threading.Timer):
        self.factory = factory
        self.cuda_available = cuda_available
        self.gpu_attached = gpu_attached
        self.release_memory = release_memory
        self.free_gpu = free_gpu
        self.idle_seconds = configured_idle_seconds() if idle_seconds is None else idle_seconds
        self.timer = timer
        # The idle timer runs on its own thread; predictions and unloads must not overlap.
        self.lock = threading.Lock()
        self.idle = None
        self.uses = 0
        self.active = None
        self.key = None
        self.name = 'patchfusion-vitb'
        self.device = None
        self.fallback_reason = None
        self.gpu_note = None

    def gpu_warning(self):
        """Explain a GPU that Docker attached but CUDA lost, for example after a systemd reload."""
        return GPU_LOST if self.gpu_attached() and not self.cuda_available() else None

    def _unload(self):
        if self.active is not None:
            self.active.unload()
            self.active = None
            self.key = None
            self.release_memory()

    def _select(self, model, device):
        if self.key != (model, device):
            self._unload()
            self.active = self.factory(model, device)
            self.key = (model, device)
        self.name, self.device = model, device

    def _gpu(self, image, model):
        """Depth from the GPU, or None when it ran out of memory."""
        self._select(model, 'cuda')
        try:
            return self.active.predict(image)
        except RuntimeError as exc:
            if not is_oom(exc):
                raise
        # Unload outside the handler so its traceback releases GPU tensors first.
        self._unload()
        return None

    def _predict(self, image, model):
        self.fallback_reason = self.gpu_note = None
        if self.cuda_available():
            depth = self._gpu(image, model)
            if depth is not None:
                return depth
            self.fallback_reason = 'GPU memory was insufficient; used Depth Anything V2 Small on CPU.'
            if self.free_gpu():
                depth = self._gpu(image, model)
                if depth is not None:
                    self.fallback_reason = None
                    self.gpu_note = 'Asked other GPU services to unload their models to make room.'
                    return depth
                self.fallback_reason = ('GPU memory was still insufficient after other GPU services unloaded; '
                                        'used Depth Anything V2 Small on CPU.')
        else:
            self.fallback_reason = (f'{GPU_LOST} Used Depth Anything V2 Small.' if self.gpu_attached()
                                    else 'CUDA was unavailable; used Depth Anything V2 Small on CPU.')
        self._select('depth-anything-v2-small', 'cpu')
        return self.active.predict(image)

    def _idle_unload(self, uses):
        with self.lock:
            if uses == self.uses and self.active is not None:
                log.info('Unloading %s after %.0f idle minutes', self.name, self.idle_seconds / 60)
                self._unload()

    def predict(self, image, model='patchfusion-vitb'):
        if model not in MODELS:
            raise ValueError('Choose a supported depth model.')
        with self.lock:
            self.uses += 1
            if self.idle is not None:
                self.idle.cancel()
                self.idle = None
            try:
                return self._predict(image, model)
            finally:
                if self.idle_seconds > 0:
                    self.idle = self.timer(self.idle_seconds, self._idle_unload, args=(self.uses,))
                    self.idle.daemon = True
                    self.idle.start()

    def predict_for(self, image, model):
        return self.predict(image, model)
