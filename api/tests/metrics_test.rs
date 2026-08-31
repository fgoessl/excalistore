use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use excalistore_api::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn metrics_endpoint_exposes_known_counters_at_zero() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();

    // pre-registered at 0 — true even though nothing has errored yet
    assert!(body.contains(r#"excalistore_errors_total{kind="not_found"} 0"#));
    assert!(body.contains(r#"excalistore_errors_total{kind="conflict"} 0"#));
    assert!(body.contains(r#"excalistore_errors_total{kind="database"} 0"#));
    // pre-registered at 0 too — true even though nothing has been created yet
    assert!(body.contains("excalistore_drawings_created_total 0"));
    assert!(body.contains("excalistore_drawings_updated_total 0"));
}

#[tokio::test]
async fn http_requests_total_counts_by_route_method_and_status() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    // A request to a route with a path parameter should be labeled by its
    // route *template* (`/api/drawings/:id`), not the concrete id in the
    // URI — otherwise every distinct id would create its own metric series.
    let unknown_id = uuid::Uuid::new_v4();
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/drawings/{unknown_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();

    let line = body
        .lines()
        .find(|line| {
            line.starts_with(
                r#"excalistore_http_requests_total{method="GET",route="/api/drawings/:id",status="404"}"#,
            )
        })
        .expect("route-templated request counter line must be present in /metrics output");

    let value: f64 = line
        .rsplit(' ')
        .next()
        .expect("counter line must have a value")
        .parse()
        .expect("counter value must be a number");
    assert!(value >= 1.0, "expected the request counter to have been incremented, got {value}");
}
