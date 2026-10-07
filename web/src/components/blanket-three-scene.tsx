"use client";

import { GizmoHelper, GizmoViewport, Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  resolveDisplayRange,
  selectedLayer,
  type ScaleMode,
  type ScientificFieldManifest,
  type ScientificVoxelProbe,
} from "@/lib/scientific-field";
import { buildScientificIsoGeometry, type ScientificIsoGeometry } from "@/lib/scientific-iso";
import {
  recordBufferAttributeAllocation,
  recordBufferGeometryCreationDuration,
  recordBufferGeometryCreation,
  recordBlanketModelRender,
  recordColorMapping,
  recordGlobalToLocalMapping,
  recordGeometryCacheHit,
  recordGeometryCacheMiss,
  recordModuleIntersectionCalculation,
  recordScientificComponentRender,
  recordScientificSceneRender,
  recordScientificRender,
  recordSliceExtraction,
  recordSliceExtractionDuration,
} from "@/lib/scientific-performance";

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

type Point3 = [number, number, number];

function buildCanonicalHexPoints(bounds: readonly number[], z: number): Point3[] {
  const centerX = (bounds[0] + bounds[1]) / 2;
  const centerY = (bounds[2] + bounds[3]) / 2;
  const radius = MODULE_LAYOUT_V1.pitchDefinition.circumradiusMm;
  const apothem = MODULE_LAYOUT_V1.pitchDefinition.apothemMm;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = index * Math.PI / 3;
    return [centerX + radius * Math.cos(angle), centerY + apothem * Math.sin(angle), z];
  });
}

function buildCellHighlightPositions(cell: ModuleCellInstance, bounds: readonly number[]) {
  const frontPoints = buildCanonicalHexPoints(bounds, bounds[4] - 0.7);
  const rearPoints = buildCanonicalHexPoints(bounds, bounds[5] + 0.7);
  const points = [...frontPoints, ...rearPoints].map(([x, y, z]) => [
    x + cell.positionMm.x,
    y + cell.positionMm.y,
    z,
  ] as Point3);
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

function buildHexCapPositions(bounds: readonly number[], z: number) {
  const points = buildCanonicalHexPoints(bounds, z);
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set(point, index * 3));
  return positions;
}

function ModuleCellBoundaryOutlines({
  bounds,
  clippingPlane,
}: {
  bounds: readonly number[];
  clippingPlane: THREE.Plane | null;
}) {
  const frontZ = bounds[4] - 0.7;
  const frontPositions = useMemo(() => buildHexCapPositions(bounds, frontZ), [bounds, frontZ]);
  const frontCapGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(frontPositions, 3));
    return geometry;
  }, [frontPositions]);
  if (MODULE_LAYOUT_V1.cellCount === 0) return null;
  return (
    <group userData={{ moduleCellBoundaries: true, boundaryArchitecture: "front-cap-overlay", instanceCount: MODULE_LAYOUT_V1.cellCount }}>
      {MODULE_LAYOUT_V1.cells.filter((cell) => cell.enabled).map((cell) => {
        const [x, y, z] = moduleCellTranslationMm(cell);
        return (
          <lineLoop
            key={cell.cellId}
            position={[x * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, y * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale, z * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale]}
            renderOrder={20}
            raycast={() => null}
            userData={{ moduleCellBoundary: true, moduleFrontCapBoundary: true, cellId: cell.cellId }}
          >
            <primitive object={frontCapGeometry} attach="geometry" />
            <lineBasicMaterial
              color="#f4fbff"
              opacity={0.96}
              depthTest={false}
              depthWrite={false}
              toneMapped={false}
              clippingPlanes={clippingPlane ? [clippingPlane] : []}
            />
          </lineLoop>
        );
      })}
    </group>
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

const MAX_SCIENTIFIC_GEOMETRY_CACHE_ENTRIES = 256;
// CPU arrays and their GPU buffers both remain resident while cached. A real
// 146x146 Z layer is roughly 3 MiB of position/color data before GPU upload.
const MAX_SCIENTIFIC_GEOMETRY_CACHE_BYTES = 96 * 1024 * 1024;

function scientificGeometryBytes(geometry: ReturnType<typeof buildSliceGeometry>): number {
  return geometry.positions.byteLength + geometry.colors.byteLength
    + geometry.pickPositions.byteLength + geometry.borderPositions.byteLength;
}

function touchScientificCache<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
}

