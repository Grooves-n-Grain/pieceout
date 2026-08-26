/**
 * Part and feature model for the layout generator.
 * All coordinates are part-local millimetres: origin at the part's top-left,
 * +x to the right, +y down. Features never carry tool compensation.
 */

export const Material = Object.freeze({ HARDWOOD: 'hardwood', BASSWOOD: 'basswood' });
export const Grain = Object.freeze({ ALONG_X: 'along-x', ANY: 'any' });
export const Layer = Object.freeze({ CUT: 'CUT', POCKET: 'POCKET', DRILL: 'DRILL', GUIDE: 'GUIDE' });

const EPS = 1e-6;

export function assertPositive(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number, got ${value}`);
    }
}

function assertNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${label} must be a finite number, got ${value}`);
    }
}

function assertOneOf(value, allowed, label) {
    if (!Object.values(allowed).includes(value)) {
        throw new Error(`${label} must be one of ${Object.values(allowed).join(', ')}, got ${value}`);
    }
}

function assertInside(part, x0, y0, x1, y1, what) {
    if (x0 < -EPS || y0 < -EPS || x1 > part.width + EPS || y1 > part.height + EPS) {
        throw new Error(`${what} lies outside part "${part.name}" (${part.width} x ${part.height})`);
    }
}

export function createPart({ name, material, width, height, grain = Grain.ALONG_X, qty = 1 }) {
    if (!name) throw new Error('name is required');
    assertOneOf(material, Material, 'material');
    assertPositive(width, 'width');
    assertPositive(height, 'height');
    assertOneOf(grain, Grain, 'grain');
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`qty must be a positive integer, got ${qty}`);
    return { name, material, width, height, grain, qty, features: [] };
}

export function addRect(part, { layer, x, y, width, height, depth }) {
    assertOneOf(layer, Layer, 'layer');
    assertNumber(x, 'x');
    assertNumber(y, 'y');
    assertPositive(width, 'width');
    assertPositive(height, 'height');
    assertInside(part, x, y, x + width, y + height, `rect ${layer}`);
    const shape = { kind: 'rect', x, y, width, height };
    let feature;
    if (depth !== undefined) {
        assertPositive(depth, 'depth');
        feature = { layer, depth, shape };
    } else {
        feature = { layer, shape };
    }
    part.features.push(feature);
    return feature;
}

export function addCircle(part, { layer, cx, cy, diameter }) {
    assertOneOf(layer, Layer, 'layer');
    assertNumber(cx, 'cx');
    assertNumber(cy, 'cy');
    assertPositive(diameter, 'diameter');
    const r = diameter / 2;
    assertInside(part, cx - r, cy - r, cx + r, cy + r, `circle ${layer}`);
    const feature = { layer, diameter, shape: { kind: 'circle', cx, cy, r } };
    part.features.push(feature);
    return feature;
}

export function addLabel(part, { text, x, y }) {
    if (typeof text !== 'string' || !text) throw new Error('label text is required');
    assertNumber(x, 'x');
    assertNumber(y, 'y');
    assertInside(part, x, y, x, y, 'label');
    const feature = { layer: Layer.GUIDE, shape: { kind: 'text', x, y, text } };
    part.features.push(feature);
    return feature;
}
