# ST.M.I.S

**Screen Translation Overlay** — a cross-platform desktop overlay that continuously detects and translates text visible beneath its transparent window.

## Product definition

The app stays above other windows. The user moves and resizes its transparent capture area over any desktop content. ST.M.I.S captures only the area beneath that overlay, detects text with OCR, translates it, and renders translated text in a floating overlay aligned with the source text.

## MVP principles

- Windows and macOS support.
- Always-on-top, movable and resizable overlay.
- Capture the screen region covered by the overlay (with explicit OS screen-recording permission).
- OCR the full captured region, not only selected text.
- Automatic refresh when the underlying image changes, with throttling/debouncing.
- Translation provider abstraction; no API key is committed.
- Display translated text as positioned labels/blocks. Preserve the original by default; source-cover/replacement mode is a later opt-in feature because accurate background reconstruction is not generally possible.
- Pause/resume, target language, source language auto-detection, and clear status/errors.

## Important platform constraint

A window cannot reliably capture the pixels behind itself on every OS/compositor. The implementation must use native screen-capture APIs and OS permissions, and must avoid capturing its own rendered translation overlay (capture exclusion or frame masking where supported). This is a core technical spike, not an assumption.

## Planned architecture

- **Desktop shell:** Tauri 2 + React + TypeScript.
- **Native integration:** Rust/Tauri commands and platform-specific capture/window modules.
- **OCR:** provider interface; initial local OCR integration selected after platform spike.
- **Translation:** provider interface with configurable remote or local backend.
- **Rendering:** transparent overlay window with click-through mode when not interacting with controls.

## Development status

Repository initialized. Implementation has not yet been validated on Windows or macOS; both platforms require native runtime testing.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
