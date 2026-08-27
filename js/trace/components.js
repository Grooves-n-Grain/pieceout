/**
 * Connected-component labelling with an explicit stack (no recursion), and
 * island detection. Black (1) uses 8-connectivity so a diagonal touch still
 * holds wood together; white (0) uses 4-connectivity so a diagonal black
 * touch still separates two cuts.
 *
 * "Body" (the material that stays attached to the machine bed, as opposed to
 * an island that falls out) is normally whatever touches the image border.
 * A drawing scanned with a white margin never touches the border at all, so
 * for black components (colour 1) only: if nothing touches the border, the
 * single largest black component is treated as the body instead (the frame
 * of the drawing), and everything else is still an island.
 *
 * A border-touching component smaller than minBodyAreaPx (a speck riding the
 * edge of the frame) doesn't qualify as a body candidate either - it falls
 * through to the same largest-component fallback as a component that never
 * touched the border at all.
 */

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function labelComponents(bitmap, colour, minBodyAreaPx = 0) {
    if (colour !== 0 && colour !== 1) throw new Error(`colour must be 0 or 1, got ${colour}`);
    const { width: W, height: H, data } = bitmap;
    const labels = new Int32Array(W * H);
    const neighbours = colour === 1 ? N8 : N4;
    const areas = [0];
    const touchesBorder = [false];
    const bboxes = [null];
    const seeds = [null];
    const stack = new Int32Array(W * H);
    let count = 0;

    for (let start = 0; start < W * H; start++) {
        if (data[start] !== colour || labels[start] !== 0) continue;
        count++;
        const id = count;
        let area = 0;
        let border = false;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        let sp = 0;
        stack[sp++] = start;
        labels[start] = id;
        while (sp > 0) {
            const i = stack[--sp];
            const x = i % W;
            const y = (i - x) / W;
            area++;
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            for (const [dx, dy] of neighbours) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                if (data[j] !== colour || labels[j] !== 0) continue;
                labels[j] = id;
                stack[sp++] = j;
            }
        }
        areas.push(area);
        touchesBorder.push(border);
        bboxes.push({ x0, y0, x1, y1 });
        seeds.push([start % W, (start - (start % W)) / W]);
    }

    const body = touchesBorder.map((touches, id) => touches && areas[id] >= minBodyAreaPx);
    if (colour === 1 && count > 0 && !body.some(Boolean)) {
        let maxId = 1;
        for (let id = 2; id <= count; id++) if (areas[id] > areas[maxId]) maxId = id;
        body[maxId] = true;
    }

    return { colour, labels, count, areas, touchesBorder, body, bboxes, seeds };
}

export function findIslands(bitmap, analysis = labelComponents(bitmap, 1)) {
    if (analysis.colour !== 1) throw new Error('findIslands needs a black (colour 1) analysis');
    const islands = [];
    for (let id = 1; id <= analysis.count; id++) {
        if (analysis.body[id]) continue;
        islands.push({ id, area: analysis.areas[id], bbox: analysis.bboxes[id], seed: analysis.seeds[id] });
    }
    return islands.sort((a, b) => b.area - a.area || a.id - b.id);
}
