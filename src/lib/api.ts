import type { DrawingResult, DrawingRequest, ModelConfig } from "./contracts";
import { streamPost, type DeltaHandler } from "./stream";
import type { ToolPending } from "./agent-activity";

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The server returned an invalid response. Please try again.",
    );
  }
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result as T;
}
export const requestDrawing = (
  input: DrawingRequest,
  signal: AbortSignal,
  onDelta: DeltaHandler,
  onToolPending?: (event: ToolPending) => void,
) =>
  streamPost<DrawingResult>("/api/draw", input, signal, onDelta, onToolPending);
export const discoverModels = (config: ModelConfig, signal?: AbortSignal) =>
  post<{ models: string[] }>("/api/models", config, signal);
export const testConnection = (
  config: ModelConfig,
  signal?: AbortSignal,
  onDelta?: DeltaHandler,
) =>
  streamPost<{ ok: boolean; model: string }>(
    "/api/test",
    config,
    signal,
    onDelta,
  );
