import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyPolygon } from '../../js/trace/simplify.js';
import { fitBeziers, bezierPoint } from '../../js/trace/fitCurves.js';

function unitSquareLoop(size) {
    const pts = [];
    for (let x = 0; x < size; x++) pts.push([x, 0]);
    for (let y = 0; y < size; y++) pts.push([size, y]);
    for (let x = size; x > 0; x--) pts.push([x, size]);
    for (let y = size; y > 0; y--) pts.push([0, y]);
    return pts;
}

function circle(n, r, cx = 100, cy = 100) {
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
}

function minDistanceToSegments(p, segments) {
    let best = Infinity;
    for (const seg of segments) {
        for (let i = 0; i <= 100; i++) {
            const q = bezierPoint(seg, i / 100);
            best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
        }
    }
    return best;
}

test('simplifyPolygon collapses a pixel-edge square to 4 corners', () => {
    const out = simplifyPolygon(unitSquareLoop(5), 0.5);
    assert.deepEqual(out, [[0, 0], [5, 0], [5, 5], [0, 5]]);
});

test('simplifyPolygon keeps at least 3 points and respects tolerance', () => {
    assert.equal(simplifyPolygon([[0, 0], [1, 0], [0, 1]], 10).length, 3);
    const coarse = simplifyPolygon(circle(64, 50), 2.5).length;
    const fine = simplifyPolygon(circle(64, 50), 0.2).length;
    assert.ok(coarse < fine, `coarse ${coarse} should have fewer points than fine ${fine}`);
    assert.ok(coarse >= 8 && coarse <= 24, `coarse circle kept ${coarse} points`);
});

test('fitBeziers fits a circle with few segments inside the error bound', () => {
    const pts = circle(64, 50);
    const segs = fitBeziers(pts, 0.5);
    assert.ok(segs.length >= 3 && segs.length <= 12, `got ${segs.length} segments`);
    for (const p of pts) assert.ok(minDistanceToSegments(p, segs) <= 0.6, 'point within tolerance');
    for (let i = 0; i < segs.length; i++) {
        const next = segs[(i + 1) % segs.length];
        assert.deepEqual(segs[i][3], next[0], 'segments chain and close');
    }
});

test('fitBeziers keeps corners of a square as straight segments', () => {
    const segs = fitBeziers([[0, 0], [10, 0], [10, 10], [0, 10]], 0.5);
    assert.equal(segs.length, 4);
    for (const [p0, p1, p2, p3] of segs) {
        const cross = (a, b) => (a[0] - p0[0]) * (b[1] - p0[1]) - (a[1] - p0[1]) * (b[0] - p0[0]);
        assert.ok(Math.abs(cross(p1, p3)) < 1e-6 && Math.abs(cross(p2, p3)) < 1e-6, 'control points on the chord');
    }
});

test('bezierPoint evaluates end points and midpoint', () => {
    const seg = [[0, 0], [0, 10], [10, 10], [10, 0]];
    assert.deepEqual(bezierPoint(seg, 0), [0, 0]);
    assert.deepEqual(bezierPoint(seg, 1), [10, 0]);
    assert.deepEqual(bezierPoint(seg, 0.5), [5, 7.5]);
});
