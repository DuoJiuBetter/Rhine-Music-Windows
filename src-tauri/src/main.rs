#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

// NVIDIA Optimus' documented application hint. MSVC exports this DWORD in
// build.rs even with LTO/stripping. WebView2's GPU subprocess also needs the
// Chromium preference below; the host export alone cannot select its adapter.
#[cfg(windows)]
#[no_mangle]
#[used]
pub static NvOptimusEnablement: u32 = 1;

fn request_high_performance_gpu() {
    #[cfg(windows)] {
        // Preserve Wry's defaults and externally supplied browser arguments.
        // Do not disable driver blocklists, the GPU sandbox, or the single-GPU
        // fallback. Windows/driver policy can still override this preference.
        let previous = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        if !previous.split_whitespace().any(|arg| arg == "--force_high_performance_gpu") {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                format!("{previous} --force_high_performance_gpu"));
        }
    }
}

struct MusicService(Mutex<Option<Child>>);

impl MusicService {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            if let Some(stdin) = child.stdin.as_mut() { let _ = stdin.write_all(b"shutdown\n"); }
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() { return; }
                std::thread::sleep(Duration::from_millis(30));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for MusicService { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
fn desktop_window_state(window: WebviewWindow) -> serde_json::Value {
    serde_json::json!({ "fullscreen": window.is_fullscreen().unwrap_or(false), "maximized": window.is_maximized().unwrap_or(false) })
}

#[tauri::command]
fn desktop_window_action(window: WebviewWindow, action: &str) -> Result<(), String> {
    match action {
        "minimize" => window.minimize(),
        // Maximize uses the Windows work area, leaving the taskbar available.
        // Keep old action names compatible without entering native fullscreen.
        "maximize" | "fullscreen" => if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() },
        "restore" | "leave-fullscreen" => window.unmaximize(),
        "close" => window.close(),
        _ => return Err("Unknown window action".into()),
    }.map_err(|e| e.to_string())
}

#[tauri::command]
async fn desktop_pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("选择音乐文件夹").pick_folder().map(|p| p.to_string_lossy().into_owned()))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_open_link(url: &str) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "Invalid link")?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err("Only web links are allowed".into()); }
    open::that_detached(url).map_err(|e| e.to_string())
}

// Feedback opens a user-reviewed draft; it never sends mail or accepts another recipient.
#[tauri::command]
fn desktop_open_feedback(url: &str) -> Result<(), String> {
    if url.len() > 7500 { return Err("Feedback draft is too long".into()); }
    let parsed: tauri::Url = url.parse().map_err(|_| "Invalid feedback link")?;
    if parsed.scheme() != "mailto" || parsed.path() != "2228396737@qq.com"
        || parsed.host_str().is_some() || parsed.fragment().is_some() {
        return Err("Invalid feedback recipient".into());
    }
    let mut keys = std::collections::HashSet::new();
    for (key, value) in parsed.query_pairs() {
        if !matches!(key.as_ref(), "subject" | "body") || !keys.insert(key.to_string())
            || (key == "subject" && value.contains(['\r', '\n'])) {
            return Err("Invalid feedback fields".into());
        }
    }
    if keys.len() != 2 { return Err("Missing feedback fields".into()); }
    open::that_detached(url).map_err(|e| e.to_string())
}

fn start_service(app: &tauri::AppHandle) -> Result<(MusicService, tauri::Url), Box<dyn std::error::Error>> {
    let resource_root = app.path().resource_dir()?.join("runtime");
    let runtime: PathBuf = if resource_root.join("node.exe").is_file() { resource_root }
        else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop-runtime") };
    let data = std::env::var_os("RHINE_DESKTOP_DATA_DIR").map(PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir()?.join("music-data"));
    std::fs::create_dir_all(&data)?;
    let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("service.log"))?;
    let mut command = Command::new(runtime.join("node.exe"));
    command.arg("scripts/desktop-server.mjs").current_dir(&runtime)
        .env("MUSIC_DATA_DIR", &data).env_remove("MUSIC_ROOTS")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
    // Node and FFmpeg must never open console windows behind the player.
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing service output")?;
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(address) = line.strip_prefix("RHINE_READY ") { let _ = send.send(address.to_owned()); }
        }
    });
    let service = MusicService(Mutex::new(Some(child)));
    let address = receive.recv_timeout(Duration::from_secs(25)).map_err(|_| "音乐服务启动超时，请查看本地数据目录中的 service.log")?;
    let mut url: tauri::Url = address.parse()?;
    url.set_query(Some("desktop=1"));
    Ok((service, url))
}

fn main() {
    request_high_performance_gpu();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_window_state::Builder::default()
            // Ignore fullscreen saved by older previews and retain the integrated chrome.
            .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED)
            .build())
        .invoke_handler(tauri::generate_handler![desktop_window_action, desktop_window_state, desktop_pick_folder, desktop_open_link, desktop_open_feedback])
        .setup(|app| {
            let (service, url) = start_service(app.handle())?;
            app.manage(service);
            let origin = url.origin().ascii_serialization();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Rhine Music").inner_size(1280.0, 800.0).min_inner_size(800.0, 560.0)
                .decorations(false).resizable(true).fullscreen(false)
                .initialization_script("Object.defineProperty(window, '__RHINE_GPU_REQUEST__', { value: 'prefer-discrete-with-integrated-fallback' });")
                .background_color(tauri::window::Color(232, 229, 225, 255))
                .on_navigation(move |target| target.origin().ascii_serialization() == origin)
                .build()?;
            // OS visibility explicitly suspends only rendering. Audio remains independent.
            let view = window.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                    let hidden = view.is_minimized().unwrap_or(false);
                    let _ = view.eval(&format!("window.dispatchEvent(new CustomEvent('rhine-desktop-visibility',{{detail:{{hidden:{hidden}}}}}))"));
                    let fullscreen = view.is_fullscreen().unwrap_or(false);
                    let maximized = view.is_maximized().unwrap_or(false);
                    let _ = view.eval(&format!("window.dispatchEvent(new CustomEvent('rhine-desktop-window-state',{{detail:{{fullscreen:{fullscreen},maximized:{maximized}}}}}))"));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Rhine Music desktop initialization failed")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { app.state::<MusicService>().stop(); }
        });
}