function evictScientificCacheEntry(
  geometryCache: Map<string, ReturnType<typeof buildSliceGeometry>>,
  renderGeometryCache: Map<string, ScientificRenderGeometry>,
  protectedKeys: ReadonlySet<string>,
  incomingBytes: number,
) {
  let cacheBytes = [...geometryCache.values()].reduce((total, geometry) => total + scientificGeometryBytes(geometry), 0);
  while (geometryCache.size >= MAX_SCIENTIFIC_GEOMETRY_CACHE_ENTRIES
    || (cacheBytes + incomingBytes > MAX_SCIENTIFIC_GEOMETRY_CACHE_BYTES && geometryCache.size > 0)) {
    const key = [...geometryCache.keys()].find((candidate) => !protectedKeys.has(candidate));
    if (!key) break; // Active multi-slice layers must never be evicted.
    const geometry = geometryCache.get(key)!;
    cacheBytes -= scientificGeometryBytes(geometry);
    geometryCache.delete(key);
    const renderGeometry = renderGeometryCache.get(key);
    renderGeometry?.surface.dispose();
    renderGeometry?.border.dispose();
    renderGeometry?.pick.dispose();
    renderGeometryCache.delete(key);
  }
}

function scientificSliceRenderSignature(
  slices: ScientificSlice[],
  viewScale: "single-cell" | "module",
  manifest: ScientificFieldManifest | undefined,
): string {
  return slices.filter((slice) => slice.visible).map((slice) => {
    const cells = viewScale === "module"
      ? moduleCellsIntersectingSlice(MODULE_LAYOUT_V1, slice.axis, slice.requestedPositionMm)
      : [null];
    const layers = cells.map((cell) => cell && manifest
      ? `${cell.cellId}:${selectedLayer(manifest, slice.axis, moduleLocalSlicePositionMm(cell, slice.axis, slice.requestedPositionMm)).index}`
      : `single-cell:${slice.layerIndex}`);
    return `${slice.id}|${slice.axis}|${slice.opacity}|${layers.join(",")}`;
  }).join(";");
}

