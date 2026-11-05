import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { BookOpen, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { t, useLocale } from "../lib/i18n";
import DrawingGuideDiagram from "./DrawingGuideDiagram";
import {
  drawingGuideChapters,
  type DrawingGuideKind,
} from "./drawing-guide-content";
import "./drawing-guide.css";

const SEEN_KEY = "draftline-drawing-guide-seen";
// Keep acknowledgement across project remounts if browser storage is unavailable.
let seenThisSession = false;

function previouslyOpened() {
  if (seenThisSession) return true;
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function DrawingGuide() {
  useLocale();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(previouslyOpened);
  const unreadId = useId();
  const entries = useRef(new Map<DrawingGuideKind, HTMLElement>());
  const show = () => {
    seenThisSession = true;
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Reading and the session acknowledgement work without persistent storage.
    }
    setOpen(true);
  };
  const close = () => setOpen(false);
  const goTo = (id: DrawingGuideKind) => {
    const entry = entries.current.get(id);
    entry?.focus({ preventScroll: true });
    entry?.scrollIntoView({ block: "start", behavior: "instant" });
  };

  return (
    <div className="drawing-guide-entry">
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-describedby={seen ? undefined : unreadId}
      >
        <BookOpen size={14} aria-hidden="true" />
        {t("Drawing examples")}
        {!seen && (
          <span className="drawing-guide-badge" aria-hidden="true">
            1
          </span>
        )}
      </button>
      {!seen && (
        <span id={unreadId} hidden>
          {t("New drawing handbook. Open to read the examples.")}
        </span>
      )}
      <Dialog open={open} onClose={close} className="drawing-guide-modal">
        <DialogBackdrop className="drawing-guide-backdrop" />
        <div className="drawing-guide-position">
          <DialogPanel className="drawing-guide-book">
            <header className="drawing-guide-header">
              <div>
                <p>{t("A visual drawing handbook")}</p>
                <DialogTitle>{t("Drawing examples")}</DialogTitle>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t("Close drawing examples")}
                data-autofocus
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="drawing-guide-reader">
              <nav
                className="drawing-guide-contents"
                aria-label={t("Handbook contents")}
              >
                <h2>{t("Contents")}</h2>
                {drawingGuideChapters.map((chapter, chapterIndex) => (
                  <div key={chapter.title}>
                    <p>
                      <span>0{chapterIndex + 1}</span> {t(chapter.title)}
                    </p>
                    <ul>
                      {chapter.entries.map((entry) => (
                        <li key={entry.id}>
                          <button type="button" onClick={() => goTo(entry.id)}>
                            {t(entry.title)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <div className="drawing-guide-pages">
                <p className="drawing-guide-intro">
                  {t(
                    "Describe what to draw, where to place it and which dimensions to use. These illustrations use example measurements in millimeters; choose the measurements for your own drawing.",
                  )}
                </p>
                {drawingGuideChapters.map((chapter, chapterIndex) => (
                  <section
                    className="drawing-guide-chapter"
                    key={chapter.title}
                  >
                    <h2>
                      <span>0{chapterIndex + 1}</span> {t(chapter.title)}
                    </h2>
                    {chapter.entries.map((entry) => (
                      <article
                        key={entry.id}
                        className="drawing-guide-section"
                        tabIndex={-1}
                        ref={(element) => {
                          if (element) entries.current.set(entry.id, element);
                          else entries.current.delete(entry.id);
                        }}
                      >
                        <h3>{t(entry.title)}</h3>
                        <p>{t(entry.description)}</p>
                        <figure>
                          <DrawingGuideDiagram
                            kind={entry.id}
                            title={entry.title}
                          />
                          <figcaption>
                            {t("Example dimensions · mm")}
                          </figcaption>
                        </figure>
                        <div className="drawing-guide-example">
                          <p>{t("How to describe it")}</p>
                          <blockquote>{t(entry.example)}</blockquote>
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
