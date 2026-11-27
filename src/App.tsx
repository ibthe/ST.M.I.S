import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type EngineStatus = {
  ok: boolean; offline: boolean; tesseract_found: boolean;
  ocr_languages: string[];
  translation_languages: { code: string; name: string }[];
  paddleocr_available?: boolean;
};
type TranslationBlock = {
  text: string; translation: string | null; source_language: string; error: string | null;
  provider?: string | null; confidence?: number;
  x: number; y: number; width: number; height: number;
};
const languages = [
  { code: "en", name: "Английский" }, { code: "ru", name: "Русский" },
  { code: "es", name: "Испанский" }, { code: "fr", name: "Французский" },
  { code: "de", name: "Немецкий" }, { code: "ja", name: "Японский" },
  { code: "zh", name: "Китайский" },
];
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Не удалось прочитать выбранное изображение."));
    reader.readAsDataURL(file);
  });
}
export default function App() {
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(false);
  const [target, setTarget] = useState("ru");
  const [source, setSource] = useState("auto");
  const [ocrLanguage, setOcrLanguage] = useState("eng+rus");
  const [translationMode, setTranslationMode] = useState("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({});
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [settingsMessage, setSettingsMessage] = useState("");
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineError, setEngineError] = useState("");
  const [blocks, setBlocks] = useState<TranslationBlock[]>([]);
  const [captureSize, setCaptureSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const captureBusy = useRef(false);

  async function refreshProviderStatus() {
    try { setProviderStatus(await invoke<Record<string, boolean>>("provider_credential_status")); }
    catch (error) { setSettingsMessage("Не удалось проверить защищённое хранилище ключей: " + String(error)); }
  }
  async function saveProviderKeys() {
    const entries = Object.entries(keyDrafts).filter(([, value]) => value.trim());
    if (!entries.length) { setSettingsMessage("Введите хотя бы один API-ключ или регион."); return; }
    try {
      for (const [provider, value] of entries) {
        await invoke("save_provider_credential", { provider, value });
      }
      setKeyDrafts({});
      await refreshProviderStatus();
      setSettingsMessage("Данные сохранены в системном хранилище macOS/Windows.");
    } catch (error) { setSettingsMessage("Не удалось сохранить данные: " + String(error)); }
  }
  async function checkSetup() {
    setEngineError("Проверяю локальные OCR и модели перевода…");
    try {
      const status = await invoke<EngineStatus>("check_offline_engines");
      setEngineStatus(status);
      const hasTarget = status.translation_languages.some(item => item.code === target);
      if (!status.paddleocr_available && !status.tesseract_found) setEngineError("Не найден PaddleOCR или Tesseract. Проверьте комплект локального OCR.");
      else if (!hasTarget) setEngineError("OCR готов. Для офлайн-перевода нет модели выбранного языка; онлайн-перевод доступен при подключённом сервисе.");
      else setEngineError("Локальное распознавание и офлайн-резерв готовы. Переводчик: " + translationMode + ".");
    } catch (error) {
      setEngineStatus(null);
      setEngineError("Не удалось запустить локальный движок: " + String(error));
    }
  }
  async function captureAndTranslate() {
    setBusy(true); setEngineError("");
    try {
      const result = await invoke<{ blocks: TranslationBlock[]; image_width: number; image_height: number }>(
        "capture_overlay_and_translate", { sourceLanguage: source, targetLanguage: target, ocrLanguage, translationMode }
      );
      setBlocks(result.blocks);
      setCaptureSize({ width: result.image_width, height: result.image_height });
      if (!result.blocks.length) setEngineError("Текст на экране не распознан. Проверьте язык OCR и разрешение на запись экрана.");
      else if (result.blocks.every(block => !block.translation)) setEngineError(result.blocks.map(block => block.error).filter(Boolean).join("; ") || "Не удалось перевести распознанный текст.");
    } catch (error) { setEngineError("Ошибка захвата или перевода: " + String(error)); }
    finally { setBusy(false); }
  }
  async function testImage(file?: File) {
    if (!file) return;
    setBusy(true); setEngineError("");
    try {
      const imageBase64 = await fileToBase64(file);
      const result = await invoke<{ blocks: TranslationBlock[]; image_width: number; image_height: number }>(
        "recognize_and_translate", { imageBase64, sourceLanguage: source, targetLanguage: target, ocrLanguage, translationMode }
      );
      setBlocks(result.blocks);
      setCaptureSize({ width: result.image_width, height: result.image_height });
      if (!result.blocks.length) setEngineError("На изображении не найден текст.");
      else if (result.blocks.every(block => !block.translation)) setEngineError(result.blocks.map(block => block.error).filter(Boolean).join("; ") || "Текст распознан, но перевод не получен.");
    } catch (error) { setEngineError("Ошибка тестирования изображения: " + String(error)); }
    finally { setBusy(false); }
  }
  const ready = Boolean(engineStatus?.paddleocr_available || engineStatus?.tesseract_found);
  useEffect(() => { void refreshProviderStatus(); }, []);
  useEffect(() => {
    if (!live || paused) return;
    const timer = window.setInterval(() => {
      if (captureBusy.current) return;
      captureBusy.current = true;
      captureAndTranslate().finally(() => { captureBusy.current = false; });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [live, paused, source, target, ocrLanguage, translationMode]);

  async function exitApp() {
    try { await getCurrentWindow().close(); }
    catch (error) { setEngineError("Не удалось закрыть приложение: " + String(error)); }
  }

  async function handleWindowMouseDown(event: React.MouseEvent<HTMLElement>) {
    const targetElement = event.target as HTMLElement;
    if (targetElement.closest("button, select, input, label, a, [role='button'], .resize-grip, .settings-panel")) return;
    try { await getCurrentWindow().startDragging(); }
    catch (error) { setEngineError("Не удалось переместить окно: " + String(error)); }
  }
  async function handleResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    try { await getCurrentWindow().startResizeDragging("SouthEast"); }
    catch (error) { setEngineError("Не удалось изменить размер окна: " + String(error)); }
  }

  return (
    <main className="overlay-shell" onMouseDown={handleWindowMouseDown}>
      {captureSize && blocks.length > 0 && (
        <div className="translated-overlay" aria-label="Переведённый текст на экране">
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

      <header className="control-rail top-rail">
        <div className="brand-lockup">
          <span className="brand-symbol">S</span><span>ST.M.I.S</span><small>ПЕРЕВОД ЭКРАНА</small>
        </div>
        <div className="round-controls">
          <button className={paused ? "round-control active" : "round-control"} title={paused ? "Продолжить" : "Пауза"}
            aria-label={paused ? "Продолжить" : "Пауза"} onClick={() => setPaused(!paused)}>{paused ? "▶" : "Ⅱ"}</button>
          <button className={live ? "round-control active" : "round-control"} title="Автоматическое сканирование"
            aria-label="Включить автоматическое сканирование" disabled={paused}
            onClick={() => { if (!live && !ready) { setEngineError("Сначала проверьте наличие локальных OCR и языковых моделей."); return; } setLive(!live); }}>{live ? "●" : "◎"}</button>
          <button className="round-control capture-control" title="Сканировать и перевести" aria-label="Сканировать и перевести"
            disabled={busy || paused || live} onClick={captureAndTranslate}>{busy ? "…" : "↗"}</button>
          <button className="round-control" title="Настройки переводчиков" aria-label="Настройки переводчиков" onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
          <button className="round-control exit-control" title="Выход из программы" aria-label="Выход из программы" onClick={exitApp}>×</button>
        </div>
        <span className={paused ? "state-indicator paused" : "state-indicator"}><i />{paused ? "ПАУЗА" : live ? "СКАНИРОВАНИЕ" : "ГОТОВО"}</span>
      </header>

      <section className="transparent-stage" aria-label="Прозрачная область экрана">
        {settingsOpen && <div className="settings-panel">
          <div className="settings-heading"><strong>ОНЛАЙН-ПЕРЕВОДЧИКИ</strong><button onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки">×</button></div>
          <p>Автоматический режим пробует Gemini, DeepL, Microsoft Translator и MyMemory. Ключи хранятся в системном хранилище, а не в файлах приложения.</p>
          <label>Gemini API key <input type="password" autoComplete="off" value={keyDrafts.gemini || ""} placeholder={providerStatus.gemini ? "Ключ сохранён — введите новый для замены" : "Вставьте бесплатный API-ключ"} onChange={e => setKeyDrafts({...keyDrafts,gemini:e.target.value})} /></label>
          <label>DeepL API Free key <input type="password" autoComplete="off" value={keyDrafts.deepl || ""} placeholder={providerStatus.deepl ? "Ключ сохранён — введите новый для замены" : "Вставьте API Free key"} onChange={e => setKeyDrafts({...keyDrafts,deepl:e.target.value})} /></label>
          <label>Microsoft Translator F0 key <input type="password" autoComplete="off" value={keyDrafts.microsoft || ""} placeholder={providerStatus.microsoft ? "Ключ сохранён — введите новый для замены" : "Ключ F0"} onChange={e => setKeyDrafts({...keyDrafts,microsoft:e.target.value})} /></label>
          <label>Регион Microsoft <input value={keyDrafts.microsoft_region || ""} placeholder={providerStatus.microsoft_region ? "Регион сохранён — введите новый для замены" : "Например, canadacentral"} onChange={e => setKeyDrafts({...keyDrafts,microsoft_region:e.target.value})} /></label>
          <div className="settings-actions"><button onClick={saveProviderKeys}>СОХРАНИТЬ КЛЮЧИ</button><span>{settingsMessage}</span></div>
          <small>Gemini Free может использовать содержимое запросов для улучшения сервисов. Бесплатные лимиты зависят от аккаунта. Не подключайте платный тариф, если не хотите рисковать расходами.</small>
          <div className="provider-state">Подключено: {["gemini","deepl","microsoft"].filter(k => providerStatus[k]).join(", ") || "пока нет ключей"} · MyMemory доступен без ключа</div>
        </div>}
        {engineError && <div className="stage-error">{engineError}</div>}
        {blocks.length > 0 && (
          <div className="result-panel">
            <div className="result-heading"><span>РЕЗУЛЬТАТЫ ПЕРЕВОДА</span><button onClick={() => setBlocks([])} aria-label="Очистить результаты">×</button></div>
            {blocks.slice(0, 5).map((block, index) => (
              <div className="result-line" key={index}>
                <small>{block.source_language.toUpperCase()} · {block.text}</small>
                <strong>{block.translation || block.error || "Перевод не получен"}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="control-rail bottom-rail">
        <div className="language-controls">
          <label><span>С ЯЗЫКА</span><select value={source} onChange={e => setSource(e.target.value)}>
            <option value="auto">Автоопределение</option>{languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select></label>
          <span className="language-arrow">→</span>
          <label><span>НА ЯЗЫК</span><select value={target} onChange={e => setTarget(e.target.value)}>
            {languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select></label>
          <label><span>ПЕРЕВОД</span><select value={translationMode} onChange={e => setTranslationMode(e.target.value)}>
            <option value="auto">Лучшее доступное</option><option value="gemini">Gemini</option><option value="deepl">DeepL</option>
            <option value="microsoft">Microsoft</option><option value="mymemory">MyMemory</option><option value="argos">Офлайн</option>
          </select></label>
          <label className="ocr-select"><span>ЯЗЫК OCR</span><select value={ocrLanguage} onChange={e => setOcrLanguage(e.target.value)}>
            <option value="eng+rus">Английский + русский</option><option value="eng">Английский</option><option value="rus">Русский</option>
            <option value="deu">Немецкий</option><option value="jpn">Японский</option><option value="chi_sim">Китайский</option>
          </select></label>
        </div>
        <div className="rail-actions">
          <button className="text-action" onClick={checkSetup}>ПРОВЕРИТЬ ОФЛАЙН</button>
          <label className="text-action import-action">ТЕСТ ИЗОБРАЖЕНИЯ<input type="file" accept="image/*" onChange={e => testImage(e.target.files?.[0])} /></label>
        </div>
        {engineStatus && <span className={ready ? "engine-dot ready" : "engine-dot"} title={ready ? "Офлайн-движки готовы" : "Не хватает офлайн-компонентов"} />}
        <div className="resize-grip" role="button" aria-label="Изменить размер окна" title="Потяните, чтобы изменить размер" onMouseDown={handleResize}><span /><span /><span /></div>
      </footer>
    </main>
  );
}
