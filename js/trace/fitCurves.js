/**
 * Cubic Bezier fitting for closed polygons (Schneider, "An Algorithm for
 * Automatically Fitting Digitized Curves", Graphics Gems 1990). Corners split
 * the polygon into open chains; each chain is fitted by least squares with
 * Newton reparameterisation and recursive splitting at the worst point.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
function normalize(a) {
    const l = len(a);
    return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
}

export function bezierPoint([p0, p1, p2, p3], t) {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function bezierDerivative1([p0, p1, p2, p3], t) {
    const mt = 1 - t;
    const q0 = scale(sub(p1, p0), 3), q1 = scale(sub(p2, p1), 3), q2 = scale(sub(p3, p2), 3);
    return add(add(scale(q0, mt * mt), scale(q1, 2 * mt * t)), scale(q2, t * t));
}

function bezierDerivative2([p0, p1, p2, p3], t) {
    const r0 = scale(add(sub(p2, scale(p1, 2)), p0), 6);
    const r1 = scale(add(sub(p3, scale(p2, 2)), p1), 6);
    return add(scale(r0, 1 - t), scale(r1, t));
}

function chordLengthParameterize(d, first, last) {
    const u = [0];
    for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + Math.sqrt(dist2(d[i], d[i - 1])));
    const total = u[u.length - 1] || 1;
    return u.map(v => v / total);
}

function generateBezier(d, first, last, u, tHat1, tHat2) {
    const n = last - first + 1;
    const A = new Array(n);
    for (let i = 0; i < n; i++) {
        const t = u[i], mt = 1 - t;
        A[i] = [scale(tHat1, 3 * mt * mt * t), scale(tHat2, 3 * mt * t * t)];
    }
    const C = [[0, 0], [0, 0]];
    const X = [0, 0];
    for (let i = 0; i < n; i++) {
        const t = u[i], mt = 1 - t;
        C[0][0] += dot(A[i][0], A[i][0]);
        C[0][1] += dot(A[i][0], A[i][1]);
        C[1][1] += dot(A[i][1], A[i][1]);
        const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
        const onChord = add(scale(d[first], b0 + b1), scale(d[last], b2 + b3));
        const tmp = sub(d[first + i], onChord);
        X[0] += dot(A[i][0], tmp);
        X[1] += dot(A[i][1], tmp);
    }
    C[1][0] = C[0][1];
    const detC0C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
    const detC0X = C[0][0] * X[1] - C[1][0] * X[0];
    const detXC1 = X[0] * C[1][1] - X[1] * C[0][1];
    let alphaL = detC0C1 === 0 ? 0 : detXC1 / detC0C1;
    let alphaR = detC0C1 === 0 ? 0 : detC0X / detC0C1;
    const segLength = Math.sqrt(dist2(d[last], d[first]));
    const epsilon = 1e-6 * segLength;
    if (alphaL < epsilon || alphaR < epsilon) {
        alphaL = alphaR = segLength / 3;
    }
    return [d[first], add(d[first], scale(tHat1, alphaL)), add(d[last], scale(tHat2, alphaR)), d[last]];
}

function computeMaxError(d, first, last, bez, u) {
    let maxDist = 0;
    let split = Math.floor((last - first + 1) / 2) + first;
    for (let i = first + 1; i < last; i++) {
        const p = bezierPoint(bez, u[i - first]);
        const dd = dist2(p, d[i]);
        if (dd > maxDist) { maxDist = dd; split = i; }
    }
    return { maxError2: maxDist, split };
}

function newtonRaphson(bez, p, u) {
    const q = bezierPoint(bez, u);
    const q1 = bezierDerivative1(bez, u);
    const q2 = bezierDerivative2(bez, u);
    const diff = sub(q, p);
    const numerator = dot(diff, q1);
    const denominator = dot(q1, q1) + dot(diff, q2);
    if (denominator === 0) return u;
    return u - numerator / denominator;
}

function reparameterize(d, first, last, u, bez) {
    return u.map((ui, i) => newtonRaphson(bez, d[first + i], ui));
}

function fitCubic(d, first, last, tHat1, tHat2, error2, out) {
    if (last - first === 1) {
        const dist = Math.sqrt(dist2(d[last], d[first])) / 3;
        out.push([d[first], add(d[first], scale(tHat1, dist)), add(d[last], scale(tHat2, dist)), d[last]]);
        return;
    }
    let u = chordLengthParameterize(d, first, last);
    let bez = generateBezier(d, first, last, u, tHat1, tHat2);
    let { maxError2, split } = computeMaxError(d, first, last, bez, u);
    if (maxError2 < error2) { out.push(bez); return; }
    if (maxError2 < error2 * 4) {
        for (let i = 0; i < 4; i++) {
            u = reparameterize(d, first, last, u, bez);
            bez = generateBezier(d, first, last, u, tHat1, tHat2);
            ({ maxError2, split } = computeMaxError(d, first, last, bez, u));
            if (maxError2 < error2) { out.push(bez); return; }
        }
    }
    const tHatCenter = normalize(sub(d[split - 1], d[split + 1]));
    fitCubic(d, first, split, tHat1, tHatCenter, error2, out);
    fitCubic(d, split, last, scale(tHatCenter, -1), tHat2, error2, out);
}

/** Fit one open chain of points (first and last are end points). */
function fitChain(pts, error2, tHat1, tHat2, out) {
    fitCubic(pts, 0, pts.length - 1, tHat1, tHat2, error2, out);
}

function interiorAngleDeg(prev, p, next) {
    const a = normalize(sub(prev, p)), b = normalize(sub(next, p));
    const c = Math.max(-1, Math.min(1, dot(a, b)));
    return Math.acos(c) * 180 / Math.PI;
}

export function fitBeziers(points, errorPx, cornerAngleDeg = 100) {
    const n = points.length;
    if (n < 3) throw new Error('fitBeziers needs a closed polygon with at least 3 points');
    const error2 = errorPx * errorPx;
    const corners = [];
    for (let i = 0; i < n; i++) {
        if (interiorAngleDeg(points[(i + n - 1) % n], points[i], points[(i + 1) % n]) < cornerAngleDeg) corners.push(i);
    }
    const out = [];
    if (corners.length === 0) {
        const chain = points.concat([points[0]]);
        const tHat1 = normalize(sub(points[1], points[n - 1]));
        fitChain(chain, error2, tHat1, scale(tHat1, -1), out);
        return out;
    }
    for (let k = 0; k < corners.length; k++) {
        const s = corners[k], e = corners[(k + 1) % corners.length];
        const chain = [];
        for (let i = s; ; i = (i + 1) % n) {
            chain.push(points[i]);
            if (i === e) break;
        }
        if (chain.length === 1) continue;
        const tHat1 = normalize(sub(chain[1], chain[0]));
        const tHat2 = normalize(sub(chain[chain.length - 2], chain[chain.length - 1]));
        fitChain(chain, error2, tHat1, tHat2, out);
    }
    return out;
}
