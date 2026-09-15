# PieceOut Relief service

The Relief tab turns an image into a **recessed impression** or a **raised subject within a carved pocket**. Local GPU models estimate depth, then a separate processing step shapes that depth into a carving. Preview, Layout and Trace still run without this service.

Choose **PatchFusion · detailed** (the default) or **Depth Anything V2 · fast**.
Both prefer CUDA. If CUDA is unavailable or GPU inference runs out of memory,
the service falls back to Depth Anything V2 Small on CPU and reports that in the
sidebar and export metadata. Other failures are reported instead of silently
changing models. Only one model stays resident; switching models unloads the
previous one. Each job caches depth separately for each requested model, including
the actual engine/device/fallback used. Switching back reuses that cache; generate
a new job to retry GPU inference after a CPU fallback.

Depth Anything V2 Small uses its native, pinned implementation without upgrading
PatchFusion's dependencies. It predicts relative disparity, converted to positive
relative depth with smaller values nearer the camera; this is not metric distance.
Its input is bounded to approximately 518 pixels on the long side. The original
PatchFusion adapter continues to use tiled inference at the working resolution.

**3D relief** in the View menu displays the processed surface at its actual
width/depth proportions. Drag to orbit, right-drag to pan, and scroll to zoom;
touch supports orbit and two-finger pan/pinch. The toolbar's zoom and Fit buttons
work in 3D too. The preview uses a floating-point grid with at most 192 samples on
the long side; the downloadable PNG retains the full working resolution and 16-bit
precision. It is a surface preview, not a stock or toolpath simulation. Three.js
0.180.0 is vendored locally and loaded only when opening 3D. Existing saved jobs
can produce this view directly from their saved float surface.

## Start on an NVIDIA server

Requires Docker Compose, an NVIDIA driver and NVIDIA Container Toolkit. Run from the PieceOut repository:

```bash
docker compose -p pieceout-relief -f services/relief/compose.yaml up -d --build
node serve.js
```

Open PieceOut on port 8765 and select **Relief**. The Python service listens on loopback port 8766; the Node server forwards `/api/relief/` to it. Use `RELIEF_API_URL` when the Node server needs a different backend address.

The first generation downloads the approximately 924 MB PatchFusion checkpoint, then loads it into VRAM. The model stays loaded for subsequent images. The queue permits four outstanding operations and runs them one at a time. Run one service process per GPU, not multiple Uvicorn workers.

The first Depth Anything V2 Small run downloads its separate checkpoint (about
100 MB) into the same persistent model volume. CPU fallback needs that checkpoint
too. On hosts without an NVIDIA container runtime, remove the GPU reservation with:

```bash
docker compose -p pieceout-relief -f services/relief/compose.yaml \
  -f services/relief/compose.cpu.yaml up -d --build
```

The override requires Docker Compose support for `!reset`. The base service remains
GPU-first; the override lets Docker start it on a CPU-only host.

Select another GPU or data location through Compose variables:

```bash
RELIEF_GPU=0 RELIEF_DATA_PATH=/absolute/path/to/relief-data \
  docker compose -p pieceout-relief -f services/relief/compose.yaml up -d
```

`RELIEF_GPU` accepts a GPU index or UUID from `nvidia-smi`. Settings can also be supplied with Compose's `--env-file`; see [.env.example](.env.example). Model downloads persist in the `pieceout-relief-models` Docker volume. Source images, masks, raw depth, settings and every published export version persist in `services/relief/data` unless overridden. There is no automatic deletion: stop the service before manually removing job directories you no longer need.

The service and proxy are intended for your own trusted workshop network. If PieceOut is publicly accessible, restrict access to the whole workspace before enabling GPU requests. Job IDs provide file organization, not user authentication.

## Prepare a carving

