"use client";

import { GizmoHelper, GizmoViewport, Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
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
import { MODULE_LAYOUT_V1, moduleCellTranslationMm, moduleCellsIntersectingSlice, moduleLocalSlicePositionMm, type ModuleCellInstance, type ModuleLayout } from "@/lib/module-layout";
import { presentationEmitterDefinition } from "@/lib/presentation-overlays";
import type { CameraCommand } from "@/lib/twin-store";
import { useTwinStore } from "@/lib/twin-store";
import type { ComponentId, ScientificFieldId, ScientificSlice, SliceAxis } from "@/lib/twin-types";
import type { GeometryDesignResponse } from "@/lib/geometry-api";
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

function cellIdFromObject(object: THREE.Object3D | null): string | null {
  let current = object;
  while (current) {
    if (typeof current.userData.cellId === "string") return current.userData.cellId;
    current = current.parent;
  }
  return null;
}

function setCellIdentity(root: THREE.Object3D, cell: ModuleCellInstance) {
  root.userData.cellId = cell.cellId;
  root.userData.cellRow = cell.row;
  root.userData.cellColumn = cell.column;
  root.userData.cellQ = cell.q;
  root.userData.cellR = cell.r;
  root.traverse((object) => {
    object.userData.cellId = cell.cellId;
  });
}

function buildModuleModel(source: THREE.Group, layout: ModuleLayout): THREE.Group {
  const assembly = new THREE.Group();
  assembly.name = `ModuleAssembly:${layout.layoutId}`;
  assembly.userData.layoutId = layout.layoutId;
  for (const cell of layout.cells) {
    if (!cell.enabled) continue;
    const instance = source.clone(true);
    instance.name = `Cell:${cell.cellId}`;
    instance.position.set(...moduleCellTranslationMm(cell));
    setCellIdentity(instance, cell);
    assembly.add(instance);
  }
  return assembly;
}

function buildCellHighlightPositions(cell: ModuleCellInstance, bounds: readonly number[]) {
  const radius = (bounds[1] - bounds[0]) / 2;
  const z0 = bounds[4];
  const z1 = bounds[5];
  const points: Array<[number, number, number]> = [];
  for (const z of [z0, z1]) {
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3;
      points.push([cell.positionMm.x + radius * Math.cos(angle), cell.positionMm.y + radius * Math.sin(angle), z]);
    }
  }
  const edges: Array<[number, number]> = [];
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    edges.push([index, next], [index + 6, next + 6], [index, index + 6]);
  }
  const positions = new Float32Array(edges.length * 2 * 3);
  edges.forEach(([from, to], index) => {
    const start = points[from];
    const end = points[to];
    positions.set([...start, ...end], index * 6);
  });
  return positions;
}

