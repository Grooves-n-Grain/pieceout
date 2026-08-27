/**
 * Trace pipeline glue and SVG serialisation. CUT = white regions (what the
 * laser removes) as evenodd paths; GUIDE = image rectangle, island markers,
 * thin-feature boxes. 1 unit = 1 mm like the Layout writer.
 */
import { fmt } from '../layout/svgWriter.js';
import { removeSpecks } from './despeckle.js';
import { labelComponents, findIslands } from './components.js';
import { traceContours } from './contour.js';
import { simplifyPolygon } from './simplify.js';
import { fitBeziers } from './fitCurves.js';
import { findThinFeatures } from './thin.js';

const COLORS = { CUT: '#e94560', GUIDE: '#888888', THIN: '#f5a623' };

function fitLoop(points, tolerancePx) {
    return fitBeziers(simplifyPolygon(points, tolerancePx), tolerancePx);
}

export function buildShapes(contours, { tolerancePx }) {
    return contours.map(c => ({
        outer: fitLoop(c.outer, tolerancePx),
        holes: c.holes.map(h => fitLoop(h, tolerancePx)),
        touchesBorder: c.touchesBorder,
    }));
}

export function pathData(segments, scale) {
    if (!segments.length) return '';
    const s = (p) => `${fmt(p[0] * scale)} ${fmt(p[1] * scale)}`;
    let d = `M ${s(segments[0][0])}`;
    for (const [, p1, p2, p3] of segments) d += ` C ${s(p1)} ${s(p2)} ${s(p3)}`;
    return d + ' Z';
}

export function tracePipeline(bitmap, { tolerancePx, kerfPx, minSpeckPx }) {
    const clean = removeSpecks(bitmap, minSpeckPx);
    const black = labelComponents(clean, 1, minSpeckPx);
    const islands = findIslands(clean, black);
    const thin = findThinFeatures(clean, kerfPx);
    const contours = traceContours(clean);
    const shapes = buildShapes(contours, { tolerancePx });
    let bodyArea = 0;
    for (let id = 1; id <= black.count; id++) if (black.body[id]) bodyArea += black.areas[id];
    return { bitmap: clean, black, islands, thin, contours, shapes, bodyArea, blackTouchesBorder: black.touchesBorder.some(Boolean) };
}

function group(name, colour, dashed, elements) {
    const dash = dashed ? ' stroke-dasharray="2 2"' : '';
    return `  <g id="${name}" inkscape:label="${name}" inkscape:groupmode="layer" fill="none" stroke="${colour}" stroke-width="0.3"${dash}>\n${elements.map(e => `    ${e}`).join('\n')}\n  </g>`;
}

export function shapesToSVG({ shapes, widthPx, heightPx, scale, includeOutline, islands = [], thin = [], blackTouchesBorder = false }) {
    const W = fmt(widthPx * scale), H = fmt(heightPx * scale);
    const guide = [`<rect x="0" y="0" width="${W}" height="${H}"/>`];
    islands.forEach((island, i) => {
        const cx = fmt((island.bbox.x0 + island.bbox.x1 + 1) / 2 * scale);
        const cy = fmt((island.bbox.y0 + island.bbox.y1 + 1) / 2 * scale);
        guide.push(`<circle cx="${cx}" cy="${cy}" r="1.5"/>`);
        guide.push(`<text x="${fmt(parseFloat(cx) + 2)}" y="${cy}" font-size="3" font-family="sans-serif" fill="${COLORS.GUIDE}" stroke="none">${island.number ?? (i + 1)}</text>`);
    });
    for (const t of thin) {
        guide.push(`<rect x="${fmt(t.bbox.x0 * scale)}" y="${fmt(t.bbox.y0 * scale)}" width="${fmt((t.bbox.x1 - t.bbox.x0 + 1) * scale)}" height="${fmt((t.bbox.y1 - t.bbox.y0 + 1) * scale)}" stroke="${COLORS.THIN}"/>`);
    }
    const cut = [];
    // The panel perimeter is its own, independent cut: emit it whenever includeOutline is on,
    // regardless of what any shape's own loops do.
    if (includeOutline) cut.push(`<rect x="0" y="0" width="${W}" height="${H}"/>`);
    for (const shape of shapes) {
        // Holes are always real black/white boundaries, so they always get cut. A shape's
        // outer loop is too, UNLESS it touches the image border with nothing black touching
        // that border either - then the loop is only tracing the image edge itself (no real
        // material boundary there), which the perimeter rect above already covers, and cutting
        // it again would double-cut that edge. When black does touch the border, the outer
        // loop does carry a real boundary along part of its run, so it's kept (accepting that
        // the segments it shares with the image edge may then be cut twice - v1 behaviour).
        const loops = [];
        if (!shape.touchesBorder || blackTouchesBorder) loops.push(pathData(shape.outer, scale));
        for (const h of shape.holes) loops.push(pathData(h, scale));
        if (!loops.length) continue;
        cut.push(`<path fill-rule="evenodd" d="${loops.join(' ')}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n${group('GUIDE', COLORS.GUIDE, true, guide)}\n${group('CUT', COLORS.CUT, false, cut)}\n</svg>\n`;
}
