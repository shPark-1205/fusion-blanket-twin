import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/inspect-glb.mjs <file.glb>");

const bytes = fs.readFileSync(source);
if (bytes.toString("ascii", 0, 4) !== "glTF") throw new Error("Not a GLB file");

const version = bytes.readUInt32LE(4);
const declaredLength = bytes.readUInt32LE(8);
let offset = 12;
let json;
while (offset < declaredLength) {
  const chunkLength = bytes.readUInt32LE(offset);
  const chunkType = bytes.readUInt32LE(offset + 4);
  const chunk = bytes.subarray(offset + 8, offset + 8 + chunkLength);
  if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").replace(/\0+$/u, "").trimEnd());
  offset += 8 + chunkLength;
}
if (!json) throw new Error("GLB has no JSON chunk");

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a, b) => {
  const out = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
};
const localMatrix = (node) => {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * y * y - 2 * z * z) * sx, (2 * x * y + 2 * z * w) * sx, (2 * x * z - 2 * y * w) * sx, 0,
    (2 * x * y - 2 * z * w) * sy, (1 - 2 * x * x - 2 * z * z) * sy, (2 * y * z + 2 * x * w) * sy, 0,
    (2 * x * z + 2 * y * w) * sz, (2 * y * z - 2 * x * w) * sz, (1 - 2 * x * x - 2 * y * y) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const point = (matrix, [x, y, z]) => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
  matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
  matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
];
const isIdentity = (matrix) => matrix.every((value, index) => Math.abs(value - identity[index]) < 1e-12);

const roots = new Set((json.scenes ?? []).flatMap((scene) => scene.nodes ?? []));
const worldMatrices = new Map();
const hierarchy = [];
const visit = (index, parentMatrix, depth) => {
  const node = json.nodes[index];
  const world = multiply(parentMatrix, localMatrix(node));
  worldMatrices.set(index, world);
  const meshName = node.mesh === undefined ? "" : ` -> mesh ${node.mesh}: ${json.meshes[node.mesh]?.name ?? "(unnamed)"}`;
  hierarchy.push(`${"  ".repeat(depth)}- node ${index}: ${node.name ?? "(unnamed)"}${meshName}`);
  for (const child of node.children ?? []) visit(child, world, depth + 1);
};
for (const root of roots) visit(root, identity, 0);

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
let primitiveCount = 0;
let vertexCount = 0;
let triangleCount = 0;
const primitiveDetails = [];
for (const [nodeIndex, world] of worldMatrices) {
  const node = json.nodes[nodeIndex];
  if (node.mesh === undefined) continue;
  for (const primitive of json.meshes[node.mesh]?.primitives ?? []) {
    primitiveCount += 1;
    const positionAccessor = json.accessors?.[primitive.attributes?.POSITION];
    if (positionAccessor) {
      vertexCount += positionAccessor.count;
      if (positionAccessor.min && positionAccessor.max) {
        for (const x of [positionAccessor.min[0], positionAccessor.max[0]])
          for (const y of [positionAccessor.min[1], positionAccessor.max[1]])
            for (const z of [positionAccessor.min[2], positionAccessor.max[2]]) {
              const transformed = point(world, [x, y, z]);
              for (let axis = 0; axis < 3; axis += 1) {
                bounds.min[axis] = Math.min(bounds.min[axis], transformed[axis]);
                bounds.max[axis] = Math.max(bounds.max[axis], transformed[axis]);
              }
            }
      }
    }
    const elementCount = primitive.indices === undefined ? (positionAccessor?.count ?? 0) : json.accessors[primitive.indices].count;
    const mode = primitive.mode ?? 4;
    if (mode === 4) triangleCount += elementCount / 3;
    else if (mode === 5 || mode === 6) triangleCount += Math.max(0, elementCount - 2);
    primitiveDetails.push({ node: node.name ?? null, mesh: json.meshes[node.mesh]?.name ?? null, mode, vertices: positionAccessor?.count ?? 0, elements: elementCount, triangles: mode === 4 ? elementCount / 3 : mode === 5 || mode === 6 ? Math.max(0, elementCount - 2) : 0 });
  }
}

const transformedNodes = (json.nodes ?? []).map((node, index) => ({ index, name: node.name ?? null, matrix: localMatrix(node) })).filter(({ matrix }) => !isIdentity(matrix));
const meshReferences = new Map();
for (const [index, node] of (json.nodes ?? []).entries()) {
  if (node.mesh !== undefined) meshReferences.set(node.mesh, [...(meshReferences.get(node.mesh) ?? []), index]);
}

console.log(JSON.stringify({
  file: path.resolve(source),
  fileSizeBytes: bytes.length,
  glbVersion: version,
  generator: json.asset?.generator ?? null,
  gltfVersion: json.asset?.version ?? null,
  scenes: (json.scenes ?? []).map((scene, index) => ({ index, name: scene.name ?? null, roots: scene.nodes ?? [] })),
  counts: {
    scenes: json.scenes?.length ?? 0,
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    primitives: primitiveCount,
    verticesAcrossPrimitives: vertexCount,
    triangles: triangleCount,
  },
  materials: (json.materials ?? []).map((material, index) => ({
    index,
    name: material.name ?? null,
    alphaMode: material.alphaMode ?? "OPAQUE",
    doubleSided: material.doubleSided ?? false,
    pbr: material.pbrMetallicRoughness ?? null,
  })),
  nodeNames: (json.nodes ?? []).map((node, index) => ({ index, name: node.name ?? null, mesh: node.mesh ?? null })),
  meshNames: (json.meshes ?? []).map((mesh, index) => ({ index, name: mesh.name ?? null, primitives: mesh.primitives?.length ?? 0 })),
  primitiveDetails,
  hierarchy,
  bounds,
  transformedNodes,
  repeatedMeshReferences: [...meshReferences].filter(([, nodes]) => nodes.length > 1).map(([mesh, nodes]) => ({ mesh, nodes })),
  gpuInstancingNodes: (json.nodes ?? []).flatMap((node, index) => node.extensions?.EXT_mesh_gpu_instancing ? [index] : []),
  extensionsUsed: json.extensionsUsed ?? [],
  extensionsRequired: json.extensionsRequired ?? [],
  compression: {
    draco: (json.extensionsUsed ?? []).includes("KHR_draco_mesh_compression"),
    meshopt: (json.extensionsUsed ?? []).includes("EXT_meshopt_compression"),
  },
}, null, 2));
