"""Free-tier online translation adapters with offline Argos fallback."""
from __future__ import annotations
import json, urllib.parse, urllib.request, urllib.error

def _request(url, payload, headers=None, method="POST"):
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=18) as response:
        return json.loads(response.read().decode("utf-8"))

def _gemini(text, source, target, key, context=""):
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + urllib.parse.quote(key)
    prompt = ("Translate the selected text from %s to %s. Preserve meaning, names, "
              "game terminology, tone and line breaks. Use the surrounding dialogue only as context. "
              "Return only the translation of the selected text.\n\nContext:\n%s\n\nSelected text:\n%s") % (source, target, context or "(no additional context)", text)
    result = _request(url, {"contents":[{"parts":[{"text":prompt}]}],
        "generationConfig":{"temperature":0.15}})
    return result["candidates"][0]["content"]["parts"][0]["text"].strip()

def _deepl(text, source, target, key):
    form = urllib.parse.urlencode({"text":text,"target_lang":target.upper(),
        **({"source_lang":source.upper()} if source != "auto" else {})}).encode()
    req = urllib.request.Request("https://api-free.deepl.com/v2/translate", data=form,
        headers={"Authorization":"DeepL-Auth-Key "+key,"Content-Type":"application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=18) as response:
        return json.loads(response.read().decode())["translations"][0]["text"]

def _azure(text, source, target, credentials):
    key = credentials.get("microsoft")
    region = credentials.get("microsoft_region")
    if not key or not region:
        raise RuntimeError("Для Microsoft Translator нужны ключ F0 и регион ресурса.")
    query = urllib.parse.urlencode({"api-version":"3.0","to":target})
    if source != "auto":
        query += "&" + urllib.parse.urlencode({"from":source})
    req = urllib.request.Request("https://api.cognitive.microsofttranslator.com/translate?"+query,
        data=json.dumps([{"text":text}]).encode(),
        headers={"Ocp-Apim-Subscription-Key":key,"Ocp-Apim-Subscription-Region":region,
                 "Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=18) as response:
        return json.loads(response.read().decode())[0]["translations"][0]["text"]

def _mymemory(text, source, target):
    if source == "auto":
        raise RuntimeError("MyMemory требует явно выбранный исходный язык.")
    query = urllib.parse.urlencode({"q":text,"langpair":source+"|"+target})
    with urllib.request.urlopen("https://api.mymemory.translated.net/get?"+query, timeout=18) as response:
        result = json.loads(response.read().decode())
    if result.get("responseStatus") != 200:
        raise RuntimeError(result.get("responseDetails","MyMemory rejected the request"))
    return result["responseData"]["translatedText"]

def translate(text, source, target, mode, credentials, context=""):
    """Try configured free services in priority order, then local Argos."""
    providers = {
        "gemini": lambda: _gemini(text,source,target,credentials.get("gemini",""),context),
        "deepl": lambda: _deepl(text,source,target,credentials.get("deepl","")),
        "microsoft": lambda: _azure(text,source,target,credentials),
        "mymemory": lambda: _mymemory(text,source,target),
    }
    if mode == "argos":
        order = []
    else:
        order = [mode] if mode in providers else ["gemini","deepl","microsoft","mymemory"]
    errors = []
    for name in order:
        if name in ("gemini","deepl") and not credentials.get(name):
            continue
        if name == "microsoft" and not (credentials.get("microsoft") and credentials.get("microsoft_region")):
            continue
        try:
            value = providers[name]()
            if value:
                return value, name, None
        except Exception as exc:
            errors.append(name+": "+str(exc))
    try:
        import argostranslate.translate
        value = argostranslate.translate.translate(text, source, target)
        if value:
            return value, "argos", "; ".join(errors) or None
    except Exception as exc:
        errors.append("argos: "+str(exc))
    return None, None, "; ".join(errors) or "Нет подключённого бесплатного переводчика."
