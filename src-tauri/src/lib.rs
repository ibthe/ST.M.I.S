use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Cursor, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use keyring::Entry;
use xcap::Monitor;

fn worker_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().resolve("python/worker.py", tauri::path::BaseDirectory::Resource) {
        if path.exists() {
            return Ok(path);
        }
    }
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("python").join("worker.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }
    Err("The local OCR/translation worker was not found in the application resources.".into())
}

const KEYRING_SERVICE: &str = "com.ibthe.stmis";

fn credential_entry(provider: &str) -> Result<Entry, String> {
    match provider {
        "gemini" | "deepl" | "microsoft" | "microsoft_region" => {},
        _ => return Err("Unknown translation provider.".into()),
    }
    Entry::new(KEYRING_SERVICE, provider).map_err(|e| format!("Could not access OS credential vault: {e}"))
}

#[tauri::command]
fn save_provider_credential(provider: String, value: String) -> Result<(), String> {
    if value.trim().is_empty() { return Err("Значение не может быть пустым.".into()); }
    credential_entry(&provider)?.set_password(value.trim()).map_err(|e| format!("Не удалось сохранить ключ в системном хранилище: {e}"))
}

#[tauri::command]
fn delete_provider_credential(provider: String) -> Result<(), String> {
    match credential_entry(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Не удалось удалить ключ из системного хранилища: {e}")),
    }
}

#[tauri::command]
fn provider_credential_status() -> Result<Value, String> {
    let mut status = serde_json::Map::new();
    for provider in ["gemini", "deepl", "microsoft", "microsoft_region"] {
        let present = credential_entry(provider).ok().and_then(|entry| entry.get_password().ok()).is_some();
        status.insert(provider.to_string(), json!(present));
    }
    Ok(Value::Object(status))
}

fn load_provider_credentials() -> Value {
    let mut values = serde_json::Map::new();
    for provider in ["gemini", "deepl", "microsoft", "microsoft_region"] {
        if let Ok(entry) = credential_entry(provider) {
            if let Ok(value) = entry.get_password() {
                values.insert(provider.to_string(), json!(value));
            }
        }
    }
    Value::Object(values)
}

struct WorkerProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for WorkerProcess {
    fn drop(&mut self) { let _ = self.child.kill(); }
}

static WORKER_PROCESS: OnceLock<Mutex<Option<WorkerProcess>>> = OnceLock::new();

fn spawn_worker(app: &AppHandle) -> Result<WorkerProcess, String> {
    let script = worker_path(app)?;
    let runtime_home = app.path().resolve("runtime/home", tauri::path::BaseDirectory::Resource).ok();
    let runtime_bin = app.path().resolve("runtime/bin", tauri::path::BaseDirectory::Resource).ok();
    let runtime_lib = app.path().resolve("runtime/lib", tauri::path::BaseDirectory::Resource).ok();
    let bundled_worker = app.path().resolve(
        if cfg!(target_os = "macos") { "runtime/stmis-worker/stmis-worker" } else { "runtime/stmis-worker/stmis-worker.exe" },
        tauri::path::BaseDirectory::Resource
    ).ok().filter(|path| path.exists());

    let mut command = if let Some(executable) = bundled_worker {
        Command::new(executable)
    } else {
        let python = std::env::var("STMIS_PYTHON").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") { "python".into() } else { "python3".into() }
        });
        let mut fallback = Command::new(python);
        fallback.arg(script);
        fallback
    };
    command.env("ARGOS_CHUNK_TYPE", "MINISBD");
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");
    if let Some(home) = runtime_home {
        command.env("HOME", &home);
        if cfg!(target_os = "windows") {
            command.env("USERPROFILE", &home);
            command.env("APPDATA", home.join("AppData").join("Roaming"));
            command.env("LOCALAPPDATA", home.join("AppData").join("Local"));
        }
    }
    if let Some(bin) = runtime_bin {
        let existing = std::env::var("PATH").unwrap_or_default();
        let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
        command.env("PATH", format!("{}{}{}", bin.display(), separator, existing));
        let tesseract = if cfg!(target_os = "windows") { "tesseract.exe" } else { "tesseract" };
        command.env("TESSERACT_CMD", bin.join(tesseract));
    }
    if let Some(lib) = runtime_lib { command.env("DYLD_LIBRARY_PATH", lib); }
    if let Ok(tessdata) = app.path().resolve("runtime/share/tessdata", tauri::path::BaseDirectory::Resource) {
        command.env("TESSDATA_PREFIX", tessdata);
    }

    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|error| format!("Could not start the local OCR/translation worker: {error}"))?;
    let stdin = child.stdin.take().ok_or("Worker stdin pipe was not created.")?;
    let stdout = child.stdout.take().ok_or("Worker stdout pipe was not created.")?;
    Ok(WorkerProcess { child, stdin, stdout: BufReader::new(stdout) })
}

