param()
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$Runtime = Join-Path $Root "src-tauri/runtime"
$Venv = Join-Path $Root ".build-venv"
$HomeDir = Join-Path $Runtime "home"
Remove-Item $Runtime,$Venv,(Join-Path $Root "build"),(Join-Path $Root "dist") -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $Runtime "bin"),(Join-Path $Runtime "share/tessdata"),(Join-Path $Runtime "stmis-worker"),$HomeDir | Out-Null

# Bundle Tesseract and its DLLs; end users must not need a separate installation.
choco install tesseract --no-progress -y
$TesseractExe = Get-ChildItem "C:\Program Files\Tesseract-OCR","C:\ProgramData\chocolatey\lib\tesseract" -Recurse -Filter tesseract.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$TesseractExe) { throw "Tesseract executable not found after installation." }
$TesseractRoot = $TesseractExe.DirectoryName
Copy-Item (Join-Path $TesseractRoot "*") (Join-Path $Runtime "bin") -Recurse -Force
$Tessdata = Join-Path $Runtime "share/tessdata"
foreach ($lang in @("eng","rus","osd")) {
  Invoke-WebRequest -Uri "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$lang.traineddata" -OutFile (Join-Path $Tessdata "$lang.traineddata")
}

# Build a self-contained worker with only English/Russian offline translation packs.
$env:HOME = $HomeDir
$env:USERPROFILE = $HomeDir
$env:APPDATA = Join-Path $HomeDir "AppData/Roaming"
$env:LOCALAPPDATA = Join-Path $HomeDir "AppData/Local"
New-Item -ItemType Directory -Force -Path $env:APPDATA,$env:LOCALAPPDATA | Out-Null
py -3.11 -m venv $Venv
$Python = Join-Path $Venv "Scripts/python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -r src-tauri/python/requirements.txt pyinstaller
$env:ARGOS_CHUNK_TYPE = "MINISBD"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
# Pre-download Russian/English PP-OCRv5 multilingual models into bundled HOME.
@'
from paddleocr import PaddleOCR
PaddleOCR(lang="ru", ocr_version="PP-OCRv5", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, device="cpu")
PaddleOCR(lang="en", ocr_version="PP-OCRv5", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, device="cpu")
print("PP-OCRv5 Russian and English models prepared.")
'@ | & $Python -
if ($LASTEXITCODE -ne 0) { throw "PaddleOCR model preparation failed." }
& (Join-Path $Venv "Scripts/argospm.exe") update
& (Join-Path $Venv "Scripts/argospm.exe") install translate-en_ru
& (Join-Path $Venv "Scripts/argospm.exe") install translate-ru_en
& $Python -m PyInstaller --noconfirm --clean --onedir --name stmis-worker --collect-all argostranslate --collect-all ctranslate2 --collect-all sentencepiece --collect-all langdetect --collect-all PIL --collect-all pytesseract --collect-all paddleocr --collect-all paddle --collect-all paddlex --collect-data paddlex --copy-metadata paddleocr --copy-metadata paddlex --copy-metadata paddlepaddle --copy-metadata imagesize --copy-metadata opencv-contrib-python --copy-metadata pyclipper --copy-metadata pypdfium2 --copy-metadata shapely --copy-metadata jinja2 --copy-metadata regex --hidden-import scipy._cyutility src-tauri/python/worker.py
Copy-Item (Join-Path $Root "dist/stmis-worker/*") (Join-Path $Runtime "stmis-worker") -Recurse -Force

# Keep Argos data in the app resources. Fail the build if package data is missing.
$ArgosCandidates = @(
  (Join-Path $env:LOCALAPPDATA "argos-translate"),
  (Join-Path $env:APPDATA "argos-translate"),
  (Join-Path $HomeDir ".local/share/argos-translate")
)
$ArgosSource = $ArgosCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$ArgosSource) { throw "Argos Translate package directory was not found; refusing to create an incomplete offline runtime." }
Copy-Item $ArgosSource (Join-Path $env:LOCALAPPDATA "argos-translate") -Recurse -Force

$env:PATH = "$(Join-Path $Runtime 'bin');$env:PATH"
$env:TESSERACT_CMD = Join-Path $Runtime "bin/tesseract.exe"
$env:TESSDATA_PREFIX = $Tessdata
@'
import argostranslate.translate
codes = {x.code for x in argostranslate.translate.get_installed_languages()}
if not {"en", "ru"}.issubset(codes):
    raise SystemExit("Both English and Russian Argos language packs are required; found: " + repr(codes))
print("Offline English/Russian translation models verified.")
'@ | & $Python -
if ($LASTEXITCODE -ne 0) { throw "Offline model validation failed." }

# End-to-end test: require the packaged PaddleOCR model and offline Argos translation.
@'
import base64, io, json
from PIL import Image, ImageDraw, ImageFont
image = Image.new("RGB", (1400, 300), "white")
draw = ImageDraw.Draw(image)
draw.text((60, 70), "Hello world", fill="black", font=ImageFont.load_default(size=100))
buffer = io.BytesIO()
image.save(buffer, format="PNG")
print(json.dumps({"action":"recognize_and_translate",
    "image_base64":base64.b64encode(buffer.getvalue()).decode("ascii"),
    "source_language":"en","target_language":"ru","ocr_language":"eng+rus",
    "translation_mode":"argos"}))
'@ | & $Python - > (Join-Path $Runtime "smoke-request.json")
if ($LASTEXITCODE -ne 0) { throw "Could not prepare OCR smoke test." }
$env:STMIS_REQUIRE_PADDLEOCR = "1"
Get-Content -Raw (Join-Path $Runtime "smoke-request.json") | & (Join-Path $Runtime "stmis-worker/stmis-worker.exe") > (Join-Path $Runtime "smoke-result.json")
if ($LASTEXITCODE -ne 0) { throw "Bundled OCR/translation worker smoke test failed." }
@'
import json, sys
result = json.load(open(sys.argv[1], encoding="utf-8"))
if result.get("ok") is not True: raise SystemExit("Worker returned error: " + repr(result))
if result.get("ocr_engine") != "paddleocr": raise SystemExit("PaddleOCR was not used: " + repr(result.get("ocr_engine")))
if not any(x.get("translation") for x in result.get("blocks", [])): raise SystemExit("Offline translation returned no text.")
print("Bundled PaddleOCR + Argos offline smoke test passed.")
'@ | & $Python - (Join-Path $Runtime "smoke-result.json")
if ($LASTEXITCODE -ne 0) { throw "Bundled PaddleOCR/Argos smoke test failed." }

Write-Host "Windows offline runtime prepared:"
(Get-ChildItem $Runtime -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1GB
