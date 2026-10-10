fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") &&
        std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/EXPORT:NvOptimusEnablement,DATA");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_window_state", "desktop_window_action", "desktop_pick_folder", "desktop_open_link", "desktop_open_feedback",
        ]),
    )).expect("desktop permission manifest");
}
