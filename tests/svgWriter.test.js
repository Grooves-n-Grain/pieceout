import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { andonLamp } from '../js/layout/templates/andonLamp.js';
import { defaultMachine } from '../js/layout/machine.js';
import { nest } from '../js/layout/nest.js';
import { sheetToSVG, sheetFileName, layerName } from '../js/layout/svgWriter.js';

function defaultSheets() {
    const p = andonLamp.defaults();
    const d = andonLamp.derive(p);
    return nest(andonLamp.build(p, d), defaultMachine());
}

test('layerName encodes depth and diameter', () => {
    assert.equal(layerName({ layer: 'CUT' }), 'CUT');
    assert.equal(layerName({ layer: 'POCKET', depth: 6.35 }), 'POCKET-6.35mm');
    assert.equal(layerName({ layer: 'DRILL', diameter: 6.2 }), 'DRILL-6.2mm');
    assert.equal(layerName({ layer: 'GUIDE' }), 'GUIDE');
});

test('sheetFileName', () => {
    const [hard] = defaultSheets();
    assert.equal(sheetFileName('andon-lamp', hard), 'andon-lamp-hardwood-1.svg');
});

test('sheetToSVG emits true-size root and named layers in order', () => {
    const [hard] = defaultSheets();
    const svg = sheetToSVG(hard);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:inkscape="http:\/\/www\.inkscape\.org\/namespaces\/inkscape" width="300mm" height="600mm" viewBox="0 0 300 600">/);
    const ids = [...svg.matchAll(/<g id="([^"]+)" inkscape:label="\1"/g)].map(m => m[1]);
    assert.deepEqual(ids, ['GUIDE', 'DRILL-6.2mm', 'POCKET-6.35mm', 'CUT']);
    assert.equal((svg.match(/<circle /g) || []).length, 8 * 4);
    assert.equal((svg.match(/<g id="CUT"[\s\S]*?<\/g>/)[0].match(/<rect /g) || []).length, 12);
    assert.match(svg, /<text [^>]*>Rail 1<\/text>/);
});

test('sheetToSVG escapes text', () => {
    const [hard] = defaultSheets();
    hard.placements[0].part.features.push({ layer: 'GUIDE', shape: { kind: 'text', x: 1, y: 1, text: 'a<b&c' } });
    assert.match(sheetToSVG(hard), /a&lt;b&amp;c/);
});

test('default lamp matches golden fixtures', () => {
    for (const sheet of defaultSheets()) {
        if (sheet.index !== 1) continue;
        const expected = readFileSync(new URL(`./fixtures/${sheetFileName('andon-lamp', sheet)}`, import.meta.url), 'utf8');
        assert.equal(sheetToSVG(sheet), expected, `${sheet.material} sheet 1 differs from fixture; run node tests/fixtures/regen.js if the change is intended`);
    }
});
