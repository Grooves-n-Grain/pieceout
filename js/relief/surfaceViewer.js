import * as THREE from '../vendor/three/three.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

export function createSurfaceViewer(host) {
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { throw new Error('3D needs WebGL support. The shaded and heightmap views are still available.'); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', '3D relief. Drag to rotate; right-drag or two-finger drag to pan; scroll or pinch to zoom.');
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.49;
    const material = new THREE.MeshStandardMaterial({ color: 0xc4a265, roughness: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    scene.add(mesh, new THREE.HemisphereLight(0xffffff, 0x555566, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(-1, -1, 1);
    scene.add(light);
    let dimensions = null, lastKey = null;
    const render = () => { if (host.clientWidth && host.clientHeight) renderer.render(scene, camera); };
    controls.addEventListener('change', render);
    function resize() {
        if (!host.clientWidth || !host.clientHeight) return;
        camera.aspect = host.clientWidth / host.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight, false);
        render();
    }
    function fit() {
        if (!dimensions) return;
        const { width_mm: width, height_mm: height, depth_mm: depth } = dimensions;
        const span = Math.max(width, height, depth);
        const distance = Math.max(height, width / camera.aspect, depth) * 1.7;
        controls.target.set(0, 0, -depth / 2);
        camera.position.set(0, -distance * 0.65, distance);
        camera.near = Math.max(0.001, span / 10000);
        camera.far = span * 100;
        controls.minDistance = span * 0.02;
        controls.maxDistance = span * 20;
        camera.updateProjectionMatrix();
        controls.update();
        render();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        host.parentElement.querySelector('[role="status"]').textContent = '3D graphics were interrupted. Reload the page or use Shaded relief.';
    });
    return {
        resize, fit,
        zoom(factor) {
            const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
            offset.clampLength(controls.minDistance, controls.maxDistance);
            camera.position.copy(controls.target).add(offset);
            controls.update();
            render();
        },
        setSurface(data, key) {
            const { cols, rows, surface, width_mm: width, height_mm: height, depth_mm: depth } = data;
            if (![cols, rows].every(v => Number.isInteger(v) && v >= 2 && v <= 192)
                || ![width, height, depth].every(v => Number.isFinite(v) && v > 0)
                || !Array.isArray(surface) || surface.length !== cols * rows
                || !surface.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
                throw new Error('The 3D surface data is invalid. Try regenerating the relief.');
            }
            const geometry = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1);
            const positions = geometry.attributes.position;
            surface.forEach((v, i) => positions.setZ(i, (v - 1) * depth));
            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            mesh.geometry.dispose();
            mesh.geometry = geometry;
            const refit = lastKey !== key || dimensions?.width_mm !== width || dimensions?.height_mm !== height;
            dimensions = data;
            lastKey = key;
            resize();
            if (refit) fit();
            else render();
        },
        dispose() {
            observer.disconnect();
            controls.dispose();
            mesh.geometry.dispose();
            material.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}
