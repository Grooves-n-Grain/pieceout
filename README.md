# PieceOut

**Preview what your CNC will actually cut — before you cut it.**

Drop in an SVG (e.g. exported from Vectric), tell PieceOut which layers are profile cuts, pockets, or decoration, and get an instant visual of the finished piece. No install, no build step, runs in your browser.

https://github.com/user-attachments/assets/58ff067c-7a4c-46cc-a53a-e39b67bd0832

---

## What it does

1. **Drag in an SVG** — every `<g>` layer is parsed (Vectric, Inkscape, anything that uses grouped layers).
2. **Auto-classify** each layer as `CUT`, `POCKET`, or `IGNORE` based on layer-name keywords (`profile`, `pocket`, `engrave`, etc.). You can override any of them.
3. **See the result** — Preview mode renders cut paths punched out of a wood-colored material, with pockets shaded as recessed regions. Wireframe mode shows the raw geometry.
4. **Export a PNG** of the preview for documentation, client approval, or just remembering what you were planning.

## Layout tab: generate cut files from dimensions

Switch to the **Layout** tab to go the other direction: type in the dimensions of a piece and get true-size, nested SVG cut files back, ready for Vectric Aspire (or any CAM that imports SVG by layer).

The first template is a Japanese Andon-style lamp: half-lapped square frames pinned with dowels, four legs, and basswood panels held by split dowels.

1. Enter the lamp dimensions (outer width, height, stock thickness, rail width, and so on). Derived sizes such as leg length and panel size update live, and any of them can be overridden.
2. Set your bit diameter, gutter, edge margin, and sheet sizes once. They are remembered.
3. Parts are nested per material onto sheets. Grain direction is respected: legs and rails never rotate.
4. **Export SVG** downloads the sheet you are looking at, one file per material per sheet. Layers are named for the operation: `CUT`, `POCKET-6.35mm`, `DRILL-6.2mm`, and `GUIDE` (reference only). Assign one toolpath per layer in Aspire and you are done.
5. **Send to Preview** drops the sheet into the Preview tab so you can see the cut before you leave the browser.

At assembly, every rail is cut identically, but each frame needs two of its four rails with the half-lap facing the bottom. Flip those rails END OVER END (rotate about the rail's width axis), never roll them about the long axis. Flipping end over end keeps the outer edge outward, and the panel dowel holes are symmetric about the rail centre so the hole pattern still lines up. Rolling a rail about its long axis would put the panel holes at `railWidth - panelInset` from the outer edge instead, which will not match the other rails in the frame.

All geometry is true part geometry. Tool offsets, tabs, and feeds stay in your CAM software where they belong.

## Why

It was tedious to have to double-click every piece I wanted cut-out in the preview. With really intricate cuts this used to take a lot of time, and if you messed it up, you only had one `undo.` PieceOut gives you the ability to instantly see everything cut out, allowing you to identify any issues.

## Try it

```bash
node serve.js
# then open http://localhost:8765 in any modern browser
```

Drag-and-drop `test-sample.svg` (included) to see it work, or use any SVG with grouped layers.

No package manager, no build step, zero dependencies — just plain ES6 modules served by a tiny built-in Node HTTP server.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `W` | Wireframe view |
| `F` | Preview (filled) view |
| `+` / `-` | Zoom |
| `0` | Fit to viewport |

Mouse wheel zooms; click-drag pans; pinch + one-finger pan work on touch devices.

## How it works

Six vanilla JS modules, loaded directly as ES6 modules from `index.html`:

- **[`js/svgParser.js`](js/svgParser.js)** — DOMParser-based SVG parsing. Extracts layers from `<g>` elements via `inkscape:label` or `id`. Collects all shape primitives (path / polygon / rect / circle / ellipse / line) per layer.
- **[`js/layerTagger.js`](js/layerTagger.js)** — keyword-based auto-classification with localStorage-persisted overrides.
- **[`js/renderer.js`](js/renderer.js)** — the visualization engine. Preview mode uses an SVG `<mask>` with `fill-rule="evenodd"` to punch CUT paths out of a material rectangle (handles complex outer-with-inner-cutouts geometry correctly). Pocket layers render as a darkened overlay.
- **[`js/viewport.js`](js/viewport.js)** — zoom/pan via viewBox manipulation. Mouse + touch.
- **[`js/app.js`](js/app.js)** — orchestrator. State, file upload, view modes, PNG export.
- **[`js/layout/`](js/layout/)**: the Layout tab. `templates/andonLamp.js` derives parts and joinery from lamp dimensions, `joints/` holds the half-lap and dowel-hole generators, `nest.js` packs parts onto sheets, `svgWriter.js` serialises a sheet to a true-size layered SVG, and `layoutUI.js` / `layoutForm.js` drive the sidebar. Everything below the UI is pure and unit-tested.

## Tests

```bash
node --test
```

Uses Node's built-in test runner. The golden SVGs in `tests/fixtures/` are the default lamp's output; regenerate them with `node tests/fixtures/regen.js` after an intentional change to the template, nester, or writer.

## Contributing

Issues and PRs welcome. The codebase is intentionally small and dependency-free — please keep it that way unless there's a strong reason not to.

## License

[MIT](LICENSE) © Grooves-n-Grain
