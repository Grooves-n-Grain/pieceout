/**
 * Shelf packer: rows left to right, tallest parts first, new sheet when the
 * current one is full. Deterministic. Parts with grain along-x are never
 * rotated; grain-any parts rotate 90 degrees only when that makes them fit.
 */
import { Grain, Material } from './parts.js';
import { sheetSize } from './machine.js';

export class NestError extends Error {
    constructor(message, partName) {
        super(message);
        this.name = 'NestError';
        this.part = partName;
    }
}

function rotateShape(shape, H) {
    switch (shape.kind) {
        case 'rect':
            return { kind: 'rect', x: H - shape.y - shape.height, y: shape.x, width: shape.height, height: shape.width };
        case 'circle':
            return { kind: 'circle', cx: H - shape.cy, cy: shape.cx, r: shape.r };
        case 'text':
            return { kind: 'text', x: H - shape.y, y: shape.x, text: shape.text };
        default:
            throw new Error(`Unknown shape kind ${shape.kind}`);
    }
}

/** Return a 90-degree clockwise rotated copy of a single-copy part. */
export function rotatePart(part) {
    const H = part.height;
    return {
        ...part,
        width: part.height,
        height: part.width,
        qty: 1,
        features: part.features.map(f => ({ ...f, shape: rotateShape(f.shape, H) })),
    };
}

function expandCopies(parts) {
    const copies = [];
    for (const part of parts) {
        for (let i = 0; i < part.qty; i++) {
            copies.push({ ...part, name: part.qty > 1 ? `${part.name} ${i + 1}` : part.name, qty: 1 });
        }
    }
    return copies;
}

function byHeightThenWidth(a, b) {
    return b.height - a.height || b.width - a.width || a.name.localeCompare(b.name);
}

function packMaterial(material, copies, machine) {
    const { width: sheetW, height: sheetH } = sheetSize(machine, material);
    const { gutter, edgeMargin } = machine;
    const usableW = sheetW - 2 * edgeMargin;
    const usableH = sheetH - 2 * edgeMargin;
    const maxX = sheetW - edgeMargin;
    const maxY = sheetH - edgeMargin;

    const sheets = [];
    let sheet = null;
    let cursorX = 0, cursorY = 0, rowHeight = 0;

    const newSheet = () => {
        sheet = { material, index: sheets.length + 1, width: sheetW, height: sheetH, placements: [] };
        sheets.push(sheet);
        cursorX = edgeMargin;
        cursorY = edgeMargin;
        rowHeight = 0;
    };
    const newRow = () => {
        cursorX = edgeMargin;
        cursorY += rowHeight + gutter;
        rowHeight = 0;
    };

    const fitsUsable = (p) => p.width <= usableW && p.height <= usableH;

    for (const original of copies.sort(byHeightThenWidth)) {
        let part = original;
        let rotated = false;

        if (!fitsUsable(part)) {
            const alt = part.grain === Grain.ANY ? rotatePart(part) : null;
            if (!alt || !fitsUsable(alt)) {
                throw new NestError(`"${part.name}" (${part.width} x ${part.height} mm) does not fit on the ${material} sheet inside the margins.`, part.name);
            }
            part = alt;
            rotated = true;
        }

        if (!sheet) newSheet();

        // Try the remaining width of the current row, rotating if that is the only way in.
        // The rotated candidate must fit both the row's remaining width and the sheet
        // height measured from the current row's y (its own height may now exceed
        // usableH even though the unrotated part fit, since width/height swap).
        if (cursorX + part.width > maxX) {
            const alt = !rotated && part.grain === Grain.ANY ? rotatePart(part) : null;
            if (alt && cursorX + alt.width <= maxX && cursorY + alt.height <= maxY) {
                part = alt;
                rotated = true;
            } else {
                newRow();
            }
        }
        if (cursorY + part.height > maxY) {
            newSheet();
        }

        sheet.placements.push({ part, x: cursorX, y: cursorY, rotated });
        cursorX += part.width + gutter;
        rowHeight = Math.max(rowHeight, part.height);
    }
    return sheets;
}

export function nest(parts, machine) {
    const copies = expandCopies(parts);
    const sheets = [];
    for (const material of Object.values(Material)) {
        const group = copies.filter(c => c.material === material);
        if (group.length) sheets.push(...packMaterial(material, group, machine));
    }
    return sheets;
}
