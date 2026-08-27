/**
 * Crack-following contour tracer. Emits unit edges along pixel boundaries with
 * the white component on the right-hand side of travel (y down), links them
 * into closed loops, and classifies loops by sign of area.
 */
import { labelComponents } from './components.js';

export function signedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
}

// Direction of a unit edge between corner indices: 0 right, 1 down, 2 left, 3 up.
function direction(from, to, VW) {
    if (to === from + 1) return 0;
    if (to === from + VW) return 1;
    if (to === from - 1) return 2;
    return 3;
}

function linkEdges(flat, VW) {
    const n = flat.length / 2;
    const outgoing = new Map();
    for (let i = 0; i < n; i++) {
        const from = flat[2 * i];
        const list = outgoing.get(from);
        if (list) list.push(i); else outgoing.set(from, [i]);
    }
    const used = new Uint8Array(n);
    const loops = [];
    for (let start = 0; start < n; start++) {
        if (used[start]) continue;
        const loop = [];
        let e = start;
        while (e >= 0 && !used[e]) {
            used[e] = 1;
            const from = flat[2 * e], to = flat[2 * e + 1];
            loop.push([from % VW, (from - (from % VW)) / VW]);
            const dir = direction(from, to, VW);
            let next = -1, bestScore = -1;
            for (const c of outgoing.get(to) || []) {
                if (used[c]) continue;
                const turn = (direction(flat[2 * c], flat[2 * c + 1], VW) - dir + 4) % 4;
                const score = turn === 1 ? 3 : turn === 0 ? 2 : turn === 3 ? 1 : 0; // right, straight, left, back
                if (score > bestScore) { bestScore = score; next = c; }
            }
            e = next;
        }
        loops.push(loop);
    }
    return loops;
}

export function traceContours(bitmap, whiteAnalysis = labelComponents(bitmap, 0)) {
    const { width: W, height: H } = bitmap;
    const { labels, count, areas, touchesBorder } = whiteAnalysis;
    const VW = W + 1;
    const edges = Array.from({ length: count + 1 }, () => []);
    const lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : labels[y * W + x];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const id = labels[y * W + x];
            if (!id) continue;
            const tl = y * VW + x, tr = tl + 1, bl = tl + VW, br = bl + 1;
            const list = edges[id];
            if (lab(x, y - 1) !== id) list.push(tl, tr);
            if (lab(x + 1, y) !== id) list.push(tr, br);
            if (lab(x, y + 1) !== id) list.push(br, bl);
            if (lab(x - 1, y) !== id) list.push(bl, tl);
        }
    }

    const contours = [];
    for (let id = 1; id <= count; id++) {
        const contour = { id, area: areas[id], touchesBorder: touchesBorder[id], outer: null, holes: [] };
        for (const loop of linkEdges(edges[id], VW)) {
            if (loop.length < 4) continue;
            if (signedArea(loop) > 0) {
                if (contour.outer) throw new Error(`component ${id} produced two outer loops`);
                contour.outer = loop;
            } else {
                contour.holes.push(loop);
            }
        }
        if (!contour.outer) throw new Error(`component ${id} produced no outer loop`);
        contours.push(contour);
    }
    return contours;
}
