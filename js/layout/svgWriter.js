/**
 * Serialises a nested Sheet to a true-size SVG string that Vectric Aspire and
 * PieceOut's own parser both understand: 1 unit = 1 mm, one <g> layer per
 * operation named CUT / POCKET-<depth>mm / DRILL-<dia>mm / GUIDE.
 */
import { Layer } from './parts.js';

const COLORS = { CUT: '#e94560', POCKET: '#4a9eff', DRILL: '#f5a623', GUIDE: '#888888' };
const STROKE_WIDTH = 0.3;
const LABEL_FONT_SIZE = 4;

export function fmt(n) {
    return String(Math.round(n * 1000) / 1000);
}

function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function layerName(feature) {
    switch (feature.layer) {
        case Layer.POCKET: return `POCKET-${fmt(feature.depth)}mm`;
        case Layer.DRILL: return `DRILL-${fmt(feature.diameter)}mm`;
        default: return feature.layer;
    }
}

export function sheetFileName(templateId, sheet) {
    return `${templateId}-${sheet.material}-${sheet.index}.svg`;
}

function shapeToSVG(shape, dx, dy) {
    switch (shape.kind) {
        case 'rect':
            return `<rect x="${fmt(shape.x + dx)}" y="${fmt(shape.y + dy)}" width="${fmt(shape.width)}" height="${fmt(shape.height)}"/>`;
        case 'circle':
            return `<circle cx="${fmt(shape.cx + dx)}" cy="${fmt(shape.cy + dy)}" r="${fmt(shape.r)}"/>`;
        case 'text':
            return `<text x="${fmt(shape.x + dx)}" y="${fmt(shape.y + dy)}" font-size="${LABEL_FONT_SIZE}" font-family="sans-serif" fill="${COLORS.GUIDE}" stroke="none">${escapeXml(shape.text)}</text>`;
        default:
            throw new Error(`Unknown shape kind ${shape.kind}`);
    }
}

/**
 * Collect elements by layer name. Returns Map<name, { base, sortKey, elements[] }>.
 */
function collectLayers(sheet) {
    const layers = new Map();
    const bucket = (name, base, sortKey) => {
        if (!layers.has(name)) layers.set(name, { base, sortKey, elements: [] });
        return layers.get(name).elements;
    };

    const guide = bucket(Layer.GUIDE, Layer.GUIDE, 0);
    guide.push(`<rect x="0" y="0" width="${fmt(sheet.width)}" height="${fmt(sheet.height)}"/>`);
    const cut = bucket(Layer.CUT, Layer.CUT, 0);

    for (const { part, x, y } of sheet.placements) {
        cut.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(part.width)}" height="${fmt(part.height)}"/>`);
        for (const feature of part.features) {
            const name = layerName(feature);
            const sortKey = feature.depth ?? feature.diameter ?? 0;
            bucket(name, feature.layer, sortKey).push(shapeToSVG(feature.shape, x, y));
        }
        // Labels are a sheet-level concern: the copy name ("Rail 1") only exists after
        // nesting, so the writer emits it here rather than the template baking in a
        // name it can't yet know.
        const labelShape = { kind: 'text', x: 3, y: Math.min(part.height - 3, 6), text: part.name };
        guide.push(shapeToSVG(labelShape, x, y));
    }
    return layers;
}

const LAYER_ORDER = [Layer.GUIDE, Layer.DRILL, Layer.POCKET, Layer.CUT];

export function sheetToSVG(sheet) {
    const layers = collectLayers(sheet);
    const ordered = [...layers.entries()].sort(([, a], [, b]) => {
        return LAYER_ORDER.indexOf(a.base) - LAYER_ORDER.indexOf(b.base) || a.sortKey - b.sortKey;
    });

    const groups = ordered.map(([name, { base, elements }]) => {
        const dash = base === Layer.GUIDE ? ' stroke-dasharray="2 2"' : '';
        const attrs = `id="${name}" inkscape:label="${name}" inkscape:groupmode="layer" fill="none" stroke="${COLORS[base]}" stroke-width="${STROKE_WIDTH}"${dash}`;
        return `  <g ${attrs}>\n${elements.map(e => `    ${e}`).join('\n')}\n  </g>`;
    });

    const w = fmt(sheet.width);
    const h = fmt(sheet.height);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n${groups.join('\n')}\n</svg>\n`;
}
