# Roadmap

## Foundation
- [x] Tauri 2 + React + TypeScript scaffold
- [x] Transparent, undecorated, always-on-top window configuration
- [x] Initial overlay control surface
- [ ] Verify clean builds on Windows and macOS

## Screen capture
- [ ] Capture only the overlay rectangle on Windows and macOS
- [ ] Permissions, DPI, multi-monitor coordinates
- [ ] Prevent self-capture feedback

## OCR
- [ ] Integrate local OCR engine
- [ ] Text, confidence, and bounding boxes
- [ ] Frame diff, debounce, and throttling

## Translation and rendering
- [ ] Provider interface, target language, cache, and batching
- [ ] Position translated blocks over source text
- [ ] Contrast, sizing, overflow, and click-through mode

## Release
- [ ] Windows/macOS testing and packaging
- [ ] Signing, notarization, privacy, and troubleshooting docs

Initial behavior preserves source text and displays aligned translations. Pixel-perfect erasure is not assumed because arbitrary backgrounds cannot be reliably reconstructed.
