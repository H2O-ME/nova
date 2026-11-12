//! Nova Desktop shell (W2 minimal): the window IS the existing WebUI.
//!
//! Contract, in order:
//! 1. Spawn `node packages/cli/dist/index.js --web` with an ISOLATED user home
//!    (temp dir) — the web surface claims without a TTY via the `--web` flag,
//!    and an empty `~/.nova` boots the unconfigured shell by design.
//! 2. Parse the launch URL (token included) from the runtime's stdout line
//!    `Nova WebUI：<url>` — the one discovery channel that needs no internal
//!    file formats.
//! 3. Navigate the webview there. The WS protocol, cookie pairing and port
//!    memory stay untouched: the shell owns window + process lifecycle only.
//! 4. On exit: kill the runtime child and delete the isolated home.
//!
//! `NOVA_REPO` is a development constant; making it configurable (or bundling
//! the runtime) is the W5 packaging concern, not this verification step.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, RunEvent, Url, WebviewWindow};

const NOVA_REPO: &str = "D:\\web\\agent";
const ISOLATED_HOME: &str = "nova-desktop-home";
const LAUNCH_MARK: &str = "Nova WebUI";

fn isolated_home() -> std::path::PathBuf {
    std::env::temp_dir().join(ISOLATED_HOME)
}

fn spawn_runtime() -> (Child, mpsc::Receiver<String>) {
    let home = isolated_home();
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).expect("create isolated home");

    let mut child = Command::new("node")
        .arg(format!("{}\\packages\\cli\\dist\\index.mjs", NOVA_REPO))
        .arg("--web")
        .env("USERPROFILE", &home)
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
                let _ = std::fs::remove_dir_all(isolated_home());
            }
        });
}
