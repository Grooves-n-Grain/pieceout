/**
 * Minimal 1-byte-per-pixel bitmap. 1 = black (material stays), 0 = white (cut away).
 * Row-major, origin top-left, index = y * width + x.
 */

function assertDim(value, label) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer, got ${value}`);
}

export function createBitmap(width, height, data) {
    assertDim(width, 'width');
    assertDim(height, 'height');
    if (data && data.length !== width * height) throw new Error('data length does not match width * height');
    return { width, height, data: data || new Uint8Array(width * height) };
}

export function cloneBitmap(bitmap) {
    return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(bitmap.data) };
}

export function getPixel(bitmap, x, y) {
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return 0;
    return bitmap.data[y * bitmap.width + x];
}

export function bitmapFromStrings(rows) {
    const height = rows.length;
    const width = rows[0].length;
    const bm = createBitmap(width, height);
    rows.forEach((row, y) => {
        if (row.length !== width) throw new Error(`ragged row ${y}: expected ${width} chars, got ${row.length}`);
        for (let x = 0; x < width; x++) {
            const ch = row[x];
            if (ch !== '#' && ch !== '.') throw new Error(`bad char "${ch}" at ${x},${y}; use # or .`);
            bm.data[y * width + x] = ch === '#' ? 1 : 0;
        }
    });
    return bm;
}

export function bitmapToStrings(bitmap) {
    const rows = [];
    for (let y = 0; y < bitmap.height; y++) {
        let row = '';
        for (let x = 0; x < bitmap.width; x++) row += bitmap.data[y * bitmap.width + x] ? '#' : '.';
        rows.push(row);
    }
    return rows;
}
