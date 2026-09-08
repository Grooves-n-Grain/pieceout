"""Validated, serializable settings shared by the CLI and API."""
import math
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class ReliefSettings:
    width_mm: float = 40
    depth_mm: float = 3
    near_percentile: float = 1
    far_percentile: float = 99
    background_threshold: float = 0.9
    gamma: float = 1
    contrast: float = 1
    smoothing: float = 1

    def __post_init__(self):
        bounds = {'width_mm': (0.1, 10000), 'depth_mm': (0.01, 100),
                  'near_percentile': (0, 100), 'far_percentile': (0, 100),
                  'background_threshold': (0.001, 1), 'gamma': (0.25, 4),
                  'contrast': (0.5, 2), 'smoothing': (0, 10)}
        for name, (low, high) in bounds.items():
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f'{name} must be between {low} and {high}.')
        if self.near_percentile >= self.far_percentile:
            raise ValueError('Near percentile must be below far percentile.')

    def to_dict(self):
        return asdict(self)
