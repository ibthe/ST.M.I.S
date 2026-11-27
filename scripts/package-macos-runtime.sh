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

# Prepare the two common English/Russian directions at build time. Runtime stays offline.
export HOME="$RUNTIME/home"
export ARGOS_CHUNK_TYPE=MINISBD
argospm update
argospm install translate-en_ru
argospm install translate-ru_en

python -m PyInstaller --noconfirm --clean --onedir \
  --name stmis-worker \
  --collect-all argostranslate \
  --collect-all ctranslate2 \
  --collect-all sentencepiece \
  --collect-all langdetect \
  --collect-all PIL \
  --collect-all pytesseract \
  src-tauri/python/worker.py
mkdir -p "$RUNTIME/stmis-worker"
cp -R dist/stmis-worker/. "$RUNTIME/stmis-worker/"

TESSERACT_BIN="$(command -v tesseract)"
cp "$TESSERACT_BIN" "$RUNTIME/bin/tesseract"
dylibbundler -od -b -x "$RUNTIME/bin/tesseract" -d "$RUNTIME/lib" -p '@executable_path/../lib'

TESSDATA="$(brew --prefix tesseract-lang)/share/tessdata"
if [[ ! -d "$TESSDATA" ]]; then
  TESSDATA="$(brew --prefix tesseract)/share/tessdata"
fi
test -d "$TESSDATA"
cp -R "$TESSDATA" "$RUNTIME/share/tessdata"

# Keep only the OCR languages needed by the initial UI to reduce installer size.
find "$RUNTIME/share/tessdata" -maxdepth 1 -type f ! -name 'eng.traineddata' ! -name 'rus.traineddata' -delete

echo "Bundled offline runtime prepared:"
du -sh "$RUNTIME"
