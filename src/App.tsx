import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type EngineStatus = {
  ok: boolean;
  offline: boolean;
  tesseract_found: boolean;
  tesseract_path?: string;
  ocr_languages: string[];
  translation_languages: { code: string; name: string }[];
  translation_error?: string | null;
};

const languages = [
  { code: "en", name: "English" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
];

export default function App() {
  const [paused, setPaused] = useState(false);
  const [target, setTarget] = useState("en");
  const [source, setSource] = useState("auto");
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [engineError, setEngineError] = useState("");

  async function checkOfflineSetup() {
    setChecking(true);
    setEngineError("");
    try {
      const result = await invoke<EngineStatus>("check_offline_engines");
      setEngineStatus(result);
    } catch (error) {
      setEngineError(String(error));
    } finally {
      setChecking(false);
    }
  }

  const ready = Boolean(engineStatus?.tesseract_found && engineStatus.translation_languages.some((item) => item.code === target));

  return (
    <main className="shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <b className="brand-mark">S</b> ST.M.I.S <small>PREVIEW 0.2</small>
        </div>
        <span className="status">{paused ? "PAUSED" : "OFFLINE MODE"}</span>
      </header>

      <section className="content">
        <div className="eyebrow">PRIVATE BY DESIGN · NO CLOUD SERVICES</div>
        <h1>Your screen,<br /><em>understood.</em></h1>
        <p className="intro">Recognize and translate text beneath the floating window. OCR and translation are designed to run locally on this computer.</p>

        <div className="capture-card">
          <div className="card-label">CAPTURE AREA</div>
          <h3>Everything under this window</h3>
          <div className="capture-visual">
            <div className="scan-line" />
            <div className="scan-copy">
              <strong>◎</strong>
              <b>Screen capture integration</b>
              <small>Native Windows and macOS capture is the next milestone</small>
            </div>
          </div>
          <div className="capture-foot">● SCREEN CAPTURE NOT CONNECTED YET</div>
        </div>

        <div className="controls">
          <label>TRANSLATE TO
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>
          </label>
          <label>SOURCE LANGUAGE
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="auto">Auto detect</option>
              {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
            </select>
          </label>
        </div>

        <div className="engine-panel">
          <div className="engine-heading">
            <div><div className="card-label">LOCAL ENGINES</div><strong>Offline readiness</strong></div>
            <button className="check-button" onClick={checkOfflineSetup} disabled={checking}>{checking ? "Checking…" : "Check setup"}</button>
          </div>
          {engineError && <p className="engine-error">{engineError}</p>}
          {engineStatus && (
            <div className="engine-results">
              <div><span className={engineStatus.tesseract_found ? "good" : "bad"}>●</span> Tesseract OCR {engineStatus.tesseract_found ? "detected" : "not found"}</div>
              <div><span className={engineStatus.translation_languages.length ? "good" : "bad"}>●</span> Argos models: {engineStatus.translation_languages.length ? engineStatus.translation_languages.map((item) => item.code).join(", ") : "none installed"}</div>
              <div><span className={ready ? "good" : "bad"}>●</span> Selected target: {ready ? "model available" : "model missing"}</div>
              {engineStatus.ocr_languages.length > 0 && <small>OCR data: {engineStatus.ocr_languages.join(", ")}</small>}
            </div>
          )}
          {!engineStatus && !engineError && <p className="engine-hint">Check that local Python packages, Tesseract and translation models are installed.</p>}
        </div>

        <div className="action-row">
          <button className="primary-button" onClick={() => setPaused(!paused)}>{paused ? "▶ Resume" : "Ⅱ Pause"}</button>
          <span>{paused ? "Translation paused" : "Live translation will start when screen capture is connected"}</span>
        </div>
      </section>

      <footer>ALL PROCESSING STAYS ON THIS DEVICE <span>NO NETWORK TRANSLATION</span></footer>
    </main>
  );
}
