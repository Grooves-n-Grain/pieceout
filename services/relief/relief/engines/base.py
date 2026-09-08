"""Depth engines return positive camera depth, with smaller values nearer the camera."""
from typing import Protocol
import numpy as np
from PIL import Image


class DepthEngine(Protocol):
    name: str

    def predict(self, image: Image.Image) -> np.ndarray: ...
