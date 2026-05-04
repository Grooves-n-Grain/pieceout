# PieceOut

**Preview what your CNC will actually cut — before you cut it.**

Drop in an SVG (e.g. exported from Vectric), tell PieceOut which layers are profile cuts, pockets, or decoration, and get an instant visual of the finished piece. No install, no build step, runs in your browser.

https://github.com/user-attachments/assets/c130e389-b88d-4d8f-9ac2-7147b5733db8

---

## What it does

1. **Drag in an SVG** — every `<g>` layer is parsed (Vectric, Inkscape, anything that uses grouped layers).
2. **Auto-classify** each layer as `CUT`, `POCKET`, or `IGNORE` based on layer-name keywords (`profile`, `pocket`, `engrave`, etc.). You can override any of them.
3. **See the result** — Preview mode renders cut paths punched out of a wood-colored material, with pockets shaded as recessed regions. Wireframe mode shows the raw geometry.
4. **Export a PNG** of the preview for documentation, client approval, or just remembering what you were planning.

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

Five vanilla JS modules, loaded directly as ES6 modules from `index.html`:

- **[`js/svgParser.js`](js/svgParser.js)** — DOMParser-based SVG parsing. Extracts layers from `<g>` elements via `inkscape:label` or `id`. Collects all shape primitives (path / polygon / rect / circle / ellipse / line) per layer.
- **[`js/layerTagger.js`](js/layerTagger.js)** — keyword-based auto-classification with localStorage-persisted overrides.
- **[`js/renderer.js`](js/renderer.js)** — the visualization engine. Preview mode uses an SVG `<mask>` with `fill-rule="evenodd"` to punch CUT paths out of a material rectangle (handles complex outer-with-inner-cutouts geometry correctly). Pocket layers render as a darkened overlay.
- **[`js/viewport.js`](js/viewport.js)** — zoom/pan via viewBox manipulation. Mouse + touch.
- **[`js/app.js`](js/app.js)** — orchestrator. State, file upload, view modes, PNG export.


## Contributing

Issues and PRs welcome. The codebase is intentionally small and dependency-free — please keep it that way unless there's a strong reason not to.

## License

[MIT](LICENSE) © Grooves-n-Grain
