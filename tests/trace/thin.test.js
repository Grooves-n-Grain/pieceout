import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitmapFromStrings } from '../../js/trace/bitmap.js';
import { distanceToZero, findThinFeatures } from '../../js/trace/thin.js';

test('distanceToZero is 0 on zeros and grows away from them', () => {
    const W = 5, H = 1;
    const mask = new Uint8Array([0, 1, 1, 1, 1]);
    const d = distanceToZero(mask, W, H);
    assert.equal(d[0], 0);
    assert.equal(d[1], 1);
    assert.equal(d[4], 4);
});

test('a 1 px bar is thin for a 4 px kerf, a 5 px bar is not', () => {
    const thinBar = bitmapFromStrings([
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '....#....',
    ]);
    const f = findThinFeatures(thinBar, 4, 4);
    assert.equal(f.length, 1);
    assert.equal(f[0].area, 9);
    assert.deepEqual(f[0].bbox, { x0: 4, y0: 0, x1: 4, y1: 8 });

    const wide = bitmapFromStrings(Array(9).fill('..#####..'));
    assert.equal(findThinFeatures(wide, 4, 4).length, 0);
});

test('kerf under 2 px reports nothing', () => {
    const bm = bitmapFromStrings(['.#.', '.#.', '.#.']);
    assert.deepEqual(findThinFeatures(bm, 1.5), []);
});
