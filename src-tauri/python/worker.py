"""Screen OCR and translation worker for ST.M.I.S."""
from __future__ import annotations
import base64, importlib.util, io, json, os, shutil, sys
os.environ["ARGOS_CHUNK_TYPE"] = "MINISBD"

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False)); sys.stdout.flush()

def installed_languages():
    import argostranslate.translate
    return [{"code":x.code,"name":x.name} for x in argostranslate.translate.get_installed_languages()]

def check():
    binary = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    try:
        import pytesseract
        if binary: pytesseract.pytesseract.tesseract_cmd = binary
        tess = sorted(pytesseract.get_languages(config="")) if binary else []
    except Exception:
        tess = []
    try:
        translations, error = installed_languages(), None
    except Exception as exc:
        translations, error = [], str(exc)
    emit({"ok":True,"offline":True,"tesseract_found":bool(binary),"tesseract_path":binary,
          "ocr_languages":tess,"paddleocr_available":importlib.util.find_spec("paddleocr") is not None,
          "translation_languages":translations,"translation_error":error})

def normalize_language(code):
    return {"zh-cn":"zh","zh-tw":"zh","pt-br":"pt"}.get(code.lower(),code.lower())

def detect_language(text):
    from langdetect import DetectorFactory, detect
    from langdetect.lang_detect_exception import LangDetectException
    DetectorFactory.seed=0
    try: return normalize_language(detect(text))
    except LangDetectException: return "unknown"

def recognize_and_translate(request):
    from PIL import Image
    from ocr import recognize_with_fallback
    from translators import translate
    image = Image.open(io.BytesIO(base64.b64decode(request["image_base64"],validate=True))).convert("RGB")
    raw_blocks, ocr_engine = recognize_with_fallback(image,request.get("ocr_language","eng+rus"))
    source_requested=request.get("source_language","auto")
    target=normalize_language(request["target_language"])
    credentials=request.get("credentials") or {}
    mode=request.get("translation_mode","auto")
    combined_text="\n".join(block["text"] for block in raw_blocks)
    detected_source=detect_language(combined_text) if source_requested=="auto" else normalize_language(source_requested)
    results=[]
    for index, block in enumerate(raw_blocks):
        source=detected_source
        nearby=raw_blocks[max(0,index-2):min(len(raw_blocks),index+3)]
        context="\n".join(item["text"] for item in nearby if item is not block)
        error, translated, provider = None, None, None
        if source=="unknown":
            error="Не удалось определить язык короткого фрагмента. Выберите исходный язык вручную."
        elif source==target:
            translated=block["text"]; provider="identity"
        else:
            translated,provider,error=translate(block["text"],source,target,mode,credentials,context)
        results.append({"text":block["text"],"translation":translated,"source_language":source,
            "error":error,"provider":provider,"confidence":block.get("confidence",0),
            "x":block["x"],"y":block["y"],"width":block["width"],"height":block["height"]})
    emit({"ok":True,"offline":False,"ocr_engine":ocr_engine,"image_width":image.width,
          "image_height":image.height,"blocks":results})

def main():
    # Stay alive so PaddleOCR models remain loaded across repeated screen scans.
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request=json.loads(line)
            if request.get("action")=="check":
                check()
            elif request.get("action")=="recognize_and_translate":
                recognize_and_translate(request)
            else:
                emit({"ok":False,"error":"Unknown worker action: "+str(request.get("action"))})
        except Exception as exc:
            emit({"ok":False,"offline":True,"error":str(exc)})

if __name__=="__main__":
    main()
