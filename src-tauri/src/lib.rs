#[tauri::command]
fn get_app_status() -> String { String::from("overlay-ui-ready; screen-capture-not-implemented") }
pub fn run() { tauri::Builder::default().invoke_handler(tauri::generate_handler![get_app_status]).run(tauri::generate_context!()).expect("error while running ST.M.I.S"); }
