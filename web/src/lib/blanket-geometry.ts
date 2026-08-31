import type { ComponentId } from "./twin-types";

export const BLANKET_MODEL_URL = "/models/blanket_unit_cell.glb";

// Source accessor coordinates are millimetres and match the project X/Y/Z axes.
// The GLB's own node transforms contain the Blender export rotation and are kept.
// Three.js scene units are metres solely for stable camera/control magnitudes.
export const BLANKET_GEOMETRY_ADAPTER = {
  sourceUnits: "mm",
  sceneUnits: "m",
  sourceToSceneScale: 0.001,
  sourceBoundsMm: {
    min: [-72.168785, -62.500132, -0.000008] as const,
    max: [72.168785, 62.500008, 921.000132] as const,
  },
} as const;

export const COMPONENT_APPEARANCE: Record<ComponentId, {
  color: string;
  metalness: number;
  roughness: number;
}> = {
  armor: { color: "#8269a8", metalness: 0.28, roughness: 0.45 },
  breeder: { color: "#d88c45", metalness: 0.05, roughness: 0.58 },
  multiplier: { color: "#6f9b78", metalness: 0.12, roughness: 0.52 },
  structure: { color: "#87949d", metalness: 0.56, roughness: 0.38 },
  coolant: { color: "#4a91c8", metalness: 0.02, roughness: 0.3 },
};

const mapping: Array<{ group: ComponentId; patterns: RegExp[] }> = [
  { group: "armor", patterns: [/^armor$/i] },
  { group: "breeder", patterns: [/^breeder$/i] },
  { group: "multiplier", patterns: [/^multiplier$/i] },
  { group: "coolant", patterns: [/^coolant(?:[ _-].*)?$/i] },
  { group: "structure", patterns: [/^first wall$/i, /^pressure tube$/i, /^pin(?:[ _-].*)?$/i, /^bss(?:[ _-].*)?$/i] },
];

function leafName(value: string) {
  return (value.split(/[\\/]/u).at(-1) ?? value).replace(/[_.-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function semanticComponentForNames(names: Array<string | null | undefined>): ComponentId | null {
  for (const rawName of names) {
    if (!rawName) continue;
    const name = leafName(rawName);
    for (const entry of mapping) {
      if (entry.patterns.some((pattern) => pattern.test(name))) return entry.group;
    }
  }
  return null;
}

export const SOURCE_NAME_MAPPING: Record<ComponentId, readonly string[]> = {
  armor: ["Armor"],
  breeder: ["Breeder"],
  multiplier: ["Multiplier"],
  structure: ["First Wall", "Pressure Tube", "Pin_1", "Pin_2", "BSS_1", "BSS_2"],
  coolant: ["Coolant"],
};
