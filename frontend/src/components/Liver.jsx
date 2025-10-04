import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function Liver() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xffffff, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 6;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 5, 8);
    scene.add(ambient, dir);

    const loader = new OBJLoader();
    loader.load(
      "/liver.obj",
      (obj) => {
        console.log("OBJ loaded:", obj);

        obj.scale.set(0.01, 0.01, 0.01);
        obj.rotation.x = Math.PI + 2;

        const allPositions = [];

        obj.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const geom = child.geometry.clone();
            const nonIndexed = geom.toNonIndexed(); // ensures every vertex is unique
            const pos = nonIndexed.getAttribute("position");
            for (let i = 0; i < pos.count; i++) {
              allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            }
          }
        });

        console.log("Total vertices:", allPositions.length / 3);

        // If no vertices, show placeholder sphere so you see something
        if (allPositions.length === 0) {
          console.warn("No geometry found in liver.obj — using fallback sphere");
          const sphere = new THREE.SphereGeometry(1, 64, 64);
          const pos = sphere.getAttribute("position");
          for (let i = 0; i < pos.count; i++) {
            allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          }
        }

        const pointsGeometry = new THREE.BufferGeometry();
        pointsGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(allPositions, 3)
        );

        const pointsMaterial = new THREE.PointsMaterial({
          color: 0x00ff00,
          size: 0.025,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
        });

        const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
        pointCloud.scale.set(0.017, 0.017, 0.017);
        pointCloud.position.set(0, 0, 0);
        pointCloud.rotation.set(Math.PI * 0.5, 3, 0);
        scene.add(pointCloud);

        const clock = new THREE.Clock();
        const animate = () => {
          requestAnimationFrame(animate);
          const t = clock.getElapsedTime();
          pointsMaterial.size = 0.02 + Math.sin(t * 2.0) * 0.005;
          pointCloud.rotation.z -= 0.002;
          controls.update();
          renderer.render(scene, camera);
        };
        animate();
      },
      undefined,
      (err) => console.error("Failed to load OBJ:", err)
    );

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
  );
}
