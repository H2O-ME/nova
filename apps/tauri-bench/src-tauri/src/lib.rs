//! Nova Desktop shell: the window IS the locally built UI, fed by the runtime
//! over a line-delimited JSON frame protocol.
//!
//! Contract, in order:
//! 1. Spawn the runtime against the user's REAL `~/.nova/` — config, sessions
//!    and pairing persist across launches. The new-session workspace defaults
//!    to the user's home dir; adopting another workspace is the UI's own
//!    runtime ability (the kernel re-roots without a restart), so the shell
//!    never needs a directory picker and keeps no workspace preference.
//! 2. The kernel speaks one JSON frame per line over the child's stdio: every
//!    stdout line is a host→client frame, forwarded verbatim as a
//!    `nova-frame` event; `nova_send` writes a client→host frame (one line +
//!    newline) into the child's stdin. The shell never parses frame contents
//!    and has no HTTP relationship with the runtime — no launch token, no
//!    server-managed webview.
//! 3. The webview loads the built UI from local files (`frontendDist`), so it
//!    runs on a local origin. The window starts invisible and is shown once
//!    the first stdout frame proves the kernel is up, bounded by a short
//!    timer so a dead runtime still gets a visible window.
//! 4. On exit: drop the child's stdin handle — EOF is the shutdown signal
//!    (the runtime disposes jobs/PTYs and exits on its own), wait up to 3s,
//!    then fall back to a hard kill. Session logs are an append-only event
//!    stream, so even the fallback costs at most the turn in flight.
//!
//! Runtime root, highest priority first:
//! 1. Bundled: a `runtime/` dir next to the exe (tauri bundle resources) —
//!    ships `node.exe` + the deployed package tree, no Node install needed.
//! 2. An explicit `novaRoot` in the app config
//!    (`%APPDATA%/com.nova.desktop/nova-desktop.json`, `{"novaRoot": ...}`) —
//!    the dev override. It is accepted only when the runtime entry it points
//!    at actually exists, so a stray value can never widen what the shell
//!    executes: the program stays the literal `node`, resolved from PATH —
//!    where the runtime dir is prepended when it ships its own node.exe.
//! 3. The development constant below — the repo checkout.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent, State, WebviewWindow};

const DEV_NOVA_ROOT: &str = "D:\\web\\agent";

/// One host→client frame, forwarded verbatim to the webview as a
/// `nova-frame` event. The payload carries the raw line: the shell never
/// parses frame contents, the UI owns the schema.
#[derive(Clone, serde::Serialize)]
struct NovaFrame {
    line: String,
}

/// The runtime entry the dir must contain to count as a runtime root — the
/// bundled deploy has the cli package at the root, the repo checkout nests it
/// under `packages/cli`.
fn runtime_entry(root: &std::path::Path) -> std::path::PathBuf {
    let bundled = root.join("dist").join("index.mjs");
    if bundled.is_file() {
        bundled
    } else {
        root.join("packages").join("cli").join("dist").join("index.mjs")
    }
}

/// Runtime root: the bundled `runtime/` beside the exe wins, then the app
/// config override (only if it points at a real runtime entry), then the dev
/// constant.
fn runtime_root() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bundled) = exe.parent().map(|dir| dir.join("runtime")) {
            if runtime_entry(&bundled).is_file() {
                return bundled;
            }
        }
    }
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
        .filter(|root| !root.is_empty())
        .and_then(|root| {
            // Accept the override only when it actually contains a runtime —
            // the entry check is what keeps the spawn target bounded.
            let dir = std::path::PathBuf::from(&root);
            if runtime_entry(&dir).is_file() {
                Some(dir)
            } else {
                None
            }
        });
    override_root
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(DEV_NOVA_ROOT))
}

/// Put the bundled runtime dir first on PATH, so the literal `node` in
/// `spawn_runtime` resolves to the shipped node.exe (ABI matched to the
/// compiled node-pty). Dev roots without node.exe keep the system PATH.
fn prepare_node_on_path(root: &std::path::Path) {
    if root.join("node.exe").is_file() {
        if let Some(root_str) = root.to_str() {
            // Edition 2024 marks set_var unsafe (process-wide env race) —
            // single-threaded here, before the runtime thread starts.
            unsafe {
                std::env::set_var(
                    "PATH",
                    format!("{root_str};{}", std::env::var("PATH").unwrap_or_default()),
                );
            }
        }
    }
}

/// Spawn the runtime kernel. stdin and stdout are piped (they carry the
/// frame protocol); stderr is inherited so runtime logs and diagnostics stay
/// visible to the user. Returns the child plus its stdout: the caller keeps
/// the child for stdin/exit control and pumps stdout lines in a thread.
fn spawn_runtime() -> (Child, ChildStdout) {
    // New sessions default to the user's home; the UI re-roots at any
    // workspace it adopts, so the shell never needs a directory picker.
    let cwd = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    let root = runtime_root();
    prepare_node_on_path(&root);
    let entry = runtime_entry(&root);
    let mut child = Command::new("node")
        .arg(&entry)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn nova runtime");
    let stdout = child.stdout.take().expect("runtime stdout");
    (child, stdout)
}

