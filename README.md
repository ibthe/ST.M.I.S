# ST.M.I.S

**Screen Translation Overlay** — a Windows/macOS desktop overlay that recognizes text in a selected screen area and translates it locally.

## Offline design

- Desktop shell: Tauri 2 + React + TypeScript + Rust.
- OCR: Tesseract with bundled local language data.
- Translation: Argos Translate with local language-pair packages.
- Language detection: local langdetect model.
- No hosted OCR or translation API is used by the worker.

## Apple Silicon build

The macOS ARM64 CI build now prepares a self-contained runtime before bundling the app:
- a PyInstaller worker with its Python dependencies;
- Tesseract plus English and Russian OCR data;
- Argos English-to-Russian and Russian-to-English translation packages;
- a build-time smoke test that feeds an image through OCR and translation.

The app locates these resources inside its own bundle. The CI smoke test is the release gate for this packaged path. Intel macOS and Windows currently use the development fallback and are not yet self-contained.

## macOS signing

The public build uses ad-hoc signing because this project does not have an Apple Developer ID certificate. Ad-hoc signing is not notarization and cannot guarantee that Gatekeeper will allow a quarantined download to open without user approval. A Developer ID certificate and Apple notarization are required for that distribution experience.

## Development fallback

For local development without the bundled macOS runtime, install Python 3.11+, Tesseract, the packages in `src-tauri/python/requirements.txt`, and the Argos language packages you need. See [docs/OFFLINE_MODELS.md](docs/OFFLINE_MODELS.md).

## Current limitations

The bundled Apple Silicon path is being validated in GitHub Actions. The first packaged release targets English/Russian OCR and translation. Other language pairs and Windows self-contained packaging remain future work.
