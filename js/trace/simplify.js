/** Ramer-Douglas-Peucker for closed polygons. Iterative, no recursion. */

function perpDistance(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return Math.hypot(p[0] - px, p[1] - py);
}

/** Open chain RDP: returns the kept points including both ends. */
function rdpOpen(pts, tol) {
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        let maxD = -1, idx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = perpDistance(pts[i], pts[s], pts[e]);
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (idx >= 0 && maxD > tol) {
            keep[idx] = 1;
            stack.push([s, idx], [idx, e]);
        }
    }
    return pts.filter((_, i) => keep[i]);
}

export function simplifyPolygon(points, tolerancePx) {
    if (points.length <= 3) return points.slice();
    let far = 1, best = -1;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[0][0], dy = points[i][1] - points[0][1];
        const d = dx * dx + dy * dy;
        if (d > best) { best = d; far = i; }
    }
    const a = rdpOpen(points.slice(0, far + 1), tolerancePx);
    const b = rdpOpen(points.slice(far).concat([points[0]]), tolerancePx);
    const out = a.concat(b.slice(1, -1));
    if (out.length >= 3) return out;
    let thirdIdx = -1, thirdDist = 0;
    for (let i = 0; i < points.length; i++) {
        if (i === 0 || i === far) continue;
        const d = perpDistance(points[i], points[0], points[far]);
        if (d > thirdDist) { thirdDist = d; thirdIdx = i; }
    }
    if (thirdIdx >= 0) return [points[0], points[far], points[thirdIdx]];
    const fallbackIdx = Math.max(1, far - 1) === far ? 0 : far - 1;
    const candidate = points[fallbackIdx];
    const distinctFromFirst = candidate[0] !== points[0][0] || candidate[1] !== points[0][1];
    const distinctFromFar = candidate[0] !== points[far][0] || candidate[1] !== points[far][1];
    return distinctFromFirst && distinctFromFar ? [points[0], points[far], candidate] : points.slice();
}
