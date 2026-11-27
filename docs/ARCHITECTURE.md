# Architecture

1. Tauri overlay shell: transparent, undecorated, always-on-top window.
2. Native capture adapter: captures the physical screen rectangle corresponding to the overlay, requests OS permission, and avoids capturing the app's own translation layer.
3. Change detector: schedules OCR only when pixels change.
4. OCR adapter: returns text, confidence, and bounding boxes in screen coordinates.
5. Translation adapter: batches strings, caches repeats, and returns translations.
6. Overlay renderer: draws translated labels at OCR bounding boxes.

Normalize capture coordinates into physical display pixels and account for DPI scaling and multi-monitor origins.

Capturing pixels beneath a transparent always-on-top window is OS/compositor-dependent. macOS requires Screen Recording permission. Windows should use Windows Graphics Capture. Both require native testing and self-capture prevention.

Privacy defaults: capture only the overlay rectangle; do not save screenshots or log text; keep credentials out of source control; provide a visible pause control.

Current implementation: Tauri shell and React control surface only. Capture, OCR, translation, and positioned rendering are not implemented.
