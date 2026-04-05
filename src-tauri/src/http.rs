use once_cell::sync::Lazy;

/// Shared HTTP client. reqwest::Client is cheap to clone — all clones share the
/// same connection pool and TLS session cache. Creating a new Client per request
/// throws away that pool, so we keep one static instance for the entire process.
pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);
