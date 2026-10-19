import DOMPurify from "dompurify";
import panZoomSource from "svg-pan-zoom/dist/svg-pan-zoom.min.js?raw";
// The self-contained UMD distribution runs locally inside the opaque frame.
import selectionSource from "../../node_modules/@viselect/vanilla/dist/viselect.umd.cjs?raw";
import { installSVGSelection } from "./sandbox-selection";
import { ensureObjectIds } from "./drawing";

const scriptText = (value: string) =>
  value.replace(/<\/script/gi, "<\\/script");
export function buildSandbox(
  html: string,
  channel: string,
  interactive = true,
) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const scripts = [...parsed.querySelectorAll("script")]
    .filter((script) => !script.src)
    .map((script) => script.textContent || "");
  const markup = DOMPurify.sanitize(parsed.body.innerHTML, {
    ADD_ATTR: ["data-for", "data-layer", "data-label"],
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "a",
      "link",
      "meta",
      "base",
      "image",
      "foreignObject",
    ],
    FORBID_ATTR: ["style"],
  });
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const bridge = `(() => {
    const channel = ${JSON.stringify(channel)};
    const send = (type, payload) => parent.postMessage({channel, type, payload}, '*');
    let svg, controller, editor, mode = 'select';
    const rawSnapshot = () => {
      if (!svg) return;
      const clone = svg.cloneNode(true);
      clone.querySelectorAll('[data-selected],[data-marquee-target]').forEach(n => { n.removeAttribute('data-selected'); n.removeAttribute('data-marquee-target'); });
      const viewport = clone.querySelector('.svg-pan-zoom_viewport');
      if (viewport) { [...viewport.childNodes].forEach(n => clone.insertBefore(n, viewport)); viewport.remove(); }
      clone.setAttribute('width', svg.dataset.physicalWidth);
      clone.setAttribute('height', svg.dataset.physicalHeight);
      clone.setAttribute('viewBox', svg.dataset.physicalViewbox);
      clone.removeAttribute('style'); clone.removeAttribute('data-physical-width'); clone.removeAttribute('data-physical-height'); clone.removeAttribute('data-physical-viewbox');
      clone.querySelectorAll('[data-layer]').forEach(n => { n.removeAttribute('display'); });
      send('snapshot', new XMLSerializer().serializeToString(clone));
    };
    window.addEventListener('error', event => send('error', 'Drawing code failed: ' + event.message));
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.channel !== channel) return;
      const { type, payload } = event.data;
      if (!controller) return;
      if (type === 'zoom') payload > 0 ? controller.zoomIn() : controller.zoomOut();
        if (type === 'fit') fitDrawing();
      if (type === 'mode') { mode = payload; mode === 'pan' ? controller.enablePan() : controller.disablePan(); editor.setMode(mode); document.body.dataset.mode = mode; }
      if (type === 'layers') { ['geometry','dimensions','presentation'].forEach(id => { const n = svg.querySelector('[id="'+id+'"]'); if(n) n.setAttribute('display', payload[id] ? 'inline' : 'none'); }); editor.visibilityChanged(); }
      if (type === 'select') editor.setSelection(payload);
      if (type === 'locked') editor.setLocked(!!payload);
      if (type === 'changes') editor.setChanges(payload);
      if (type === 'command') editor.command(payload);
      if (type === 'snapshot') rawSnapshot();
    });
      const fitDrawing = () => {
        const size = svg.getBoundingClientRect();
        if (size.width < 1 || size.height < 1) return;
        controller.resize(); controller.fit(); controller.center(); editor?.refresh();
      };
      window.addEventListener('DOMContentLoaded', () => {
      svg = document.querySelector('svg#drawing');
      if (!svg) return send('error', 'The generated code did not create an SVG with id drawing.');
      (${ensureObjectIds.toString()})(svg);
      svg.dataset.physicalWidth = svg.getAttribute('width'); svg.dataset.physicalHeight = svg.getAttribute('height'); svg.dataset.physicalViewbox = svg.getAttribute('viewBox');
      rawSnapshot();
      if (!${interactive}) return;
      svg.style.width = '100%'; svg.style.height = '100%';
      const initialize = () => {
      const size = svg.getBoundingClientRect();
      if (size.width < 1 || size.height < 1) { requestAnimationFrame(initialize); return; }
      controller = svgPanZoom(svg, {zoomEnabled:true, panEnabled:false, controlIconsEnabled:false, fit:true, center:true, minZoom:0.1, maxZoom:30, dblClickZoomEnabled:false, zoomScaleSensitivity:0.22, onZoom:z=>{send('zoom',Math.round(z*100)); editor?.refresh();},onUpdatedCTM:()=>editor?.refresh()});
      editor = (${installSVGSelection.toString()})(svg, SelectionArea, send);
        new ResizeObserver(fitDrawing).observe(document.body);
      send('ready', true);
      };
      requestAnimationFrame(initialize);
    });
  })();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}svg{overflow:visible}body{user-select:none;touch-action:none}.svg-marquee{background:#2462f322;border:1px solid #2462f3}.svg-selection-overlay{position:fixed;inset:0;pointer-events:none;z-index:2}.svg-object-outline{position:fixed;border:1.5px solid #2462f3;box-sizing:border-box}.svg-object-outline.changed{border:2px dashed #c77a12}.svg-object-outline.editing{border:1px dashed #8a94a3}#geometry :is(path,circle,rect,ellipse,line,polygon,polyline,text,use){pointer-events:all;cursor:pointer}#dimensions>g{cursor:pointer;pointer-events:all}body[data-mode=pan] svg,body[data-mode=pan] svg *{cursor:grab!important}</style>${interactive ? `<script nonce="${nonce}">${scriptText(panZoomSource)}</script><script nonce="${nonce}">${scriptText(selectionSource)}</script>` : ""}<script nonce="${nonce}">${scriptText(bridge)}</script></head><body>${markup}${scripts.map((script) => `<script nonce="${nonce}">${scriptText(script)}</script>`).join("")}</body></html>`;
}