fn run_local_worker(app: &AppHandle, mut payload: Value) -> Result<Value, String> {
    if payload.get("action").and_then(Value::as_str) == Some("recognize_and_translate") {
        if let Some(object) = payload.as_object_mut() {
            object.insert("credentials".into(), load_provider_credentials());
        }
    }
    let process_lock = WORKER_PROCESS.get_or_init(|| Mutex::new(None));
    let mut slot = process_lock.lock().map_err(|_| "Worker process lock is poisoned.".to_string())?;
    if slot.as_mut().and_then(|worker| worker.child.try_wait().ok().flatten()).is_some() {
        *slot = None;
    }
    if slot.is_none() { *slot = Some(spawn_worker(app)?); }
    let worker = slot.as_mut().expect("worker was initialized");
    writeln!(worker.stdin, "{}", payload).and_then(|_| worker.stdin.flush())
        .map_err(|error| format!("Could not send request to OCR/translation worker: {error}"))?;
    let mut line = String::new();
    let bytes = worker.stdout.read_line(&mut line)
        .map_err(|error| format!("Could not read worker response: {error}"))?;
    if bytes == 0 {
        *slot = None;
        return Err("OCR/translation worker stopped unexpectedly.".into());
    }
    let response: Value = serde_json::from_str(&line)
        .map_err(|error| format!("Worker returned invalid JSON: {error}"))?;
    if response.get("ok") == Some(&json!(false)) {
        return Err(response.get("error").and_then(Value::as_str).unwrap_or("Local OCR/translation failed.").to_string());
    }
    Ok(response)
}

#[tauri::command]
fn check_offline_engines(app: AppHandle) -> Result<Value, String> {
    run_local_worker(&app, json!({"action": "check"}))
}

#[tauri::command]
fn recognize_and_translate(
    app: AppHandle,
    image_base64: String,
    source_language: String,
    target_language: String,
    ocr_language: String,
    translation_mode: String,
) -> Result<Value, String> {
    run_local_worker(&app, json!({
        "action": "recognize_and_translate",
        "image_base64": image_base64,
        "source_language": source_language,
        "target_language": target_language,
        "ocr_language": ocr_language,
        "translation_mode": translation_mode
    }))
}


#[tauri::command]
fn capture_overlay_and_translate(
    app: AppHandle,
    source_language: String,
    target_language: String,
    ocr_language: String,
    translation_mode: String,
) -> Result<Value, String> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| "Main overlay window was not found.".to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;

    window.hide().map_err(|e| format!("Could not hide overlay before capture: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(180));

    let capture_result = (|| -> Result<String, String> {
        let center_x = position.x + (size.width / 2) as i32;
        let center_y = position.y + (size.height / 2) as i32;
        let monitor = Monitor::from_point(center_x, center_y)
            .map_err(|e| format!("Could not identify display for overlay: {e}"))?;
        let monitor_x = monitor.x().map_err(|e| e.to_string())?;
        let monitor_y = monitor.y().map_err(|e| e.to_string())?;
        // Tauri outer_position/outer_size are already physical pixels; XCap capture_region
        // also expects monitor-relative physical pixels. Do not apply the DPI scale twice.
        let x = (position.x - monitor_x).max(0) as u32;
        let y = (position.y - monitor_y).max(0) as u32;
        let width = size.width;
        let height = size.height;
        let image = monitor.capture_region(x, y, width, height)
            .map_err(|e| format!("Screen capture failed. Check OS screen-recording permissions: {e}"))?;
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image).write_to(&mut png, ImageFormat::Png)
            .map_err(|e| format!("Could not encode captured screen area: {e}"))?;
        Ok(STANDARD.encode(png.into_inner()))
    })();

    let restore_result = window.show().map_err(|e| format!("Could not restore overlay after capture: {e}"));
    // Always restore the overlay, even when the capture itself fails.
    restore_result?;
    let image_base64 = capture_result?;
    run_local_worker(&app, json!({
        "action": "recognize_and_translate",
        "image_base64": image_base64,
        "source_language": source_language,
        "target_language": target_language,
        "ocr_language": ocr_language,
        "translation_mode": translation_mode
    }))
}

pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(lock) = WORKER_PROCESS.get() {
                    if let Ok(mut slot) = lock.lock() { *slot = None; }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![check_offline_engines, recognize_and_translate, capture_overlay_and_translate, save_provider_credential, delete_provider_credential, provider_credential_status])
        .run(tauri::generate_context!())
        .expect("error while running ST.M.I.S");
}
