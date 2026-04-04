/// GOAMP node sidecar management.
///
/// Spawns `goamp-node --mode=client --api-port=7472` as a Tauri sidecar
/// and reads its stdout for the `ready:PORT` signal before considering it up.
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the spawned node process so Tauri can kill it on shutdown.
pub struct NodeProcess(Arc<Mutex<Option<CommandChild>>>);

impl NodeProcess {
    pub fn new() -> Self {
        NodeProcess(Arc::new(Mutex::new(None)))
    }

    pub fn set(&self, child: CommandChild) {
        *self.0.lock().unwrap() = Some(child);
    }

    pub fn kill(&self) {
        if let Some(child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

/// Spawn the goamp-node sidecar.
/// Reads stdout until it sees `ready:PORT`, then returns.
/// Call this from the Tauri setup hook.
pub fn start_node(app: &AppHandle) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("goamp-node")
        .map_err(|e| format!("sidecar not found: {e}"))?
        .args(["--mode=client", "--api-port=7472"]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("spawn goamp-node: {e}"))?;

    // Store the process handle so we can kill it on shutdown
    app.state::<NodeProcess>().set(child);

    // Spawn a task to forward node stdout/stderr to Tauri logs
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[goamp-node] {text}");
                    // Emit to frontend so TypeScript knows the node is ready
                    if text.starts_with("ready:") {
                        let _ = app_handle.emit("goamp-node:ready", text.trim().to_string());
                    }
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[goamp-node stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(e) => {
                    eprintln!("[goamp-node error] {e}");
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[goamp-node] terminated with {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}
