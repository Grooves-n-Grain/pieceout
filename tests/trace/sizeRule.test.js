import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFromStrings, bitmapToStrings } from '../../js/trace/bitmap.js';
import { seedKey } from '../../js/trace/islandNumbers.js';
import { removeSmallIslands } from '../../js/trace/sizeRule.js';

test('a threshold of 0 is a no-op and returns the same bitmap object', () => {
    const bm = bitmapFromStrings([
        '#####',
        '#...#',
        '#.#.#',
        '#...#',
        '#####',
    ]);
    const result = removeSmallIslands(bm, { minAreaPx: 0 });
    assert.equal(result.bitmap, bm);
    assert.equal(result.removed, 0);
});

const twoIslands = () => bitmapFromStrings([
    '###########',
    '#.........#',
    '#.#.......#',
    '#.........#',
    '#...##....#',
    '#...##....#',
    '#.........#',
    '###########',
]);

test('an island under the threshold is flipped white and a bigger one survives', () => {
    const bm = twoIslands();
    const result = removeSmallIslands(bm, { minAreaPx: 2 });
    assert.equal(result.removed, 1);
    assert.notEqual(result.bitmap, bm, 'a change happened, so a clone is returned');
    const rows = bitmapToStrings(result.bitmap);
    assert.equal(rows[2][2], '.', 'the 1-pixel island is gone');
    assert.equal(rows[4][4], '#', 'the 4-pixel island survives');
    assert.equal(rows[4][5], '#');
    assert.equal(rows[5][4], '#');
    assert.equal(rows[5][5], '#');
    // Original bitmap is untouched.
    assert.equal(bitmapToStrings(bm)[2][2], '#');
});

test('a kept island survives even under the threshold', () => {
    const bm = twoIslands();
    const kept = new Set([seedKey([2, 2])]);
    const result = removeSmallIslands(bm, { minAreaPx: 2, keptKeys: kept });
    assert.equal(result.removed, 0);
    assert.equal(bitmapToStrings(result.bitmap)[2][2], '#', 'kept island is not removed');
});

test('the body is never flipped even when it is smaller than minSpeckPx', () => {
    // A tiny border-touching frame with nothing else black: labelComponents falls back to
    // treating the single component as the body regardless of minSpeckPx (see components.js),
    // so it must never be a target of the size rule no matter how high the threshold is.
    const bm = bitmapFromStrings([
        '###',
        '#.#',
        '###',
    ]);
    const before = bitmapToStrings(bm);
    const result = removeSmallIslands(bm, { minAreaPx: 1000, minSpeckPx: 1000 });
    assert.equal(result.removed, 0);
    assert.deepEqual(bitmapToStrings(result.bitmap), before);
});
