"""Generate relief artifacts from an image, or reprocess a saved float depth array."""
import argparse
import logging
from pathlib import Path
import numpy as np

from .artifacts import write_artifacts
from .images import decode_image, prepare_image, MAX_UPLOAD_BYTES
from .settings import ReliefSettings


def read_bounded(path):
    with Path(path).open('rb') as source:
        data = source.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError('Images must be at most 20 MB.')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--image', type=Path)
    source.add_argument('--depth', type=Path, help='Saved positive floating-point camera depth (.npy)')
    parser.add_argument('--mask', type=Path, help='Matching grayscale image: white allows carving')
    parser.add_argument('--output', type=Path, required=True)
    for name, default in ReliefSettings().to_dict().items():
        parser.add_argument('--' + name.replace('_', '-'), type=float, default=default)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    try:
        settings = ReliefSettings(**{name: getattr(args, name) for name in ReliefSettings().to_dict()})
        mask_data = read_bounded(args.mask) if args.mask else None
        if args.image:
            from .engines.patchfusion import PatchFusionEngine
            image, mask = prepare_image(read_bounded(args.image), mask_data)
            engine = PatchFusionEngine()
            depth = engine.predict(image)
            engine_name = engine.name
        else:
            if args.depth.stat().st_size > 128 * 1024 * 1024:
                raise ValueError('Cached depth file is too large.')
            depth = np.load(args.depth, allow_pickle=False)
            image = None
            mask = np.asarray(decode_image(mask_data).convert('RGB').convert('L'), dtype=np.float32) / 255 if mask_data else None
            engine_name = 'cached-depth'
        if (args.output / 'raw_depth.npy').exists():
            raise ValueError('Output already contains depth. Choose a new output directory to preserve it.')
        metadata = write_artifacts(args.output, depth, settings, mask, engine_name)
        np.save(args.output / 'raw_depth.npy', depth, allow_pickle=False)
        if mask is not None:
            np.save(args.output / 'source_mask.npy', mask, allow_pickle=False)
        if image:
            image.save(args.output / 'source.png')
        print(f"Saved {args.output / 'relief_16bit.png'} ({metadata['pixels']['width']} × {metadata['pixels']['height']})")
    except (ValueError, OSError, RuntimeError) as exc:
        parser.exit(1, f'Relief: {exc}\n')


if __name__ == '__main__':
    main()
