/**
 * Island repair: bridge an island to the body across the shortest white gap,
 * or delete it. Edits are stored as replayable ops keyed by the island's seed
 * pixel so they survive a threshold change.
 */
import { cloneBitmap } from './bitmap.js';
import { labelComponents } from './components.js';

export function stampDisc(bitmap, cx, cy, radius, out) {
    const { width: W, height: H, data } = bitmap;
    const r = Math.max(0, radius);
    const R = Math.ceil(r);
    const r2 = r * r;
    for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = y * W + x;
            if (out && data[i] === 0) out.push(i);
            data[i] = 1;
        }
    }
}

export function bridgeIsland(bitmap, analysis, islandId, widthPx) {
    const { width: W, height: H, data } = bitmap;
    const { labels, touchesBorder } = analysis;
    const N = W * H;
    const parent = new Int32Array(N).fill(-1);
    const visited = new Uint8Array(N);
    let frontier = [];
    for (let i = 0; i < N; i++) {
        if (labels[i] === islandId) { visited[i] = 1; frontier.push(i); }
    }
    let target = -1;
    while (frontier.length && target < 0) {
        const next = [];
        for (const i of frontier) {
            const x = i % W, y = (i - x) / W;
            const around = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
            for (const [nx, ny] of around) {
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                if (visited[j]) continue;
                visited[j] = 1;
                parent[j] = i;
                if (data[j] === 1) {
                    if (touchesBorder[labels[j]]) { target = j; break; }
                    continue; // another island: wall
                }
                next.push(j);
            }
            if (target >= 0) break;
        }
        frontier = next;
    }
    if (target < 0) return null;

    const path = [];
    for (let p = target; p >= 0 && labels[p] !== islandId; p = parent[p]) path.push([p % W, (p - (p % W)) / W]);
    path.reverse();
    const out = cloneBitmap(bitmap);
    const radius = Math.max(0, widthPx / 2 - 0.5);
    const stamped = [];
    for (const [x, y] of path) stampDisc(out, x, y, radius, stamped);
    return { bitmap: out, path, stamped };
}

export function deleteIsland(bitmap, analysis, islandId) {
    const out = cloneBitmap(bitmap);
    const { labels } = analysis;
    for (let i = 0; i < labels.length; i++) if (labels[i] === islandId) out.data[i] = 0;
    return out;
}

export function applyOps(bitmap, ops) {
    let current = bitmap;
    const kept = [];
    // Label once, then patch the analysis incrementally as ops are applied instead of
    // relabelling the whole bitmap per op (that was O(ops * pixels), dominant cost on a
    // large image with many ops). A delete leaves its island's old labels stale rather than
    // clearing them: those pixels are now white, and every reader below (and bridgeIsland's
    // BFS, which walls off other islands only when `data[j] === 1`) only trusts a label when
    // the matching bitmap pixel is still black, so a stale label on a white pixel is inert.
    const a = labelComponents(current, 1);
    for (const op of ops) {
        const [x, y] = op.seed;
        const inBounds = x >= 0 && y >= 0 && x < current.width && y < current.height;
        const idx = inBounds ? y * current.width + x : -1;
        const id = inBounds ? a.labels[idx] : 0;
        if (!id || a.touchesBorder[id] || current.data[idx] !== 1) continue;
        if (op.kind === 'delete') {
            current = deleteIsland(current, a, id);
            kept.push({ kind: 'delete', seed: op.seed });
        } else if (op.kind === 'bridge') {
            const r = bridgeIsland(current, a, id, op.widthPx);
            if (!r) continue;
            current = r.bitmap;
            // The island is now part of the body: its bridge pixels join its label, and the
            // label is marked border-touching so later ops can path into it or target it.
            for (const i of r.stamped) a.labels[i] = id;
            a.touchesBorder[id] = true;
            kept.push({ kind: 'bridge', seed: op.seed, widthPx: op.widthPx, path: r.path });
        } else {
            throw new Error(`unknown op kind ${op.kind}`);
        }
    }
    return { bitmap: current, ops: kept };
}
