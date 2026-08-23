use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// Every `#[tauri::command]` function name in the source tree.
fn declared_commands() -> BTreeSet<String> {
    fn walk(dir: &Path, out: &mut BTreeSet<String>) {
        for entry in std::fs::read_dir(dir).expect("readable source dir") {
            let path = entry.expect("readable entry").path();
            if path.is_dir() {
                walk(&path, out);
                continue;
            }
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("readable source file");
            let mut lines = text.lines().peekable();
            while let Some(line) = lines.next() {
                if !line.trim_start().starts_with("#[tauri::command") {
                    continue;
                }
                // The attribute may be followed by more attributes.
                for next in lines.by_ref() {
                    let t = next.trim_start();
                    if t.starts_with('#') {
                        continue;
                    }
                    if let Some(rest) = t
                        .strip_prefix("pub async fn ")
                        .or_else(|| t.strip_prefix("pub fn "))
                    {
                        let name = rest.split(['(', '<']).next().unwrap_or("").trim();
                        if !name.is_empty() {
                            out.insert(name.to_string());
                        }
                    }
                    break;
                }
            }
        }
    }

    let mut out = BTreeSet::new();
    walk(&src_dir(), &mut out);
    out
}

/// Every command name registered in `run()`'s `generate_handler!`.
fn registered_commands() -> BTreeSet<String> {
    let text = std::fs::read_to_string(src_dir().join("lib.rs")).expect("lib.rs is readable");
    let start = text
        .find("generate_handler![")
        .expect("lib.rs registers commands");
    let body = &text[start..];
    let end = body.find("])").expect("the handler list is closed");

    body[..end]
        .lines()
        .skip(1)
        .filter_map(|line| {
            let t = line.trim().trim_end_matches(',');
            if t.is_empty() || t.starts_with('#') || t.starts_with("//") {
                return None;
            }
            t.rsplit("::").next().map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// A `#[tauri::command]` that nobody registered is invisible to every existing
/// test and fails at runtime as "command not found" the moment the UI calls it.
#[test]
fn every_declared_command_is_registered() {
    let declared = declared_commands();
    let registered = registered_commands();

    assert!(
        declared.len() > 90,
        "the parser found only {} commands — it is broken, not the code",
        declared.len()
    );

    let missing: Vec<&String> = declared.difference(&registered).collect();
    assert!(
        missing.is_empty(),
        "these #[tauri::command] functions are never registered in lib.rs: {missing:?}"
    );
}

/// The gate invokes a subset of the real command set — never a name production
/// does not register.
#[test]
fn gate_commands_are_a_subset_of_production() {
    let registered = registered_commands();

    let strays: Vec<&&str> = super::harness::GATE_COMMANDS
        .iter()
        .filter(|cmd| !registered.contains(**cmd))
        .collect();

    assert!(
        strays.is_empty(),
        "the gate invokes commands production does not register: {strays:?}"
    );
}
