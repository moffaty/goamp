---
name: code-reviewer
description: Review GOAMP code changes for safety, security, and quality
---

# Code Reviewer

Review the current changes (staged + unstaged) for the following concerns:

## Rust Backend (src-tauri/)
- No `.unwrap()` in production paths — use proper error handling (`?`, `map_err`, etc.)
- Tauri IPC command security — validate inputs, check permissions
- No blocking operations on the main thread — use `async`/`tokio`
- SQLite queries use parameterized statements (no SQL injection)
- Proper resource cleanup (file handles, HTTP connections)
- reqwest calls use timeouts

## TypeScript Frontend (src/)
- No memory leaks — clean up event listeners, audio contexts, intervals
- Webamp integration — proper lifecycle management
- No hardcoded API keys or tokens
- Tauri IPC calls handle errors gracefully
- Type safety — no `any` unless justified

## General
- No secrets or credentials in committed code
- No `console.log` left in production code (use structured logging)
- Changes are consistent with existing code style
- New dependencies are justified

## Output Format
List issues found with severity (critical/warning/info), file path, line number, and suggested fix.
If no issues found, confirm the code looks good.