/// Forward one client→host frame to the runtime: a single JSON line plus a
/// newline, flushed immediately (the UI's next state depends on it). Best
/// effort: once the stdin handle is dropped (exit path) or the child died,
/// the frame is discarded and the UI simply sees the runtime go silent.
#[tauri::command]
fn nova_send(frame: String, stdin: State<'_, Arc<Mutex<Option<ChildStdin>>>>) {
    if let Ok(mut slot) = stdin.lock() {
        if let Some(stdin) = slot.as_mut() {
            let _ = writeln!(stdin, "{frame}");
            let _ = stdin.flush();
        }
    }
}

/// Frames buffered until the webview's listener exists, and the flag saying
/// whether it does yet.
///
/// THE BUG THIS EXISTS FOR: the runtime writes `ready` (the transcript
/// baseline) the instant it attaches — long before a webview has loaded the
/// local UI and registered its `nova-frame` listener. Emitting into that gap
/// does not queue the event (Tauri drops it), so the window came up
/// permanently un-baselined: no transcript, no model, and a prompt typed into
/// it went nowhere until the operator reloaded. The bridge is therefore on the
/// SHELL's side of the channel, where the gap actually exists.
#[derive(Default)]
struct FrameBuffer {
    lines: Vec<String>,
    listening: bool,
}

/// Ceiling on that bridge. Far beyond the gap (`ready` plus a couple of list
/// answers) and still bounded, because a webview that never reports in must not
/// let the shell grow without limit.
const MAX_BUFFERED_FRAMES: usize = 8192;

/// The UI's "my listener is registered" call: hand back everything buffered so
/// far, and let the pump emit directly from here on.
#[tauri::command]
fn nova_ready(app: tauri::AppHandle, buffer: State<'_, Arc<Mutex<FrameBuffer>>>) {
    let pending = {
        let mut guard = match buffer.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        guard.listening = true;
        std::mem::take(&mut guard.lines)
    };
    for line in pending {
        let _ = app.emit("nova-frame", NovaFrame { line });
    }
}

/// Emit one frame — directly when the UI is listening, into the buffer when it
/// is not (see `FrameBuffer` for why that window exists).
fn deliver(app: &tauri::AppHandle, buffer: &Arc<Mutex<FrameBuffer>>, line: String) {
    let mut guard = match buffer.lock() {
        Ok(guard) => guard,
        // A poisoned lock means the buffer is unusable; emitting directly is
        // still better than dropping the frame silently.
        Err(_) => {
            let _ = app.emit("nova-frame", NovaFrame { line });
            return;
        }
    };
    if !guard.listening {
        if guard.lines.len() < MAX_BUFFERED_FRAMES {
            guard.lines.push(line);
        }
        return;
    }
    drop(guard);
    let _ = app.emit("nova-frame", NovaFrame { line });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (mut child, stdout) = spawn_runtime();
    // Take stdin NOW and keep it in shared state: `nova_send` writes frames
    // into it and the exit hook drops it for EOF, so it must live outside
    // `child.stdin` (which is behind the child lock both sides would fight
    // over).
    let stdin: Arc<Mutex<Option<ChildStdin>>> = Arc::new(Mutex::new(child.stdin.take()));
    let child = Arc::new(Mutex::new(child));
    // The startup bridge: frames are buffered here until the webview reports in
    // through `nova_ready` (see `FrameBuffer`).
    let frames: Arc<Mutex<FrameBuffer>> = Arc::new(Mutex::new(FrameBuffer::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::clone(&stdin))
        .manage(Arc::clone(&frames))
        .setup(move |app| {
            let window: WebviewWindow = app.get_webview_window("main").expect("main window");
            let handle = app.handle().clone();
            let frames = Arc::clone(&frames);
            let (ready_tx, ready_rx) = mpsc::channel::<()>();
            // Line pump: every stdout line is one host→client frame, forwarded
            // verbatim — the shell stays schema-agnostic and never parses one.
            thread::spawn(move || {
                let mut first = true;
                for line in BufReader::new(stdout).lines().flatten() {
                    deliver(&handle, &frames, line);
                    if first {
                        first = false;
                        // The kernel has spoken: tell the show timer below.
                        let _ = ready_tx.send(());
                    }
                }
            });
            thread::spawn(move || {
                // SHOW ON FIRST FRAME. The window is created invisible
                // (`visible: false` in tauri.conf.json) and the webview loads
                // the local UI immediately — showing it before the kernel has
                // spoken would flash a "not connected" shell. The first
                // stdout frame is the earliest observable signal that the
                // kernel is actually up, so show on it; a fixed 3s timer
                // bounds the wait so a wedged or dead runtime still gets a
                // visible window (an empty UI beats an invisible one).
                let _ = ready_rx.recv_timeout(Duration::from_secs(3));
                let _ = window.show();
                let _ = window.set_focus();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![nova_send, nova_ready])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let RunEvent::Exit = event {
                // Graceful first: dropping the stdin handle sends EOF, the
                // runtime's signal to dispose jobs/PTYs and exit on its own.
                // Wait up to 3s (same bound as before), then hard-kill;
                // session logs are an append-only event stream, so even the
                // fallback costs at most the turn in flight.
                if let Ok(mut slot) = stdin.lock() {
                    *slot = None;
                }
                if let Ok(mut c) = child.lock() {
                    for _ in 0..30 {
                        if matches!(c.try_wait(), Ok(Some(_))) {
                            return;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        });
}
