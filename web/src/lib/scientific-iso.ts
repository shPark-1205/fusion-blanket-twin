import {
  colorScalarValue,
  linearCellIndex,
  type ScientificFieldManifest,
  type ScientificFieldRecord,
  type ScaleMode,
} from "./scientific-field";

export interface ScientificIsoGeometry {
  positions: Float32Array;
  colors: Float32Array;
}

type IsoPoint = {
  position: [number, number, number];
  value: number;
};

const TETRAHEDRA = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const;

export function buildScientificIsoGeometry(
  manifest: ScientificFieldManifest,
  values: Float32Array,
  field: ScientificFieldRecord,
  isoValue: number,
  scaleMode: ScaleMode,
  displayRange: readonly [number, number],
): ScientificIsoGeometry {
  const [nz, ny, nx] = manifest.mesh.cell_shape_zyx;
  const x = manifest.mesh.axis_boundaries_mm.x;
  const y = manifest.mesh.axis_boundaries_mm.y;
  const z = manifest.mesh.axis_boundaries_mm.z;
  const nodeWidth = nx + 1;
  const nodeHeight = ny + 1;
  const nodeSums = new Float64Array((nx + 1) * (ny + 1) * (nz + 1));
  const nodeCounts = new Uint32Array(nodeSums.length);
  const nodeIndex = (i: number, j: number, k: number) => k * nodeHeight * nodeWidth + j * nodeWidth + i;

  // MCNP values are cell-associated. Reconstructing nodal values by averaging
  // neighboring cells is deliberately limited to Iso visualization geometry.
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const value = values[linearCellIndex(manifest, { i, j, k })];
        if (!Number.isFinite(value)) continue;
        for (const dk of [0, 1]) {
          for (const dj of [0, 1]) {
            for (const di of [0, 1]) {
              const index = nodeIndex(i + di, j + dj, k + dk);
              nodeSums[index] += value;
              nodeCounts[index] += 1;
            }
          }
        }
      }
    }
  }

  const nodeValue = (i: number, j: number, k: number) => {
    const index = nodeIndex(i, j, k);
    return nodeCounts[index] > 0 ? nodeSums[index] / nodeCounts[index] : 0;
  };
  const positions: number[] = [];
  const colors: number[] = [];
  const addVertex = (point: IsoPoint) => {
    positions.push(...point.position);
    colors.push(...colorScalarValue(point.value, field, scaleMode, displayRange));
  };
  const addTriangle = (a: IsoPoint, b: IsoPoint, c: IsoPoint) => {
    const ab = distanceSquared(a.position, b.position);
    const ac = distanceSquared(a.position, c.position);
    if (ab < 1e-12 || ac < 1e-12) return;
    addVertex(a);
    addVertex(b);
    addVertex(c);
  };

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const cube: IsoPoint[] = [
          makePoint(x[i], y[j], z[k], nodeValue(i, j, k)),
          makePoint(x[i + 1], y[j], z[k], nodeValue(i + 1, j, k)),
          makePoint(x[i + 1], y[j + 1], z[k], nodeValue(i + 1, j + 1, k)),
          makePoint(x[i], y[j + 1], z[k], nodeValue(i, j + 1, k)),
          makePoint(x[i], y[j], z[k + 1], nodeValue(i, j, k + 1)),
          makePoint(x[i + 1], y[j], z[k + 1], nodeValue(i + 1, j, k + 1)),
          makePoint(x[i + 1], y[j + 1], z[k + 1], nodeValue(i + 1, j + 1, k + 1)),
          makePoint(x[i], y[j + 1], z[k + 1], nodeValue(i, j + 1, k + 1)),
        ];
        for (const tetrahedron of TETRAHEDRA) {
          const tetra = tetrahedron.map((index) => cube[index]);
          const inside = tetra.filter((point) => point.value >= isoValue);
          const outside = tetra.filter((point) => point.value < isoValue);
          if (inside.length === 1) {
            const point = inside[0];
            addTriangle(interpolate(point, outside[0], isoValue), interpolate(point, outside[1], isoValue), interpolate(point, outside[2], isoValue));
          } else if (inside.length === 3) {
            const point = outside[0];
            addTriangle(interpolate(point, inside[0], isoValue), interpolate(point, inside[2], isoValue), interpolate(point, inside[1], isoValue));
          } else if (inside.length === 2) {
            const first = inside[0];
            const second = inside[1];
            const firstOutside = outside.map((point) => interpolate(first, point, isoValue));
            const secondOutside = outside.map((point) => interpolate(second, point, isoValue));
            addTriangle(firstOutside[0], firstOutside[1], secondOutside[0]);
            addTriangle(firstOutside[1], secondOutside[1], secondOutside[0]);
          }
        }
      }
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

function makePoint(x: number, y: number, z: number, value: number): IsoPoint {
  return { position: [x, y, z], value };
}

function interpolate(first: IsoPoint, second: IsoPoint, isoValue: number): IsoPoint {
  const denominator = second.value - first.value;
  const fraction = Math.abs(denominator) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (isoValue - first.value) / denominator));
  return {
    position: [
      first.position[0] + (second.position[0] - first.position[0]) * fraction,
      first.position[1] + (second.position[1] - first.position[1]) * fraction,
      first.position[2] + (second.position[2] - first.position[2]) * fraction,
    ],
    value: first.value + (second.value - first.value) * fraction,
  };
}

function distanceSquared(first: readonly number[], second: readonly number[]) {
  return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2 + (first[2] - second[2]) ** 2;
}
