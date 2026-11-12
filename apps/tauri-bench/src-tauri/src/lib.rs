//! Nova Desktop shell (W2.1): the window IS the existing WebUI, on the real home.
//!
//! Contract, in order:
//! 1. Spawn `node packages/cli/dist/index.mjs --web` against the user's REAL
//!    `~/.nova/` — config, sessions and pairing persist across launches. The
//!    new-session workspace defaults to the user's home dir; adopting another
//!    workspace is the WebUI's own runtime ability (DirectoryBrowser re-roots
//!    the kernel without a restart), so the shell has no directory picker and
//!    keeps no workspace preference.
//! 2. Parse the launch URL (token included) from the runtime's stdout line
//!    `Nova WebUI：<url>` — the one discovery channel that needs no internal
//!    file formats. Port memory stays: a busy remembered port falls back to an
//!    ephemeral bind, so the shell instance coexists with a browser instance.
//! 3. Navigate the webview there. The WS protocol and cookie pairing stay
//!    untouched: the shell owns window + process lifecycle only.
//! 4. On exit: kill the runtime child. Session logs are an append-only event
//!    stream (durable per event), so a hard kill costs at most the turn in
//!    flight — a graceful-stop channel is a runtime-side concern, tracked.
//!
//! Runtime root: an explicit `novaRoot` in the app config
//! (`%APPDATA%/com.nova.desktop/nova-desktop.json`, `{"novaRoot": ...}`)
//! wins; the development constant below is the fallback. Bundling the runtime
//! beside the exe (no config needed) stays the W5 packaging step.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent, Url, WebviewWindow};

const DEV_NOVA_ROOT: &str = "D:\\web\\agent";
const LAUNCH_MARK: &str = "Nova WebUI";

/// Runtime root: an explicit `novaRoot` in the app config wins, the dev
/// constant is the fallback.
fn runtime_root() -> std::path::PathBuf {
    let override_root = std::env::var("APPDATA").ok()
        .map(|base| {
            std::path::PathBuf::from(base)
                .join("com.nova.desktop")
                .join("nova-desktop.json")
        })
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| {
            // Windows tooling (PS 5.1, older Notepad) writes UTF-8 with BOM;
            // serde_json refuses a leading BOM, so strip it before parsing.
            let text = text.trim_start_matches('\u{feff}');
            serde_json::from_str::<serde_json::Value>(text).ok()
        })
        .and_then(|value| {
            value
                .get("novaRoot")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .filter(|root| !root.is_empty());
    override_root
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(DEV_NOVA_ROOT))
}

fn spawn_runtime() -> (Child, mpsc::Receiver<String>) {
    // New sessions default to the user's home; the WebUI re-roots at any
    // workspace it adopts, so the shell never needs a directory picker.
    let cwd = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    let entry = runtime_root()
        .join("packages")
        .join("cli")
        .join("dist")
        .join("index.mjs");
    let mut child = Command::new("node")
        .arg(&entry)
        .arg("--web")
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn nova runtime");

    let stdout = child.stdout.take().expect("runtime stdout");
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            // The marker's colon is full-width (the runtime logs in Chinese);
            // find the marker and strip whatever separator follows it.
            if let Some(idx) = line.find(LAUNCH_MARK) {
                let url = line[idx + LAUNCH_MARK.len()..]
                    .trim_start_matches(['：', ':', ' '])
                    .trim()
                    .to_string();
                if !url.is_empty() {
                    let _ = tx.send(url);
                    break;
                }
            }
        }
    });
    (child, rx)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (child, rx) = spawn_runtime();
    let child = Arc::new(Mutex::new(child));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let window: WebviewWindow = app.get_webview_window("main").expect("main window");
            thread::spawn(move || {
                let url = match rx.recv_timeout(Duration::from_secs(60)) {
                    Ok(url) => url,
                    Err(_) => {
                        "data:text/html,<body style='font-family:sans-serif;background:#16171a;color:#e8e8ea'><h3>Nova runtime 未在 60 秒内就绪</h3></body>".to_string()
                    }
                };
                match url.parse::<Url>() {
                    Ok(parsed) => {
                        let _ = window.navigate(parsed);
                    }
                    Err(err) => eprintln!("nova: launch URL 解析失败: {url} ({err})"),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut c) = child.lock() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        });
}
