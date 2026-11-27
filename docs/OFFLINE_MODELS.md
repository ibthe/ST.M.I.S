# Fully offline OCR and translation

ST.M.I.S performs OCR and machine translation locally. It must not send screenshots, recognized text, or translations to a network service.

## Local engines

- OCR: Tesseract with local tessdata language files.
- Translation: Argos Translate language-pair packages.
- Language detection: langdetect, using its packaged local model.
- Bridge: src-tauri/python/worker.py, invoked by Rust Tauri commands.

Argos Translate is an open-source local translation engine. Model packages are installed per direction; English-to-Russian does not automatically install Russian-to-English. Argos can pivot through intermediate languages when the required direct pair is unavailable, with a possible quality trade-off.

## Prepare a development machine (one-time, while online)

1. Install Python 3.11 or newer.
2. Install Tesseract OCR and the eng and rus OCR language data (add other OCR languages as needed).
3. Install worker dependencies:

   python -m pip install -r src-tauri/python/requirements.txt

4. Install Argos model packages for the language directions you need. Example:

   argospm update
   argospm install translate-en_ru
   argospm install translate-ru_en

5. Prepare and verify Argos offline sentence splitting. The worker forces ARGOS_CHUNK_TYPE=MINISBD to avoid optional first-run SBD downloads. Run a representative test translation before disconnecting.
6. Launch ST.M.I.S and use Check setup to verify Tesseract and installed Argos language packs.
7. Disconnect the network and test again. Runtime translation must still work.

The package index and model downloads are setup-time operations only. The ST.M.I.S runtime worker does not update indexes, fetch packages, or call remote APIs.

## Runtime dependencies and packaging status

The current development bridge expects a local Python interpreter, Python packages, Tesseract executable, Tesseract language data, and Argos language packs. These are not yet bundled into Windows/macOS installers. A release-ready installer must bundle or bootstrap the worker runtime, OCR engine/data, and selected translation models, and then pass an offline test on a clean machine.

## Language selection

Source language can be auto-detected locally or explicitly selected. OCR language and translation source language are separate settings: OCR language controls which character sets Tesseract recognizes; source language controls the translation model route. The initial UI exposes source and target language selection; OCR language is currently set to English in the worker call contract and will be exposed in settings.

## Privacy guarantee

The worker accepts image bytes over standard input and returns OCR/translation JSON over standard output. It does not write screenshots to disk, record recognized text, or access a remote translation service.
