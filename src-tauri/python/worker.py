"""Local-only OCR and translation worker for ST.M.I.S."""
from __future__ import annotations
import base64, io, json, os, shutil, sys
from collections import defaultdict
os.environ["ARGOS_CHUNK_TYPE"] = "MINISBD"

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False))
    sys.stdout.flush()

def installed_languages():
    import argostranslate.translate
    return [{"code": x.code, "name": x.name} for x in argostranslate.translate.get_installed_languages()]

def check():
    import pytesseract
    binary = shutil.which("tesseract")
    try:
        ocr_languages = sorted(pytesseract.get_languages(config="")) if binary else []
    except Exception:
        ocr_languages = []
    try:
        translations, error = installed_languages(), None
    except Exception as exc:
        translations, error = [], str(exc)
    emit({"ok": True, "offline": True, "tesseract_found": bool(binary),
          "tesseract_path": binary, "ocr_languages": ocr_languages,
          "translation_languages": translations, "translation_error": error})

def normalize_language(code):
    return {"zh-cn":"zh", "zh-tw":"zh", "pt-br":"pt"}.get(code.lower(), code.lower())

def detect_language(text):
    from langdetect import DetectorFactory, detect
    DetectorFactory.seed = 0
    return normalize_language(detect(text))

def recognize_and_translate(request):
    import pytesseract
    from PIL import Image
    import argostranslate.translate
    if not shutil.which("tesseract"):
        raise RuntimeError("Tesseract OCR is not installed. Install it and its language data first.")
    image = Image.open(io.BytesIO(base64.b64decode(request["image_base64"], validate=True))).convert("RGB")
    data = pytesseract.image_to_data(image, lang=request.get("ocr_language", "eng"),
        output_type=pytesseract.Output.DICT, config="--psm 6")
    lines = defaultdict(list)
    for i, raw in enumerate(data["text"]):
        if str(raw).strip() and int(data["conf"][i]) >= 0:
            key = (int(data["page_num"][i]), int(data["block_num"][i]),
                   int(data["par_num"][i]), int(data["line_num"][i]))
            lines[key].append(i)
    source_requested = request.get("source_language", "auto")
    target = normalize_language(request["target_language"])
    available = {x["code"] for x in installed_languages()}
    results = []
    for indexes in lines.values():
        source_text = " ".join(str(data["text"][i]).strip() for i in indexes).strip()
        if not source_text:
            continue
        source = detect_language(source_text) if source_requested == "auto" else normalize_language(source_requested)
        left = min(int(data["left"][i]) for i in indexes)
        top = min(int(data["top"][i]) for i in indexes)
        right = max(int(data["left"][i]) + int(data["width"][i]) for i in indexes)
        bottom = max(int(data["top"][i]) + int(data["height"][i]) for i in indexes)
        error, translated = None, None
        if source not in available:
            error = "No offline translation model installed for source language '%s'." % source
        elif target not in available:
            error = "No offline translation model installed for target language '%s'." % target
        else:
            try:
                translated = argostranslate.translate.translate(source_text, source, target)
            except Exception as exc:
                error = str(exc)
        results.append({"text":source_text, "translation":translated, "source_language":source,
            "error":error, "x":left, "y":top, "width":right-left, "height":bottom-top})
    emit({"ok":True, "offline":True, "image_width":image.width,
          "image_height":image.height, "blocks":results})

def main():
    request = json.load(sys.stdin)
    if request.get("action") == "check":
        check()
    elif request.get("action") == "recognize_and_translate":
        recognize_and_translate(request)
    else:
        raise ValueError("Unknown worker action: %s" % request.get("action"))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"ok":False, "offline":True, "error":str(exc)})
        sys.exit(1)
