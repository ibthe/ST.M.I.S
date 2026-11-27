# Roadmap

## Foundation
- [x] Tauri 2 + React + TypeScript scaffold
- [x] Transparent, undecorated, always-on-top window configuration
- [x] Initial overlay control surface
- [ ] Verify clean builds on Windows and macOS

## Fully offline OCR and translation
- [x] Select local-only engines: Tesseract OCR + Argos Translate
- [x] Add local worker contract for OCR, line boxes, source-language detection, and translation
- [x] Force Argos MINISBD to avoid first-run remote sentence-splitter downloads
- [x] Integrate worker into Rust Tauri commands
- [x] Add UI readiness check for local OCR and translation models
- [ ] Bundle Python/runtime, Tesseract data, and selected Argos packages into installers
- [ ] Add in-app language-pack manager and offline readiness checks

## Screen capture
- [ ] Capture only the overlay rectangle on Windows
- [ ] Capture only the overlay rectangle on macOS
- [ ] Handle screen-recording permissions, DPI, and multi-monitor coordinates
- [ ] Exclude or mask the app's own translation overlay to prevent feedback

## OCR pipeline
- [x] Local OCR and translation worker returns text blocks and bounding boxes from a supplied image
- [ ] Connect native captured frames to the local OCR worker
- [ ] Add frame-diff detection, debounce, and OCR throttling

## Translation rendering
- [ ] Position translated blocks over source text
- [ ] Add font sizing, contrast, and overflow handling
- [ ] Add click-through mode with a discoverable interaction shortcut

## Release
- [ ] Test Windows 10/11 and supported macOS versions
- [ ] Package, sign, and notarize installers
- [ ] Verify the installed app works with networking disabled

Initial behavior preserves source text and displays aligned translations. Pixel-perfect erasure is not assumed because arbitrary backgrounds cannot be reliably reconstructed.
