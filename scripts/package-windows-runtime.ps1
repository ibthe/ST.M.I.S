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
& (Join-Path $Venv "Scripts/argospm.exe") update
& (Join-Path $Venv "Scripts/argospm.exe") install translate-en_ru
& (Join-Path $Venv "Scripts/argospm.exe") install translate-ru_en
& $Python -m PyInstaller --noconfirm --clean --onedir --name stmis-worker --collect-all argostranslate --collect-all ctranslate2 --collect-all sentencepiece --collect-all langdetect --collect-all PIL --collect-all pytesseract src-tauri/python/worker.py
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
Write-Host "Windows offline runtime prepared:"
(Get-ChildItem $Runtime -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1GB
