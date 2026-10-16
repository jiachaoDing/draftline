import { useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import { Check, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import type { Project } from "../lib/projects";

type Props = {
  projects: Project[];
  activeId: string;
  disabled: boolean;
  projectBusy: boolean;
  onOpen: (id: string) => void;
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
  const [deleting, setDeleting] = useState<Project | null>(null);
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const finishRename = (id: string) => {
    setRenaming(null);
    requestAnimationFrame(() => actionButtons.current.get(id)?.focus());
  };

  return (
    <>
      <ul className="project-list" aria-label="Drawings">
        {projects.map((project) => (
          <li
            key={project.id}
            className={`project-row ${activeId === project.id ? "active" : ""}`}
          >
            {renaming === project.id ? (
              <form
                className="project-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (disabled || !projectName.trim()) return;
                  onRename(project.id, projectName);
                  finishRename(project.id);
                }}
              >
                <input
                  aria-label="Project name"
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  maxLength={120}
                  value={projectName}
                  disabled={disabled}
                  onChange={(event) => setProjectName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") finishRename(project.id);
                  }}
                />
                <button
                  className="icon-button"
                  aria-label="Save project name"
                  disabled={disabled || !projectName.trim()}
                >
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel rename"
                  onClick={() => finishRename(project.id)}
                >
                  <X size={15} />
                </button>
              </form>
            ) : (
              <>
                <button
                  className="project-open"
                  aria-label={`Open drawing ${project.name}`}
                  aria-current={activeId === project.id ? "page" : undefined}
                  title={project.name}
                  disabled={disabled}
                  onClick={() => onOpen(project.id)}
                >
                  <span>{project.name}</span>
                </button>
                <Menu>
                  <MenuButton
                    ref={(button) => {
                      if (button) actionButtons.current.set(project.id, button);
                      else actionButtons.current.delete(project.id);
                    }}
                    className="icon-button project-action"
                    aria-label={`Drawing actions for ${project.name}`}
                    title="Drawing actions"
                    disabled={disabled}
                  >
                    <MoreHorizontal size={17} />
                  </MenuButton>
                  <MenuItems anchor="bottom end" className="project-menu">
                    <MenuItem>
                      <button
                        disabled={disabled}
                        aria-label={`Rename drawing ${project.name}`}
                        onClick={() => {
                          setRenaming(project.id);
                          setProjectName(project.name);
                        }}
                      >
                        <Pencil size={15} /> Rename
                      </button>
                    </MenuItem>
                    <MenuItem>
                      <button
                        className="danger-action"
                        disabled={disabled}
                        aria-label={`Delete drawing ${project.name}`}
                        onClick={() => setDeleting(project)}
                      >
                        <Trash2 size={15} /> Delete
                      </button>
                    </MenuItem>
                  </MenuItems>
                </Menu>
              </>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={!!deleting}
        onClose={() => {
          if (!projectBusy) setDeleting(null);
        }}
        className="project-dialog"
      >
        <DialogBackdrop className="project-dialog-backdrop" />
        <div className="project-dialog-position">
          <DialogPanel className="project-dialog-panel">
            <DialogTitle>Delete drawing?</DialogTitle>
            <p>
              <strong>{deleting?.name}</strong> and its conversation will be
              permanently deleted.
            </p>
            <div className="project-dialog-actions">
              <button
                className="button secondary"
                data-autofocus
                disabled={projectBusy}
                onClick={() => setDeleting(null)}
              >
                Keep
              </button>
              <button
                className="button delete-project"
                disabled={disabled}
                onClick={() => {
                  if (deleting)
                    void onDelete(deleting.id).then((removed) => {
                      if (removed) setDeleting(null);
                    });
                }}
              >
                Delete
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
