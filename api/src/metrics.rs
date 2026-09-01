use std::{sync::OnceLock, time::Instant};

use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::IntoResponse,
};
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

    metrics::describe_counter!(
        "excalistore_drawings_updated_total",
        "Count of drawings successfully updated (version matched)"
    );
    metrics::counter!("excalistore_drawings_updated_total").absolute(0);
    // The 409-conflict and 404-not-found cases aren't tracked by a
    // dedicated counter here — they already show up in
    // excalistore_errors_total{kind="conflict"|"not_found"} via AppError's
    // own IntoResponse impl, so a second counter for the same thing would
    // just be a duplicate label to keep in sync.

    metrics::describe_counter!(
        "excalistore_drawings_deleted_total",
        "Count of drawings successfully deleted"
    );
    metrics::counter!("excalistore_drawings_deleted_total").absolute(0);

    metrics::describe_counter!(
        "excalistore_http_requests_total",
        "Count of HTTP requests handled, labeled by method, route, and status code"
    );
    // Not pre-registered at 0 like the counters above: unlike error kinds
    // (a small fixed enum) or the drawings-created counter (a single
    // label-less series), the (method, route, status) combinations aren't
    // known ahead of time here without duplicating the route table — each
    // series just appears the first time that combination is actually hit.

    metrics::describe_histogram!(
        "excalistore_http_request_duration_seconds",
        metrics::Unit::Seconds,
        "Request handling duration, labeled by method, route, and status code"
    );
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

/// Middleware that counts every request handled and records how long it
/// took, both labeled by method, route, and response status.
///
/// Must be installed via `.route_layer(...)`, not `.layer(...)`. The two
/// look similar but differ in exactly the way this middleware needs:
/// `.layer(...)` wraps the whole `Router` from the *outside*, so it runs
/// before route matching happens — at that point axum hasn't looked up
/// which route the request matched yet, so `MatchedPath` isn't available,
/// and by the time it would be, the request has already been moved into
/// `next.run(...)` with no way to read it back. `.route_layer(...)` instead
/// wraps each already-registered route's handler, running *after* axum's
/// router has matched the request to a specific route — so `MatchedPath`
/// is already present in the request's extensions when this runs. It also
/// means requests that don't match any route at all skip this middleware
/// entirely (and so never appear in this counter), which is what we want:
/// there's no bounded set of "route" label values to worry about for
/// requests to routes that don't exist.
///
/// `MatchedPath` gives us the *route template* (e.g. `/api/drawings/:id`),
/// not the concrete request URI (e.g. `/api/drawings/<uuid>`) — using the
/// concrete URI as a label would mean a brand new metric series for every
/// distinct id ever requested, growing forever.
pub async fn track_metrics(req: Request, next: Next) -> impl IntoResponse {
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|matched_path| matched_path.as_str().to_owned())
        .unwrap_or_else(|| req.uri().path().to_owned());
    let method = req.method().to_string();

    let start = Instant::now();
    let response = next.run(req).await;
    let elapsed = start.elapsed();

    let status = response.status().as_u16().to_string();
    metrics::counter!(
        "excalistore_http_requests_total",
        "method" => method.clone(),
        "route" => route.clone(),
        "status" => status.clone(),
    )
    .increment(1);
    metrics::histogram!(
        "excalistore_http_request_duration_seconds",
        "method" => method,
        "route" => route,
        "status" => status,
    )
    .record(elapsed.as_secs_f64());

    response
}