1. Open a PNG, JPEG, WebP or HEIC/HEIF (20 MB and 16 million pixels maximum). Camera orientation is applied automatically. Images larger than 1920 pixels on either side are reduced with their proportions preserved.
2. Choose Recessed impression or Raised in a pocket, then set the physical width and maximum carving depth. Height follows the image aspect ratio.
3. Optionally provide a mask with exactly the source image's dimensions. White permits carving; black protects the face. Source alpha also protects transparent areas. A photographic depth threshold cannot reliably identify a vine against every background, so inspect the carving area.
4. Generate depth. The **Carving area** view shows the actual allowed region after the background limit. White is permitted and black is protected in this mask view.
5. Adjust background limit, shape compression (gamma), contrast, smoothing and clipping. These use saved floating-point depth and **do not run the neural network again**. Smoothing is measured in working-image pixels. Changing a source or uploaded mask currently requires Generate depth again; selected mask changes keep export disabled until applied.
6. Download the **16-bit PNG** and **size & settings** file. The last job is restored when you reopen the Relief tab in the same browser.

HEIC/HEIF photos can be selected directly from an iPad photo library. The service creates a temporary PNG preview when you open a HEIC image, or when the browser cannot decode an image itself. This requires the Relief service to be online but does not load the depth model or create a job. Generate depth uploads the original file; source and mask validation uses their oriented dimensions. For HEIF collections, only the primary image is used. Decoding uses the [Pillow HEIF plugin](https://pillow-heif.readthedocs.io/en/stable/pillow-plugin.html); no browser conversion library is needed. The export remains a 16-bit PNG.

In the **export heightmap**, white (65535) is the untouched material face; black (0) is the maximum cutting depth. This encoding applies to both styles. Physical Z is `(surface - 1) * depth_mm`, so the surface never extends above the original stock face. Pixels outside the final mask stay exactly white, even after smoothing or contrast.

For **Recessed impression**, the normalized surface is `1 - coverage * carving_strength`: nearest features become deepest. For **Raised in a pocket**, it is `1 - coverage * (1 - carving_strength)`: nearest features stay high while their surroundings are lowered. Raise Background limit toward 1 to include the surrounding background in the pocket. Regions excluded by a mask or background limit stay protected in either mode; raised mode does not remove material outside your selected carving area.

The PNG carries normalized heights, **not an automatically enforced physical cutting depth**. In Aspire, use **Create Component from Bitmap** with no bitmap selected and choose the PNG directly. Vectric recommends this route to preserve 16-bit shades ([official documentation](https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/form/create-component-from-bitmap/)). Set the physical component dimensions and height from the JSON, and position the white plane at the original stock face. Check the component orientation, background and material removal in Aspire before generating toolpaths. PieceOut does not generate or simulate toolpaths, cutter reach, stock thickness or machining setups. Successful import and carving quality must be verified with the actual Aspire version and source artwork.

## What the preview views mean

| View | What it shows | How to read it |
| --- | --- | --- |
| Original image | The working source image, resized if needed | Use it to compare the estimated shapes with the artwork. |
| AI depth | A grayscale visualization of the model's estimated camera distances | Lighter means nearer the camera; darker means farther away. This view does not apply your carving controls or mask. |
| Carving area | The combined source alpha, optional uploaded mask and background limit | White allows carving; black protects the face. Gray permits partial carving. It describes coverage, not cutting depth. |
| Shaded relief | The processed surface under simulated light | Judge the selected carving style here. Brightness depends on lighting and slope, so it is not a height measurement. |
| Export heightmap | A grayscale preview of the processed surface | White is the untouched face; darker means deeper. Black represents the maximum configured recess. This is the shape represented by the downloaded PNG. |
| 3D relief | The float surface, sampled to a smaller grid at physical proportions | Rotate to inspect the pocket or impression. Full detail remains in the downloaded PNG. |

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

Outputs include `raw_depth.npy`, `relief_float.npy`, `relief_16bit.png`, `depth_preview.png`, `mask_preview.png`, `relief_preview.png`, `shaded_preview.png`, `surface_preview.json` and `metadata.json`. Image runs also retain `source.png` and `source_mask.npy`. Raw depth uses smaller positive values for nearer geometry. No 8-bit preview is used as processing input. CLI options `--mode raised` and `--depth-model depth-anything-v2-small` select the new style/model. API jobs keep the original `raw_depth.npy` unchanged and store additional model results in separate caches.

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

Depth Anything V2 source is pinned to `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`.
The added model is [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small)
(Apache-2.0); its checkpoint is also downloaded separately.
