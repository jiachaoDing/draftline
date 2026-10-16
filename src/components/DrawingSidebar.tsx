import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Transition,
} from "@headlessui/react";
import { CircleHelp, Search, SquarePen, X } from "lucide-react";
import ProjectList from "./ProjectList";
import type { Project } from "../lib/projects";

type Props = {
  open: boolean;
  onToggle: (open: boolean) => void;
  projects: Project[];
  activeId: string;
  disabled: boolean;
  projectBusy: boolean;
  onOpen: (id?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onHelp: () => void;
};

export default function DrawingSidebar({
  open,
  onToggle,
  projects,
  activeId,
  disabled,
  projectBusy,
  onOpen,
  onRename,
  onDelete,
  onHelp,
}: Props) {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const [query, setQuery] = useState("");
  const pendingNavigation = useRef<{ id?: string } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setMobile(media.matches);
      onToggle(!media.matches);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [onToggle]);
  const matching = [...projects]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((project) =>
      project.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    );
  const openDrawing = (id?: string) => {
    if (!id) setQuery("");
    if (mobile) {
      pendingNavigation.current = { id };
      onToggle(false);
    } else onOpen(id);
  };
  const content = (
    <>
      <div className="sidebar-navigation">
        <div className="sidebar-top-row">
          <button
            className="sidebar-link new-drawing"
            disabled={disabled}
            onClick={() => openDrawing()}
          >
            <SquarePen size={18} /> New Drawing
          </button>
          {mobile && (
            <button
              className="icon-button"
              aria-label="Close sidebar"
              onClick={() => onToggle(false)}
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="drawing-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search drawings"
            placeholder="Search drawings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear drawing search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <h2 className="drawings-label">Drawings</h2>
      <nav className="drawings-scroll" aria-label="Drawing projects">
        <ProjectList
          key={activeId}
          projects={matching}
          activeId={activeId}
          disabled={disabled}
          projectBusy={projectBusy}
          onOpen={openDrawing}
          onRename={onRename}
          onDelete={onDelete}
        />
        {!matching.length && (
          <p className="drawing-search-empty">No drawings found.</p>
        )}
      </nav>
      <div className="sidebar-footer">
        <button
          className="sidebar-link"
          onClick={() => {
            if (mobile) onToggle(false);
            onHelp();
          }}
        >
          <CircleHelp size={16} /> How it works
        </button>
      </div>
    </>
  );

  if (mobile)
    return (
      <Transition
        show={open}
        afterLeave={() => {
          const navigation = pendingNavigation.current;
          pendingNavigation.current = null;
          if (navigation) onOpen(navigation.id);
        }}
      >
        <Dialog
          onClose={() => onToggle(false)}
          className="sidebar-drawer"
          aria-label="Drawing navigation"
        >
          <DialogBackdrop transition className="sidebar-backdrop" />
          <DialogPanel
            transition
            id="drawing-sidebar"
            className="sidebar-drawer-panel"
          >
            {content}
          </DialogPanel>
        </Dialog>
      </Transition>
    );

  return (
    <aside
      id="drawing-sidebar"
      className="left-panel"
      aria-label="Drawing navigation"
      inert={!open}
    >
      {content}
    </aside>
  );
}
