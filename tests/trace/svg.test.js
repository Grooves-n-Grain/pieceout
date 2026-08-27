import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bitmapFromStrings } from '../../js/trace/bitmap.js';
import { pathData, shapesToSVG, tracePipeline } from '../../js/trace/svg.js';

const ring = () => bitmapFromStrings([
    '##########',
    '#........#',
    '#..####..#',
    '#..#..#..#',
    '#..#..#..#',
    '#..####..#',
    '#........#',
    '#.#......#',
    '#........#',
    '##########',
]);

test('pathData scales and closes', () => {
    const d = pathData([[[0, 0], [1, 0], [2, 1], [2, 2]]], 0.5);
    assert.equal(d, 'M 0 0 C 0.5 0 1 0.5 1 1 Z');
});

test('tracePipeline reports islands, thin features and shapes', () => {
    const r = tracePipeline(ring(), { tolerancePx: 0.5, kerfPx: 0, minSpeckPx: 0 });
    assert.equal(r.islands.length, 2, 'the ring and the lone pixel');
    assert.equal(r.shapes.length, 2, 'outer white region and the ring interior');
    assert.equal(r.shapes.filter(s => s.touchesBorder).length, 0, 'white never touches the border in a framed image');
    assert.ok(r.shapes.some(s => s.holes.length === 2), 'the outer white region has two holes');
});

test('shapesToSVG emits mm root, GUIDE then CUT, evenodd paths', () => {
    const r = tracePipeline(ring(), { tolerancePx: 0.5, kerfPx: 0, minSpeckPx: 0 });
    const svg = shapesToSVG({ shapes: r.shapes, widthPx: 10, heightPx: 10, scale: 10, includeOutline: true, islands: r.islands, thin: r.thin });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:inkscape="http:\/\/www\.inkscape\.org\/namespaces\/inkscape" width="100mm" height="100mm" viewBox="0 0 100 100">/);
    const ids = [...svg.matchAll(/<g id="([^"]+)" inkscape:label="\1"/g)].map(m => m[1]);
    assert.deepEqual(ids, ['GUIDE', 'CUT']);
    assert.equal((svg.match(/fill-rule="evenodd"/g) || []).length, 2);
    assert.equal((svg.match(/<circle /g) || []).length, 2, 'one marker per island');
    assert.match(svg, /<g id="CUT"[\s\S]*<rect x="0" y="0" width="100" height="100"\/>/);
});

test('ring fixture matches golden SVG', () => {
    const rows = JSON.parse(readFileSync(new URL('./fixtures/ring.json', import.meta.url), 'utf8'));
    const r = tracePipeline(bitmapFromStrings(rows), { tolerancePx: 0.5, kerfPx: 2, minSpeckPx: 0 });
    const svg = shapesToSVG({ shapes: r.shapes, widthPx: rows[0].length, heightPx: rows.length, scale: 5, includeOutline: false, islands: r.islands, thin: r.thin });
    const expected = readFileSync(new URL('./fixtures/ring.svg', import.meta.url), 'utf8');
    assert.equal(svg, expected, 'run node tests/trace/fixtures/regen.js if the change is intended');
});
