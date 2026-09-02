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
import type { ComponentId, ScientificFieldId, ScientificSlice, SliceAxis } from "@/lib/twin-types";
import type { GeometryDesignResponse } from "@/lib/geometry-api";
import {
  axisBoundaries,
  colorScalarValue,
  linearCellIndex,
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
  onCameraState: (state: CameraState) => void;
}

const INITIAL_TARGET = new THREE.Vector3(0, 0, 0.46);
const INITIAL_CAMERA = INITIAL_TARGET.clone().add(
  new THREE.Vector3(-1, 1, -1).normalize().multiplyScalar(1.58),
);

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

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

type DisplayBoundsMm = [number, number, number, number, number, number];

function displayBoundsMm(bounds: readonly number[] | null): DisplayBoundsMm {
  const fallback = [...BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min, ...BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max];
  if (bounds?.length !== 6) return fallback as DisplayBoundsMm;
  return [
    Number.isFinite(bounds[0]) ? bounds[0] : fallback[0],
    Number.isFinite(bounds[1]) ? bounds[1] : fallback[3],
    Number.isFinite(bounds[2]) ? bounds[2] : fallback[1],
    Number.isFinite(bounds[3]) ? bounds[3] : fallback[4],
    Number.isFinite(bounds[4]) ? bounds[4] : fallback[2],
    Number.isFinite(bounds[5]) ? bounds[5] : fallback[5],
  ];
}

function sectionBoundsMm(bounds: readonly number[] | null, axis: SliceAxis): [number, number] {
  const values = displayBoundsMm(bounds);
  const index = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  const minimum = values[index * 2];
  const maximum = values[index * 2 + 1];
  return [Math.min(minimum, maximum), Math.max(minimum, maximum)];
}

