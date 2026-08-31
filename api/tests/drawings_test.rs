use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use excalistore_api::AppState;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn test_pool() -> sqlx::PgPool {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    sqlx::postgres::PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test")
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn create_drawing_returns_201_with_stored_drawing() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "My Drawing" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = body_json(response).await;
    assert_eq!(body["title"], "My Drawing");
    assert_eq!(body["version"], 1);
    assert!(body["owner_id"].is_null());
    assert!(body["id"].is_string());
}

#[tokio::test]
async fn create_drawing_defaults_scene_when_omitted() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "No scene given" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = body_json(response).await;
    assert_eq!(body["scene"]["elements"], json!([]));
}

#[tokio::test]
async fn list_drawings_includes_a_created_drawing() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    // Create one, so we know at least this drawing must show up in the list —
    // other tests share the same database, so we can't assert on the total
    // count, only that ours is present.
    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "title": "Listed Drawing" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let created = body_json(create_response).await;
    let created_id = created["id"].as_str().unwrap().to_string();

    let list_response = app
        .oneshot(
            Request::builder()
                .uri("/api/drawings")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(list_response.status(), StatusCode::OK);
    let body = body_json(list_response).await;
    let drawings = body.as_array().expect("response body must be a JSON array");

    let found = drawings
        .iter()
        .find(|drawing| drawing["id"] == created_id)
        .expect("created drawing must be present in the list response");
    assert_eq!(found["title"], "Listed Drawing");
}

#[tokio::test]
async fn get_drawing_returns_the_full_scene() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "Fetch Me" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(create).await;
    let id = created["id"].as_str().unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/drawings/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["title"], "Fetch Me");
    assert_eq!(body["scene"]["elements"], json!([]));
}

#[tokio::test]
async fn get_drawing_returns_404_for_unknown_id() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });
    let unknown_id = uuid::Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/drawings/{unknown_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_drawing_succeeds_with_matching_version() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "Editable" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(create).await;
    let id = created["id"].as_str().unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/drawings/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Edited",
                        "scene": { "elements": [{"id": "a"}], "appState": {}, "files": {} },
                        "version": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    assert_eq!(body["title"], "Edited");
    assert_eq!(body["version"], 2);
}

#[tokio::test]
async fn update_drawing_returns_409_on_stale_version() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "Stale" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(create).await;
    let id = created["id"].as_str().unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/drawings/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Edited",
                        "scene": { "elements": [], "appState": {}, "files": {} },
                        "version": 99
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn update_drawing_returns_404_for_unknown_id() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });
    let unknown_id = uuid::Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/drawings/{unknown_id}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Ghost",
                        "scene": { "elements": [], "appState": {}, "files": {} },
                        "version": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
