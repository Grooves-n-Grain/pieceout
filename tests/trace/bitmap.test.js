import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBitmap, cloneBitmap, getPixel, bitmapFromStrings, bitmapToStrings } from '../../js/trace/bitmap.js';
import { imageToBitmap } from '../../js/trace/raster.js';

test('bitmapFromStrings and back', () => {
    const bm = bitmapFromStrings(['#..', '.#.']);
    assert.equal(bm.width, 3);
    assert.equal(bm.height, 2);
    assert.deepEqual(Array.from(bm.data), [1, 0, 0, 0, 1, 0]);
    assert.deepEqual(bitmapToStrings(bm), ['#..', '.#.']);
    assert.throws(() => bitmapFromStrings(['#', '##']), /ragged/);
});

test('getPixel is 0 outside the image', () => {
    const bm = bitmapFromStrings(['#']);
    assert.equal(getPixel(bm, 0, 0), 1);
    assert.equal(getPixel(bm, -1, 0), 0);
    assert.equal(getPixel(bm, 0, 1), 0);
});

test('createBitmap and cloneBitmap', () => {
    const bm = createBitmap(2, 2);
    assert.equal(bm.data.length, 4);
    bm.data[3] = 1;
    const c = cloneBitmap(bm);
    c.data[0] = 1;
    assert.deepEqual(Array.from(bm.data), [0, 0, 0, 1]);
    assert.deepEqual(Array.from(c.data), [1, 0, 0, 1]);
    assert.throws(() => createBitmap(0, 2), /width/);
});

test('imageToBitmap thresholds luminance, treats transparent as white, supports invert', () => {
    const px = (r, g, b, a = 255) => [r, g, b, a];
    const data = new Uint8ClampedArray([
        ...px(0, 0, 0), ...px(255, 255, 255), ...px(100, 100, 100),
        ...px(0, 0, 0, 0), ...px(255, 0, 0), ...px(200, 200, 200),
    ]);
    const img = { width: 3, height: 2, data };
    assert.deepEqual(bitmapToStrings(imageToBitmap(img, { threshold: 128 })), ['#.#', '.#.']);
    assert.deepEqual(bitmapToStrings(imageToBitmap(img, { threshold: 128, invert: true })), ['.#.', '#.#']);
    assert.deepEqual(bitmapToStrings(imageToBitmap(img, { threshold: 90 })), ['#..', '.#.']);
});
