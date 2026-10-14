import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { html } from "@codemirror/lang-html";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, isolateHistory, redo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#fbfcff", color: "#26364a" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: "12px",
    lineHeight: "1.75",
  },
  ".cm-content": { padding: "16px 0" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": {
    backgroundColor: "#f5f7fb",
    color: "#8c99ae",
    borderRight: "1px solid #e5eaf2",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#eef3fb" },
});

export default function CodeEditor({
  value,
  onChange,
  disabled = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const initial = useRef({ value, disabled });
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup,
          html(),
          indentUnit.of("  "),
          keymap.of([
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            indentWithTab,
          ]),
          EditorView.lineWrapping,
          theme,
          EditorView.contentAttributes.of({
            "aria-label": "Drawing source code",
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          editable.current.of(
            EditorState.readOnly.of(initial.current.disabled),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
    // The effects below synchronize props without recreating the editor.
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: isolateHistory.of("full"),
      });
  }, [value]);

  useEffect(() => {
    editor.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);

  return <div className="code-editor" ref={host} />;
}
