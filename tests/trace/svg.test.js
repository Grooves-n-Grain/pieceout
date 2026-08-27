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

// White margin (touches the border), a solid black ring that does not touch the border,
// and a solid white interior sealed inside the ring (does not touch the border either).
const marginRing = () => bitmapFromStrings([
    '..........',
    '..........',
    '..####....',
    '..#..#....',
    '..#..#....',
    '..####....',
    '..........',
    '..........',
]);

test('shapesToSVG with a white margin: outline on adds the rect; the margin shape emits only the ring as a hole, no outer loop', () => {
    const r = tracePipeline(marginRing(), { tolerancePx: 0.5, kerfPx: 0, minSpeckPx: 0 });
    assert.equal(r.shapes.length, 2, 'the margin and the sealed interior');
    assert.equal(r.blackTouchesBorder, false, 'the ring never reaches the image edge');
    const on = shapesToSVG({ shapes: r.shapes, widthPx: 10, heightPx: 8, scale: 1, includeOutline: true, islands: r.islands, thin: r.thin, blackTouchesBorder: r.blackTouchesBorder });
    const onCut = on.match(/<g id="CUT"[\s\S]*?<\/g>/)[0];
    assert.equal((onCut.match(/<rect/g) || []).length, 1, 'outline on adds the perimeter rect');
    const onPaths = [...onCut.matchAll(/<path[^>]*d="([^"]*)"/g)].map(m => m[1]);
    assert.equal(onPaths.length, 2, 'the margin (hole only) and the interior (outer only)');
    for (const d of onPaths) assert.doesNotMatch(d, /^M 0 0 /, 'no path traces the image edge when black never touches the border');

    const off = shapesToSVG({ shapes: r.shapes, widthPx: 10, heightPx: 8, scale: 1, includeOutline: false, islands: r.islands, thin: r.thin, blackTouchesBorder: r.blackTouchesBorder });
    const offCut = off.match(/<g id="CUT"[\s\S]*?<\/g>/)[0];
    assert.equal((offCut.match(/<rect/g) || []).length, 0, 'outline off drops the rect');
    const offPaths = [...offCut.matchAll(/<path[^>]*d="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(offPaths, onPaths, 'the region paths do not depend on includeOutline');
});

// Left third of an 8x6 image is black and touches the top/left/bottom border; the rest is
// white and touches the top/right/bottom border. Black touching the border means the
// black/white boundary at x=3 is a real cut, so it must survive even with the outline off.
const leftThird = () => bitmapFromStrings([
    '###.....',
    '###.....',
    '###.....',
    '###.....',
    '###.....',
    '###.....',
]);

test('shapesToSVG with black touching the border: the shared boundary is still cut, outline or not', () => {
    const r = tracePipeline(leftThird(), { tolerancePx: 0.5, kerfPx: 0, minSpeckPx: 0 });
    assert.equal(r.shapes.length, 1);
    assert.equal(r.shapes[0].touchesBorder, true);
    assert.equal(r.blackTouchesBorder, true);
    const on = shapesToSVG({ shapes: r.shapes, widthPx: 8, heightPx: 6, scale: 1, includeOutline: true, islands: r.islands, thin: r.thin, blackTouchesBorder: r.blackTouchesBorder });
    const onCut = on.match(/<g id="CUT"[\s\S]*?<\/g>/)[0];
    assert.equal((onCut.match(/<rect/g) || []).length, 1);
    const onPaths = [...onCut.matchAll(/<path[^>]*d="([^"]*)"/g)].map(m => m[1]);
    assert.equal(onPaths.length, 1);
    assert.match(onPaths[0], /3 0/);
    assert.match(onPaths[0], /3 6/);

    const off = shapesToSVG({ shapes: r.shapes, widthPx: 8, heightPx: 6, scale: 1, includeOutline: false, islands: r.islands, thin: r.thin, blackTouchesBorder: r.blackTouchesBorder });
    const offCut = off.match(/<g id="CUT"[\s\S]*?<\/g>/)[0];
    assert.equal((offCut.match(/<rect/g) || []).length, 0);
    const offPaths = [...offCut.matchAll(/<path[^>]*d="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(offPaths, onPaths);
});

test('shapesToSVG with a framed bitmap (black frame touching the border) still gets the rect when includeOutline is true', () => {
    const r = tracePipeline(ring(), { tolerancePx: 0.5, kerfPx: 0, minSpeckPx: 0 });
    assert.equal(r.shapes.some(s => s.touchesBorder), false, 'white never touches the border in a framed image');
    const svg = shapesToSVG({ shapes: r.shapes, widthPx: 10, heightPx: 10, scale: 1, includeOutline: true, islands: r.islands, thin: r.thin, blackTouchesBorder: r.blackTouchesBorder });
    const cutGroup = svg.match(/<g id="CUT"[\s\S]*?<\/g>/)[0];
    assert.equal((cutGroup.match(/<rect/g) || []).length, 1, 'the frame does not touch border, so the outline still needs its own rect');
    const paths = [...cutGroup.matchAll(/<path/g) || []];
    assert.equal(paths.length, 2, 'interior white shapes are always emitted regardless of includeOutline');
});

test('ring fixture matches golden SVG', () => {
    const rows = JSON.parse(readFileSync(new URL('./fixtures/ring.json', import.meta.url), 'utf8'));
    const r = tracePipeline(bitmapFromStrings(rows), { tolerancePx: 0.5, kerfPx: 2, minSpeckPx: 0 });
    const svg = shapesToSVG({ shapes: r.shapes, widthPx: rows[0].length, heightPx: rows.length, scale: 5, includeOutline: false, islands: r.islands, thin: r.thin });
    const expected = readFileSync(new URL('./fixtures/ring.svg', import.meta.url), 'utf8');
    assert.equal(svg, expected, 'run node tests/trace/fixtures/regen.js if the change is intended');
});
