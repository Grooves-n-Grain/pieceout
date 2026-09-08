"""Camera depth to a recessed surface. No model, filesystem or UI dependencies."""
import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter

from .settings import ReliefSettings


def clean_depth(depth):
    depth = np.asarray(depth, dtype=np.float32)
    if depth.ndim != 2 or min(depth.shape) < 2 or depth.size > 16_000_000:
        raise ValueError('Depth must be a 2D array, at least 2 × 2 and at most 16 million pixels.')
    valid = np.isfinite(depth) & (depth > 0)
    if not valid.any():
        raise ValueError('The model returned no valid positive camera depth.')
    if not valid.all():
        indices = distance_transform_edt(~valid, return_distances=False, return_indices=True)
        depth = depth[tuple(indices)]
    return depth.copy()


def unit_depth(depth, near=1, far=99, selection=None):
    values = depth[selection] if selection is not None else depth.ravel()
    low, high = np.percentile(values, [near, far])
    if not np.isfinite(high - low) or high - low <= max(abs(float(high)) * 1e-7, 1e-7):
        raise ValueError('The selected area has no usable depth variation. Adjust the mask or background limit.')
    return np.clip((depth - low) / (high - low), 0, 1).astype(np.float32)


def process_depth(depth, settings: ReliefSettings, mask=None):
    depth = clean_depth(depth)
    if mask is None:
        coverage = np.ones_like(depth)
    else:
        coverage = np.asarray(mask, dtype=np.float32).copy()
        if coverage.shape != depth.shape or not np.isfinite(coverage).all() or np.any((coverage < 0) | (coverage > 1)):
            raise ValueError('Mask must match the depth dimensions and contain finite values from 0 to 1.')
    if not (coverage > 0).any():
        raise ValueError('The carving mask is empty.')
    # Threshold within the source mask, then normalize only the retained subject.
    relative = unit_depth(depth, selection=coverage > 0)
    if settings.background_threshold < 1:
        coverage[relative >= settings.background_threshold] = 0
    selected = coverage > 0
    if not selected.any():
        raise ValueError('The background limit removed the entire carving area.')
    strength = 1 - unit_depth(depth, settings.near_percentile, settings.far_percentile, selected)
    strength = np.clip((np.power(strength, settings.gamma) - 0.5) * settings.contrast + 0.5, 0, 1)
    if settings.smoothing:
        # Normalize the filter by coverage so distant background cannot flatten subject edges.
        numerator = gaussian_filter(strength * coverage, settings.smoothing)
        denominator = gaussian_filter(coverage, settings.smoothing)
        strength = np.divide(numerator, denominator, out=np.zeros_like(numerator), where=denominator > 1e-8)
    surface = 1 - np.clip(strength, 0, 1) * coverage
    return surface.astype(np.float32), coverage
