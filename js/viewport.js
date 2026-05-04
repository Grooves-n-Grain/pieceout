/**
 * Viewport - handles zoom, pan, and click interactions on the SVG canvas
 */

let viewState = {
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    // Original bounds for "fit to view"
    origX: 0,
    origY: 0,
    origWidth: 1000,
    origHeight: 1000,
};

let isPanning = false;
let panStart = { x: 0, y: 0 };
let canvasEl = null;

const ZOOM_FACTOR = 1.15;
const MIN_ZOOM = 0.01;  // Can zoom in to 1% of original
const MAX_ZOOM = 50;     // Can zoom out to 50x original

/**
 * Initialize viewport controls on the SVG canvas.
 */
export function initViewport(canvas) {
    canvasEl = canvas;
    const container = canvas.parentElement;

    // Mouse wheel zoom
    container.addEventListener('wheel', onWheel, { passive: false });

    // Pan with middle-click or left-click drag
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);

    // Touch support
    let lastTouchDist = 0;
    let lastTouchCenter = { x: 0, y: 0 };

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            lastTouchCenter = {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2,
            };
        } else if (e.touches.length === 1) {
            isPanning = true;
            panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const center = {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2,
            };

            if (lastTouchDist > 0) {
                const scale = lastTouchDist / dist;
                zoomAt(center.x, center.y, scale);
            }
            lastTouchDist = dist;
            lastTouchCenter = center;
        } else if (e.touches.length === 1 && isPanning) {
            e.preventDefault();
            const dx = e.touches[0].clientX - panStart.x;
            const dy = e.touches[0].clientY - panStart.y;
            pan(dx, dy);
            panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    }, { passive: false });

    container.addEventListener('touchend', () => {
        isPanning = false;
        lastTouchDist = 0;
    });
}

/**
 * Set the initial viewBox from parsed SVG bounds.
 */
export function setInitialView(bounds) {
    // Add some padding
    const pad = Math.max(bounds.width, bounds.height) * 0.05;
    let vx = bounds.x - pad;
    let vy = bounds.y - pad;
    let vw = bounds.width + pad * 2;
    let vh = bounds.height + pad * 2;

    // Match viewBox aspect ratio to container so content appears centered and fills the view
    if (canvasEl) {
        const rect = canvasEl.parentElement.getBoundingClientRect();
        if (rect.width && rect.height) {
            const containerAspect = rect.width / rect.height;
            const contentAspect = vw / vh;

            if (containerAspect > contentAspect) {
                // Container is wider — expand viewBox width
                const newWidth = vh * containerAspect;
                vx -= (newWidth - vw) / 2;
                vw = newWidth;
            } else {
                // Container is taller — expand viewBox height
                const newHeight = vw / containerAspect;
                vy -= (newHeight - vh) / 2;
                vh = newHeight;
            }
        }
    }

    viewState = {
        x: vx, y: vy, width: vw, height: vh,
        origX: vx, origY: vy, origWidth: vw, origHeight: vh,
    };
    applyViewBox();
}

/**
 * Zoom in by one step.
 */
export function zoomIn() {
    const cx = viewState.x + viewState.width / 2;
    const cy = viewState.y + viewState.height / 2;
    zoom(1 / ZOOM_FACTOR, cx, cy);
}

/**
 * Zoom out by one step.
 */
export function zoomOut() {
    const cx = viewState.x + viewState.width / 2;
    const cy = viewState.y + viewState.height / 2;
    zoom(ZOOM_FACTOR, cx, cy);
}

/**
 * Fit the view to show the entire SVG.
 */
export function zoomFit() {
    viewState.x = viewState.origX;
    viewState.y = viewState.origY;
    viewState.width = viewState.origWidth;
    viewState.height = viewState.origHeight;
    applyViewBox();
}

// --- Internal handlers ---

function onWheel(e) {
    e.preventDefault();
    const rect = canvasEl.parentElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    zoomAt(e.clientX, e.clientY, factor);
}

function onMouseDown(e) {
    // Pan with left button or middle button
    if (e.button === 0 || e.button === 1) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        canvasEl.parentElement.style.cursor = 'grabbing';
        e.preventDefault();
    }
}

function onMouseMove(e) {
    if (!isPanning) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    pan(dx, dy);
    panStart = { x: e.clientX, y: e.clientY };
}

function onMouseUp() {
    isPanning = false;
    if (canvasEl) {
        canvasEl.parentElement.style.cursor = '';
    }
}

function zoomAt(clientX, clientY, factor) {
    const rect = canvasEl.parentElement.getBoundingClientRect();

    // Convert mouse position to SVG coordinates
    const fracX = (clientX - rect.left) / rect.width;
    const fracY = (clientY - rect.top) / rect.height;

    const svgX = viewState.x + fracX * viewState.width;
    const svgY = viewState.y + fracY * viewState.height;

    zoom(factor, svgX, svgY);
}

function zoom(factor, centerX, centerY) {
    const newWidth = viewState.width * factor;
    const newHeight = viewState.height * factor;

    // Clamp zoom level
    const zoomRatio = newWidth / viewState.origWidth;
    if (zoomRatio < MIN_ZOOM || zoomRatio > MAX_ZOOM) return;

    viewState.x = centerX - (centerX - viewState.x) * factor;
    viewState.y = centerY - (centerY - viewState.y) * factor;
    viewState.width = newWidth;
    viewState.height = newHeight;

    applyViewBox();
}

function pan(dx, dy) {
    const rect = canvasEl.parentElement.getBoundingClientRect();
    // Convert pixel delta to SVG coordinate delta
    const scaleX = viewState.width / rect.width;
    const scaleY = viewState.height / rect.height;

    viewState.x -= dx * scaleX;
    viewState.y -= dy * scaleY;

    applyViewBox();
}

function applyViewBox() {
    if (!canvasEl) return;
    canvasEl.setAttribute('viewBox',
        `${viewState.x} ${viewState.y} ${viewState.width} ${viewState.height}`
    );
}
