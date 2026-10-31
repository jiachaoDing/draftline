# PDF fonts

Draftline bundles Noto Sans SC Regular (weight 400) and Bold (weight 700) for PDF text export. The font covers Simplified Chinese, Latin text and technical symbols. Source font families map to these upright faces during PDF export; weights of 600 and above use Bold. The canonical SVG retains its font attributes and text.

Source: [Google Fonts / Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), `NotoSansSC[wght].ttf`.

Source SHA-256: `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`.

License: [SIL Open Font License 1.1](OFL.txt), copyright Adobe. The application includes this license in its distributed assets under `/licenses/pdf-fonts/`.

Each `.base64.txt` asset contains a gzip-compressed static TrueType instance encoded as base64. This UTF-8 representation works with the portable Node asset bundler and Cloudflare Static Assets. The regular and bold assets load separately, only when needed for export. jsPDF subsets embedded PDF fonts to the glyphs used in that document.

To rebuild with Python and `fonttools==4.55.3`, run `python scripts/build-pdf-fonts.py`. The script verifies the upstream source hash before generating the assets and preserves source timestamps for reproducible output. Review the source and license before updating the hash.
