import { useCallback, type SetStateAction } from "react";
import type { Project } from "../lib/projects";

export type UpdateProject = (
  id: string,
  update: (project: Project) => Project,
) => void;

/** A setter retains its project's identity across awaits and navigation. */
export function useProjectField<K extends keyof Project>(
  project: Project | undefined,
  key: K,
  fallback: Project[K],
  update: UpdateProject,
) {
  const id = project?.id || "";
  const set = useCallback(
    (value: SetStateAction<Project[K]>) => {
      update(id, (current) => ({
        ...current,
        [key]:
          typeof value === "function"
            ? (value as (previous: Project[K]) => Project[K])(current[key])
            : value,
      }));
    },
    [id, key, update],
  );
  return [project ? project[key] : fallback, set] as const;
}
