import type {
  DesignDomain,
  ScalarPredictionRequest,
  ScalarPredictionResponse,
  TwinApiHealth,
} from "./twin-types";

export const TWIN_API_BASE_URL = (
  process.env.NEXT_PUBLIC_TWIN_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export class TwinApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "TwinApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${TWIN_API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new TwinApiError("Twin API is unavailable.", null);
  }

  if (!response.ok) {
    let detail = `Twin API request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // The status code remains the useful, safe browser-facing error.
    }
    throw new TwinApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

export const twinApi = {
  health: () => requestJson<TwinApiHealth>("/api/health"),
  designDomain: () => requestJson<DesignDomain>("/api/design-domain"),
  predictScalars: (request: ScalarPredictionRequest) =>
    requestJson<ScalarPredictionResponse>("/api/predict/scalars", {
      method: "POST",
      body: JSON.stringify(request),
    }),
};
