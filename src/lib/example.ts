import { svgToHTML } from "./drawing";
import type { Drawing } from "./contracts";

export const EXAMPLE_SVG = `<svg id="drawing" xmlns="http://www.w3.org/2000/svg" width="164mm" height="124mm" viewBox="-22 -22 164 124">
<title>Mounting plate</title><desc>120 by 80 mm plate, R8 corners, four 10 mm holes, hole centers 20 mm from each edge.</desc>
<defs><marker id="arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="3" markerHeight="3" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L6 3 L0 6 Z" fill="#66758b"/></marker></defs>
<g id="geometry" data-layer="geometry" fill="white" stroke="#26364a" stroke-width="0.4">
<rect id="plate-outline" data-label="Plate outline" x="0" y="0" width="120" height="80" rx="8"/>
<circle id="hole-top-left" data-label="Top left hole" cx="20" cy="20" r="5"/>
<circle id="hole-top-right" data-label="Top right hole" cx="100" cy="20" r="5"/>
<circle id="hole-bottom-left" data-label="Bottom left hole" cx="20" cy="60" r="5"/>
<circle id="hole-bottom-right" data-label="Bottom right hole" cx="100" cy="60" r="5"/>
</g>
<g id="dimensions" data-layer="dimensions" fill="none" stroke="#66758b" stroke-width="0.18" font-family="Arial,sans-serif" font-size="3.3">
<g id="dim-width" data-for="plate-outline"><path d="M0 -3 V-16 M120 -3 V-16"/><path d="M0 -12 H120" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="60" y="-14.5" fill="#66758b" stroke="none" text-anchor="middle">120</text></g>
<g id="dim-height" data-for="plate-outline"><path d="M123 0 H136 M123 80 H136"/><path d="M132 0 V80" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="135" y="40" fill="#66758b" stroke="none" text-anchor="middle" transform="rotate(90 135 40)">80</text></g>
<g id="dim-hole" data-for="hole-top-left hole-top-right hole-bottom-left hole-bottom-right"><path d="M24 16 L34 6 H56" marker-start="url(#arrow)"/><text x="37" y="4" fill="#66758b" stroke="none">4 × Ø10</text></g>
<g id="dim-hole-x" data-for="hole-top-left hole-bottom-left"><path d="M0 83 V95 M20 65 V95"/><path d="M0 91 H20" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="10" y="89" fill="#66758b" stroke="none" text-anchor="middle">20</text></g>
<g id="dim-hole-spacing-x" data-for="hole-top-left hole-top-right hole-bottom-left hole-bottom-right"><path d="M100 65 V95"/><path d="M20 91 H100" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="60" y="89" fill="#66758b" stroke="none" text-anchor="middle">80</text></g>
<g id="dim-hole-y" data-for="hole-top-left hole-top-right"><path d="M-3 0 H-15 M15 20 H-15"/><path d="M-11 0 V20" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="-14" y="10" fill="#66758b" stroke="none" text-anchor="middle" transform="rotate(-90 -14 10)">20</text></g>
<g id="dim-hole-spacing-y" data-for="hole-top-left hole-bottom-left hole-top-right hole-bottom-right"><path d="M15 60 H-15"/><path d="M-11 20 V60" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="-14" y="40" fill="#66758b" stroke="none" text-anchor="middle" transform="rotate(-90 -14 40)">40</text></g>
<g id="dim-radius" data-for="plate-outline"><path d="M2.4 2.4 L-3 -3 L-11 -3" marker-start="url(#arrow)"/><text x="-10" y="-5" fill="#66758b" stroke="none">R8</text></g>
</g></svg>`;
export const EXAMPLE: Drawing = {
  title: "Mounting plate",
  svg: EXAMPLE_SVG,
  html: svgToHTML(EXAMPLE_SVG),
  summary: "Example · 120 × 80 mm plate with four Ø10 holes and R8 corners.",
};
