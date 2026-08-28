import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandsInRect } from '../../js/trace/select.js';

function island(number, bbox) {
    return { number, bbox };
}

test('an island fully inside the rect is included', () => {
    const a = island(1, { x0: 10, y0: 10, x1: 20, y1: 20 });
    const rect = { x0: 0, y0: 0, x1: 30, y1: 30 };
    assert.deepEqual(islandsInRect([a], rect), [a]);
});

test('an island that only partially overlaps the rect is excluded', () => {
    const a = island(1, { x0: 10, y0: 10, x1: 40, y1: 20 });
    const rect = { x0: 0, y0: 0, x1: 30, y1: 30 };
    assert.deepEqual(islandsInRect([a], rect), []);
});

test('an island whose bbox exactly touches the rect edge is included', () => {
    const a = island(1, { x0: 0, y0: 0, x1: 30, y1: 30 });
    const rect = { x0: 0, y0: 0, x1: 30, y1: 30 };
    assert.deepEqual(islandsInRect([a], rect), [a]);
});

test('an empty island list returns an empty result', () => {
    const rect = { x0: 0, y0: 0, x1: 30, y1: 30 };
    assert.deepEqual(islandsInRect([], rect), []);
});

test('picks out only the islands fully inside among a mix', () => {
    const inside = island(1, { x0: 5, y0: 5, x1: 15, y1: 15 });
    const outside = island(2, { x0: 100, y0: 100, x1: 110, y1: 110 });
    const overlapping = island(3, { x0: 15, y0: 15, x1: 45, y1: 45 });
    const rect = { x0: 0, y0: 0, x1: 20, y1: 20 };
    assert.deepEqual(islandsInRect([inside, outside, overlapping], rect), [inside]);
});
