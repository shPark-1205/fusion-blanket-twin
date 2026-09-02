import { TWIN_API_BASE_URL, TwinApiError } from "./twin-api";

export interface GeometryDesignRequest {
  pz_206: number;
  cz_301_radius: number;
}

export interface GeometryComponentMesh {
  id: string;
  group: "Armor" | "Breeder" | "Multiplier" | "Structure" | "Coolant";
  display_name: string;
  positions: number[];
  indices: number[];
  bounds_mm: number[];
  vertex_count: number;
  triangle_count: number;
}

export interface GeometryDesignResponse {
  design: GeometryDesignRequest & { units: { pz_206: "cm"; cz_301_radius: "cm" } };
  units: "mm";
  provenance: {
    source: string;
    provider: string;
    representation: string;
    coordinate_transform: string;
  };
  bounds_mm: number[];
  components: GeometryComponentMesh[];
  component_count: number;
  vertex_count: number;
  triangle_count: number;
  generation_ms: number;
  cache_hit: boolean;
}

async function requestGeometry(request: GeometryDesignRequest): Promise<GeometryDesignResponse> {
  let response: Response;
  try {
    response = await fetch(`${TWIN_API_BASE_URL}/api/geometry/design`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new TwinApiError("Geometry API is unavailable.", null);
  }
  if (!response.ok) {
    let detail = `Geometry API request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the safe status-based error.
    }
    throw new TwinApiError(detail, response.status);
  }
  return response.json() as Promise<GeometryDesignResponse>;
}

export const geometryApi = { design: requestGeometry };
