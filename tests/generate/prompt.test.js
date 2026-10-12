import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildPrompt, DEFAULT_PREAMBLE } = require('../../server/generate/prompt.js');

test('no subject, no style: task line, prompt, orientation, no image lines', () => {
    const out = buildPrompt({ prompt: 'a moose in a lake', hasSubject: false, useStyle: false, preamble: '', aspect: 'square', referenceCount: 0 });
    assert.equal(out, [
        'Create exactly one new raster image.',
        'a moose in a lake',
        'Square, 1:1.',
        'Return one image. Do not substitute SVG, code, or a written description for the image.',
    ].join('\n\n'));
});

test('subject present: task line mentions following the subject, and image 1 is labeled subject', () => {
    const out = buildPrompt({ prompt: 'a loon', hasSubject: true, useStyle: false, preamble: '', aspect: 'portrait', referenceCount: 0 });
    assert.equal(out, [
        'Create exactly one new raster image. Follow the subject image for the design and composition.',
        'a loon',
        'Portrait orientation, roughly 2:3.',
        'Attached image 1 is the subject or design to follow.',
        'Return one image. Do not substitute SVG, code, or a written description for the image.',
    ].join('\n\n'));
});

test('useStyle true inserts the preamble after the prompt and before the orientation line', () => {
    const out = buildPrompt({ prompt: 'a loon', hasSubject: false, useStyle: true, preamble: 'STYLE TEXT', aspect: 'landscape', referenceCount: 0 });
    assert.equal(out, [
        'Create exactly one new raster image.',
        'a loon',
        'STYLE TEXT',
        'Landscape orientation, roughly 3:2.',
        'Return one image. Do not substitute SVG, code, or a written description for the image.',
    ].join('\n\n'));
});

test('subject plus style references: subject first, then one line per reference, in order', () => {
    const out = buildPrompt({ prompt: 'a loon', hasSubject: true, useStyle: true, preamble: 'STYLE', aspect: 'square', referenceCount: 3 });
    const lines = out.split('\n\n');
    assert.deepEqual(lines.slice(4, 8), [
        'Attached image 1 is the subject or design to follow.',
        'Attached image 2 is visual style guidance only, not a replacement subject.',
        'Attached image 3 is visual style guidance only, not a replacement subject.',
        'Attached image 4 is visual style guidance only, not a replacement subject.',
    ]);
});

test('useStyle false ignores referenceCount entirely: no preamble, no reference image lines', () => {
    const out = buildPrompt({ prompt: 'a loon', hasSubject: true, useStyle: false, preamble: 'STYLE', aspect: 'square', referenceCount: 3 });
    assert.ok(!out.includes('STYLE'));
    assert.equal(out.split('\n\n').filter(p => p.startsWith('Attached image')).length, 1);
});

test('style references without a subject: every image line reads as style guidance, none as subject', () => {
    const out = buildPrompt({ prompt: 'p', hasSubject: false, useStyle: true, preamble: 'STYLE', aspect: 'square', referenceCount: 2 });
    const imageLines = out.split('\n\n').filter(p => p.startsWith('Attached image'));
    assert.equal(imageLines.length, 2);
    assert.ok(imageLines.every(line => line.includes('visual style guidance only')));
});

test('every branch ends with the fixed closing line', () => {
    for (const useStyle of [true, false]) {
        for (const hasSubject of [true, false]) {
            const out = buildPrompt({ prompt: 'p', hasSubject, useStyle, preamble: 'x', aspect: 'square', referenceCount: 1 });
            assert.ok(out.endsWith('Return one image. Do not substitute SVG, code, or a written description for the image.'));
        }
    }
});

test('rejects an unknown aspect', () => {
    assert.throws(() => buildPrompt({ prompt: 'p', hasSubject: false, useStyle: false, preamble: '', aspect: 'huge', referenceCount: 0 }));
});

test('DEFAULT_PREAMBLE matches the contract verbatim', () => {
    assert.equal(DEFAULT_PREAMBLE, 'Finished panel artwork for a laser-cut wooden lamp panel, in the style of a bold '
        + 'woodcut / stencil illustration. Rules: pure black and white only, solid flat black with no wood grain or '
        + 'texture, no grays, no gradients, no halftones. White is what gets cut away and glows; black is the wood '
        + 'that stays. Use bold, closed, connected black shapes; avoid hairline details thinner than 2mm at panel '
        + 'scale. Frame the design with a rounded-rectangle black border that the artwork connects to, so no black '
        + 'piece floats unattached. Output ONLY the flat 2D cut-file artwork on a plain white background, viewed '
        + 'perfectly straight-on, edge to edge. Never render a photograph, physical lamp, wooden frame, room, glow, '
        + 'or 3D mockup, even if a reference image shows one; reference images supply drawing style only.');
});
