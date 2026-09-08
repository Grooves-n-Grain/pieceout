# PieceOut Relief service

The Relief tab turns an image into a **recessed** heightmap. It uses a local PatchFusion ViT-B model to estimate camera depth, then separately shapes that depth into a carving. Preview, Layout and Trace still run without this service.

## Start on an NVIDIA server

Requires Docker Compose, an NVIDIA driver and NVIDIA Container Toolkit. Run from the PieceOut repository:

```bash
docker compose -p pieceout-relief -f services/relief/compose.yaml up -d --build
node serve.js
```

Open PieceOut on port 8765 and select **Relief**. The Python service listens on loopback port 8766; the Node server forwards `/api/relief/` to it. Use `RELIEF_API_URL` when the Node server needs a different backend address.

The first generation downloads the approximately 924 MB PatchFusion checkpoint, then loads it into VRAM. The model stays loaded for subsequent images. The queue permits four outstanding operations and runs them one at a time. Run one service process per GPU, not multiple Uvicorn workers.

Select another GPU or data location through Compose variables:

```bash
RELIEF_GPU=0 RELIEF_DATA_PATH=/absolute/path/to/relief-data \
  docker compose -p pieceout-relief -f services/relief/compose.yaml up -d
```

`RELIEF_GPU` accepts a GPU index or UUID from `nvidia-smi`. Settings can also be supplied with Compose's `--env-file`; see [.env.example](.env.example). Model downloads persist in the `pieceout-relief-models` Docker volume. Source images, masks, raw depth, settings and every published export version persist in `services/relief/data` unless overridden. There is no automatic deletion: stop the service before manually removing job directories you no longer need.

The service and proxy are intended for your own trusted workshop network. If PieceOut is publicly accessible, restrict access to the whole workspace before enabling GPU requests. Job IDs provide file organization, not user authentication.

## Prepare a recessed carving

1. Open a PNG, JPEG or WebP (20 MB and 16 million pixels maximum). Images larger than 1920 pixels on either side are reduced with their proportions preserved.
2. Set the physical width and maximum carving depth. Height follows the image aspect ratio.
3. Optionally provide a mask with exactly the source image's dimensions. White permits carving; black protects the face. Source alpha also protects transparent areas. A photographic depth threshold cannot reliably identify a vine against every background, so inspect the carving area.
4. Generate depth. The **Carving area** view shows the actual allowed region after the background limit. White is permitted and black is protected in this mask view.
5. Adjust background limit, shape compression (gamma), contrast, smoothing and clipping. These use saved floating-point depth and **do not run the neural network again**. Smoothing is measured in working-image pixels. Changing a source or uploaded mask currently requires Generate depth again; selected mask changes keep export disabled until applied.
6. Download the **16-bit PNG** and **size & settings** file. The last job is restored when you reopen the Relief tab in the same browser.

In the **export heightmap**, white (65535) is the untouched material face; black (0) is the maximum recess. This differs from the mask view. The normalized surface is `1 - coverage * carving_strength`; physical Z is `(surface - 1) * depth_mm`. Pixels outside the final mask stay exactly white, even after smoothing or contrast. The closest parts of the estimated subject become its deepest recessed parts. This is an inverted impression, not a raised vine sitting within a pocket.

The PNG carries normalized heights, **not an automatically enforced physical cutting depth**. In Aspire, use **Create Component from Bitmap** with no bitmap selected and choose the PNG directly. Vectric recommends this route to preserve 16-bit shades ([official documentation](https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/form/create-component-from-bitmap/)). Set the physical component dimensions and height from the JSON, and position the white plane at the original stock face. Check the component orientation, background and material removal in Aspire before generating toolpaths. PieceOut does not generate or simulate toolpaths, cutter reach, stock thickness or machining setups. Successful import and carving quality must be verified with the actual Aspire version and source artwork.

## What the preview views mean

