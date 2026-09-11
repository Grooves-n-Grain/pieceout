"""Bounded image decoding and aspect-preserving working images."""
import io
import warnings
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import is_supported, register_heif_opener

register_heif_opener(thumbnails=False)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_EDGE = 1920


class ImageInputError(ValueError):
    """User-facing validation, distinct from errors raised by image codecs."""


def decode_image(data):
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError('Images must be at most 20 MB.')
    detected = 'HEIC/HEIF' if is_supported(io.BytesIO(data)) else None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                detected = image.format
                if detected not in {'PNG', 'JPEG', 'WEBP', 'HEIF'}:
                    raise ImageInputError(f'{detected} images are not supported. Choose PNG, JPEG, WebP or HEIC/HEIF.')
                if image.width * image.height > MAX_PIXELS or min(image.size) < 2:
                    raise ImageInputError('Images must be at least 2 × 2 and at most 16 million pixels.')
                return ImageOps.exif_transpose(image).convert('RGBA')
    except ImageInputError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ImageInputError('Images must be at most 16 million pixels.') from exc
    except (UnidentifiedImageError, OSError, ValueError, EOFError) as exc:
        if detected:
            name = 'HEIC/HEIF' if detected == 'HEIF' else detected
            raise ImageInputError(f'This {name} image could not be decoded. It may be damaged or incomplete; export a fresh copy and try again.') from exc
        raise ImageInputError('The file could not be identified as an image. Choose a valid PNG, JPEG, WebP or HEIC/HEIF.') from exc


def preview_image(data):
    """A browser-readable preview; the original upload remains the generation input."""
    image = decode_image(data)
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    # Do not forward camera metadata into the temporary preview.
    image.info.clear()
    image.save(output, format='PNG')
    return output.getvalue()


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
