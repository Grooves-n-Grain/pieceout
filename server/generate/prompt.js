// Pure prompt assembly. No I/O; every branch is driven entirely by its arguments so this
// can be unit tested without a server, a provider, or the style store.

// Shipped verbatim from docs/generate-tab/contract.md.
const DEFAULT_PREAMBLE = 'Finished panel artwork for a laser-cut wooden lamp panel, in the style '
    + 'of a bold woodcut / stencil illustration. Rules: pure black and white only, solid flat black '
    + 'with no wood grain or texture, no grays, no gradients, no halftones. White is what gets cut '
    + 'away and glows; black is the wood that stays. Use bold, closed, connected black shapes; avoid '
    + 'hairline details thinner than 2mm at panel scale. Frame the design with a rounded-rectangle '
    + 'black border that the artwork connects to, so no black piece floats unattached. Output ONLY '
    + 'the flat 2D cut-file artwork on a plain white background, viewed perfectly straight-on, edge '
    + 'to edge. Never render a photograph, physical lamp, wooden frame, room, glow, or 3D mockup, '
    + 'even if a reference image shows one; reference images supply drawing style only.';

const ORIENTATION_LINES = {
    portrait: 'Portrait orientation, roughly 2:3.',
    landscape: 'Landscape orientation, roughly 3:2.',
    square: 'Square, 1:1.',
};

// aspect: 'portrait' | 'landscape' | 'square'
// referenceCount: number of saved style reference images (ignored unless useStyle is true)
function buildPrompt({ prompt, hasSubject, useStyle, preamble, aspect, referenceCount = 0 }) {
    const orientation = ORIENTATION_LINES[aspect];
    if (!orientation) throw new Error('buildPrompt: aspect must be portrait, landscape, or square');

    const parts = [];
    parts.push(hasSubject
        ? 'Create exactly one new raster image. Follow the subject image for the design and composition.'
        : 'Create exactly one new raster image.');
    parts.push(prompt);
    if (useStyle) parts.push(preamble);
    parts.push(orientation);

    const imageCount = (hasSubject ? 1 : 0) + (useStyle ? referenceCount : 0);
    for (let i = 0; i < imageCount; i++) {
        const isSubject = hasSubject && i === 0;
        parts.push(`Attached image ${i + 1} is ${isSubject
            ? 'the subject or design to follow.'
            : 'visual style guidance only, not a replacement subject.'}`);
    }
    parts.push('Return one image. Do not substitute SVG, code, or a written description for the image.');
    return parts.join('\n\n');
}

module.exports = { buildPrompt, DEFAULT_PREAMBLE };
