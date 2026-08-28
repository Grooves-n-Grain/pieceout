/**
 * Island repair: bridge an island to the body across the shortest white gap,
 * to a specific clicked point, or delete it. Edits are stored as replayable
 * ops keyed by the island's seed pixel so they survive a threshold change.
 */
import { cloneBitmap } from './bitmap.js';
import { labelComponents } from './components.js';

export function stampDisc(bitmap, cx, cy, radius, out) {
    const { width: W, height: H, data } = bitmap;
    const r = Math.max(0, radius);
    const R = Math.ceil(r);
    const r2 = r * r;
    // Clamp the loop bounds to the bitmap instead of looping the full square and skipping
    // out-of-bounds cells one at a time - matters when a disc near an edge has a large radius.
    const dyMin = Math.max(-R, -cy), dyMax = Math.min(R, H - 1 - cy);
    const dxMin = Math.max(-R, -cx), dxMax = Math.min(R, W - 1 - cx);
    for (let dy = dyMin; dy <= dyMax; dy++) {
        for (let dx = dxMin; dx <= dxMax; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const i = (cy + dy) * W + (cx + dx);
            if (out && data[i] === 0) out.push(i);
            data[i] = 1;
        }
    }
}

// Shared BFS: walk outward from the island across white pixels (4-connectivity), treating any
// other black pixel as a wall unless isGoal(j) says otherwise. bridgeIsland's goal is "any body
// pixel"; bridgeIslandTo's goal is "this one specific target pixel". Every neighbour (white or
// black) is marked visited and given a parent before the black/goal check runs, both so a wall
// pixel is never re-examined by another frontier cell and so the goal pixel itself - which is
// black and therefore never pushed onto the frontier - still has a parent to trace the path back
// through once it's found.
function bfsToGoal(bitmap, analysis, islandId, isGoal) {
    const { width: W, height: H, data } = bitmap;
    const { labels } = analysis;
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
                    if (isGoal(j)) { target = j; break; }
                    continue; // wall: another island, or a body pixel that isn't the goal
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
    return path;
}

function stampPath(bitmap, path, widthPx) {
    const out = cloneBitmap(bitmap);
    const radius = Math.max(0, widthPx / 2 - 0.5);
    const stamped = [];
    for (const [x, y] of path) stampDisc(out, x, y, radius, stamped);
    return { bitmap: out, path, stamped };
}

export function bridgeIsland(bitmap, analysis, islandId, widthPx) {
    const { labels, body } = analysis;
    const path = bfsToGoal(bitmap, analysis, islandId, (j) => body[labels[j]]);
    if (!path) return null;
    return stampPath(bitmap, path, widthPx);
}

// Bridge an island to one specific black pixel of the body (a user's click), rather than
// whichever body pixel happens to be nearest. Returns null if the target isn't currently a
// body pixel (off the material entirely, on a different island, or the body/island split has
// changed since the click was made) or if no white path can reach it.
export function bridgeIslandTo(bitmap, analysis, islandId, target, widthPx) {
    const { width: W, height: H, data } = bitmap;
    const { labels, body } = analysis;
    const [tx, ty] = target;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
    const targetIdx = ty * W + tx;
    if (data[targetIdx] !== 1 || !body[labels[targetIdx]]) return null;

    const path = bfsToGoal(bitmap, analysis, islandId, (j) => j === targetIdx);
    if (!path) return null;
    return stampPath(bitmap, path, widthPx);
}

// Nearest body pixel to (x, y) within `radius` (Euclidean, in bitmap pixels), or null. A click
// on a one-pixel-wide feature at screen zoom easily lands on the white beside it; snapping to
// the closest body pixel turns that near miss into the bridge the user meant.
export function nearestBodyPixel(bitmap, analysis, x, y, radius) {
    const { width: W, height: H, data } = bitmap;
    const { labels, body } = analysis;
    const R = Math.ceil(radius);
    let best = null, bestD = radius * radius + 1e-9;
    for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const d = dx * dx + dy * dy;
            if (d >= bestD) continue;
            const i = ny * W + nx;
            if (data[i] === 1 && body[labels[i]]) { best = [nx, ny]; bestD = d; }
        }
    }
    return best;
}

export function deleteIsland(bitmap, analysis, islandId) {
    const out = cloneBitmap(bitmap);
    const { labels } = analysis;
    for (let i = 0; i < labels.length; i++) if (labels[i] === islandId) out.data[i] = 0;
    return out;
}

