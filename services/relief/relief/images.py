"""Bounded image decoding and aspect-preserving working images."""
import io
import warnings
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_EDGE = 1920


def decode_image(data):
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError('Images must be at most 20 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {'PNG', 'JPEG', 'WEBP'}:
                    raise ValueError('Choose a PNG, JPEG or WebP image.')
                if image.width * image.height > MAX_PIXELS or min(image.size) < 2:
                    raise ValueError('Images must be at least 2 × 2 and at most 16 million pixels.')
                return ImageOps.exif_transpose(image).convert('RGBA')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError('The image could not be decoded. Choose a valid PNG, JPEG or WebP.') from exc


def prepare_image(data, mask_data=None):
    rgba = decode_image(data)
    coverage = rgba.getchannel('A')
    if mask_data is not None:
        mask = decode_image(mask_data)
        if mask.size != rgba.size:
            raise ValueError('Mask dimensions must match the source image.')
        # A mask uses luminance, not its alpha channel. White allows carving.
        gray = np.asarray(mask.convert('RGB').convert('L'), dtype=np.float32) / 255
        coverage = Image.fromarray(np.rint(np.asarray(coverage) * gray).astype(np.uint8))
    size = rgba.size
    rgba.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    if rgba.size != size:
        coverage = coverage.resize(rgba.size, Image.Resampling.BOX)
    white = Image.new('RGBA', rgba.size, 'white')
    rgb = Image.alpha_composite(white, rgba).convert('RGB')
    mask = np.asarray(coverage, dtype=np.float32) / 255
    if not (mask > 0).any():
        raise ValueError('The image or mask contains no visible carving area.')
    return rgb, mask
