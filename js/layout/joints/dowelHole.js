/**
 * Through-hole for a dowel, drilled vertically through the part's face.
 * Hole diameter is the *finished* size; Aspire picks peck vs bore.
 */
import { addCircle, Layer } from '../parts.js';

export function dowelHole(part, { x, y, diameter }) {
    return addCircle(part, { layer: Layer.DRILL, cx: x, cy: y, diameter });
}
