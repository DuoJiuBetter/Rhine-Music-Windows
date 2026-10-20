// Before the single-instance plugin's unbounded SendMessageW handshake, use
// the same locked 2.5.2 protocol with a deadline. An unresponsive old process
// must not leave every new click silently blocked before service startup.
#[cfg(windows)]
pub fn forward_existing() -> bool {
    use std::ffi::c_void;
    #[repr(C)]
    struct CopyData { tag: usize, bytes: u32, data: *const c_void }
    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, name: *const u16) -> isize;
        fn GetWindowThreadProcessId(window: isize, process: *mut u32) -> u32;
        fn AllowSetForegroundWindow(process: u32) -> i32;
        fn SendMessageTimeoutW(window: isize, message: u32, wparam: usize, lparam: isize, flags: u32, timeout: u32, result: *mut usize) -> isize;
        fn MessageBoxW(window: isize, text: *const u16, title: *const u16, flags: u32) -> i32;
    }
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).expect("embedded app config");
    let id = config["identifier"].as_str().expect("app identifier");
    let wide = |value: &str| value.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let class = wide(&format!("{id}-sic"));
    let name = wide(&format!("{id}-siw"));
    let window = unsafe { FindWindowW(class.as_ptr(), name.as_ptr()) };
    if window == 0 { return false; }
    let mut process = 0;
    unsafe { GetWindowThreadProcessId(window, &mut process); if process != 0 { AllowSetForegroundWindow(process); } }
    let payload = b"|activate\0";
    let data = CopyData { tag: 1542, bytes: payload.len() as u32, data: payload.as_ptr().cast() };
    let mut result = 0;
    // SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT; no infinite wait.
    let replied = unsafe { SendMessageTimeoutW(window, 0x004a, 0, &data as *const _ as isize, 0x0023, 1500, &mut result) };
    if replied != 0 && result == 1 { return true; }
    let text = wide("已有播放器仍在启动或没有响应（INSTANCE_HANDOFF_TIMEOUT）。请稍后重试；若旧窗口一直无响应，请退出旧版后再打开。此次启动已停止，不会继续等待。");
    let title = wide("Rhine Music 启动提示");
    unsafe { MessageBoxW(0, text.as_ptr(), title.as_ptr(), 0x0030); }
    true
}

#[cfg(not(windows))]
pub fn forward_existing() -> bool { false }