| View | What it shows | How to read it |
| --- | --- | --- |
| Original image | The working source image, resized if needed | Use it to compare the estimated shapes with the artwork. |
| AI depth | A grayscale visualization of the model's estimated camera distances | Lighter means nearer the camera; darker means farther away. This view does not apply your carving controls or mask. |
| Carving area | The combined source alpha, optional uploaded mask and background limit | White allows carving; black protects the face. Gray permits partial carving. It describes coverage, not cutting depth. |
| Shaded relief | The processed surface under simulated light | Judge the recessed shape here. Brightness depends on lighting and slope, so it is not a height measurement. |
| Export heightmap | A grayscale preview of the processed surface | White is the untouched face; darker means deeper. Black represents the maximum configured recess. This is the shape represented by the downloaded PNG. |

For a vine, a section that appears bright in **AI depth** is estimated to be close to the camera. In the current recessed mode, that near geometry becomes a deeper impression and generally appears dark in **Export heightmap**. The protected background stays white. Masking, clipping, shape compression, contrast and smoothing mean the export is more than a simple inversion of the depth preview.

Both grayscale views displayed in the browser are **8-bit previews**. The model's source data is retained separately as floating-point `raw_depth.npy`, and **Download 16-bit PNG** returns `relief_16bit.png` directly from the service. Saving a screenshot or the displayed preview is not equivalent to downloading that file.

With a maximum depth of 3 mm, white corresponds to 0 mm removed, halfway gray to about 1.5 mm removed, and black to 3 mm removed, assuming the component is scaled and positioned accordingly in Aspire. Some settings produce a shallower result that never reaches black. Changing maximum depth scales the physical carving and shaded preview; it does not change the normalized grayscale heightmap by itself.

Relief adjustments leave the underlying AI depth unchanged. Use **AI depth** to assess what the model inferred, **Carving area** to check what is protected, and **Shaded relief** plus **Export heightmap** to assess the result you will take into Aspire.

## CLI and cached-depth processing

The same pipeline works without the browser. Use container-visible paths and mount source/output folders:

```bash
docker compose -p pieceout-relief -f services/relief/compose.yaml run --rm \
  -v /absolute/input:/input:ro -v /absolute/output:/output \
  relief python -m relief.cli --image /input/vine.png \
  --output /output/vine --width-mm 40 --depth-mm 3
```

To try different controls without AI inference, pass `--depth /input/raw_depth.npy` instead of `--image`. Use a fresh output directory. Pass the matching grayscale `--mask` as well when reprocessing a masked image; raw depth alone does not contain the original alpha/mask. CLI outputs retain `source_mask.npy` for programmatic reuse, and API jobs preserve it automatically.

Outputs include `raw_depth.npy`, `relief_float.npy`, `relief_16bit.png`, `depth_preview.png`, `mask_preview.png`, `relief_preview.png`, `shaded_preview.png` and `metadata.json`. Image runs also retain `source.png` and `source_mask.npy`. Raw camera depth uses smaller positive values for nearer geometry. No 8-bit preview is used as processing input.

## Development and tests

CPU tests do not need PyTorch or a GPU:

```bash
python3 -m venv services/relief/.venv
services/relief/.venv/bin/pip install -r services/relief/requirements.txt httpx==0.28.1
PYTHONPATH=services/relief services/relief/.venv/bin/python \
  -m unittest discover -s services/relief/tests -v
node --test
```

- `relief/processing.py`: pure float processing, mask preservation and normalization.
- `relief/artifacts.py`: 16-bit export, physical metadata and shaded previews.
- `relief/images.py`: bounded decode, alpha/mask combination and resizing.
- `relief/engines/`: model-specific imports and inference; the rest of the service stays independent.
- `relief/jobs.py`: bounded worker, persistent job records and immutable output versions.
- `relief/api.py`: upload limits and REST endpoints.
- `relief/cli.py`: image inference or cached-depth export.

PatchFusion source is pinned to `ab6814fe52d99cec7f0ac831fb3a8bfd4e8b7ff8`. The container keeps PyTorch 2.1.2/CUDA 11.8 and the model-specific dependencies isolated. The adapter pads image edges to the upstream tile-grid multiple and crops the prediction back; it does not stretch the exported image to landscape proportions. Inference uses deterministic `m2` tiling, two-by-two tiles, one patch per batch and full precision.

Upstream code and model weights have their own terms; see [PatchFusion](https://github.com/zhyever/PatchFusion) and the [checkpoint repository](https://huggingface.co/Zhyever/patchfusion_depth_anything_vitb14). Model weights are downloaded separately and are not part of PieceOut's source distribution.
