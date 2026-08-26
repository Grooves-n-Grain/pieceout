/**
 * End half-lap: a pocket across the full part width at one end, cut from the
 * top face. Two rails lapped at a corner mate when one is flipped at assembly.
 */
import { addRect, Layer } from '../parts.js';

function assertPositive(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number, got ${value}`);
    }
}

export function halfLap(part, end, { depth, length }) {
    if (end !== 'start' && end !== 'end') {
        throw new Error(`halfLap end must be 'start' or 'end', got ${end}`);
    }
    assertPositive(depth, 'depth');
    assertPositive(length, 'length');
    const x = end === 'start' ? 0 : part.width - length;
    return addRect(part, { layer: Layer.POCKET, x, y: 0, width: length, height: part.height, depth });
}
