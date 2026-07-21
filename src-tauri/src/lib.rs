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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn app_state_uptime_is_non_negative_and_monotonic() {
        let state = AppState {
            started: Instant::now(),
        };
        let first = state.started.elapsed().as_secs();
        std::thread::sleep(Duration::from_millis(1100));
        let second = state.started.elapsed().as_secs();
        assert!(second >= first);
    }

    #[test]
    fn tauri_context_parses_without_panicking() {
        // generate_context!() reads tauri.conf.json + the bundled icons at
        // compile time; this just confirms the resulting context is well
        // formed enough to hand to a Builder without immediately erroring,
        // catching config/icon regressions before they reach a real build.
        let _ctx: tauri::Context<tauri::Wry> = tauri::generate_context!();
    }
}
