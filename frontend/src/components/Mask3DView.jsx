import { useEffect, useRef, useState, useImperativeHandle } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cropMask } from "../utils/meshing";

const MESH_COLOR = 0xd64545;
const GIZMO_SIZE = 88; // px
const REBUILD_DELAY = 150; // ms, debounces slider drags

// Patient axes in world (RAS) space: +x right, +y anterior, +z superior
const GIZMO_AXES = [
  { label: "R", dir: [1, 0, 0], color: 0xff5c5c },
  { label: "A", dir: [0, 1, 0], color: 0x5cd65c },
  { label: "S", dir: [0, 0, 1], color: 0x6b9bff },
];

function makeLabelSprite(text, color, disposables) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(text, 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  disposables.push(texture, material);

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.55, 0.55, 1);
  return sprite;
}

/**
 * Mask3DView - interactive 3D surface rendering of a binary mask volume.
 *
 * The surface is built in a Web Worker and placed in world (RAS, mm) space using
 * the scan's affine, so proportions are correct for anisotropic voxels.
 *
 * Props:
 * @param {Float32Array} mask - Mask volume, mask[(x*Y + y)*Z + z]
 * @param {number[]} shape - Volume dimensions [X, Y, Z]
 * @param {{ affine: number[][] }} geometry - Voxel-to-world affine (4×4, row-major)
 * @param {number} maskVersion - Changes whenever the mask's voxels are edited in place
 * @param {"voxels"|"marchingCubes"} method - Surface extraction algorithm
 * @param {"none"|"laplacian"|"taubin"} smoothing - Mesh smoothing algorithm
 * @param {number} iterations - Smoothing iterations
 * @param {number} opacity - Surface opacity (0-1); 0 hides the surface
 * @param {boolean} wireframe - Draw triangle edges over the surface (unaffected by opacity)
 * @param {boolean} isLoading - Show loading spinner overlay
 * @param {React.Ref} ref - Exposes `resetView()`
 */
