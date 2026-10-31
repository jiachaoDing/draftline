"""Generate the self-hosted PDF font assets (requires fonttools==4.55.3)."""

import base64
import gzip
import hashlib
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
TARGET = ROOT / "third_party" / "pdf-fonts"
SOURCE_SHA256 = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"

if __name__ == "__main__":
    data = urlopen(SOURCE).read()
    print("Source SHA-256:", hashlib.sha256(data).hexdigest())
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError("Font source changed; review the source and license before updating the hash.")
    TARGET.mkdir(parents=True, exist_ok=True)
    for weight, style in [(400, "Regular"), (700, "Bold")]:
        font = instantiateVariableFont(TTFont(BytesIO(data), recalcTimestamp=False), {"wght": weight}, updateFontNames=True)
        output = BytesIO()
        font.save(output)
        encoded = base64.b64encode(gzip.compress(output.getvalue(), mtime=0)).decode("ascii")
        (TARGET / f"NotoSansSC-{style}.base64.txt").write_text(encoded, encoding="utf-8")
