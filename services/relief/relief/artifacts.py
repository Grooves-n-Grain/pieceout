"""High precision exports and physically scaled shaded previews."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .processing import clean_depth, process_depth, unit_depth


def save_gray(path, values):
    Image.fromarray(np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)).save(path)


def shaded_preview(surface, settings):
    rows, cols = surface.shape
    spacing = settings.width_mm / max(cols - 1, 1)
    gy, gx = np.gradient((surface - 1) * settings.depth_mm, spacing)
    normals = np.stack((-gx, -gy, np.ones_like(surface)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    light = np.array([-0.5, -0.6, 0.8])
    light /= np.linalg.norm(light)
    shade = 0.25 + 0.75 * np.clip(normals @ light, 0, 1)
    wood = np.array([196, 162, 101])
    return Image.fromarray(np.rint(shade[..., None] * wood).astype(np.uint8))


def write_artifacts(output, depth, settings, mask=None, engine='cached-depth'):
    output = Path(output)
    surface, coverage = process_depth(depth, settings, mask)
    output.mkdir(parents=True, exist_ok=True)
    np.save(output / 'relief_float.npy', surface, allow_pickle=False)
    Image.fromarray(np.rint(surface * 65535).astype(np.uint16)).save(output / 'relief_16bit.png')
    save_gray(output / 'relief_preview.png', surface)
    save_gray(output / 'mask_preview.png', coverage)
    save_gray(output / 'depth_preview.png', 1 - unit_depth(clean_depth(depth), 0, 100))
    shaded_preview(surface, settings).save(output / 'shaded_preview.png')
    height, width = surface.shape
    metadata = {
        'schema_version': 1, 'mode': 'recessed', 'engine': engine,
        'settings': settings.to_dict(), 'pixels': {'width': width, 'height': height},
        'physical': {'width_mm': settings.width_mm, 'height_mm': settings.width_mm * height / width,
                     'z_surface_mm': 0, 'z_min_mm': -settings.depth_mm,
                     'actual_min_mm': float((surface.min() - 1) * settings.depth_mm)},
        'encoding': {'black': 'maximum recess', 'white': 'uncut face',
                     'z_mm': '(pixel / 65535 - 1) * depth_mm', 'bit_depth': 16},
        'aspire': 'Set width and height from physical, component height to depth_mm; align white to the stock face. Verify orientation and material removal in Aspire before cutting.',
    }
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2, allow_nan=False) + '\n')
    return metadata