export default function Mask3DView({
  mask,
  shape,
  geometry,
  maskVersion = 0,
  method = "marchingCubes",
  smoothing = "taubin",
  iterations = 10,
  opacity = 1,
  wireframe = false,
  isLoading = false,
  ref,
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null); // { group, mesh, wireMesh, material, requestRender, frameView }
  const workerRef = useRef(null);
  const requestId = useRef(0);
  // Inputs the worker's current mask crop was built from
  const cropState = useRef({ mask: null, version: -1, geometry: null, key: 0, empty: false });
  const needsFrame = useRef(true);

  const [status, setStatus] = useState("idle"); // idle | building | ready | empty | error
  const [triangles, setTriangles] = useState(0);

  useImperativeHandle(ref, () => ({
    resetView: () => viewRef.current?.frameView(),
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // Scene, camera, controls and worker (once per mount)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const disposables = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.autoClear = false;
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1); // superior up
    camera.position.set(0, 400, 0);
    scene.add(camera);

    // Headlight that follows the camera
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const headlight = new THREE.DirectionalLight(0xffffff, 2.2);
    headlight.position.set(0.4, 0.6, 1);
    headlight.target.position.set(0, 0, -1);
    camera.add(headlight, headlight.target);

    const material = new THREE.MeshStandardMaterial({
      color: MESH_COLOR,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
      // Push the surface back slightly so the wireframe drawn over it does not flicker
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const wireMaterial = new THREE.MeshStandardMaterial({
      color: MESH_COLOR,
      roughness: 0.6,
      metalness: 0.05,
      side: THREE.DoubleSide,
      wireframe: true,
    });

    // Surface and wireframe share one geometry; the group is hidden until a mesh is built
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const wireMesh = new THREE.Mesh(mesh.geometry, wireMaterial);
    const group = new THREE.Group();
    group.add(mesh, wireMesh);
    group.visible = false;
    scene.add(group);

    const controls = new OrbitControls(camera, renderer.domElement);

    // Orientation gizmo (bottom-left corner)
    const gizmoScene = new THREE.Scene();
    const gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    gizmoCamera.up.set(0, 0, 1);
    for (const { label, dir, color } of GIZMO_AXES) {
      const direction = new THREE.Vector3(...dir);
      const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(), 1, color, 0.28, 0.16);
      disposables.push(arrow);
      const sprite = makeLabelSprite(label, color, disposables);
      sprite.position.copy(direction).multiplyScalar(1.3);
      gizmoScene.add(arrow, sprite);
    }

    // Render on demand, not in a continuous loop
    let frameHandle = 0;
    const render = () => {
      frameHandle = 0;
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.clear();
      renderer.render(scene, camera);

      renderer.clearDepth();
      renderer.setViewport(8, 8, GIZMO_SIZE, GIZMO_SIZE);
      gizmoCamera.position.copy(camera.position).sub(controls.target).setLength(4);
      gizmoCamera.lookAt(0, 0, 0);
      renderer.render(gizmoScene, gizmoCamera);
    };
    const requestRender = () => {
      if (!frameHandle) frameHandle = requestAnimationFrame(render);
    };
    controls.addEventListener("change", requestRender);

    // View the mesh from anterior, fitted to the viewport
    const frameView = () => {
      const sphere = mesh.geometry.boundingSphere;
      if (!group.visible || !sphere || !(sphere.radius > 0)) return;
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const fit = Math.min(vFov, 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect));
      const distance = (sphere.radius / Math.sin(fit / 2)) * 1.1;

      controls.target.copy(sphere.center);
      camera.position.set(sphere.center.x, sphere.center.y + distance, sphere.center.z);
      camera.near = distance / 100;
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    };

    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render(); // resizing clears the canvas
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const worker = new Worker(new URL("../workers/meshWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.id !== requestId.current) return; // superseded by a newer request
      if (data.error) {
        console.error("Mesh build failed:", data.error);
        setStatus("error");
        return;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();

      mesh.geometry.dispose();
      mesh.geometry = geo;
      wireMesh.geometry = geo;
      group.visible = true;

      if (needsFrame.current) {
        needsFrame.current = false;
        frameView();
      }
      setTriangles(data.indices.length / 3);
      setStatus("ready");
      requestRender();
    };
    worker.onerror = (e) => {
      console.error("Mesh worker error:", e.message);
      setStatus("error");
    };

    workerRef.current = worker;
    viewRef.current = { group, mesh, wireMesh, material, requestRender, frameView };
    // A new worker has no mask data yet
    cropState.current = { mask: null, version: -1, geometry: null, key: 0, empty: false };
    needsFrame.current = true;

    return () => {
      workerRef.current = null;
      viewRef.current = null;
      worker.terminate();
      resizeObserver.disconnect();
      if (frameHandle) cancelAnimationFrame(frameHandle);
      controls.dispose();
      mesh.geometry.dispose();
      material.dispose();
      wireMaterial.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Re-fit the camera for a different volume; edits and setting changes keep the viewpoint
  useEffect(() => {
    needsFrame.current = true;
  }, [mask, geometry]);

  // ───────────────────────────────────────────────────────────────────────────
  // (Re)build the mesh when the mask or the surface settings change
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mask || !shape || !geometry) return;

    const timer = setTimeout(() => {
      const worker = workerRef.current;
      const view = viewRef.current;
      if (!worker || !view) return;

      const id = ++requestId.current;
      const state = cropState.current;

      // Re-crop and re-send the mask only when its voxels changed
      let crop;
      if (state.mask !== mask || state.version !== maskVersion || state.geometry !== geometry) {
        crop = cropMask(mask, shape);
        state.mask = mask;
        state.version = maskVersion;
        state.geometry = geometry;
        state.key += 1;
        state.empty = !crop;
      }

      if (state.empty) {
        view.group.visible = false;
        view.requestRender();
        setTriangles(0);
        setStatus("empty");
        return;
      }

      setStatus("building");
      worker.postMessage(
        { id, cropKey: state.key, crop, affine: geometry.affine, method, smoothing, iterations },
        crop ? [crop.data.buffer] : [],
      );
    }, REBUILD_DELAY);

    return () => clearTimeout(timer);
  }, [mask, shape, geometry, maskVersion, method, smoothing, iterations]);

  // ───────────────────────────────────────────────────────────────────────────
  // Appearance
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const { material, mesh, wireMesh } = view;
    material.opacity = opacity;
    material.transparent = opacity < 1;
    material.depthWrite = opacity >= 1;
    mesh.visible = opacity > 0;
    wireMesh.visible = wireframe;
    // Flat faces for unsmoothed voxels, smooth shading otherwise
    material.flatShading = method === "voxels" && smoothing === "none";
    material.needsUpdate = true;
    view.requestRender();
  }, [opacity, wireframe, method, smoothing]);

  return (
    <div className="relative h-[75vh] border border-[#282828] rounded-xl overflow-hidden bg-black text-white">
      <div ref={containerRef} className="absolute inset-0" />

      {status === "building" && (
        <div className="absolute top-3 left-3 flex items-center gap-2 text-xs bg-black/60 rounded px-2 py-1">
          <div className="animate-spin rounded-full h-3 w-3 border-2 border-t-transparent border-white"></div>
          Building mesh…
        </div>
      )}
      {status === "empty" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm opacity-70 pointer-events-none">
          The mask is empty, so there is nothing to show in 3D.
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400 pointer-events-none">
          Could not build the 3D mesh. See the console for details.
        </div>
      )}

      <div className="absolute bottom-2 right-3 text-xs opacity-60 pointer-events-none text-right">
        {status === "ready" && <div>{triangles.toLocaleString()} triangles</div>}
        <div>Drag to rotate · right-drag to pan · scroll to zoom</div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent border-white"></div>
        </div>
      )}
    </div>
  );
}
