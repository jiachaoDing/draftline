import DOMPurify from "dompurify";
import panZoomSource from "svg-pan-zoom/dist/svg-pan-zoom.min.js?raw";

const scriptText = (value: string) =>
  value.replace(/<\/script/gi, "<\\/script");
export function buildSandbox(html: string, channel: string) {
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
    let svg, controller, selected, mode = 'select';
    let start = null;
    const rawSnapshot = () => {
      if (!svg) return;
      const clone = svg.cloneNode(true);
      clone.querySelectorAll('[data-selected]').forEach(n => n.removeAttribute('data-selected'));
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
      if (type === 'mode') { mode = payload; mode === 'pan' ? controller.enablePan() : controller.disablePan(); document.body.dataset.mode = mode; }
      if (type === 'layers') ['geometry','dimensions','presentation'].forEach(id => { const n = svg.querySelector('[id="'+id+'"]'); if(n) n.setAttribute('display', payload[id] ? 'inline' : 'none'); });
      if (type === 'select') { if (selected) selected.removeAttribute('data-selected'); selected = [...svg.querySelectorAll('[id]')].find(n => n.id === payload); if(selected) selected.setAttribute('data-selected','true'); }
      if (type === 'snapshot') rawSnapshot();
    });
      const fitDrawing = () => {
        const size = svg.getBoundingClientRect();
        if (size.width < 1 || size.height < 1) return;
        controller.resize(); controller.fit(); controller.center();
      };
      window.addEventListener('DOMContentLoaded', () => {
      svg = document.querySelector('svg#drawing');
      if (!svg) return send('error', 'The generated code did not create an SVG with id drawing.');
      svg.dataset.physicalWidth = svg.getAttribute('width'); svg.dataset.physicalHeight = svg.getAttribute('height'); svg.dataset.physicalViewbox = svg.getAttribute('viewBox');
      rawSnapshot();
      svg.style.width = '100%'; svg.style.height = '100%';
      const initialize = () => {
      const size = svg.getBoundingClientRect();
      if (size.width < 1 || size.height < 1) { requestAnimationFrame(initialize); return; }
      controller = svgPanZoom(svg, {zoomEnabled:true, panEnabled:false, controlIconsEnabled:false, fit:true, center:true, minZoom:0.1, maxZoom:30, dblClickZoomEnabled:false, zoomScaleSensitivity:0.22, onZoom:z=>send('zoom',Math.round(z*100))});
      svg.addEventListener('pointerdown', e => { start = [e.clientX,e.clientY]; });
      svg.addEventListener('click', e => {
        if(mode !== 'select' || (start && Math.hypot(e.clientX-start[0], e.clientY-start[1]) > 5)) return;
        let node = e.target.closest('[id]');
        const dim = e.target.closest('#dimensions > g[id]'); if(dim) node=dim;
        if (!node || ['drawing','geometry','dimensions','presentation'].includes(node.id) || !node.closest('[data-layer]')) node = null;
        if(selected) selected.removeAttribute('data-selected'); selected=node;
        if(node) node.setAttribute('data-selected','true');
        send('selection', node?.id || null);
      });
        new ResizeObserver(fitDrawing).observe(document.body);
      send('ready', true);
      };
      requestAnimationFrame(initialize);
    });
  })();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}svg{overflow:visible}[data-selected]{stroke:#2462f3!important;filter:drop-shadow(0 0 1px #2462f380)}#geometry :is(path,circle,rect,ellipse,line,polygon,polyline){pointer-events:all;cursor:pointer}#dimensions>g{cursor:pointer;pointer-events:all}body[data-mode=pan] svg,body[data-mode=pan] svg *{cursor:grab!important}</style><script nonce="${nonce}">${scriptText(panZoomSource)}</script><script nonce="${nonce}">${scriptText(bridge)}</script></head><body>${markup}${scripts.map((script) => `<script nonce="${nonce}">${scriptText(script)}</script>`).join("")}</body></html>`;
}
