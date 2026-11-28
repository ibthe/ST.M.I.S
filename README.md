# ST.M.I.S

**Screen Translation Overlay** — a transparent Windows/macOS overlay for local screen capture, OCR, and translation.

## Current architecture

- Desktop shell: Tauri 2 + React + TypeScript + Rust.
- OCR: PaddleOCR PP-OCRv5 multilingual (Russian/English path), with Tesseract as a fallback.
- Image preparation: EXIF normalization, selective upscaling, contrast enhancement, and sharpening.
- Online translation: Gemini API, DeepL API Free, Microsoft Translator F0, and MyMemory.
- Offline translation: Argos Translate language-pair packages.
- Language detection: local `langdetect`.
- API credentials: OS credential vault via Rust keyring integration (Windows Credential Manager / macOS Keychain).

## Translation behavior

The default **Best available** mode tries configured free-tier providers in this order:

1. Gemini 3.8 Flash (context-aware translation; Free tier).
2. Microsoft Translator F0 (requires a free F0 resource, key, and region).
3. DeepL API Free (existing keys only; new subscriptions are no longer offered).
4. MyMemory (no API key, subject to usage limits).
5. Argos Translate (local fallback).

A provider error, including a quota/rate-limit response, causes the worker to try the next configured provider. The app does not automatically change a free F0 subscription into a paid tier. Users can select a provider manually or choose Argos offline mode.

**No paid Google Cloud Translation endpoint is configured.** Free quotas are controlled by each provider and may change. A user-supplied API key does not itself guarantee a free account or free-tier project. In particular, do not attach a billing-enabled Google Cloud project to a Gemini key if you require a strict no-charge setup. Gemini Free may use submitted content to improve Google products; provider privacy terms apply.

Only recognized text is sent to online translation providers. Screen images are processed locally and are not uploaded by the translation adapters. Use offline Argos mode to keep text local too.

## API key setup

Open the gear button in the app and add any available credentials:

- Gemini API key from Google AI Studio (Free tier).
- Microsoft Translator F0 key and its Azure resource region.
- DeepL API Free key, only if you already have an active key (new sign-ups are no longer available).
- MyMemory works without a key.

Credentials are saved in the operating system's protected credential store. They are not returned to the frontend or written to the app's ordinary settings files. The app never deliberately switches to a paid provider endpoint, but account-side billing configuration and provider quota policies remain outside the app's control.

## OCR runtime

The build scripts install PaddleOCR and prepare its PP-OCRv5 Russian multilingual model inside the app runtime. PaddleOCR is the preferred backend; Tesseract remains a fallback if PaddleOCR is unavailable or fails. The first bundled build may be substantially larger because the Paddle runtime and model files are included.

## Build and validation

GitHub Actions builds Windows x64 and Apple Silicon macOS packages. CI success verifies compilation and packaging only; a real Windows/macOS launch and accuracy test with representative game screenshots are still required before calling the app production-ready.

macOS builds use ad-hoc signing, not Developer ID signing or notarization. Gatekeeper may require additional user action for downloaded builds.
