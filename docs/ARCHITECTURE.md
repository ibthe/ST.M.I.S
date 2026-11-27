# Architecture

## Runtime layers

1. **Desktop shell (Tauri 2):** transparent, always-on-top desktop window. The current UI is a control panel prototype; the final product will separate controls from the transparent capture/translation surface.
2. **Native capture adapter (Rust):** captures the physical screen rectangle corresponding to the overlay. It must request OS permission and exclude the application's own overlay to prevent feedback.
3. **Change detector:** compares sampled frames and schedules OCR only when the underlying screen changes.
4. **Local OCR worker:** Tesseract returns text, confidence, and bounding boxes in captured-image coordinates.
5. **Local language detection:** langdetect identifies the source language without a network request.
6. **Local translation:** Argos Translate uses installed language-pair packages. Runtime uses MINISBD and must not update package indexes or download models.
7. **Overlay renderer:** positions translated labels over the corresponding source text.

## Current implementation

- Tauri commands invoke a local Python worker through stdin/stdout JSON.
- The worker supports an engine-readiness check and image-to-OCR-to-translation processing.
- The UI can check local engine installation and test the OCR/translation pipeline using a local image file.
- The capture adapter and automatic polling/rendering are not yet connected.

## Coordinate system

Native capture results should be normalized into physical display pixels. OCR boxes are relative to the captured image. The renderer converts them to overlay logical coordinates, accounting for DPI scaling, display scaling, and multi-monitor origins.

## Capture feedback and permission

Capturing the screen beneath a transparent always-on-top window is OS/compositor-dependent. Windows and macOS implementations must be tested separately. macOS requires Screen Recording permission. The capture adapter must exclude or mask the app's own rendered translation pixels to avoid recursive OCR.

## Offline model provisioning

Python dependencies, Tesseract executable and language data, and Argos language packages are development prerequisites at present. Release installers must bundle these components or provide an explicit one-time model installer. No setup/download operation may run during offline translation.

## Privacy

- Capture only the rectangle covered by the overlay.
- Do not save screenshots by default.
- Do not log recognized text or translations.
- Do not send images or text to remote services.
- Provide a visible pause state and capture indicator.

## Known product limitation

The initial renderer preserves source text and places translated text in aligned overlay blocks. Pixel-perfect erasure/replacement is not assumed because arbitrary application backgrounds, images, gradients, and anti-aliased glyphs cannot reliably be reconstructed.
