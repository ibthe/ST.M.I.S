import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type EngineStatus = {
  ok: boolean; offline: boolean; tesseract_found: boolean;
  ocr_languages: string[];
  translation_languages: { code: string; name: string }[];
};
type TranslationBlock = {
  text: string; translation: string | null; source_language: string; error: string | null;
  x: number; y: number; width: number; height: number;
};
const languages = [
  { code: "en", name: "English" }, { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" }, { code: "fr", name: "French" },
  { code: "de", name: "German" }, { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
];
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read selected image."));
    reader.readAsDataURL(file);
  });
}
export default function App() {
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(false);
  const [target, setTarget] = useState("ru");
  const [source, setSource] = useState("auto");
  const [ocrLanguage, setOcrLanguage] = useState("eng+rus");
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineError, setEngineError] = useState("");
  const [blocks, setBlocks] = useState<TranslationBlock[]>([]);
  const [captureSize, setCaptureSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const captureBusy = useRef(false);

  async function checkSetup() {
    setEngineError("");
    try { setEngineStatus(await invoke<EngineStatus>("check_offline_engines")); }
    catch (error) { setEngineError(String(error)); }
  }
  async function captureAndTranslate() {
    setBusy(true); setEngineError("");
    try {
      const result = await invoke<{ blocks: TranslationBlock[]; image_width: number; image_height: number }>(
        "capture_overlay_and_translate", { sourceLanguage: source, targetLanguage: target, ocrLanguage }
      );
      setBlocks(result.blocks);
      setCaptureSize({ width: result.image_width, height: result.image_height });
    } catch (error) { setEngineError(String(error)); }
    finally { setBusy(false); }
  }
  async function testImage(file?: File) {
    if (!file) return;
    setBusy(true); setEngineError("");
    try {
      const imageBase64 = await fileToBase64(file);
      const result = await invoke<{ blocks: TranslationBlock[]; image_width: number; image_height: number }>(
        "recognize_and_translate", { imageBase64, sourceLanguage: source, targetLanguage: target, ocrLanguage }
      );
      setBlocks(result.blocks);
      setCaptureSize({ width: result.image_width, height: result.image_height });
    } catch (error) { setEngineError(String(error)); }
    finally { setBusy(false); }
  }
  const ready = Boolean(engineStatus?.tesseract_found &&
    engineStatus.translation_languages.some(item => item.code === target));
  useEffect(() => {
    if (!live || paused) return;
    const timer = window.setInterval(() => {
      if (captureBusy.current) return;
      captureBusy.current = true;
      captureAndTranslate().finally(() => { captureBusy.current = false; });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [live, paused, source, target, ocrLanguage]);

  return (
    <main className="overlay-shell">
      {captureSize && blocks.length > 0 && (
        <div className="translated-overlay" aria-label="Translated screen text">
          {blocks.filter(block => block.translation).map((block, index) => (
            <div className="translated-label" key={index} style={{
              left: (block.x / captureSize.width * 100) + "%",
              top: (block.y / captureSize.height * 100) + "%",
              width: Math.max(7, block.width / captureSize.width * 100) + "%",
              minHeight: Math.max(2, block.height / captureSize.height * 100) + "%"
            }}>{block.translation}</div>
          ))}
        </div>
      )}

      <header className="control-rail top-rail" data-tauri-drag-region>
        <div className="brand-lockup" data-tauri-drag-region>
          <span className="brand-symbol">S</span><span>ST.M.I.S</span><small>SCREEN TRANSLATOR</small>
        </div>
        <div className="round-controls">
          <button className={paused ? "round-control active" : "round-control"} title={paused ? "Resume" : "Pause"}
            aria-label={paused ? "Resume" : "Pause"} onClick={() => setPaused(!paused)}>{paused ? "▶" : "Ⅱ"}</button>
          <button className={live ? "round-control active" : "round-control"} title="Automatic translation"
            aria-label="Toggle automatic translation" disabled={paused}
            onClick={() => { if (!live && !ready) { setEngineError("Check offline setup first. Install the selected local OCR and translation models."); return; } setLive(!live); }}>{live ? "●" : "◎"}</button>
          <button className="round-control capture-control" title="Capture and translate" aria-label="Capture and translate"
            disabled={busy || paused || live} onClick={captureAndTranslate}>{busy ? "…" : "↗"}</button>
        </div>
        <span className={paused ? "state-indicator paused" : "state-indicator"}><i />{paused ? "PAUSED" : live ? "LIVE" : "READY"}</span>
      </header>

      <section className="transparent-stage" data-tauri-drag-region aria-label="Transparent screen viewing area">
        {engineError && <div className="stage-error">{engineError}</div>}
        {blocks.length > 0 && (
          <div className="result-panel">
            <div className="result-heading"><span>TRANSLATION LOG</span><button onClick={() => setBlocks([])} aria-label="Clear translations">×</button></div>
            {blocks.slice(0, 5).map((block, index) => (
              <div className="result-line" key={index}>
                <small>{block.source_language.toUpperCase()} · {block.text}</small>
                <strong>{block.translation || block.error || "No translation"}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="control-rail bottom-rail">
        <div className="language-controls">
          <label><span>FROM</span><select value={source} onChange={e => setSource(e.target.value)}>
            <option value="auto">Auto detect</option>{languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select></label>
          <span className="language-arrow">→</span>
          <label><span>TO</span><select value={target} onChange={e => setTarget(e.target.value)}>
            {languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select></label>
          <label className="ocr-select"><span>OCR</span><select value={ocrLanguage} onChange={e => setOcrLanguage(e.target.value)}>
            <option value="eng+rus">EN + RU</option><option value="eng">English</option><option value="rus">Russian</option>
            <option value="deu">German</option><option value="jpn">Japanese</option><option value="chi_sim">Chinese</option>
          </select></label>
        </div>
        <div className="rail-actions">
          <button className="text-action" onClick={checkSetup}>CHECK OFFLINE</button>
          <label className="text-action import-action">TEST IMAGE<input type="file" accept="image/*" onChange={e => testImage(e.target.files?.[0])} /></label>
        </div>
        {engineStatus && <span className={ready ? "engine-dot ready" : "engine-dot"} title={ready ? "Offline engines ready" : "Offline models missing"} />}
        <div className="resize-grip" aria-hidden="true"><span /><span /><span /></div>
      </footer>
    </main>
  );
}
