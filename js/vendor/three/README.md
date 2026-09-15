# Three.js

Pinned version: **0.180.0** (MIT), from the official npm package
<https://registry.npmjs.org/three/-/three-0.180.0.tgz>.

- `build/three.module.min.js` → `three.js`
- `build/three.core.min.js` → `core.js`
- `examples/jsm/controls/OrbitControls.js` → `OrbitControls.js`
- `LICENSE` → `LICENSE.txt`

Only import paths are changed: `./three.core.min.js` → `./core.js` and
OrbitControls' `three` import → `./three.js`. Files are local and loaded only
when the Relief 3D view opens; no CDN or frontend build step is required.
