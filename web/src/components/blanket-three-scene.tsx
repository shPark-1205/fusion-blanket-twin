"use client";

import { GizmoHelper, GizmoViewport, Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BLANKET_GEOMETRY_ADAPTER,
  BLANKET_MODEL_URL,
  COMPONENT_APPEARANCE,
  semanticComponentForNames,
} from "@/lib/blanket-geometry";
import type { CameraCommand } from "@/lib/twin-store";
import { useTwinStore } from "@/lib/twin-store";
import type { ComponentId } from "@/lib/twin-types";

export interface GeometryReadyMetrics {
  totalMs: number;
  resourceMs: number | null;
  meshes: number;
  triangles: number;
  groups: Record<ComponentId, number>;
}

interface SceneProps {
  cameraCommand: CameraCommand;
  onReady: (metrics: GeometryReadyMetrics) => void;
  onError: (message: string) => void;
}

const INITIAL_CAMERA = new THREE.Vector3(0.82, -1.28, 0.89);
const INITIAL_TARGET = new THREE.Vector3(0, 0, 0.46);

function namesFromObject(object: THREE.Object3D) {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current) {
    names.push(current.name);
    current = current.parent;
  }
  return names;
}

function semanticComponent(object: THREE.Object3D): ComponentId | null {
  return object.userData.semanticComponent ?? semanticComponentForNames(namesFromObject(object));
}

function countTriangles(geometry: THREE.BufferGeometry) {
  const elements = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(elements / 3);
}

function CameraController({ model, command }: { model: THREE.Group | null; command: CameraCommand }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, invalidate } = useThree();

  const reset = useCallback(() => {
    camera.position.copy(INITIAL_CAMERA);
    camera.up.set(0, 1, 0);
    camera.lookAt(INITIAL_TARGET);
    controls.current?.target.copy(INITIAL_TARGET);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate]);

  const fit = useCallback(() => {
    if (!model) return;
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const perspective = camera as THREE.PerspectiveCamera;
    const verticalFov = THREE.MathUtils.degToRad(perspective.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * size.width / size.height);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = sphere.radius / Math.sin(limitingFov / 2) * 1.12;
    const direction = new THREE.Vector3(0.8, -1.25, 0.42).normalize();
    camera.position.copy(center).addScaledVector(direction, Math.max(distance, 0.62));
    controls.current?.target.copy(center);
    camera.lookAt(center);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate, model, size.height, size.width]);

  useEffect(() => {
    if (command.sequence === 0) return;
    if (command.action === "reset") reset();
    else fit();
  }, [command, fit, reset]);

  useEffect(() => {
    if (model) fit();
  }, [fit, model]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.28}
      maxDistance={3.2}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI - 0.12}
      panSpeed={0.65}
      rotateSpeed={0.65}
      zoomSpeed={0.72}
      screenSpacePanning
    />
  );
}

function BlanketModel({ cameraCommand, onReady, onError }: SceneProps) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [hovered, setHovered] = useState<{ group: ComponentId; point: [number, number, number] } | null>(null);
  const selected = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const opacity = useTwinStore((state) => state.componentOpacity);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const { invalidate } = useThree();

  useEffect(() => {
    let active = true;
    const started = performance.now();
    const loader = new GLTFLoader();
    loader.load(
      BLANKET_MODEL_URL,
      (gltf) => {
        if (!active) return;
        const scene = gltf.scene.clone(true);
        const groups: Record<ComponentId, number> = { armor: 0, breeder: 0, multiplier: 0, structure: 0, coolant: 0 };
        let meshes = 0;
        let triangles = 0;
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const group = semanticComponentForNames(namesFromObject(object));
          if (!group) {
            console.warn(`Unmapped GLB mesh: ${object.name || "(unnamed)"}`);
            return;
          }
          object.userData.semanticComponent = group;
          object.material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
          groups[group] += 1;
          meshes += 1;
          triangles += countTriangles(object.geometry);
        });
        const resource = performance.getEntriesByName(new URL(BLANKET_MODEL_URL, window.location.href).href).at(-1);
        setModel(scene);
        onReady({
          totalMs: performance.now() - started,
          resourceMs: resource instanceof PerformanceResourceTiming ? resource.duration : null,
          meshes,
          triangles,
          groups,
        });
      },
      undefined,
      (error) => {
        if (!active) return;
        const detail = error instanceof Error ? error.message : "The GLB request could not be completed.";
        onError(detail);
      },
    );
    return () => {
      active = false;
      document.body.style.cursor = "";
    };
  }, [onError, onReady]);

  useEffect(() => {
    if (!model) return;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const group = semanticComponent(object);
      if (!group) return;
      object.visible = visibility[group];
      const material = object.material as THREE.MeshStandardMaterial;
      const appearance = COMPONENT_APPEARANCE[group];
      material.color.set(appearance.color);
      material.metalness = appearance.metalness;
      material.roughness = appearance.roughness;
      material.opacity = opacity[group];
      material.transparent = opacity[group] < 0.999;
      material.depthWrite = opacity[group] > 0.82;
      material.emissive.set(group === selected ? appearance.color : "#000000");
      material.emissiveIntensity = group === selected ? 0.2 : group === hovered?.group ? 0.07 : 0;
      material.needsUpdate = true;
    });
    invalidate();
  }, [hovered, invalidate, model, opacity, selected, visibility]);

  useEffect(() => () => {
    model?.traverse((object) => {
      if (object instanceof THREE.Mesh) (object.material as THREE.Material).dispose();
    });
  }, [model]);

  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const group = semanticComponent(event.object);
    if (!group) return;
    setHovered({ group, point: event.point.toArray() });
    document.body.style.cursor = "pointer";
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const group = semanticComponent(event.object);
    if (group) selectComponent(group);
  };

  return (
    <>
      <hemisphereLight args={["#d9ecf5", "#17232a", 1.45]} />
      <directionalLight position={[1.5, -1.8, 2.2]} intensity={2.6} />
      <directionalLight position={[-1.4, 0.8, 0.5]} intensity={0.9} color="#8fb5cf" />
      <gridHelper args={[1.3, 26, "#263a43", "#14262e"]} position={[0, -0.082, 0.46]} />
      {model && (
        <primitive
          object={model}
          scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
          onClick={handleClick}
          onPointerMove={handlePointer}
          onPointerOut={() => {
            setHovered(null);
            document.body.style.cursor = "";
          }}
        />
      )}
      <CameraController model={model} command={cameraCommand} />
      <GizmoHelper alignment="bottom-left" margin={[72, 58]}>
        <GizmoViewport axisColors={["#b95c5c", "#55a16e", "#528ec8"]} labelColor="#dce6ea" />
      </GizmoHelper>
      {hovered && (
        <Html position={hovered.point} center style={{ pointerEvents: "none" }}>
          <span className="geometry-hover-label">{hovered.group}</span>
        </Html>
      )}
    </>
  );
}

export function BlanketThreeScene(props: SceneProps) {
  return (
    <Canvas
      aria-label="Interactive Web CAD blanket geometry"
      camera={{ fov: 38, near: 0.01, far: 20, position: INITIAL_CAMERA.toArray() }}
      dpr={[1, 1.35]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onPointerMissed={() => { document.body.style.cursor = ""; }}
    >
      <BlanketModel {...props} />
    </Canvas>
  );
}
