"""OCR backends for ST.M.I.S. PaddleOCR is preferred; Tesseract remains fallback."""
from __future__ import annotations
import os
from typing import Any

_PADDLE = None

def _paddle_instance(language: str):
    global _PADDLE
    if _PADDLE is not None:
        return _PADDLE
    from paddleocr import PaddleOCR
    # PP-OCRv5 multilingual recognition covers Russian and English.
    lang = "ru" if language in ("eng+rus", "rus", "ru") else {
        "eng":"en", "deu":"de", "jpn":"japan", "chi_sim":"ch"
    }.get(language, "ru")
    _PADDLE = PaddleOCR(
        lang=lang,
        ocr_version="PP-OCRv5",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
    )
    return _PADDLE

def _preprocess(image):
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    # Preserve color where possible, improve small UI/subtitle text.
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = 1.0
    if min(image.size) < 900:
        scale = min(2.0, 900 / max(1, min(image.size)))
        image = image.resize((int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS)
    image = ImageEnhance.Contrast(image).enhance(1.18)
    image = image.filter(ImageFilter.UnsharpMask(radius=1.2, percent=125, threshold=3))
    return image, scale

def recognize(image, language: str):
    """Return normalized OCR blocks with coordinates in original image pixels."""
    import numpy as np
    prepared, scale = _preprocess(image)
    ocr = _paddle_instance(language)
    results = ocr.predict(np.asarray(prepared))
    blocks = []
    for item in results or []:
        payload = getattr(item, "json", None)
        if callable(payload):
            payload = payload()
        if isinstance(payload, dict):
            payload = payload.get("res", payload)
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts") or []
        scores = payload.get("rec_scores") or []
        polygons = payload.get("dt_polys") or payload.get("rec_polys") or []
        for idx, text in enumerate(texts):
            text = str(text).strip()
            if not text:
                continue
            try:
                score = float(scores[idx]) if idx < len(scores) else 1.0
                points = np.asarray(polygons[idx], dtype=float).reshape(-1, 2)
                left, top = points.min(axis=0)
                right, bottom = points.max(axis=0)
            except Exception:
                left = top = 0
                right, bottom = prepared.size
                score = 0.0
            if score < 0.35:
                continue
            blocks.append({
                "text": text,
                "confidence": score,
                "x": int(left / scale), "y": int(top / scale),
                "width": max(1, int((right-left) / scale)),
                "height": max(1, int((bottom-top) / scale)),
            })
    return blocks

def recognize_with_fallback(image, language: str):
    try:
        blocks = recognize(image, language)
        return blocks, "paddleocr"
    except (ImportError, ModuleNotFoundError) as exc:
        if os.environ.get("STMIS_REQUIRE_PADDLEOCR") == "1":
            raise RuntimeError("Packaged PaddleOCR dependency is missing: %s" % exc) from exc
        return recognize_tesseract(image, language), "tesseract"
    except Exception as exc:
        # CI smoke tests must fail loudly rather than silently passing via fallback.
        if os.environ.get("STMIS_REQUIRE_PADDLEOCR") == "1":
            raise RuntimeError("Packaged PaddleOCR inference failed: %s" % exc) from exc
        try:
            blocks = recognize_tesseract(image, language)
            return blocks, "tesseract"
        except Exception as fallback_exc:
            raise RuntimeError("PaddleOCR failed (%s); Tesseract fallback failed (%s)." % (exc, fallback_exc)) from exc

def recognize_tesseract(image, language: str):
    import pytesseract
    from collections import defaultdict
    from pytesseract import Output
    binary = os.environ.get("TESSERACT_CMD")
    if binary:
        pytesseract.pytesseract.tesseract_cmd = binary
    data = pytesseract.image_to_data(image, lang=language, output_type=Output.DICT, config="--psm 6")
    lines = defaultdict(list)
    for i, raw in enumerate(data["text"]):
        if str(raw).strip():
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            lines[key].append(i)
    blocks = []
    for indexes in lines.values():
        text = " ".join(str(data["text"][i]).strip() for i in indexes).strip()
        if not text:
            continue
        left = min(int(data["left"][i]) for i in indexes)
        top = min(int(data["top"][i]) for i in indexes)
        right = max(int(data["left"][i])+int(data["width"][i]) for i in indexes)
        bottom = max(int(data["top"][i])+int(data["height"][i]) for i in indexes)
        blocks.append({"text":text,"confidence":0.0,"x":left,"y":top,"width":right-left,"height":bottom-top})
    return blocks
