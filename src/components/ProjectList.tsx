import { useState } from "react";
import { Check, FileCode2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Project } from "../lib/projects";

type Props = {
  projects: Project[];
  activeId: string;
  disabled: boolean;
  projectBusy: boolean;
  onOpen: (id?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<boolean>;
};

export default function ProjectList({
  projects,
  activeId,
  disabled,
  projectBusy,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <section className="projects-section" aria-label="Drawing projects">
      <button
        className="button primary new-drawing"
        disabled={disabled}
        onClick={() => onOpen()}
      >
        <Plus size={16} /> New Drawing
      </button>
      <div className="section-title">
        <span>Your drawings</span>
        <span className="layer-count">{projects.length}</span>
      </div>
      <div className="project-list">
        {projects.map((project) => (
          <div
            key={project.id}
            className={`project-row ${activeId === project.id ? "active" : ""}`}
          >
            {renaming === project.id ? (
              <form
                className="project-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectName.trim()) return;
                  onRename(project.id, projectName);
                  setRenaming(null);
                }}
              >
                <input
                  aria-label="Project name"
                  autoFocus
                  maxLength={120}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
                <button
                  className="icon-button"
                  aria-label="Save project name"
                  disabled={!projectName.trim()}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel rename"
                  onClick={() => setRenaming(null)}
                >
                  <X size={14} />
                </button>
              </form>
            ) : (
              <>
                <button
                  className="project-open"
                  aria-label={`Open drawing ${project.name}`}
                  aria-current={activeId === project.id ? "true" : undefined}
                  disabled={disabled}
                  onClick={() => onOpen(project.id)}
                >
                  <FileCode2 size={16} />
                  <span>
                    <strong title={project.name}>{project.name}</strong>
                    <small>
                      {project.history.items[project.history.index]
                        ? "Vector drawing"
                        : "Ready for your idea"}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button project-action"
                  aria-label={`Rename drawing ${project.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setRenaming(project.id);
                    setProjectName(project.name);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-button project-action"
                  aria-label={`Delete drawing ${project.name}`}
                  disabled={disabled}
                  onClick={() => setDeleting(project.id)}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
            {deleting === project.id && (
              <div className="project-delete" role="alert">
                <span>Delete this drawing and its conversation?</span>
                <button
                  disabled={projectBusy}
                  onClick={() =>
                    void onDelete(project.id).then((removed) => {
                      if (removed) setDeleting(null);
                    })
                  }
                >
                  Delete
                </button>
                <button onClick={() => setDeleting(null)}>Keep</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
