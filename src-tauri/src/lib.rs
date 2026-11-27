use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Write},
    path::PathBuf,
    process::{Command, Stdio},
};
use tauri::{AppHandle, Manager};
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

fn run_local_worker(app: &AppHandle, payload: Value) -> Result<Value, String> {
    let script = worker_path(app)?;
    let python = std::env::var("STMIS_PYTHON").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") { "python".into() } else { "python3".into() }
    });
    let mut child = Command::new(python)
        .arg(script)
        .env("ARGOS_CHUNK_TYPE", "MINISBD")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the local Python worker: {error}. Install Python and the packages in src-tauri/python/requirements.txt, or set STMIS_PYTHON."))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(payload.to_string().as_bytes())
            .map_err(|error| format!("Could not send data to the local worker: {error}"))?;
    }
    let output = child.wait_with_output()
        .map_err(|error| format!("The local worker failed to return a result: {error}"))?;
    let response: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| format!("The local worker returned invalid JSON. {}", String::from_utf8_lossy(&output.stderr)))?;
    if !output.status.success() || response.get("ok") == Some(&json!(false)) {
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
) -> Result<Value, String> {
    run_local_worker(&app, json!({
        "action": "recognize_and_translate",
        "image_base64": image_base64,
        "source_language": source_language,
        "target_language": target_language,
        "ocr_language": ocr_language
    }))
}


#[tauri::command]
fn capture_overlay_and_translate(
    app: AppHandle,
    source_language: String,
    target_language: String,
    ocr_language: String,
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
        let scale = monitor.scale_factor().map_err(|e| e.to_string())?;
        let x = ((position.x - monitor_x) as f32 * scale).round().max(0.0) as u32;
        let y = ((position.y - monitor_y) as f32 * scale).round().max(0.0) as u32;
        let width = (size.width as f32 * scale).round() as u32;
        let height = (size.height as f32 * scale).round() as u32;
        let image = monitor.capture_region(x, y, width, height)
            .map_err(|e| format!("Screen capture failed. Check OS screen-recording permissions: {e}"))?;
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image).write_to(&mut png, ImageFormat::Png)
            .map_err(|e| format!("Could not encode captured screen area: {e}"))?;
        Ok(STANDARD.encode(png.into_inner()))
    })();

    let restore_result = window.show().map_err(|e| format!("Captured screen, but could not restore overlay: {e}"));
    let image_base64 = capture_result?;
    restore_result?;
    run_local_worker(&app, json!({
        "action": "recognize_and_translate",
        "image_base64": image_base64,
        "source_language": source_language,
        "target_language": target_language,
        "ocr_language": ocr_language
    }))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_offline_engines, recognize_and_translate, capture_overlay_and_translate])
        .run(tauri::generate_context!())
        .expect("error while running ST.M.I.S");
}
