import type { AIResult, DrawingRequest, ModelConfig } from "./contracts";

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
export const requestDrawing = (input: DrawingRequest, signal: AbortSignal) =>
  post<AIResult>("/api/draw", input, signal);
export const discoverModels = (config: ModelConfig) =>
  post<{ models: string[] }>("/api/models", config);
export const testConnection = (config: ModelConfig) =>
  post<{ ok: boolean }>("/api/test", config);
