#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RUNTIME="$ROOT/src-tauri/runtime"
VENV="$ROOT/.build-venv"

rm -rf "$RUNTIME" "$VENV"
mkdir -p "$RUNTIME/bin" "$RUNTIME/lib" "$RUNTIME/share" "$RUNTIME/home"

brew install tesseract tesseract-lang dylibbundler

python3 -m venv "$VENV"
source "$VENV/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r src-tauri/python/requirements.txt pyinstaller

# Install both translation directions into the bundled application data directory.
export HOME="$RUNTIME/home"
export ARGOS_CHUNK_TYPE=MINISBD
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
argospm update
argospm install translate-en_ru
argospm install translate-ru_en

# Pre-download Russian/English PP-OCRv5 multilingual models into bundled HOME.
python - <<'PY'
from paddleocr import PaddleOCR
PaddleOCR(lang="ru", ocr_version="PP-OCRv5", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, device="cpu", enable_mkldnn=False)
PaddleOCR(lang="en", ocr_version="PP-OCRv5", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, device="cpu", enable_mkldnn=False)
print("PP-OCRv5 Russian and English models prepared.")
PY

python -m PyInstaller --noconfirm --clean --onedir \
  --name stmis-worker \
  --collect-all argostranslate \
  --collect-all ctranslate2 \
  --collect-all sentencepiece \
  --collect-all langdetect \
  --collect-all PIL \
  --collect-all pytesseract \
  --collect-all paddleocr \
  --collect-all paddle \
  --collect-all paddlex \
  --collect-data paddlex \
  --copy-metadata paddleocr \
  --copy-metadata paddlex \
  --copy-metadata paddlepaddle \
  --copy-metadata imagesize \
  --copy-metadata opencv-contrib-python \
  --copy-metadata pyclipper \
  --copy-metadata pypdfium2 \
  --copy-metadata shapely \
  --copy-metadata jinja2 \
  --copy-metadata regex \
  --hidden-import scipy._cyutility \
  src-tauri/python/worker.py
mkdir -p "$RUNTIME/stmis-worker"
cp -R dist/stmis-worker/. "$RUNTIME/stmis-worker/"

TESSERACT_BIN="$(command -v tesseract)"
cp "$TESSERACT_BIN" "$RUNTIME/bin/tesseract"
dylibbundler -od -b -x "$RUNTIME/bin/tesseract" -d "$RUNTIME/lib" -p '@executable_path/../lib'

# tesseract-lang excludes eng/osd because those are supplied by the core formula.
TESSDATA_LANG="$(brew --prefix tesseract-lang)/share/tessdata"
TESSDATA_CORE="$(brew --prefix tesseract)/share/tessdata"
mkdir -p "$RUNTIME/share/tessdata"
cp -R "$TESSDATA_LANG/." "$RUNTIME/share/tessdata/"
cp "$TESSDATA_CORE/eng.traineddata" "$RUNTIME/share/tessdata/eng.traineddata"
cp "$TESSDATA_CORE/osd.traineddata" "$RUNTIME/share/tessdata/osd.traineddata"
if [[ ! -f "$RUNTIME/share/tessdata/eng.traineddata" || ! -f "$RUNTIME/share/tessdata/rus.traineddata" ]]; then
  echo "Could not assemble English and Russian Tesseract data files." >&2
  ls -la "$RUNTIME/share/tessdata" >&2 || true
  exit 1
fi

# Keep only the OCR languages needed by the initial UI to reduce installer size.
find "$RUNTIME/share/tessdata" -maxdepth 1 -type f ! -name 'eng.traineddata' ! -name 'rus.traineddata' ! -name 'osd.traineddata' -delete

# Build-time end-to-end test: bundled OCR + bundled English-to-Russian model.
export PATH="$RUNTIME/bin:$PATH"
export TESSERACT_CMD="$RUNTIME/bin/tesseract"
export TESSDATA_PREFIX="$RUNTIME/share/tessdata"
python - <<'PY' > /tmp/stmis-smoke-request.json
import base64, io, json
from PIL import Image, ImageDraw, ImageFont
image = Image.new("RGB", (1400, 300), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.load_default(size=100)
draw.text((60, 70), "Hello world", fill="black", font=font)
buffer = io.BytesIO()
image.save(buffer, format="PNG")
print(json.dumps({
    "action": "recognize_and_translate",
    "image_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
    "source_language": "en",
    "target_language": "ru",
    "ocr_language": "eng+rus",
    "translation_mode": "argos"
}))
PY

export STMIS_REQUIRE_PADDLEOCR=1
if ! "$RUNTIME/stmis-worker/stmis-worker" < /tmp/stmis-smoke-request.json > /tmp/stmis-smoke-result.json 2> /tmp/stmis-smoke-stderr.log; then
  echo "Bundled worker process failed. stderr:" >&2
  cat /tmp/stmis-smoke-stderr.log >&2 || true
  echo "Bundled worker stdout:" >&2
  cat /tmp/stmis-smoke-result.json >&2 || true
  exit 1
fi

python - <<'PY'
import json
with open("/tmp/stmis-smoke-result.json", encoding="utf-8") as stream:
    result = json.load(stream)
if result.get("ok") is not True:
    raise SystemExit("Bundled worker returned an error: " + repr(result))
if result.get("ocr_engine") != "paddleocr":
    raise SystemExit("PaddleOCR was not used by the packaged worker: " + repr(result.get("ocr_engine")))
if not result.get("blocks"):
    raise SystemExit("OCR smoke test returned no text blocks: " + repr(result))
if not any(block.get("translation") for block in result["blocks"]):
    raise SystemExit("Translation smoke test returned no translation: " + repr(result))
print("Offline OCR + English-to-Russian translation smoke test passed.")
PY

echo "Bundled offline runtime prepared:"
du -sh "$RUNTIME"