function SectionPlaneMarker({
  boundsMm,
  axis,
  positionMm,
}: {
  boundsMm: DisplayBoundsMm;
  axis: SliceAxis;
  positionMm: number;
}) {
  const marker = useMemo(() => {
    const scale = BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
    const x0 = boundsMm[0] * scale;
    const x1 = boundsMm[1] * scale;
    const y0 = boundsMm[2] * scale;
    const y1 = boundsMm[3] * scale;
    const z0 = boundsMm[4] * scale;
    const z1 = boundsMm[5] * scale;
    const position = positionMm * scale;
    if (axis === "X") {
      return {
        size: [Math.max(y1 - y0, 0.001), Math.max(z1 - z0, 0.001)] as [number, number],
        position: [position, (y0 + y1) / 2, (z0 + z1) / 2] as [number, number, number],
        rotation: [0, Math.PI / 2, 0] as [number, number, number],
        corners: [[position, y0, z0], [position, y1, z0], [position, y1, z1], [position, y0, z1]],
      };
    }
    if (axis === "Y") {
      return {
        size: [Math.max(x1 - x0, 0.001), Math.max(z1 - z0, 0.001)] as [number, number],
        position: [(x0 + x1) / 2, position, (z0 + z1) / 2] as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        corners: [[x0, position, z0], [x1, position, z0], [x1, position, z1], [x0, position, z1]],
      };
    }
    return {
      size: [Math.max(x1 - x0, 0.001), Math.max(y1 - y0, 0.001)] as [number, number],
      position: [(x0 + x1) / 2, (y0 + y1) / 2, position] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      corners: [[x0, y0, position], [x1, y0, position], [x1, y1, position], [x0, y1, position]],
    };
  }, [axis, boundsMm, positionMm]);
  const outlinePositions = useMemo(() => {
    const positions = new Float32Array(12);
    marker.corners.forEach(([x, y, z], index) => {
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
    });
    return positions;
  }, [marker.corners]);

  return (
    <>
      <mesh
        position={marker.position}
        rotation={marker.rotation}
        renderOrder={7}
        raycast={() => null}
        userData={{ sectionPlaneMarker: true, sectionAxis: axis }}
      >
        <planeGeometry args={marker.size} />
        <meshBasicMaterial color="#d99a4c" transparent opacity={0.14} depthTest={false} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <lineLoop renderOrder={8} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[outlinePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#f0b866" transparent opacity={0.92} depthTest={false} depthWrite={false} toneMapped={false} />
      </lineLoop>
    </>
  );
}

function ScientificSliceScene() {
  const section = useTwinStore((state) => state.section);
  const mode = useTwinStore((state) => state.visualizationMode);
  const scientificSlices = useTwinStore((state) => state.scientificSlices);
  const activeSliceId = useTwinStore((state) => state.activeScientificSliceId);
  const activeFieldId = useTwinStore((state) => state.activeFieldId) as ScientificFieldId;
  const scientificData = useTwinStore((state) => state.scientificField);
  const useLogScale = useTwinStore((state) => state.useLogScale);
  const probe = useTwinStore((state) => state.scientificProbe);
  const probeVoxel = useTwinStore((state) => state.probeScientificVoxel);
  const reportRender = useTwinStore((state) => state.reportScientificRender);
  const { invalidate } = useThree();
  const manifest = scientificData?.manifest ?? null;
  const values = scientificData?.valuesByField[activeFieldId] ?? null;
  const slices = useMemo(() => {
    if (!manifest || !values || section !== "neutronics" || mode !== "Slice") return null;
    const field = manifest.fields[activeFieldId];
    return scientificSlices
      .filter((slice) => slice.visible)
      .map((slice) => ({
        slice,
        geometry: buildSliceGeometry(manifest, values, field.key, slice, useLogScale ? "log" : "linear"),
      }));
  }, [activeFieldId, manifest, mode, scientificSlices, section, useLogScale, values]);

  useEffect(() => {
    if (!slices) return;
    const requested = performance.now();
    const frame = requestAnimationFrame(() => {
      const loadMs = useTwinStore.getState().scientificLoadMetrics?.totalMs ?? 0;
      const updateMs = performance.now() - requested;
      reportRender(loadMs + updateMs, updateMs);
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidate, reportRender, slices]);

  if (!slices) return null;
  return <>{slices.map(({ slice, geometry }) => (
    <ScientificSliceLayer
      key={slice.id}
      slice={slice}
      geometry={geometry}
      active={slice.id === activeSliceId}
      probe={probe}
      activeFieldId={activeFieldId}
      onProbe={probeVoxel}
    />
  ))}</>;
}

function ScientificSliceLayer({
  slice,
  geometry,
  active,
  probe,
  activeFieldId,
  onProbe,
}: {
  slice: ScientificSlice;
  geometry: ReturnType<typeof buildSliceGeometry>;
  active: boolean;
  probe: ScientificVoxelProbe | null;
  activeFieldId: ScientificFieldId;
  onProbe: (sliceId: string, pointMm: [number, number, number]) => Promise<void>;
}) {
  const selectSlice = useTwinStore((state) => state.selectScientificSlice);
  const highlightPositions = useMemo(() => {
    const axisIndex = slice.axis === "X" ? "i" : slice.axis === "Y" ? "j" : "k";
    return probe?.sliceId === slice.id && probe.indices[axisIndex] === slice.layerIndex
      ? buildProbeHighlight(slice.axis, probe)
      : null;
  }, [probe, slice]);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectSlice(slice.id);
    const scale = BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
    void onProbe(slice.id, [event.point.x / scale, event.point.y / scale, event.point.z / scale]);
  };

  return (
    <>
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={8}
        onClick={handleClick}
        userData={{ scientificField: activeFieldId, scientificSliceId: slice.id, sliceAxis: slice.axis, layer: slice.layerIndex, centerMm: slice.centerMm }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
        </bufferGeometry>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent={slice.opacity < 0.999} opacity={slice.opacity} depthWrite={slice.opacity >= 0.999} depthTest toneMapped={false} />
      </mesh>
      <lineLoop scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={10}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.borderPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={active ? "#f4fbff" : "#67c7cb"} transparent opacity={active ? 0.95 : 0.7} depthTest={false} toneMapped={false} />
      </lineLoop>
      {highlightPositions && (
        <lineSegments scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={11}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[highlightPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.96} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={9}
        onClick={handleClick}
        userData={{ scientificPickPlane: true, scientificSliceId: slice.id, sliceAxis: slice.axis, layer: slice.layerIndex }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.pickPositions, 3]} />
        </bufferGeometry>
        <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </>
  );
}

function buildSliceGeometry(
  manifest: ScientificFieldManifest,
  values: Float32Array,
  fieldId: ScientificFieldId,
  slice: ScientificSlice,
  scaleMode: "linear" | "log",
) {
  const x = axisBoundaries(manifest, "X");
  const y = axisBoundaries(manifest, "Y");
  const z = axisBoundaries(manifest, "Z");
  const [, ny, nx] = manifest.mesh.cell_shape_zyx;
  const axis = slice.axis;
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
    if (!(value > 0)) return;
    const color = colorScalarValue(value, field, scaleMode);
    for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
      const [px, py, pz] = corners[cornerIndex];
      addVertex(px, py, pz, color);
    }
  };

  if (axis === "X") {
    const i = slice.layerIndex;
    const fixed = slice.centerMm;
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
    const j = slice.layerIndex;
    const fixed = slice.centerMm;
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
    const k = slice.layerIndex;
    const fixed = slice.centerMm;
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
    positions: positions.slice(0, offset),
    colors: colors.slice(0, offset),
    pickPositions: buildSlicePickPlane(axis, manifest, slice.centerMm),
    borderPositions: buildSliceBorderPlane(axis, manifest, slice.centerMm),
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

function buildSliceBorderPlane(axis: SliceAxis, manifest: ScientificFieldManifest, centerMm: number) {
  const x = axisBoundaries(manifest, "X");
  const y = axisBoundaries(manifest, "Y");
  const z = axisBoundaries(manifest, "Z");
  const corners: Array<[number, number, number]> = axis === "X"
    ? [[centerMm, y[0], z[0]], [centerMm, y[y.length - 1], z[0]], [centerMm, y[y.length - 1], z[z.length - 1]], [centerMm, y[0], z[z.length - 1]]]
    : axis === "Y"
      ? [[x[0], centerMm, z[0]], [x[x.length - 1], centerMm, z[0]], [x[x.length - 1], centerMm, z[z.length - 1]], [x[0], centerMm, z[z.length - 1]]]
      : [[x[0], y[0], centerMm], [x[x.length - 1], y[0], centerMm], [x[x.length - 1], y[y.length - 1], centerMm], [x[0], y[y.length - 1], centerMm]];
  const positions = new Float32Array(12);
  corners.forEach(([px, py, pz], index) => {
    positions[index * 3] = px;
    positions[index * 3 + 1] = py;
    positions[index * 3 + 2] = pz;
  });
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

function CameraController({
  model,
  command,
  onCameraState,
}: {
  model: THREE.Group | null;
  command: CameraCommand;
  onCameraState: (state: CameraState) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const initialized = useRef(false);
  const lastCommandSequence = useRef(0);
  const { camera, size, invalidate } = useThree();

  const reportCameraState = useCallback(() => {
    const target = controls.current?.target ?? INITIAL_TARGET;
    onCameraState({
      position: camera.position.toArray() as [number, number, number],
      target: target.toArray() as [number, number, number],
      up: camera.up.toArray() as [number, number, number],
    });
  }, [camera, onCameraState]);

  const reset = useCallback(() => {
    camera.position.copy(INITIAL_CAMERA);
    camera.up.set(0, 1, 0);
    camera.lookAt(INITIAL_TARGET);
    controls.current?.target.copy(INITIAL_TARGET);
    controls.current?.update();
    reportCameraState();
    invalidate();
  }, [camera, invalidate, reportCameraState]);

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
    const direction = new THREE.Vector3(-1, 1, -1).normalize();
    camera.position.copy(center).addScaledVector(direction, Math.max(distance, 0.62));
    controls.current?.target.copy(center);
    camera.lookAt(center);
    controls.current?.update();
    reportCameraState();
    invalidate();
  }, [camera, invalidate, model, reportCameraState, size.height, size.width]);

  const rotate = useCallback((action: CameraCommand["action"]) => {
    const target = controls.current?.target ?? INITIAL_TARGET;
    const direction = target.clone().sub(camera.position).normalize();
    const angle = action === "roll-cw" ? -Math.PI / 2 : Math.PI / 2;
    camera.up.applyAxisAngle(direction, angle);
    camera.lookAt(target);
    controls.current?.update();
    reportCameraState();
    invalidate();
  }, [camera, invalidate, reportCameraState]);

  useEffect(() => {
    if (command.sequence === 0 || command.sequence === lastCommandSequence.current) return;
    lastCommandSequence.current = command.sequence;
    if (command.action === "reset") reset();
    else if (command.action === "fit") fit();
    else rotate(command.action);
  }, [command, fit, reset, rotate]);

  useEffect(() => {
    if (!model || initialized.current) return;
    initialized.current = true;
    reset();
  }, [model, reset]);

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
      onChange={reportCameraState}
    />
  );
}

function BlanketModel({ cameraCommand, onReady, onError, onCameraState }: SceneProps) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [hovered, setHovered] = useState<{ group: ComponentId; point: [number, number, number] } | null>(null);
  const selected = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const opacity = useTwinStore((state) => state.componentOpacity);
  const section = useTwinStore((state) => state.section);
  const visualizationMode = useTwinStore((state) => state.visualizationMode);
  const geometry = useTwinStore((state) => state.geometry);
  const sectionViewEnabled = useTwinStore((state) => state.sectionViewEnabled);
  const sectionViewAxis = useTwinStore((state) => state.sectionViewAxis);
  const sectionViewPositionMm = useTwinStore((state) => state.sectionViewPositionMm);
  const sectionViewFlip = useTwinStore((state) => state.sectionViewFlip);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const { invalidate } = useThree();

  const parametricModel = useMemo(() => (
    geometry ? buildParametricModel(geometry) : null
  ), [geometry]);
  const displayModel = parametricModel ?? model;
  const clippingPlane = useMemo(() => {
    if (!sectionViewEnabled) return null;
    const [minimum, maximum] = sectionBoundsMm(geometry?.bounds_mm ?? null, sectionViewAxis);
    const positionMm = Math.min(maximum, Math.max(minimum, sectionViewPositionMm));
    const normal = sectionViewAxis === "X"
      ? new THREE.Vector3(sectionViewFlip ? -1 : 1, 0, 0)
      : sectionViewAxis === "Y"
        ? new THREE.Vector3(0, sectionViewFlip ? -1 : 1, 0)
        : new THREE.Vector3(0, 0, sectionViewFlip ? -1 : 1);
    const point = normal.clone().multiplyScalar(positionMm * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale);
    return new THREE.Plane(normal, -normal.dot(point));
  }, [geometry, sectionViewAxis, sectionViewEnabled, sectionViewFlip, sectionViewPositionMm]);
  const sectionDisplayBoundsMm = useMemo(
    () => displayBoundsMm(geometry?.bounds_mm ?? null),
    [geometry],
  );
  const sectionDisplayPositionMm = useMemo(() => {
    const [minimum, maximum] = sectionBoundsMm(geometry?.bounds_mm ?? null, sectionViewAxis);
    return Math.min(maximum, Math.max(minimum, sectionViewPositionMm));
  }, [geometry, sectionViewAxis, sectionViewPositionMm]);

  useEffect(() => {
    if (!parametricModel) return;
    const groups: Record<ComponentId, number> = { armor: 0, breeder: 0, multiplier: 0, structure: 0, coolant: 0 };
    let meshes = 0;
    let triangles = 0;
    parametricModel.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const group = object.userData.semanticComponent as ComponentId;
      groups[group] += 1;
      meshes += 1;
      triangles += countTriangles(object.geometry);
    });
    onReady({ totalMs: geometry?.generation_ms ?? 0, resourceMs: null, meshes, triangles, groups });
  }, [geometry?.generation_ms, onReady, parametricModel]);

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
          object.material = new THREE.MeshStandardMaterial({
            side: THREE.FrontSide,
            transparent: false,
            opacity: 1,
            depthTest: true,
            depthWrite: true,
          });
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
    if (!displayModel) return;
    displayModel.traverse((object) => {
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
      material.depthTest = true;
      material.depthWrite = opacity[group] >= 0.999 || opacity[group] > 0.82;
      material.side = THREE.FrontSide;
      material.clippingPlanes = clippingPlane ? [clippingPlane] : [];
      material.clipIntersection = false;
      material.emissive.set(group === selected ? appearance.color : "#000000");
      material.emissiveIntensity = group === selected ? 0.2 : group === hovered?.group ? 0.07 : 0;
      material.needsUpdate = true;
    });
    invalidate();
  }, [clippingPlane, displayModel, hovered, invalidate, opacity, selected, visibility]);

  useEffect(() => () => {
    model?.traverse((object) => {
      if (object instanceof THREE.Mesh) (object.material as THREE.Material).dispose();
    });
    parametricModel?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  }, [model, parametricModel]);

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
      {displayModel && (
        <primitive
          object={displayModel}
          scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
          onClick={handleClick}
          onPointerMove={handlePointer}
          onPointerOut={() => {
            setHovered(null);
            document.body.style.cursor = "";
          }}
        />
      )}
      {sectionViewEnabled && displayModel && (
        <SectionPlaneMarker
          boundsMm={sectionDisplayBoundsMm}
          axis={sectionViewAxis}
          positionMm={sectionDisplayPositionMm}
        />
      )}
      <ScientificSliceScene />
      <CameraController model={displayModel} command={cameraCommand} onCameraState={onCameraState} />
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

function buildParametricModel(response: GeometryDesignResponse): THREE.Group {
  const group = new THREE.Group();
  group.name = "ParametricCSGGeometry";
  for (const component of response.components) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(component.positions, 3));
    geometry.setIndex(component.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      side: THREE.FrontSide,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
    }));
    mesh.name = component.display_name;
    mesh.userData.semanticComponent = component.group.toLowerCase() as ComponentId;
    mesh.userData.parametricComponent = component.id;
    group.add(mesh);
  }
  return group;
}

export function BlanketThreeScene(props: SceneProps) {
  return (
    <Canvas
      aria-label="Interactive Web CAD blanket geometry"
      camera={{ fov: 38, near: 0.01, far: 20, position: INITIAL_CAMERA.toArray() }}
      dpr={[1, 1.35]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.localClippingEnabled = true;
      }}
      onPointerMissed={() => { document.body.style.cursor = ""; }}
    >
      <BlanketModel {...props} />
    </Canvas>
  );
}
