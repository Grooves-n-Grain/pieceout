/**
 * Thin-feature detection by morphological opening, using a chamfer distance
 * transform so the cost is linear in pixel count regardless of kerf size.
 */
import { labelComponents } from './components.js';

const INF = 1e9;

export function distanceToZero(mask, W, H) {
    const d = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
    // Forward pass: left, up-left, up, up-right.
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let v = d[i];
            if (x > 0) v = Math.min(v, d[i - 1] + 3);
            if (y > 0) {
                v = Math.min(v, d[i - W] + 3);
                if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
                if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
            }
            d[i] = v;
        }
    }
    // Backward pass: right, down-right, down, down-left.
    for (let y = H - 1; y >= 0; y--) {
        for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            let v = d[i];
            if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
            if (y < H - 1) {
                v = Math.min(v, d[i + W] + 3);
                if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
                if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
            }
            d[i] = v;
        }
    }
    for (let i = 0; i < W * H; i++) d[i] /= 3;
    return d;
}

export function findThinFeatures(bitmap, kerfPx, minAreaPx = 4) {
    const r = kerfPx / 2;
    if (!(r >= 1)) return [];
    const { width: W, height: H, data } = bitmap;
    const toWhite = distanceToZero(data, W, H);           // data: 1 = black, 0 = white
    const notEroded = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) notEroded[i] = data[i] && toWhite[i] > r ? 0 : 1;
    const toEroded = distanceToZero(notEroded, W, H);
    const thin = { width: W, height: H, data: new Uint8Array(W * H) };
    for (let i = 0; i < W * H; i++) thin.data[i] = data[i] && toEroded[i] > r ? 1 : 0;
    const a = labelComponents(thin, 1);
    const out = [];
    for (let id = 1; id <= a.count; id++) {
        if (a.areas[id] >= minAreaPx) out.push({ area: a.areas[id], bbox: a.bboxes[id] });
    }
    return out.sort((p, q) => q.area - p.area);
}
