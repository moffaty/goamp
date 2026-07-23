//! Native window z-order helpers not exposed by Tauri's cross-platform API.

/// Send the window to the BACK of the z-order — ONE-SHOT, no persistent flag.
///
/// Tauri's `setAlwaysOnBottom(true)` is a sticky mode: the window can never
/// come forward again, so it becomes un-clickable. This instead issues a single
/// `SetWindowPos(HWND_BOTTOM)` — the window drops behind the others once but
/// stays a normal, clickable, focusable window (clicking or Alt-Tab raises it).
#[cfg(windows)]
#[tauri::command]
#[allow(clippy::unnecessary_cast)]
pub fn window_send_to_back(window: tauri::WebviewWindow) -> Result<(), String> {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            hwnd_insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            uflags: u32,
        ) -> i32;
    }

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // HWND_BOTTOM = 1
    // SWP_NOSIZE (0x1) | SWP_NOMOVE (0x2) | SWP_NOACTIVATE (0x10) = 0x13
    let result = unsafe { SetWindowPos(hwnd.0 as *mut c_void, 1 as *mut c_void, 0, 0, 0, 0, 0x13) };
    if result == 0 {
        Err("SetWindowPos failed".into())
    } else {
        Ok(())
    }
}

/// Non-Windows: no portable one-shot "lower" exists. No-op (the user builds
/// and runs GOAMP on Windows; this keeps the command callable everywhere).
#[cfg(not(windows))]
#[tauri::command]
pub fn window_send_to_back(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Global mouse cursor position in physical screen pixels.
///
/// Polled by the frontend to drive click-through: it reports the cursor even
/// while the window ignores cursor events (so it can decide when to start
/// capturing again). Uses GetCursorPos — a trivial, always-reliable call,
/// unlike a global low-level hook.
#[cfg(windows)]
#[tauri::command]
pub fn cursor_position() -> Result<(i32, i32), String> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
    }

    let mut p = Point { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut p) };
    if ok == 0 {
        Err("GetCursorPos failed".into())
    } else {
        Ok((p.x, p.y))
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn cursor_position() -> Result<(i32, i32), String> {
    Err("cursor_position is Windows-only".into())
}