// A bridge's stamped pixels can land 8-adjacent to a different island's pixels (black
// uses 8-connectivity for adjacency, see components.js), physically fusing that island
// into the body without ever relabelling it. Flag any such neighbour's label as body
// so a later op in the same batch treats it as no longer a standalone island, matching
// what a fresh full relabel would find.
function mergeDiagonalNeighbours(bitmap, analysis, stamped) {
    const { width: W, height: H, data } = bitmap;
    const { labels, body } = analysis;
    for (const i of stamped) {
        const x = i % W, y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const n = ny * W + nx;
                if (data[n] !== 1) continue;
                const otherId = labels[n];
                if (otherId && !body[otherId]) body[otherId] = true;
            }
        }
    }
}

export function applyOps(bitmap, ops, minBodyAreaPx = 0) {
    let current = bitmap;
    const kept = [];
    const dropped = [];
    let fellBack = 0;
    // Label once, then patch the analysis incrementally as ops are applied instead of
    // relabelling the whole bitmap per op (that was O(ops * pixels), dominant cost on a
    // large image with many ops). A delete leaves its island's old labels stale rather than
    // clearing them: those pixels are now white, and every reader below (and bfsToGoal, which
    // walls off other islands only when `data[j] === 1`) only trusts a label when the matching
    // bitmap pixel is still black, so a stale label on a white pixel is inert.
    // A bridge's new material can also land 8-adjacent to a *different* island: black uses
    // 8-connectivity, so that neighbour is now physically fused into the body even though it
    // keeps its own old label. That other label's `body` flag is patched to true below so a
    // later op on it in the same batch is dropped, matching what a full relabel would find.
    // minBodyAreaPx must match the speck threshold the rest of the pipeline uses (see
    // removeSpecks/labelComponents in svg.js): otherwise a border-touching speck too small to
    // survive despeckling could still be picked as the body here, changing what "the body" is
    // for bridging purposes before it gets swept away.
    const a = labelComponents(current, 1, minBodyAreaPx);
    for (const op of ops) {
        const [x, y] = op.seed;
        const inBounds = x >= 0 && y >= 0 && x < current.width && y < current.height;
        const idx = inBounds ? y * current.width + x : -1;
        const id = inBounds ? a.labels[idx] : 0;
        // 'gone': the seed pixel isn't black any more (never was, or a prior op deleted its
        // island out from under it). 'merged': the seed's island is already the body (either
        // it always was, or an earlier op in this batch bridged or diagonally fused it in) -
        // applying this op again would be a no-op, not a failure.
        if (!id || current.data[idx] !== 1) { dropped.push({ op, reason: 'gone' }); continue; }
        if (a.body[id]) { dropped.push({ op, reason: 'merged' }); continue; }
        if (op.kind === 'delete') {
            current = deleteIsland(current, a, id);
            kept.push({ kind: 'delete', seed: op.seed });
        } else if (op.kind === 'bridge') {
            // A targeted bridge tries to land exactly where the user clicked. If the target is
            // no longer reachable (the threshold changed, or it was never reachable across white
            // to begin with), fall back to the nearest-gap search rather than dropping the op
            // outright - but the op no longer means "go to that exact point", so its `target` is
            // dropped and it's flagged `fellBack` for the caller to warn about.
            let r = null;
            let usedFallback = false;
            if (op.target) {
                r = bridgeIslandTo(current, a, id, op.target, op.widthPx);
                if (!r) {
                    r = bridgeIsland(current, a, id, op.widthPx);
                    usedFallback = Boolean(r);
                }
            } else {
                r = bridgeIsland(current, a, id, op.widthPx);
            }
            if (!r) { dropped.push({ op, reason: 'unreachable' }); continue; }
            current = r.bitmap;
            // The island is now part of the body: its bridge pixels join its label, and the
            // label is marked body so later ops can path into it or target it.
            for (const i of r.stamped) a.labels[i] = id;
            a.body[id] = true;
            mergeDiagonalNeighbours(current, a, r.stamped);
            const keptOp = { kind: 'bridge', seed: op.seed, widthPx: op.widthPx, path: r.path };
            if (op.target && !usedFallback) keptOp.target = op.target;
            if (usedFallback) { keptOp.fellBack = true; fellBack++; }
            kept.push(keptOp);
        } else {
            throw new Error(`unknown op kind ${op.kind}`);
        }
    }
    return { bitmap: current, ops: kept, dropped, fellBack };
}
