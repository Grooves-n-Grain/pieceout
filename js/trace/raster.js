/** Threshold RGBA ImageData into a Bitmap. Pure: takes { width, height, data }, never touches a canvas. */
import { createBitmap } from './bitmap.js';

export function imageToBitmap(imageData, { threshold = 128, invert = false } = {}) {
    const { width, height, data } = imageData;
    if (!(threshold >= 1 && threshold <= 254)) throw new Error(`threshold must be 1..254, got ${threshold}`);
    const bm = createBitmap(width, height);
    const n = width * height;
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const alpha = data[o + 3];
        let black = 0;
        if (alpha >= 128) {
            const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
            black = lum < threshold ? 1 : 0;
        }
        bm.data[i] = invert ? 1 - black : black;
    }
    return bm;
}
