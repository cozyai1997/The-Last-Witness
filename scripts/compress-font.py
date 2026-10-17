"""Compress the complete upstream font, then verify its decoded data.

Optional build tooling only, not an application dependency:
  python -m pip install --index-url https://pypi.org/simple --target ../font-tools fonttools==4.67.0 brotli==1.2.0
  python scripts/compress-font.py --input ../font-source/NanumPenScript-Regular.ttf

Run from the repository root. --tools-dir also accepts a separate installation.
No subsetting, glyph transform, renaming, timestamp update, or metadata editing.
"""

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
import struct
import sys
import tempfile


REPO = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--input", type=Path, default=REPO.parent / "font-source/NanumPenScript-Regular.ttf")
parser.add_argument("--output", type=Path, default=REPO / "public/fonts/handwriting.woff2")
parser.add_argument("--tools-dir", type=Path, default=REPO.parent / "font-tools")
parser.add_argument("--report", type=Path, default=REPO / "public/fonts/verification.json")
args = parser.parse_args()
if args.tools_dir.is_dir():
    sys.path.insert(0, str(args.tools_dir.resolve()))
try:
    import brotli
    import fontTools
    from fontTools.ttLib import TTFont, woff2
except ImportError as error:
    parser.error(f"Install optional fonttools + brotli build tooling first: {error}")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checksum(data):
    padded = data + b"\0" * (-len(data) % 4)
    return sum(struct.unpack(f">{len(padded) // 4}I", padded)) & 0xFFFFFFFF


def normalized_head(data):
    # WOFF2 requires a new SFNT checksum and head.flags bit 11. All other
    # head bytes must match. See https://www.w3.org/TR/WOFF2/#CompressedDataFormat
    data = bytearray(data)
    data[8:12] = b"\0" * 4
    flags = struct.unpack_from(">H", data, 16)[0] & ~(1 << 11)
    struct.pack_into(">H", data, 16, flags)
    return bytes(data)


source = args.input.read_bytes()
assert sha(source) == "6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43", "Input differs from the reviewed upstream font"
args.output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="witness-font-") as temporary:
    candidate = Path(temporary) / "font.woff2"
    # Empty transform set is deliberate: glyf/loca/hmtx remain literal bytes.
    woff2.compress(BytesIO(source), candidate, transform_tables=set())
    compressed = candidate.read_bytes()
    decoded_buffer = BytesIO()
    woff2.decompress(BytesIO(compressed), decoded_buffer)
    decoded = decoded_buffer.getvalue()

original = TTFont(BytesIO(source), lazy=True, recalcBBoxes=False, recalcTimestamp=False)
restored = TTFont(BytesIO(decoded), lazy=True, recalcBBoxes=False, recalcTimestamp=False)
wrapped = TTFont(BytesIO(compressed), lazy=True, recalcBBoxes=False, recalcTimestamp=False)
source_tags, decoded_tags = set(original.reader.keys()), set(restored.reader.keys())
removed = source_tags - decoded_tags
assert not decoded_tags - source_tags, "Unexpected additional table"
assert removed <= {"DSIG"}, f"Unexpected missing tables: {removed}"
if "DSIG" in removed:
    signature_data = original.reader["DSIG"]
    # This upstream file has an empty signature table; refuse a new signed
    # input rather than silently discarding an actual signature.
    assert len(signature_data) == 8 and struct.unpack(">IHH", signature_data) == (1, 0, 0), "Input has an actual digital signature"

identical = []
for tag in sorted(decoded_tags):
    before, after = original.reader[tag], restored.reader[tag]
    if tag == "head":
        assert normalized_head(before) == normalized_head(after), "Unexpected head change"
        assert restored["head"].flags == original["head"].flags | (1 << 11), "Missing WOFF2 flag"
    else:
        assert before == after, f"Changed font table: {tag}"
        identical.append(str(tag))

assert original.getGlyphOrder() == restored.getGlyphOrder(), "Glyph order changed"
assert original.getBestCmap() == restored.getBestCmap(), "Character mapping changed"
assert original.reader["name"] == restored.reader["name"], "Internal font names/metadata changed"
assert not wrapped.flavorData.transformedTables, "Unexpected glyph/metric transform"
assert wrapped.flavorData.metaData is None and wrapped.flavorData.privData is None, "Unexpected WOFF metadata"
assert checksum(decoded) == 0xB1B0AFBA, "Decoded SFNT checksum invalid"
license_path = REPO / "public/fonts/OFL.txt"
license_hash = sha(license_path.read_bytes())
assert license_hash == "eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f", "Upstream OFL text changed"
report = {
    "source": "https://raw.githubusercontent.com/google/fonts/main/ofl/nanumpenscript/NanumPenScript-Regular.ttf",
    "tools": {"fonttools": fontTools.__version__, "brotli": brotli.__version__},
    "sourceBytes": len(source), "woff2Bytes": len(compressed),
    "savedBytes": len(source) - len(compressed),
    "savedPercent": round((1 - len(compressed) / len(source)) * 100, 2),
    "sourceSha256": sha(source), "woff2Sha256": sha(compressed),
    "licenseSha256": license_hash,
    "sourceTableCount": len(source_tags), "decodedTableCount": len(decoded_tags),
    "byteIdenticalTables": identical,
    "requiredFormatChanges": ["empty DSIG removed", "head.flags bit 11 set", "head.checkSumAdjustment recalculated", "SFNT table directory/order/padding reconstructed"],
    "glyphCount": len(original.getGlyphOrder()),
    "unicodeMappings": len(original.getBestCmap()),
    "glyphOrderEqual": True, "cmapEqual": True, "nameTableEqual": True,
    "glyphTransforms": [], "woffMetadata": None,
    "decodedChecksumValid": True, "verified": True,
}
args.output.write_bytes(compressed)
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
