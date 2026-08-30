use std::sync::OnceLock;

use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use strum::IntoEnumIterator;

use crate::error::AppErrorKind;

static METRICS_HANDLE: OnceLock<PrometheusHandle> = OnceLock::new();

/// Returns the process-wide Prometheus handle, installing the recorder and
/// registering every known metric (at its zero value) the first time this
/// is called. Safe to call from many places/threads — `OnceLock` guarantees
/// the install/registration logic runs exactly once.
fn handle() -> &'static PrometheusHandle {
    METRICS_HANDLE.get_or_init(|| {
        let handle = PrometheusBuilder::new()
            .install_recorder()
            .expect("failed to install Prometheus metrics recorder");
        register_known_metrics();
        handle
    })
}

fn register_known_metrics() {
    metrics::describe_counter!(
        "excalistore_errors_total",
        "Count of AppError responses returned by the API, labeled by error kind"
    );

    // Pre-register every known label value at 0. Without this, a given
    // `kind` only appears in /metrics the first time it's incremented — so
    // scraping /metrics before, say, a 409 has ever happened would show
    // nothing at all for kind="conflict", even once that counter is wired
    // up to actually increment. Iterating AppErrorKind (rather than a
    // hardcoded string list) means a future AppError variant is picked up
    // here automatically.
    for kind in AppErrorKind::iter() {
        let label: &'static str = kind.into();
        metrics::counter!("excalistore_errors_total", "kind" => label).absolute(0);
    }

    metrics::describe_counter!(
        "excalistore_drawings_created_total",
        "Count of drawings successfully created"
    );
    metrics::counter!("excalistore_drawings_created_total").absolute(0);
}

/// Eagerly installs the recorder and registers every known metric. Must be
/// called before any request can possibly be handled — otherwise, any
/// `metrics::counter!()` call made before something first hits `/metrics`
/// would silently go to `metrics`'s default no-op recorder and be lost, since
/// nothing would have installed the real one yet. Called once from
/// `build_router()`, so this always runs before `axum::serve` can accept a
/// single request.
pub fn init() {
    handle();
}

/// Handler for `GET /metrics` — renders the current state of every
/// registered metric in Prometheus's plain-text exposition format.
pub async fn metrics_handler() -> String {
    handle().render()
}
