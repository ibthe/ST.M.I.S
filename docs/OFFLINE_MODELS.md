# OCR and offline translation

ST.M.I.S separates screen recognition from translation. OCR is performed locally. Translation can use free-tier online providers or the local Argos engine.

## Local OCR

- Preferred: PaddleOCR PP-OCRv5 multilingual, configured for Russian/English.
- Fallback: Tesseract with local `eng` and `rus` tessdata.
- Preprocessing: image normalization, upscaling for small captures, contrast enhancement, and sharpening.
- The worker returns text, confidence, and bounding boxes so translations can be overlaid near the source text.

The bundled Windows and Apple Silicon scripts install PaddleOCR/PaddlePaddle, initialize the Russian multilingual model cache, and package the Python worker. Tesseract is retained as a fallback. More OCR languages can be enabled after their PaddleOCR model caches are included in the build.

## Online translation

The default mode tries configured providers in this order: Gemini, Microsoft Translator F0, DeepL API Free (existing keys only), then MyMemory. If all online options fail or are not configured, Argos Translate is attempted locally. A user may select a provider manually or choose Argos directly.

- Gemini Free: free quota and model availability vary by account; content may be used to improve Google products.
- DeepL API Free: 500,000 characters/month for existing accounts; new sign-ups are no longer available.
- Microsoft Translator F0: 2 million free characters per subscription month; requires an Azure Translator F0 resource, key, and region. The service stops at the quota instead of silently switching to a paid tier.
- MyMemory: free API with usage restrictions and daily limits.
- No Google Cloud Translation API is enabled because its credit/overage model cannot guarantee no charges.

Provider limits and terms can change. An API key is not proof that an account is configured for a free tier. The app uses the free DeepL endpoint and Microsoft Translator endpoint; it does not intentionally fall back to a paid endpoint. Users must ensure the Google AI Studio key is associated with a Free-tier project without billing enabled if zero charges are required.

Only recognized text is sent to online providers. Screenshots stay local. Use Argos mode to keep both screenshots and text on the device.

## Credentials

Tauri stores Gemini, DeepL, Microsoft key, and Microsoft region in the OS credential vault through the Rust keyring crate. The frontend only receives booleans indicating whether a credential exists. Secret values are passed from the Rust backend to the local worker through its standard-input request and are not persisted in normal app files.

## Argos offline translation

Argos language packages are installed per direction. English-to-Russian does not automatically install Russian-to-English. Example:

```bash
argospm update
argospm install translate-en_ru
argospm install translate-ru_en
```

The bundled scripts prepare en→ru and ru→en packages and force `ARGOS_CHUNK_TYPE=MINISBD` to avoid optional first-run sentence-boundary downloads.

## Validation status

CI builds are required to validate the bundled PaddleOCR runtime and Tauri keychain integration. CI success alone does not establish recognition quality or successful first launch on a user's computer. Representative screenshots and real clean-machine tests are still needed.
