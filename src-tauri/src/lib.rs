use tauri::Manager;

/// Returns process uptime in seconds since the backend started.
/// (Privacy: the only OS-derived signals we expose are the clock and uptime.)
#[tauri::command]
fn app_uptime(state: tauri::State<'_, AppState>) -> u64 {
    state.started.elapsed().as_secs()
}

struct AppState {
    started: std::time::Instant,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            started: std::time::Instant::now(),
        })
        .invoke_handler(tauri::generate_handler![app_uptime])
        .setup(|app| {
            // Ensure the main window is shown on launch.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ECHOSEED");
}
