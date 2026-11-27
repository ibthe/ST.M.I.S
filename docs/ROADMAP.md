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
- [x] Add image-file test path to exercise OCR, source-language detection, translation, and text bounding boxes
- [ ] Bundle Python/runtime, Tesseract data, and selected Argos packages into installers
- [ ] Add in-app language-pack manager and offline readiness checks

## Screen capture
- [x] Add cross-platform xcap capture of the overlay rectangle on Windows/macOS (initial implementation; awaiting CI and device validation)
- [ ] Validate macOS Screen Recording permission prompts, DPI scaling, and multi-monitor coordinate mapping on physical devices
- [ ] Exclude or mask the app's own translation overlay to prevent feedback

## OCR pipeline
- [x] Local OCR and translation worker returns text blocks and bounding boxes from a supplied image
- [x] Connect one-shot native captured frames to the local OCR worker
- [x] Add opt-in automatic screen scans every 3 seconds (initial polling implementation)
- [ ] Replace periodic full OCR with frame-diff detection, debounce, and OCR throttling

## Translation rendering
- [x] Position translated blocks over source text using OCR bounding boxes (initial styling/coordinate implementation)
- [ ] Add font sizing, contrast, and overflow handling
- [ ] Add click-through mode with a discoverable interaction shortcut

## Release
- [ ] Test Windows 10/11 and supported macOS versions
- [ ] Package, sign, and notarize installers
- [ ] Verify the installed app works with networking disabled

Initial behavior preserves source text and displays aligned translations. Pixel-perfect erasure is not assumed because arbitrary backgrounds cannot be reliably reconstructed.
