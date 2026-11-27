# ST.M.I.S

**Screen Translation Overlay** — a Windows and macOS desktop overlay designed to recognize and translate all readable text beneath a transparent, always-on-top window.

## Product promise

**Fully offline at runtime.** Screenshots, recognized text, and translations stay on the user's computer. No hosted OCR or translation API is used.

## Local technology

- Desktop: Tauri 2 + React + TypeScript + Rust.
- OCR: Tesseract with local language data.
- Translation: Argos Translate with locally installed language-pair packages.
- Language detection: local langdetect model.
- Worker: Python subprocess at src-tauri/python/worker.py.

Language models must be prepared before going offline. Translation packages are directional: install each direction you need. The worker forces Argos MINISBD to avoid optional first-run remote sentence-boundary downloads.

## Current implementation status

The repository includes the desktop shell, a Python local OCR/translation worker, Rust commands that invoke the worker, and a UI panel for checking local engines. Native screen capture, automatic live polling, positioned translation rendering, installer bundling, and Windows/macOS runtime validation are still in progress. The development bridge currently expects Python, Tesseract, Tesseract language data, Argos packages, and Python dependencies installed locally.

See docs/OFFLINE_MODELS.md, docs/ARCHITECTURE.md, and docs/ROADMAP.md.