function ScientificSliceScene() {
  recordScientificSceneRender();
  const section = useTwinStore((state) => state.section);
  const viewScale = useTwinStore((state) => state.viewScale);
  const mode = useTwinStore((state) => state.visualizationMode);
  // The requested coordinate can change many times inside one raw FMESH layer.
  // Only subscribe the Three.js scene when a rendered layer/membership changes.
  const sliceRenderSignature = useTwinStore((state) => scientificSliceRenderSignature(
    state.scientificSlices, state.viewScale, state.scientificField?.manifest,
  ));
  const activeSliceId = useTwinStore((state) => state.activeScientificSliceId);
  const activeFieldId = useTwinStore((state) => state.activeFieldId) as ScientificFieldId;
  const scientificData = useTwinStore((state) => state.scientificField);
  const useLogScale = useTwinStore((state) => state.useLogScale);
  const displayRangeState = useTwinStore((state) => state.scientificDisplayRanges[activeFieldId]);
  const isoValuesByField = useTwinStore((state) => state.isoValuesByField);
  const probe = useTwinStore((state) => state.scientificProbe);
  const probeVoxel = useTwinStore((state) => state.probeScientificVoxel);
  const reportRender = useTwinStore((state) => state.reportScientificRender);
  const { invalidate } = useThree();
  const manifest = scientificData?.manifest ?? null;
  const values = scientificData?.valuesByField[activeFieldId] ?? null;
  const moduleMode = viewScale === "module";
  const scaleMode: ScaleMode = useLogScale ? "log" : "linear";
  const field = manifest?.fields[activeFieldId] ?? null;
  const displayRange = useMemo(
    () => field ? resolveDisplayRange(field, scaleMode, displayRangeState) : [0, 1] as [number, number],
    [displayRangeState, field, scaleMode],
  );
  const isoValue = isoValuesByField[activeFieldId] ?? defaultIsoValue(displayRange, useLogScale);
  const [isoGeometryCache] = useState(() => new Map<string, ScientificIsoGeometry>());
  const [geometryCache] = useState(() => new Map<string, ReturnType<typeof buildSliceGeometry>>());
  const [renderGeometryCache] = useState(() => new Map<string, ScientificRenderGeometry>());
  const renderInputs = useMemo(() => {
    const scientificSlices = useTwinStore.getState().scientificSlices;
    if (!manifest || !values || section !== "neutronics" || mode !== "Slice") return null;
    const planEntries: ScientificRenderPlanEntry[] = [];
    const signatureEntries: string[] = [];
    for (const sourceSlice of scientificSlices.filter((slice) => slice.visible)) {
      const cells = moduleMode
        ? (recordModuleIntersectionCalculation(), moduleCellsIntersectingSlice(MODULE_LAYOUT_V1, sourceSlice.axis, sourceSlice.requestedPositionMm))
        : [null];
      const mappedCells: string[] = [];
      for (const moduleCell of cells) {
        const localSlice = moduleCell ? localModuleSlice(manifest, sourceSlice, moduleCell) : sourceSlice;
        mappedCells.push(`${moduleCell?.cellId ?? "single-cell"}:${localSlice.layerIndex}`);
        planEntries.push({
          sourceSlice,
          moduleCell,
          localSlice,
          geometryKey: `${manifest.dataset_id}|${activeFieldId}|${localSlice.axis}|${localSlice.layerIndex}|${scaleMode}|${displayRange[0]}|${displayRange[1]}`,
          translationMm: moduleCell ? moduleCellTranslationMm(moduleCell) : [0, 0, 0],
        });
      }
      signatureEntries.push(`${sourceSlice.id}|${sourceSlice.axis}|${sourceSlice.opacity}|${mappedCells.join(",")}`);
    }
    const signature = `${manifest.dataset_id}|${activeFieldId}|${scaleMode}|${displayRange[0]}|${displayRange[1]}|${signatureEntries.join(";")}`;
    return { signature, entries: planEntries };
  // The external-store signature intentionally invalidates this snapshot even
  // though the slices are read from getState rather than referenced directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFieldId, displayRange, manifest, mode, moduleMode, scaleMode, sliceRenderSignature, section, values]);
  // The signature contains every render-relevant layer/membership dimension.
  // Requested positions inside one raw layer intentionally reuse the prior plan.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderPlan = useMemo(() => renderInputs, [renderInputs?.signature]);
  const patches = useMemo(() => {
    if (!renderPlan || !manifest || !values) return null;
    const nextPatches: ScientificSlicePatch[] = [];
    const protectedKeys = new Set(renderPlan.entries.map((entry) => entry.geometryKey));
    for (const entry of renderPlan.entries) {
      let geometry = geometryCache.get(entry.geometryKey);
      if (geometry) {
        recordGeometryCacheHit();
        touchScientificCache(geometryCache, entry.geometryKey, geometry);
      } else {
        recordGeometryCacheMiss();
        geometry = buildSliceGeometry(manifest, values, activeFieldId, entry.localSlice, scaleMode, displayRange);
        evictScientificCacheEntry(geometryCache, renderGeometryCache, protectedKeys, scientificGeometryBytes(geometry));
        touchScientificCache(geometryCache, entry.geometryKey, geometry);
      }
      let renderGeometry = renderGeometryCache.get(entry.geometryKey);
      if (!renderGeometry) {
        renderGeometry = createScientificRenderGeometry(geometry);
        touchScientificCache(renderGeometryCache, entry.geometryKey, renderGeometry);
      } else {
        touchScientificCache(renderGeometryCache, entry.geometryKey, renderGeometry);
      }
      nextPatches.push({ ...entry, geometry, renderGeometry });
    }
    return nextPatches;
  }, [activeFieldId, displayRange, geometryCache, manifest, renderGeometryCache, renderPlan, scaleMode, values]);

  const isoPatches = useMemo(() => {
    if (!manifest || !values || !field || section !== "neutronics" || mode !== "Iso-surface") return null;
    const cacheKey = `${manifest.dataset_id}:${activeFieldId}:${isoValue}:${scaleMode}:${displayRange[0]}:${displayRange[1]}`;
    let geometry = isoGeometryCache.get(cacheKey);
    if (!geometry) {
      geometry = buildScientificIsoGeometry(manifest, values, field, isoValue, scaleMode, displayRange);
      isoGeometryCache.set(cacheKey, geometry);
    }
    const cells = moduleMode ? MODULE_LAYOUT_V1.cells.filter((cell) => cell.enabled) : [null];
    return { geometry, cells };
  }, [activeFieldId, displayRange, field, isoGeometryCache, isoValue, manifest, mode, moduleMode, scaleMode, section, values]);
  const isoRenderGeometry = useMemo(
    () => isoPatches ? createScientificIsoRenderGeometry(isoPatches.geometry) : null,
    [isoPatches],
  );
  useEffect(() => () => isoRenderGeometry?.dispose(), [isoRenderGeometry]);

  useEffect(() => {
    const renderedPatches = mode === "Iso-surface" ? isoPatches?.cells.length ?? 0 : patches?.length ?? 0;
    const renderedVertices = mode === "Iso-surface"
      ? (isoPatches?.geometry.positions.length ?? 0) / 3 * renderedPatches
      : patches?.reduce((total, patch) => total + patch.geometry.positions.length / 3, 0) ?? 0;
    if (renderedPatches === 0 && !patches && !isoPatches) return;
    const requested = performance.now();
    const frame = requestAnimationFrame(() => {
      const loadMs = useTwinStore.getState().scientificLoadMetrics?.totalMs ?? 0;
      const updateMs = performance.now() - requested;
      reportRender(
        loadMs + updateMs,
        updateMs,
        mode === "Iso-surface" ? 0 : new Set(patches?.map((patch) => patch.sourceSlice.id)).size,
        renderedVertices,
        renderedPatches,
      );
      recordScientificRender(renderedPatches);
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidate, isoPatches, mode, patches, reportRender]);

  if (mode === "Iso-surface") {
    if (!isoPatches || !isoRenderGeometry) return null;
    return <>{isoPatches.cells.map((moduleCell) => (
      <ScientificIsoLayer
        key={moduleCell?.cellId ?? "single-cell"}
        renderGeometry={isoRenderGeometry}
        translationMm={moduleCell ? moduleCellTranslationMm(moduleCell) : [0, 0, 0]}
        moduleMode={moduleMode}
      />
    ))}</>;
  }
  if (!patches) return null;
  // R3F's development profiler recursively formats props. Passing Float32Arrays
  // to each cell component made 28 cells cost seconds despite shared geometry.
  return <>{patches.map(({ sourceSlice, localSlice, moduleCell, geometry, renderGeometry, translationMm }) => (
    <ScientificSliceLayer
      key={`${sourceSlice.id}-${moduleCell?.cellId ?? "single-cell"}`}
      slice={localSlice}
      vertexCount={geometry.positions.length / 3}
      renderGeometry={renderGeometry}
      active={localSlice.id === activeSliceId}
      probe={probe}
      activeFieldId={activeFieldId}
      translationMm={translationMm}
      moduleCellId={moduleCell?.cellId ?? null}
      moduleMode={moduleMode}
      globalSliceId={sourceSlice.id}
      onProbe={probeVoxel}
    />
  ))}</>;
}

function defaultIsoValue(range: readonly [number, number], log: boolean) {
  return log && range[0] > 0 ? Math.sqrt(range[0] * range[1]) : range[0] + (range[1] - range[0]) / 2;
}

function createScientificIsoRenderGeometry(geometry: ScientificIsoGeometry) {
  const renderGeometry = new THREE.BufferGeometry();
  renderGeometry.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
  renderGeometry.setAttribute("color", new THREE.BufferAttribute(geometry.colors, 3));
  renderGeometry.computeVertexNormals();
  return renderGeometry;
}

function ScientificIsoLayer({
  renderGeometry,
  translationMm,
  moduleMode,
}: {
  renderGeometry: THREE.BufferGeometry;
  translationMm: [number, number, number];
  moduleMode: boolean;
}) {
  return (
    <group dispose={null} position={translationMm.map((value) => value * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale) as [number, number, number]} userData={{ scientificIsoSurface: true, scientificOverlay: moduleMode }}>
      <mesh scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={moduleMode ? 20 : 8}>
        <primitive object={renderGeometry} attach="geometry" />
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={moduleMode ? 0.62 : 0.55} depthWrite={false} depthTest={!moduleMode} toneMapped={false} />
      </mesh>
    </group>
  );
}

type ScientificSlicePatch = {
  sourceSlice: ScientificSlice;
  moduleCell: ModuleCellInstance | null;
  localSlice: ScientificSlice;
  geometryKey: string;
  translationMm: [number, number, number];
  geometry: ReturnType<typeof buildSliceGeometry>;
  renderGeometry: ScientificRenderGeometry;
};

type ScientificRenderPlanEntry = {
  sourceSlice: ScientificSlice;
  moduleCell: ModuleCellInstance | null;
  localSlice: ScientificSlice;
  geometryKey: string;
  translationMm: [number, number, number];
};

type ScientificRenderGeometry = {
  surface: THREE.BufferGeometry;
  border: THREE.BufferGeometry;
  pick: THREE.BufferGeometry;
};

function createScientificRenderGeometry(geometry: ReturnType<typeof buildSliceGeometry>): ScientificRenderGeometry {
  const started = performance.now();
  const surface = new THREE.BufferGeometry();
  const border = new THREE.BufferGeometry();
  const pick = new THREE.BufferGeometry();
  recordBufferGeometryCreation();
  recordBufferGeometryCreation();
  recordBufferGeometryCreation();
  surface.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
  surface.setAttribute("color", new THREE.BufferAttribute(geometry.colors, 3));
  border.setAttribute("position", new THREE.BufferAttribute(geometry.borderPositions, 3));
  pick.setAttribute("position", new THREE.BufferAttribute(geometry.pickPositions, 3));
  recordBufferAttributeAllocation();
  recordBufferAttributeAllocation();
  recordBufferAttributeAllocation();
  recordBufferAttributeAllocation();
  recordBufferGeometryCreationDuration(performance.now() - started);
  return { surface, border, pick };
}

function localModuleSlice(manifest: ScientificFieldManifest, slice: ScientificSlice, cell: ModuleCellInstance): ScientificSlice {
  recordGlobalToLocalMapping();
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

const ScientificSliceLayer = memo(function ScientificSliceLayer({
  slice,
  vertexCount,
  renderGeometry,
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
  vertexCount: number;
  renderGeometry: ScientificRenderGeometry;
  active: boolean;
  probe: ScientificVoxelProbe | null;
  activeFieldId: ScientificFieldId;
  translationMm: [number, number, number];
  moduleCellId: string | null;
  moduleMode: boolean;
  globalSliceId: string;
  onProbe: (sliceId: string, pointMm: [number, number, number], moduleCellId?: string, localSlicePositionMm?: number) => Promise<void>;
}) {
  recordScientificComponentRender();
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
    <group dispose={null} position={translationMm.map((value) => value * BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale) as [number, number, number]} userData={{ scientificReferenceCellId: moduleCellId ?? undefined, scientificLocalCoordinates: true, scientificOverlay: moduleOverlay, scientificVertexCount: vertexCount }}>
      <mesh
        scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale}
        renderOrder={renderOrderBase}
        onClick={handleClick}
        userData={{ scientificField: activeFieldId, scientificSliceId: slice.id, sliceAxis: slice.axis, layer: slice.layerIndex, centerMm: slice.centerMm }}
      >
        <primitive object={renderGeometry.surface} attach="geometry" />
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent={slice.opacity < 0.999} opacity={slice.opacity} depthWrite={moduleOverlay ? false : slice.opacity >= 0.999} depthTest={!moduleOverlay} toneMapped={false} />
      </mesh>
      <lineLoop scale={BLANKET_GEOMETRY_ADAPTER.sourceToSceneScale} renderOrder={renderOrderBase + 2}>
        <primitive object={renderGeometry.border} attach="geometry" />
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
        <primitive object={renderGeometry.pick} attach="geometry" />
        <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
  );
});

function buildSliceGeometry(
  manifest: ScientificFieldManifest,
  values: Float32Array,
  fieldId: ScientificFieldId,
  slice: ScientificSlice,
  scaleMode: "linear" | "log",
  displayRange: readonly [number, number],
) {
  const started = performance.now();
  recordSliceExtraction();
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
  let colorMappings = 0;

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
    colorMappings += 1;
    const color = colorScalarValue(value, field, scaleMode, displayRange);
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

  recordColorMapping(colorMappings);
  recordSliceExtractionDuration(performance.now() - started);
  return {
    positions: offset === positions.length ? positions : positions.slice(0, offset),
    colors: offset === colors.length ? colors : colors.slice(0, offset),
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
  recordBlanketModelRender();
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
      {viewScale === "module" && displayModel && (
        <ModuleCellBoundaryOutlines
          bounds={MODULE_LAYOUT_V1.sourceCellGeometry.boundsMm}
          clippingPlane={clippingPlane}
        />
      )}
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

export const BlanketThreeScene = memo(function BlanketThreeScene(props: SceneProps) {
  const useDemandFrames = useTwinStore((state) => state.viewScale === "module"
    && !state.neutronAnimationEnabled && !state.plasmaSourceEnabled);
  return (
    <Canvas
      aria-label="Interactive Web CAD blanket geometry"
      frameloop={useDemandFrames ? "demand" : "always"}
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
});
