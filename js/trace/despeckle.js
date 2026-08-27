/** Remove dust: tiny black specks become white, then tiny white pinholes become black. */
import { cloneBitmap } from './bitmap.js';
import { labelComponents } from './components.js';

function flipSmall(bitmap, colour, minAreaPx) {
    const a = labelComponents(bitmap, colour);
    const out = cloneBitmap(bitmap);
    const flipTo = colour === 1 ? 0 : 1;
    const small = new Uint8Array(a.count + 1);
    let any = false;
    for (let id = 1; id <= a.count; id++) {
        if (a.areas[id] < minAreaPx && !a.touchesBorder[id]) { small[id] = 1; any = true; }
    }
    if (!any) return out;
    for (let i = 0; i < a.labels.length; i++) {
        if (a.labels[i] && small[a.labels[i]]) out.data[i] = flipTo;
    }
    return out;
}

export function removeSpecks(bitmap, minAreaPx) {
    if (!(minAreaPx >= 0)) throw new Error(`minAreaPx must be >= 0, got ${minAreaPx}`);
    if (minAreaPx <= 1) return cloneBitmap(bitmap);
    return flipSmall(flipSmall(bitmap, 1, minAreaPx), 0, minAreaPx);
}
