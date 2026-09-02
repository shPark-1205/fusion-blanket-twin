"use client";

import { GizmoHelper, GizmoViewport, Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ComponentId, ScientificFieldId, SliceAxis } from "@/lib/twin-types";
import {
  axisBoundaries,
  colorScalarValue,
  linearCellIndex,
  selectedLayer,
  type ScientificFieldManifest,
  type ScientificVoxelProbe,
} from "@/lib/scientific-field";

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

function ScientificSlice() {
  const section = useTwinStore((state) => state.section);
  const mode = useTwinStore((state) => state.visualizationMode);
  const axis = useTwinStore((state) => state.sliceAxis);
  const positionsMm = useTwinStore((state) => state.slicePositions);
  const activeFieldId = useTwinStore((state) => state.activeFieldId) as ScientificFieldId;
  const scientificData = useTwinStore((state) => state.scientificField);
  const useLogScale = useTwinStore((state) => state.useLogScale);
  const probe = useTwinStore((state) => state.scientificProbe);
  const probeVoxel = useTwinStore((state) => state.probeScientificVoxel);
  const reportRender = useTwinStore((state) => state.reportScientificRender);
  const { invalidate } = useThree();
  const slice = useMemo(() => {
    if (!scientificData || section !== "neutronics" || mode !== "Slice") return null;
    const values = scientificData.valuesByField[activeFieldId];
    if (!values) return null;
    const field = scientificData.manifest.fields[activeFieldId];
    return buildSliceGeometry(scientificData.manifest, values, field.key, axis, positionsMm[axis], useLogScale ? "log" : "linear", probe);
  }, [activeFieldId, axis, mode, positionsMm, probe, scientificData, section, useLogScale]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const scale = BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
    const pointMm: [number, number, number] = [
      event.point.x / scale,
      event.point.y / scale,
      event.point.z / scale,
    ];
    void probeVoxel(pointMm);
  };

  useEffect(() => {
    if (!slice) return;
    const requested = performance.now();
    const frame = requestAnimationFrame(() => {
      const loadMs = useTwinStore.getState().scientificLoadMetrics?.totalMs ?? 0;
      const updateMs = performance.now() - requested;
      reportRender(loadMs + updateMs, updateMs);
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidate, reportRender, slice]);

  if (!slice) return null;
  return (
    <>
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={8}
        onClick={handleClick}
        userData={{ scientificField: activeFieldId, sliceAxis: axis, layer: slice.layer.index, centerMm: slice.layer.center_mm }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[slice.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[slice.colors, 3]} />
        </bufferGeometry>
        <meshBasicMaterial
          vertexColors
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {slice.highlightPositions && (
        <lineSegments scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={10}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[slice.highlightPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#e5edf1" transparent opacity={0.92} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={9}
        onClick={handleClick}
        userData={{ scientificPickPlane: true, sliceAxis: axis, layer: slice.layer.index }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[slice.pickPositions, 3]} />
        </bufferGeometry>
        <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

function ScientificProbeController() {
  const section = useTwinStore((state) => state.section);
  const mode = useTwinStore((state) => state.visualizationMode);
  const axis = useTwinStore((state) => state.sliceAxis);
  const positionsMm = useTwinStore((state) => state.slicePositions);
  const scientificData = useTwinStore((state) => state.scientificField);
  const probeVoxel = useTwinStore((state) => state.probeScientificVoxel);
  const { camera, gl } = useThree();

  useEffect(() => {
    if (!scientificData || section !== "neutronics" || mode !== "Slice") return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const intersection = new THREE.Vector3();
    const normal = axis === "X"
      ? new THREE.Vector3(1, 0, 0)
      : axis === "Y"
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
    const layer = selectedLayer(scientificData.manifest, axis, positionsMm[axis]);
    const fixedScene = layer.center_mm * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
    const plane = new THREE.Plane(normal, -fixedScene);

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const point = raycaster.ray.intersectPlane(plane, intersection);
      if (!point) return;
      const scale = BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
      const pointMm: [number, number, number] = [point.x / scale, point.y / scale, point.z / scale];
      pointMm[axis === "X" ? 0 : axis === "Y" ? 1 : 2] = layer.center_mm;
      void probeVoxel(pointMm);
    };

    gl.domElement.addEventListener("click", handleClick, true);
    return () => gl.domElement.removeEventListener("click", handleClick, true);
  }, [axis, camera, gl.domElement, mode, positionsMm, probeVoxel, scientificData, section]);

  return null;
}

function buildSliceGeometry(
  manifest: ScientificFieldManifest,
  values: Float32Array,
  fieldId: ScientificFieldId,
  axis: SliceAxis,
  positionMm: number,
  scaleMode: "linear" | "log",
  probe: ScientificVoxelProbe | null,
) {
  const x = axisBoundaries(manifest, "X");
  const y = axisBoundaries(manifest, "Y");
  const z = axisBoundaries(manifest, "Z");
  const [, ny, nx] = manifest.mesh.cell_shape_zyx;
  const layer = selectedLayer(manifest, axis, positionMm);
  const field = manifest.fields[fieldId];
  const cellCount = axis === "X" ? ny * manifest.mesh.cell_shape_zyx[0] : axis === "Y" ? nx * manifest.mesh.cell_shape_zyx[0] : nx * ny;
  const verticesPerCell = 6;
  const positions = new Float32Array(cellCount * verticesPerCell * 3);
  const colors = new Float32Array(positions.length);
  let offset = 0;

  const addVertex = (px: number, py: number, pz: number, color: [number, number, number]) => {
    positions[offset] = px;
    positions[offset + 1] = py;
    positions[offset + 2] = pz;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
    offset += 3;
  };

  const addQuad = (corners: Array<[number, number, number]>, index: { i: number; j: number; k: number }) => {
    const value = values[linearCellIndex(manifest, index)];
    const color = colorScalarValue(value, field, scaleMode);
    for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
      const [px, py, pz] = corners[cornerIndex];
      addVertex(px, py, pz, color);
    }
  };

  if (axis === "X") {
    const i = layer.index;
    const fixed = layer.center_mm;
    for (let k = 0; k < z.length - 1; k += 1) {
      for (let j = 0; j < y.length - 1; j += 1) {
        addQuad([
          [fixed, y[j], z[k]],
          [fixed, y[j + 1], z[k]],
          [fixed, y[j + 1], z[k + 1]],
          [fixed, y[j], z[k + 1]],
        ], { i, j, k });
      }
    }
  } else if (axis === "Y") {
    const j = layer.index;
    const fixed = layer.center_mm;
    for (let k = 0; k < z.length - 1; k += 1) {
      for (let i = 0; i < x.length - 1; i += 1) {
        addQuad([
          [x[i], fixed, z[k]],
          [x[i + 1], fixed, z[k]],
          [x[i + 1], fixed, z[k + 1]],
          [x[i], fixed, z[k + 1]],
        ], { i, j, k });
      }
    }
  } else {
    const k = layer.index;
    const fixed = layer.center_mm;
    for (let j = 0; j < y.length - 1; j += 1) {
      for (let i = 0; i < x.length - 1; i += 1) {
        addQuad([
          [x[i], y[j], fixed],
          [x[i + 1], y[j], fixed],
          [x[i + 1], y[j + 1], fixed],
          [x[i], y[j + 1], fixed],
        ], { i, j, k });
      }
    }
  }

  return {
    positions,
    colors,
    layer,
    pickPositions: buildSlicePickPlane(axis, manifest, layer.center_mm),
    highlightPositions: probe && probe.indices[axis.toLowerCase() === "x" ? "i" : axis.toLowerCase() === "y" ? "j" : "k"] === layer.index
      ? buildProbeHighlight(axis, probe)
      : null,
  };
}

function buildSlicePickPlane(axis: SliceAxis, manifest: ScientificFieldManifest, centerMm: number) {
  const x = axisBoundaries(manifest, "X");
  const y = axisBoundaries(manifest, "Y");
  const z = axisBoundaries(manifest, "Z");
  const x0 = x[0];
  const x1 = x[x.length - 1];
  const y0 = y[0];
  const y1 = y[y.length - 1];
  const z0 = z[0];
  const z1 = z[z.length - 1];
  const corners: Array<[number, number, number]> = axis === "X"
    ? [[centerMm, y0, z0], [centerMm, y1, z0], [centerMm, y1, z1], [centerMm, y0, z1]]
    : axis === "Y"
      ? [[x0, centerMm, z0], [x1, centerMm, z0], [x1, centerMm, z1], [x0, centerMm, z1]]
      : [[x0, y0, centerMm], [x1, y0, centerMm], [x1, y1, centerMm], [x0, y1, centerMm]];
  const positions = new Float32Array(18);
  let offset = 0;
  for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
    const [px, py, pz] = corners[cornerIndex];
    positions[offset] = px;
    positions[offset + 1] = py;
    positions[offset + 2] = pz;
    offset += 3;
  }
  return positions;
}

function buildProbeHighlight(axis: SliceAxis, probe: ScientificVoxelProbe) {
  const { x, y, z } = probe.boundsMm;
  const center = probe.centerMm;
  const corners: Array<[number, number, number]> = axis === "X"
    ? [[center[0], y[0], z[0]], [center[0], y[1], z[0]], [center[0], y[1], z[1]], [center[0], y[0], z[1]]]
    : axis === "Y"
      ? [[x[0], center[1], z[0]], [x[1], center[1], z[0]], [x[1], center[1], z[1]], [x[0], center[1], z[1]]]
      : [[x[0], y[0], center[2]], [x[1], y[0], center[2]], [x[1], y[1], center[2]], [x[0], y[1], center[2]]];
  const positions = new Float32Array(8 * 3);
  let offset = 0;
  for (const edge of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
    for (const cornerIndex of edge) {
      const [px, py, pz] = corners[cornerIndex];
      positions[offset] = px;
      positions[offset + 1] = py;
      positions[offset + 2] = pz;
      offset += 3;
    }
  }
  return positions;
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
  const section = useTwinStore((state) => state.section);
  const visualizationMode = useTwinStore((state) => state.visualizationMode);
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
    if (!(section === "neutronics" && visualizationMode === "Slice")) event.stopPropagation();
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
      <ScientificSlice />
      <ScientificProbeController />
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