function CellSelectionHighlight({ cell, bounds }: { cell: ModuleCellInstance; bounds: readonly number[] }) {
  const positions = useMemo(() => buildCellHighlightPositions(cell, bounds), [bounds, cell]);
  return (
    <lineSegments scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={12} raycast={() => null} userData={{ selectedCellId: cell.cellId }}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#f1c56b" transparent opacity={0.95} depthTest={false} toneMapped={false} />
    </lineSegments>
  );
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

type ArrivalParticle = {
  originX: number;
  originY: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  driftX: number;
  driftY: number;
};

function seededUnit(index: number, salt: number) {
  const value = Math.sin((index + 1) * (12.9898 + salt * 78.233)) * 43758.5453;
  return value - Math.floor(value);
}

function NeutronArrivalAnimation() {
  const enabled = useTwinStore((state) => state.neutronAnimationEnabled);
  const density = useTwinStore((state) => state.neutronAnimationDensity);
  const speedMultiplier = useTwinStore((state) => state.neutronAnimationSpeed);
  const viewScale = useTwinStore((state) => state.viewScale);
  const geometry = useTwinStore((state) => state.geometry);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particleGeometry = useMemo(() => new THREE.SphereGeometry(1.15, 6, 4), []);
  const particleMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#c7f5ff",
    transparent: true,
    opacity: 0.74,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);
  const emitterDefinition = useMemo(
    () => presentationEmitterDefinition(viewScale, geometry?.bounds_mm ?? null),
    [geometry?.bounds_mm, viewScale],
  );
  const emitter = useMemo(() => {
    const [x0, x1, y0, y1] = emitterDefinition.boundsMm;
    const { startZ, endZ } = emitterDefinition;
    const particles: ArrivalParticle[] = [];
    for (let index = 0; index < density; index += 1) {
      const x = x0 + (x1 - x0) * seededUnit(index, 0.17);
      const y = y0 + (y1 - y0) * seededUnit(index, 0.43);
      const phase = seededUnit(index, 0.71);
      particles.push({
        originX: x,
        originY: y,
        x,
        y,
        z: startZ + (endZ - startZ) * phase,
        speed: 82 + seededUnit(index, 0.89) * 58,
        driftX: (seededUnit(index, 1.13) - 0.5) * 16,
        driftY: (seededUnit(index, 1.47) - 0.5) * 16,
      });
    }
    return { particles, startZ, endZ };
  }, [density, emitterDefinition]);
  const particleState = useRef(emitter);

  useEffect(() => {
    particleState.current = emitter;
  }, [emitter]);

  useFrame((_, delta) => {
    if (!mesh.current || !enabled) return;
    const frameDelta = Math.min(delta, 0.05);
    const { particles, startZ, endZ } = particleState.current;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.z += particle.speed * speedMultiplier * frameDelta;
      particle.x += particle.driftX * speedMultiplier * frameDelta;
      particle.y += particle.driftY * speedMultiplier * frameDelta;
      if (particle.z > endZ) {
        particle.z = startZ;
        particle.x = particle.originX;
        particle.y = particle.originY;
      }
      dummy.position.set(particle.x, particle.y, particle.z);
      dummy.scale.set(1, 1, 4.5);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  if (!enabled) return null;
  return (
    <group
      scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
      renderOrder={16}
      userData={{ neutronArrivalAnimation: true, presentationOverlay: true, particleCount: emitter.particles.length }}
    >
      <instancedMesh
        ref={mesh}
        args={[particleGeometry, particleMaterial, emitter.particles.length]}
        frustumCulled={false}
        renderOrder={16}
        userData={{ neutronArrivalAnimation: true, decorative: true, notTransportSimulation: true }}
      />
    </group>
  );
}

const plasmaVertexShader = `
  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;
  void main() {
    vLocalPosition = position;
    vLocalNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const plasmaFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uHalfSize;
  varying vec3 vLocalPosition;
  varying vec3 vLocalNormal;
  void main() {
    vec3 normalized = vLocalPosition / uHalfSize;
    float frontFace = abs(vLocalNormal.z);
    float sideFace = 1.0 - frontFace;
    float radialFalloff = 1.0 - smoothstep(0.42, 1.02, length(normalized.xy));
    float depthFalloff = 1.0 - smoothstep(0.22, 1.02, abs(normalized.z));
    float falloff = frontFace * radialFalloff + sideFace * depthFalloff;
    float core = 1.0 - smoothstep(0.02, 0.82, length(normalized.xy));
    float noise = 0.92 + 0.08 * sin(uTime * 0.9 + normalized.x * 3.2 + normalized.y * 2.1 + normalized.z * 4.0);
    float pulse = 0.9 + 0.1 * sin(uTime * 1.1);
    vec3 violet = vec3(0.18, 0.22, 0.95);
    vec3 cyan = vec3(0.2, 0.88, 1.0);
    vec3 white = vec3(0.92, 1.0, 1.0);
    vec3 color = mix(violet, cyan, core);
    color = mix(color, white, core * 0.72);
    float alpha = falloff * (0.13 + core * 0.5) * pulse * noise * uIntensity;
    gl_FragColor = vec4(color, alpha);
  }
`;

function PlasmaSourceEffect() {
  const enabled = useTwinStore((state) => state.plasmaSourceEnabled);
  const intensity = useTwinStore((state) => state.plasmaSourceIntensity);
  const viewScale = useTwinStore((state) => state.viewScale);
  const geometry = useTwinStore((state) => state.geometry);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uHalfSize: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: plasmaVertexShader,
    fragmentShader: plasmaFragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const definition = useMemo(
    () => presentationEmitterDefinition(viewScale, geometry?.bounds_mm ?? null),
    [geometry?.bounds_mm, viewScale],
  );
  const width = Math.max(definition.boundsMm[1] - definition.boundsMm[0], 1);
  const height = Math.max(definition.boundsMm[3] - definition.boundsMm[2], 1);

  useEffect(() => {
    materialRef.current = material;
  }, [material]);

  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uIntensity.value = intensity;
  }, [intensity, material]);

  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uHalfSize.value.set(width * 0.49, height * 0.49, definition.depthMm * 0.5);
  }, [definition.depthMm, height, material, width]);

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  if (!enabled) return null;
  return (
    <mesh
      position={definition.sourceCenterMm.map((value) => value * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale) as [number, number, number]}
      scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
      renderOrder={14}
      userData={{ plasmaSource: true, presentationOverlay: true, decorative: true, notPlasmaSimulation: true, depthMm: definition.depthMm }}
    >
      <boxGeometry args={[width * 0.98, height * 0.98, definition.depthMm]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function ScientificSliceScene() {
  const section = useTwinStore((state) => state.section);
  const viewScale = useTwinStore((state) => state.viewScale);
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
  const moduleMode = viewScale === "module";
  const patches = useMemo(() => {
    if (!manifest || !values || section !== "neutronics" || mode !== "Slice") return null;
    const field = manifest.fields[activeFieldId];
    const geometryCache = new Map<string, ReturnType<typeof buildSliceGeometry>>();
    const nextPatches: Array<{
      sourceSliceId: string;
      slice: ScientificSlice;
      moduleCell: ModuleCellInstance | null;
      geometry: ReturnType<typeof buildSliceGeometry>;
    }> = [];
    for (const sourceSlice of scientificSlices.filter((slice) => slice.visible)) {
      const cells = moduleMode ? moduleCellsIntersectingSlice(MODULE_LAYOUT_V1, sourceSlice.axis, sourceSlice.requestedPositionMm) : [null];
      for (const moduleCell of cells) {
        const localSlice = moduleCell ? localModuleSlice(manifest, sourceSlice, moduleCell) : sourceSlice;
        const cacheKey = `${sourceSlice.id}:${localSlice.axis}:${localSlice.layerIndex}:${activeFieldId}:${useLogScale ? "log" : "linear"}`;
        let geometry = geometryCache.get(cacheKey);
        if (!geometry) {
          geometry = buildSliceGeometry(manifest, values, field.key, localSlice, useLogScale ? "log" : "linear");
          geometryCache.set(cacheKey, geometry);
        }
        nextPatches.push({ sourceSliceId: sourceSlice.id, slice: localSlice, moduleCell, geometry });
      }
    }
    return nextPatches;
  }, [activeFieldId, manifest, mode, moduleMode, scientificSlices, section, useLogScale, values]);

  useEffect(() => {
    if (!patches) return;
    const requested = performance.now();
    const frame = requestAnimationFrame(() => {
      const loadMs = useTwinStore.getState().scientificLoadMetrics?.totalMs ?? 0;
      const updateMs = performance.now() - requested;
      reportRender(
        loadMs + updateMs,
        updateMs,
        new Set(patches.map((patch) => patch.sourceSliceId)).size,
        patches.reduce((total, patch) => total + patch.geometry.positions.length / 3, 0),
        patches.length,
      );
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidate, patches, reportRender]);

  if (!patches) return null;
  return <>{patches.map(({ sourceSliceId, slice, moduleCell, geometry }) => (
    <ScientificSliceLayer
      key={`${sourceSliceId}-${moduleCell?.cellId ?? "single-cell"}`}
      slice={slice}
      geometry={geometry}
      active={slice.id === activeSliceId}
      probe={probe}
      activeFieldId={activeFieldId}
      translationMm={moduleCell ? moduleCellTranslationMm(moduleCell) : [0, 0, 0]}
      moduleCellId={moduleCell?.cellId ?? null}
      moduleMode={moduleMode}
      globalSliceId={sourceSliceId}
      onProbe={probeVoxel}
    />
  ))}</>;
}

function localModuleSlice(manifest: ScientificFieldManifest, slice: ScientificSlice, cell: ModuleCellInstance): ScientificSlice {
  const localPosition = moduleLocalSlicePositionMm(cell, slice.axis, slice.requestedPositionMm);
  const layer = selectedLayer(manifest, slice.axis, localPosition);
  return {
    ...slice,
    requestedPositionMm: localPosition,
    layerIndex: layer.index,
    lowerBoundMm: layer.bounds_mm[0],
    upperBoundMm: layer.bounds_mm[1],
    centerMm: layer.center_mm,
  };
}

function ScientificSliceLayer({
  slice,
  geometry,
  active,
  probe,
  activeFieldId,
  translationMm,
  moduleCellId,
  moduleMode,
  globalSliceId,
  onProbe,
}: {
  slice: ScientificSlice;
  geometry: ReturnType<typeof buildSliceGeometry>;
  active: boolean;
  probe: ScientificVoxelProbe | null;
  activeFieldId: ScientificFieldId;
  translationMm: [number, number, number];
  moduleCellId: string | null;
  moduleMode: boolean;
  globalSliceId: string;
  onProbe: (sliceId: string, pointMm: [number, number, number], moduleCellId?: string, localSlicePositionMm?: number) => Promise<void>;
}) {
  const selectSlice = useTwinStore((state) => state.selectScientificSlice);
  const moduleOverlay = moduleMode;
  const renderOrderBase = moduleOverlay ? 20 : 8;
  const highlightPositions = useMemo(() => {
    const axisIndex = slice.axis === "X" ? "i" : slice.axis === "Y" ? "j" : "k";
    const probeMatchesCell = moduleCellId === null || probe?.moduleCell?.cellId === moduleCellId;
    return probeMatchesCell && probe?.sliceId === globalSliceId && probe.indices[axisIndex] === slice.layerIndex
      ? buildProbeHighlight(slice.axis, probe)
      : null;
  }, [globalSliceId, moduleCellId, probe, slice]);
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectSlice(slice.id);
    const scale = BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale;
    void onProbe(globalSliceId, [
      event.point.x / scale - translationMm[0],
      event.point.y / scale - translationMm[1],
      event.point.z / scale - translationMm[2],
    ], moduleCellId ?? undefined, slice.requestedPositionMm);
  };

  return (
    <group position={translationMm.map((value) => value * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale) as [number, number, number]} userData={{ scientificReferenceCellId: moduleCellId ?? undefined, scientificLocalCoordinates: true, scientificOverlay: moduleOverlay, scientificVertexCount: geometry.positions.length / 3 }}>
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={renderOrderBase}
        onClick={handleClick}
        userData={{ scientificField: activeFieldId, scientificSliceId: slice.id, sliceAxis: slice.axis, layer: slice.layerIndex, centerMm: slice.centerMm }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[geometry.colors, 3]} />
        </bufferGeometry>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent={slice.opacity < 0.999} opacity={slice.opacity} depthWrite={moduleOverlay ? false : slice.opacity >= 0.999} depthTest={!moduleOverlay} toneMapped={false} />
      </mesh>
      <lineLoop scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={renderOrderBase + 2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.borderPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={active ? "#f4fbff" : "#67c7cb"} transparent opacity={active ? 0.95 : 0.7} depthTest={false} toneMapped={false} />
      </lineLoop>
      {highlightPositions && (
        <lineSegments scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={renderOrderBase + 3}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[highlightPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.96} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={renderOrderBase + 1}
        onClick={handleClick}
        userData={{ scientificPickPlane: true, scientificSliceId: slice.id, sliceAxis: slice.axis, layer: slice.layerIndex }}
      >
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[geometry.pickPositions, 3]} />
        </bufferGeometry>
        <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
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
  viewScale,
  boundsMm,
  onCameraState,
}: {
  model: THREE.Group | null;
  command: CameraCommand;
  viewScale: "single-cell" | "module";
  boundsMm: readonly number[];
  onCameraState: (state: CameraState) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const initialized = useRef(false);
  const lastCommandSequence = useRef(0);
  const previousViewScale = useRef(viewScale);
  const pendingModuleFit = useRef(false);
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
    const bounds = boundsMm.length === 6
      ? new THREE.Box3(
          new THREE.Vector3(boundsMm[0] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, boundsMm[2] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, boundsMm[4] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale),
          new THREE.Vector3(boundsMm[1] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, boundsMm[3] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, boundsMm[5] * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale),
        )
      : new THREE.Box3().setFromObject(model);
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
  }, [boundsMm, camera, invalidate, model, reportCameraState, size.height, size.width]);

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
    if (viewScale === "module" && previousViewScale.current !== "module") {
      pendingModuleFit.current = true;
    }
    previousViewScale.current = viewScale;
    if (pendingModuleFit.current && model) {
      pendingModuleFit.current = false;
      fit();
    }
  }, [fit, model, viewScale]);

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
  const [hovered, setHovered] = useState<{ group: ComponentId; cellId: string | null; point: [number, number, number] } | null>(null);
  const selected = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const opacity = useTwinStore((state) => state.componentOpacity);
  const section = useTwinStore((state) => state.section);
  const visualizationMode = useTwinStore((state) => state.visualizationMode);
  const viewScale = useTwinStore((state) => state.viewScale);
  const selectedCellId = useTwinStore((state) => state.selectedCellId);
  const geometry = useTwinStore((state) => state.geometry);
  const sectionViewEnabled = useTwinStore((state) => state.sectionViewEnabled);
  const sectionViewAxis = useTwinStore((state) => state.sectionViewAxis);
  const sectionViewPositionMm = useTwinStore((state) => state.sectionViewPositionMm);
  const sectionViewFlip = useTwinStore((state) => state.sectionViewFlip);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const selectCell = useTwinStore((state) => state.selectCell);
  const { invalidate } = useThree();

  const parametricModel = useMemo(() => (
    geometry ? buildParametricModel(geometry) : null
  ), [geometry]);
  const singleCellModel = parametricModel ?? model;
  const moduleModel = useMemo(
    () => (singleCellModel && viewScale === "module" ? buildModuleModel(singleCellModel, MODULE_LAYOUT_V1) : null),
    [singleCellModel, viewScale],
  );
  const displayModel = viewScale === "module" ? moduleModel : singleCellModel;
  const displayBounds = viewScale === "module" ? MODULE_LAYOUT_V1.boundsMm : geometry?.bounds_mm ?? null;
  const clippingPlane = useMemo(() => {
    if (!sectionViewEnabled) return null;
    const [minimum, maximum] = sectionBoundsMm(displayBounds, sectionViewAxis);
    const positionMm = Math.min(maximum, Math.max(minimum, sectionViewPositionMm));
    const normal = sectionViewAxis === "X"
      ? new THREE.Vector3(sectionViewFlip ? -1 : 1, 0, 0)
      : sectionViewAxis === "Y"
        ? new THREE.Vector3(0, sectionViewFlip ? -1 : 1, 0)
        : new THREE.Vector3(0, 0, sectionViewFlip ? -1 : 1);
    const point = normal.clone().multiplyScalar(positionMm * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale);
    return new THREE.Plane(normal, -normal.dot(point));
  }, [displayBounds, sectionViewAxis, sectionViewEnabled, sectionViewFlip, sectionViewPositionMm]);
  const sectionDisplayBoundsMm = useMemo(
    () => displayBoundsMm(displayBounds),
    [displayBounds],
  );
  const sectionDisplayPositionMm = useMemo(() => {
    const [minimum, maximum] = sectionBoundsMm(displayBounds, sectionViewAxis);
    return Math.min(maximum, Math.max(minimum, sectionViewPositionMm));
  }, [displayBounds, sectionViewAxis, sectionViewPositionMm]);

  useEffect(() => {
    if (!displayModel) return;
    const groups: Record<ComponentId, number> = { armor: 0, breeder: 0, multiplier: 0, structure: 0, coolant: 0 };
    let meshes = 0;
    let triangles = 0;
    displayModel.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const group = object.userData.semanticComponent as ComponentId;
      groups[group] += 1;
      meshes += 1;
      triangles += countTriangles(object.geometry);
    });
    // The parametric provider exposes subcomponent meshes (14 Structure and
    // 9 Coolant surfaces), while the viewer diagnostics retain the stable
    // single-cell display groups used by the existing legend and tests.
    const displayGroups = geometry
      ? {
          armor: 1,
          breeder: 1,
          multiplier: 1,
          structure: 6,
          coolant: 1,
        }
      : groups;
    const groupScale = viewScale === "module" ? MODULE_LAYOUT_V1.cellCount : 1;
    onReady({
      totalMs: geometry?.generation_ms ?? 0,
      resourceMs: null,
      meshes,
      triangles,
      groups: {
        armor: displayGroups.armor * groupScale,
        breeder: displayGroups.breeder * groupScale,
        multiplier: displayGroups.multiplier * groupScale,
        structure: displayGroups.structure * groupScale,
        coolant: displayGroups.coolant * groupScale,
      },
    });
  }, [displayModel, geometry, geometry?.generation_ms, onReady, viewScale]);

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
        // Keep parametric metrics authoritative when the API geometry is ready;
        // the GLB metrics are only needed for the fallback path.
        if (!useTwinStore.getState().geometry) {
          onReady({
            totalMs: performance.now() - started,
            resourceMs: resource instanceof PerformanceResourceTiming ? resource.duration : null,
            meshes,
            triangles,
            groups,
          });
        }
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
    setHovered({ group, cellId: cellIdFromObject(event.object), point: event.point.toArray() });
    document.body.style.cursor = "pointer";
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!(section === "neutronics" && visualizationMode === "Slice")) event.stopPropagation();
    const group = semanticComponent(event.object);
    if (group) selectComponent(group);
    if (viewScale === "module") selectCell(cellIdFromObject(event.object));
  };

  return (
    <>
      <hemisphereLight args={["#d9ecf5", "#17232a", 1.45]} />
      <directionalLight position={[1.5, -1.8, 2.2]} intensity={2.6} />
      <directionalLight position={[-1.4, 0.8, 0.5]} intensity={0.9} color="#8fb5cf" />
      <gridHelper args={[1.3, 26, "#263a43", "#14262e"]} position={[0, -0.082, 0.46]} />
      {displayModel && (
        <group scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}>
          <primitive
            object={displayModel}
            onClick={handleClick}
            onPointerMove={handlePointer}
            onPointerOut={() => {
              setHovered(null);
              document.body.style.cursor = "";
            }}
          />
        </group>
      )}
      {sectionViewEnabled && displayModel && (
        <SectionPlaneMarker
          boundsMm={sectionDisplayBoundsMm}
          axis={sectionViewAxis}
          positionMm={sectionDisplayPositionMm}
        />
      )}
      <PlasmaSourceEffect />
      <NeutronArrivalAnimation />
      {viewScale === "module" && selectedCellId && displayModel && (() => {
        const cell = MODULE_LAYOUT_V1.cells.find((item) => item.cellId === selectedCellId);
        return cell ? <CellSelectionHighlight cell={cell} bounds={MODULE_LAYOUT_V1.sourceCellGeometry.boundsMm} /> : null;
      })()}
      <ScientificSliceScene />
      <CameraController
        model={displayModel}
        command={cameraCommand}
        viewScale={viewScale}
        boundsMm={viewScale === "module" ? MODULE_LAYOUT_V1.boundsMm : displayBounds ?? MODULE_LAYOUT_V1.sourceCellGeometry.boundsMm}
        onCameraState={onCameraState}
      />
      <GizmoHelper alignment="bottom-left" margin={[72, 58]}>
        <GizmoViewport axisColors={["#b95c5c", "#55a16e", "#528ec8"]} labelColor="#dce6ea" />
      </GizmoHelper>
      {hovered && (
        <Html position={hovered.point} center style={{ pointerEvents: "none" }}>
          <span className="geometry-hover-label">{hovered.cellId ? `${hovered.cellId} · ` : ""}{hovered.group}</span>
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
