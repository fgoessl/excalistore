# ExcaliStore v0.1 — Persistence MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, self-hosted ExcaliStore v0.1 — a Rust/Axum + PostgreSQL backend and a thin React/TypeScript frontend embedding `@excalidraw/excalidraw`, with no authentication, that lets a single user create, list, open, autosave, and delete Excalidraw drawings, runnable end-to-end via `docker compose up` (Postgres only) plus `cargo run` / `npm run dev`, and packagable as one production Docker image.

**Architecture:** A single Postgres table (`drawings`, JSONB `scene` column) is the only persistence. Axum exposes `GET/POST /api/drawings` and `GET/PUT/DELETE /api/drawings/:id`; updates use optimistic versioning (`WHERE version = $n`, 409 on mismatch) from day one. The React app is a thin shell around the `Excalidraw` component: routing, a drawing list, and a debounced autosave loop calling `PUT`. In production, the Rust binary serves the compiled frontend's static files in addition to `/api/*` — one container, one Deployment.

**Tech Stack:** Rust, Axum 0.7, SQLx 0.7 (Postgres, JSONB, compile-time `query_as!` macros), tokio, tower-http; React 18, TypeScript, Vite, `@excalidraw/excalidraw`, react-router-dom, Vitest + React Testing Library; PostgreSQL 16; Docker (multi-stage build); Docker Compose (Mode A, Postgres only).

**Spec:** [docs/PROJECT_PLAN.md](../../PROJECT_PLAN.md) — this plan implements §1–§7, §10 (Mode A), §12, and the v0.1 checklist in §16/§20. Auth (§8, §9, §11) and Kubernetes/Helm (§13) are out of scope for this plan (v0.3 and v0.2 respectively).

## Global Constraints

- No auth in v0.1: no `AuthContext`, no auth middleware, `owner_id` stays `NULL` on every row (spec §16 v0.1, §10 Mode A).
- Optimistic versioning is built in from the first `PUT` handler, not added later: `UPDATE ... WHERE id = $n AND version = $m`; 0 rows affected + row exists → `409 Conflict`; 0 rows affected + row absent → `404 Not Found` (spec §5).
- The backend treats the Excalidraw scene as opaque JSON stored in a `JSONB` column — no relational modeling of `elements`/`appState`/`files` (spec §4, §5).
- Use SQLx (compile-time-checked `query_as!`/`query!` macros against a live dev Postgres), not an ORM; migrations are plain paired `.up.sql`/`.down.sql` files under `api/migrations/` (spec §6, §7).
- Frontend stays thin: routing, list UI, API calls, autosave state only — no drawing logic reimplemented (spec §3).
- The server generates the drawing UUID on `POST /api/drawings`; the client redirects to `/drawings/:id` after creation, never generates the id itself (spec §3 Routing).
- Autosave debounces ~1–2 seconds after `onChange` before calling `PUT /api/drawings/:id`; UI must be able to show exactly these three states: `✓ Saved`, `⟳ Saving…`, `⚠ Save failed — retry` (spec §3 Autosave).
- `compose.yaml` for v0.1 contains Postgres only (Mode A) — no Keycloak, no oauth2-proxy (spec §10).
- Exactly one production Docker image: the Rust binary serves both the compiled React static files and `/api/*`; Postgres is never bundled into that image (spec §12).
- v0.1 endpoints are exactly: `GET /api/drawings`, `POST /api/drawings`, `GET /api/drawings/:id`, `PUT /api/drawings/:id`, `DELETE /api/drawings/:id` (spec §4).
- **Learning exception to "no placeholders":** in Tasks 4–8, the body of each handler in `drawings.rs` (the SQLx query + the Axum extractor logic) is intentionally left as a stub — full signature, explanatory comments describing the SQL/logic, ending in `todo!()` — instead of finished code, because the person executing this plan is writing that code by hand to learn SQLx and Axum. Every other file in the plan (migrations, `error.rs`, `lib.rs` routing/state wiring, all frontend code, all tests) is fully implemented as normal.

---

## File Structure

```
api/
├── Cargo.toml
├── migrations/
│   ├── 001_create_drawings.up.sql
│   └── 001_create_drawings.down.sql
├── src/
│   ├── lib.rs        — AppState, build_router() (grows across Tasks 1, 3, 4, 15)
│   ├── main.rs        — binary entrypoint: env, pool, migrate, serve
│   ├── error.rs        — AppError + IntoResponse mapping
│   └── drawings.rs      — Drawing/DrawingSummary models + CRUD handlers
└── tests/
    ├── health_test.rs
    └── drawings_test.rs

frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.setup.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── types.ts
    ├── api/
    │   ├── api.ts
    │   └── api.test.ts
    ├── hooks/
    │   ├── useAutosave.ts
    │   └── useAutosave.test.ts
    ├── components/
    │   ├── DrawingList.tsx
    │   ├── DrawingList.test.tsx
    │   ├── SaveStatus.tsx
    │   └── SaveStatus.test.tsx
    └── pages/
        ├── DrawingsPage.tsx
        ├── NewDrawingPage.tsx
        └── EditorPage.tsx

compose.yaml
.env.example
Dockerfile
README.md
```

**Responsibilities:**
- `lib.rs` owns `AppState` and `build_router` — the one place that assembles routes, so tests and `main.rs` both go through it (no route logic duplicated).
- `error.rs` is the single `IntoResponse` mapping point — handlers never format HTTP status/JSON error bodies themselves.
- `drawings.rs` owns the DB row shape and all five CRUD handlers — one file because they share the same two structs and are inseparable from the optimistic-versioning contract.
- `api/api.ts` is the only file that calls `fetch` — pages/components never call `fetch` directly, so the API contract has one owner.
- `useAutosave.ts` is generic over the saved value type — it knows nothing about drawings, only "debounce, call this async function, report status".

---

### Task 1: Backend skeleton — Axum app with a health check

**Files:**
- Create: `api/Cargo.toml`
- Create: `api/src/lib.rs`
- Create: `api/src/main.rs`
- Test: `api/tests/health_test.rs`

**Interfaces:**
- Produces: `excalistore_api::build_router() -> axum::Router` (no state yet — state is added in Task 3).

- [ ] **Step 1: Create the crate manifest**

`api/Cargo.toml`:
```toml
[package]
name = "excalistore-api"
version = "0.1.0"
edition = "2021"

[lib]
name = "excalistore_api"
path = "src/lib.rs"

[[bin]]
name = "excalistore-api"
path = "src/main.rs"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono", "macros", "migrate", "json"] }
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
tower = { version = "0.4", features = ["util"] }
tower-http = { version = "0.5", features = ["trace", "fs"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

- [ ] **Step 2: Write the failing test**

`api/tests/health_test.rs`:
```rust
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_200_ok() {
    let app = excalistore_api::build_router();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && cargo test --test health_test`
Expected: compile error — `build_router` does not exist (`lib.rs` is empty/missing).

- [ ] **Step 4: Write the minimal implementation**

`api/src/lib.rs`:
```rust
use axum::{routing::get, Router};

pub fn build_router() -> Router {
    Router::new().route("/health", get(health))
}

async fn health() -> &'static str {
    "ok"
}
```

`api/src/main.rs`:
```rust
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = excalistore_api::build_router();

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && cargo test --test health_test`
Expected: `test health_returns_200_ok ... ok`

- [ ] **Step 6: Commit**

```bash
git add api/Cargo.toml api/src/lib.rs api/src/main.rs api/tests/health_test.rs
git commit -m "feat(api): Axum skeleton with health check"
```

---

### Task 2: `drawings` table migration

**Files:**
- Create: `api/migrations/001_create_drawings.up.sql`
- Create: `api/migrations/001_create_drawings.down.sql`

**Interfaces:**
- Produces: Postgres table `drawings(id UUID PK, title TEXT, scene JSONB, owner_id TEXT NULL, version BIGINT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)` — every later task's SQL is written against exactly these column names and types.

- [ ] **Step 1: Start Postgres for local development**

This step needs `compose.yaml` from Task 9. If Task 9 hasn't run yet, start Postgres directly instead:

```bash
docker run -d --name excalistore-postgres \
  -e POSTGRES_USER=excalistore \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=excalistore \
  -p 5432:5432 \
  postgres:16
export DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore
```

- [ ] **Step 2: Install sqlx-cli**

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

- [ ] **Step 3: Write the up migration**

`api/migrations/001_create_drawings.up.sql`:
```sql
CREATE TABLE drawings (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    scene JSONB NOT NULL,
    owner_id TEXT,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Write the down migration**

`api/migrations/001_create_drawings.down.sql`:
```sql
DROP TABLE drawings;
```

- [ ] **Step 5: Apply the migration and verify**

```bash
cd api && sqlx migrate run
```
Expected: `Applied 1/migrate create drawings`. Verify the table exists:
```bash
psql "$DATABASE_URL" -c "\d drawings"
```
Expected: a table listing with columns `id, title, scene, owner_id, version, created_at, updated_at`.

- [ ] **Step 6: Verify the down migration is valid**

```bash
sqlx migrate revert && sqlx migrate run
```
Expected: `Reverted 1/migrate create drawings` then `Applied 1/migrate create drawings` again, no errors.

- [ ] **Step 7: Commit**

```bash
git add api/migrations/001_create_drawings.up.sql api/migrations/001_create_drawings.down.sql
git commit -m "feat(api): add drawings table migration"
```

---

### Task 3: `AppState`, Postgres pool wiring, and `error.rs`

**Files:**
- Create: `api/src/error.rs`
- Modify: `api/src/lib.rs`
- Modify: `api/src/main.rs`
- Modify: `api/tests/health_test.rs`

**Interfaces:**
- Consumes: `drawings` table from Task 2 (via `DATABASE_URL`).
- Produces: `excalistore_api::AppState { pool: sqlx::PgPool }`, `excalistore_api::build_router(state: AppState) -> Router`, `excalistore_api::error::AppError` with variants `NotFound`, `Conflict`, `Database(sqlx::Error)` and `From<sqlx::Error> for AppError` (`sqlx::Error::RowNotFound` → `NotFound`, everything else → `Database`).

- [ ] **Step 1: Write the failing unit tests for error mapping**

`api/src/error.rs`:
```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    NotFound,
    Conflict,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound,
            other => AppError::Database(other),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "drawing not found".to_string()),
            AppError::Conflict => (
                StatusCode::CONFLICT,
                "drawing was modified since it was loaded".to_string(),
            ),
            AppError::Database(err) => {
                tracing::error!(%err, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_maps_to_404() {
        let response = AppError::NotFound.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn conflict_maps_to_409() {
        let response = AppError::Conflict.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn database_error_maps_to_500() {
        let response = AppError::Database(sqlx::Error::RowNotFound).into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn row_not_found_converts_to_not_found_variant() {
        let err: AppError = sqlx::Error::RowNotFound.into();
        assert!(matches!(err, AppError::NotFound));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && cargo test --lib`
Expected: compile error — `error` module not wired into `lib.rs` yet.

- [ ] **Step 3: Wire `AppState` and the error module into `lib.rs`**

`api/src/lib.rs`:
```rust
pub mod error;

use axum::{routing::get, Router};

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
```

- [ ] **Step 4: Update `main.rs` to build a real pool and pass `AppState`**

`api/src/main.rs`:
```rust
use excalistore_api::{build_router, AppState};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("failed to run migrations");

    let app = build_router(AppState { pool });

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 5: Update `health_test.rs` for the new `build_router` signature**

`api/tests/health_test.rs` — replace the body construction:
```rust
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use excalistore_api::AppState;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_200_ok() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test`
Expected: all tests pass, including the 4 new unit tests in `error.rs` and `health_returns_200_ok`.

- [ ] **Step 7: Commit**

```bash
git add api/src/error.rs api/src/lib.rs api/src/main.rs api/tests/health_test.rs
git commit -m "feat(api): AppState, Postgres pool wiring, AppError"
```

---

### Task 4: `POST /api/drawings` — create a drawing

**Files:**
- Create: `api/src/drawings.rs`
- Modify: `api/src/lib.rs`
- Create: `api/tests/drawings_test.rs`

**Interfaces:**
- Consumes: `AppState` (Task 3), `AppError` (Task 3), `drawings` table (Task 2).
- Produces: `pub struct Drawing { id: Uuid, title: String, scene: serde_json::Value, owner_id: Option<String>, version: i64, created_at: DateTime<Utc>, updated_at: DateTime<Utc> }` (all `pub`, `Serialize`, `sqlx::FromRow`), `pub struct CreateDrawing { title: String, scene: serde_json::Value }` (`Deserialize`, `scene` defaults to `{"elements": [], "appState": {}, "files": {}}` when omitted), `pub async fn create_drawing(State(AppState), Json(CreateDrawing)) -> Result<(StatusCode, Json<Drawing>), AppError>`.

- [ ] **Step 1: Write the failing integration test**

`api/tests/drawings_test.rs`:
```rust
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test`
Expected: compile error — `/api/drawings` route and `drawings` module do not exist.

- [ ] **Step 3: Write the struct definitions (given), then implement `create_drawing` yourself**

`api/src/drawings.rs` — the models and imports are given in full; write the body of `create_drawing` yourself using the comments as a spec:
```rust
use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, AppState};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Drawing {
    pub id: Uuid,
    pub title: String,
    pub scene: serde_json::Value,
    pub owner_id: Option<String>,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDrawing {
    pub title: String,
    #[serde(default = "default_scene")]
    pub scene: serde_json::Value,
}

fn default_scene() -> serde_json::Value {
    serde_json::json!({ "elements": [], "appState": {}, "files": {} })
}

pub async fn create_drawing(
    State(state): State<AppState>,
    Json(body): Json<CreateDrawing>,
) -> Result<(StatusCode, Json<Drawing>), AppError> {
    // 1. Generate a fresh row id with `Uuid::new_v4()` — the server always
    //    mints the id (spec §3 Routing); the client never sends one.
    // 2. INSERT a new row into `drawings` using columns (id, title, scene) —
    //    `owner_id` is left NULL (no auth in v0.1), `version` and the
    //    timestamps take their table defaults (see the migration in Task 2).
    // 3. RETURNING all 7 columns so you can build the `Drawing` to respond
    //    with, without a second SELECT.
    // 4. Look up `sqlx::query_as!` — it binds `Drawing` as the row type and
    //    lets you interpolate the SQL as a raw string with `$1`/`$2`/`$3`
    //    placeholders, followed by the bound values as extra macro args.
    //    `.fetch_one(&state.pool).await?` runs it (the `?` relies on
    //    `From<sqlx::Error> for AppError` from Task 3).
    // 5. Respond with `(StatusCode::CREATED, Json(drawing))`.
    todo!("insert `body` as a new drawing and return 201 Created with the inserted row")
}
```

- [ ] **Step 4: Wire the route into `lib.rs`**

`api/src/lib.rs`:
```rust
pub mod drawings;
pub mod error;

use axum::{routing::get, Router};

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/drawings", get_placeholder_list().post(drawings::create_drawing))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
```

`get_placeholder_list()` does not exist — Task 5 replaces it with the real list handler. Use a temporary stub so the router compiles for this task only:
```rust
fn get_placeholder_list() -> axum::routing::MethodRouter<AppState> {
    axum::routing::get(|| async { axum::http::StatusCode::NOT_IMPLEMENTED })
}
```
Add that function to `lib.rs` below `build_router`.

- [ ] **Step 5: Implement `create_drawing`, then run the test to verify it passes**

Replace the `todo!()` with your own implementation, then run:
Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test`
Expected: both tests pass. If they don't, re-read the comments in Step 3 — the column list and `RETURNING` clause matter for `query_as!` to type-check against the `Drawing` struct.

- [ ] **Step 6: Commit**

```bash
git add api/src/drawings.rs api/src/lib.rs api/tests/drawings_test.rs
git commit -m "feat(api): POST /api/drawings"
```

---

### Task 5: `GET /api/drawings` — list drawings

**Files:**
- Modify: `api/src/drawings.rs`
- Modify: `api/src/lib.rs`
- Modify: `api/tests/drawings_test.rs`

**Interfaces:**
- Consumes: `Drawing`, `AppState`, `AppError` (Task 4/3).
- Produces: `pub struct DrawingSummary { id: Uuid, title: String, version: i64, created_at: DateTime<Utc>, updated_at: DateTime<Utc> }` (`Serialize`, `sqlx::FromRow`), `pub async fn list_drawings(State(AppState)) -> Result<Json<Vec<DrawingSummary>>, AppError>`, ordered `updated_at DESC`.

- [ ] **Step 1: Write the failing test**

Append to `api/tests/drawings_test.rs`:
```rust
#[tokio::test]
async fn list_drawings_returns_created_drawings() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "Listed Drawing" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create.status(), StatusCode::CREATED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/drawings")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response).await;
    let titles: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["title"].as_str().unwrap())
        .collect();
    assert!(titles.contains(&"Listed Drawing"));
    // list responses must not include the full scene payload
    assert!(body[0].get("scene").is_none());
}
```

Note: `excalistore_api::build_router` currently takes `AppState` by value and `Router` isn't `Clone`-friendly across two `oneshot` calls unless the router is cloned before the first `oneshot` — `Router` implements `Clone`, so `app.clone().oneshot(...)` followed by `app.oneshot(...)` is valid.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test list_drawings`
Expected: FAIL — the stub route returns `501 Not Implemented`.

- [ ] **Step 3: Implement `list_drawings` yourself**

The `DrawingSummary` struct is given (it's the row shape, not logic) — add it and the handler signature to `api/src/drawings.rs`, then write the body:
```rust
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DrawingSummary {
    pub id: Uuid,
    pub title: String,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_drawings(
    State(state): State<AppState>,
) -> Result<Json<Vec<DrawingSummary>>, AppError> {
    // SELECT the 5 DrawingSummary columns (id, title, version, created_at,
    // updated_at) from `drawings` — deliberately NOT `scene`, per the test's
    // assertion that list responses omit the full scene payload.
    // Order by `updated_at DESC` so recently-edited drawings sort first.
    // Use `sqlx::query_as!(DrawingSummary, "...")` with no bind parameters,
    // then `.fetch_all(&state.pool).await?` — this returns a `Vec<DrawingSummary>`
    // directly (contrast with `fetch_one`/`fetch_optional` in the other handlers).
    todo!("select all drawings ordered by updated_at DESC, without the scene column")
}
```

- [ ] **Step 4: Replace the stub route in `lib.rs`**

`api/src/lib.rs` — remove `get_placeholder_list` and its use entirely, replacing the `/api/drawings` route:
```rust
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(
            "/api/drawings",
            get(drawings::list_drawings).post(drawings::create_drawing),
        )
        .with_state(state)
}
```

- [ ] **Step 5: Implement `list_drawings`, then run the tests to verify they pass**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/drawings.rs api/src/lib.rs api/tests/drawings_test.rs
git commit -m "feat(api): GET /api/drawings"
```

---

### Task 6: `GET /api/drawings/:id` — fetch one drawing

**Files:**
- Modify: `api/src/drawings.rs`
- Modify: `api/src/lib.rs`
- Modify: `api/tests/drawings_test.rs`

**Interfaces:**
- Consumes: `Drawing`, `AppState`, `AppError`.
- Produces: `pub async fn get_drawing(State(AppState), Path(Uuid)) -> Result<Json<Drawing>, AppError>` — `AppError::NotFound` (404) when no row matches.

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/drawings_test.rs`:
```rust
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
```
Add `uuid = { version = "1", features = ["v4"] }` is already available transitively via the `api` crate but the test binary needs its own `uuid` — it's already a normal dependency in `Cargo.toml` from Task 1, so `uuid::Uuid::new_v4()` is usable directly in the test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test get_drawing`
Expected: compile error — no route matches `/api/drawings/:id` yet (404 from Axum's default "no route" handler is a different code path than `get_drawing`; the first test fails to compile/run meaningfully until the route exists).

- [ ] **Step 3: Implement `get_drawing` yourself**

Add `Path` to the `axum::extract` import in `api/src/drawings.rs`:
```rust
use axum::extract::{Path, State};
```
Then write the handler body:
```rust
pub async fn get_drawing(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Drawing>, AppError> {
    // SELECT all 7 Drawing columns (this endpoint returns the full scene,
    // unlike the list endpoint) WHERE id = the path parameter.
    // Use `.fetch_optional(&state.pool).await?` — it returns
    // `Option<Drawing>` instead of erroring when no row matches, which lets
    // you turn "no row" into `AppError::NotFound` yourself rather than
    // relying on sqlx::Error::RowNotFound (that conversion exists too, but
    // `fetch_optional` + `.ok_or(AppError::NotFound)?` is the idiom used by
    // `update_drawing`'s existence check later, so it's worth practicing
    // here first).
    todo!("look up the drawing by id; 404 (AppError::NotFound) if it doesn't exist")
}
```

- [ ] **Step 4: Add the `/api/drawings/:id` route in `lib.rs`**

```rust
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(
            "/api/drawings",
            get(drawings::list_drawings).post(drawings::create_drawing),
        )
        .route("/api/drawings/:id", get(drawings::get_drawing))
        .with_state(state)
}
```

- [ ] **Step 5: Implement `get_drawing`, then run the tests to verify they pass**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/drawings.rs api/src/lib.rs api/tests/drawings_test.rs
git commit -m "feat(api): GET /api/drawings/:id"
```

---

### Task 7: `PUT /api/drawings/:id` — optimistic-versioned update

**Files:**
- Modify: `api/src/drawings.rs`
- Modify: `api/src/lib.rs`
- Modify: `api/tests/drawings_test.rs`

**Interfaces:**
- Consumes: `Drawing`, `AppState`, `AppError`.
- Produces: `pub struct UpdateDrawing { title: String, scene: serde_json::Value, version: i64 }` (`Deserialize`), `pub async fn update_drawing(State(AppState), Path(Uuid), Json(UpdateDrawing)) -> Result<Json<Drawing>, AppError>` — returns updated row with `version + 1` on match; `AppError::Conflict` (409) if the row exists but `version` doesn't match; `AppError::NotFound` (404) if the row doesn't exist at all.

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/drawings_test.rs`:
```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test update_drawing`
Expected: FAIL — no `PUT` route exists yet.

- [ ] **Step 3: Implement `update_drawing` yourself**

The `UpdateDrawing` input struct is given — add it and the handler signature to `api/src/drawings.rs`, then write the body. This is the one with real logic (spec §5 optimistic versioning), so read the hint carefully before coding:
```rust
#[derive(Debug, Deserialize)]
pub struct UpdateDrawing {
    pub title: String,
    pub scene: serde_json::Value,
    pub version: i64,
}

pub async fn update_drawing(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDrawing>,
) -> Result<Json<Drawing>, AppError> {
    // The core of optimistic versioning (spec §5):
    //
    //   UPDATE drawings
    //   SET title = $1, scene = $2, version = version + 1, updated_at = now()
    //   WHERE id = $3 AND version = $4
    //   RETURNING id, title, scene, owner_id, version, created_at, updated_at
    //
    // bound to (body.title, body.scene, id, body.version), via
    // `sqlx::query_as!(Drawing, "...", ...).fetch_optional(&state.pool).await?`.
    //
    // `fetch_optional` returns `None` in TWO different situations that this
    // single query can't tell apart on its own:
    //   (a) no row has that `id` at all              -> should be 404
    //   (b) a row has that `id` but a DIFFERENT       -> should be 409
    //       `version` (someone else saved since the
    //       client loaded it)
    //
    // So: if the UPDATE returns `Some(drawing)`, respond `Json(drawing)`.
    // If it returns `None`, run a second, separate query — just
    // `SELECT EXISTS(SELECT 1 FROM drawings WHERE id = $1)` — to tell (a)
    // from (b), and return `AppError::NotFound` or `AppError::Conflict`
    // accordingly. (`sqlx::query_scalar!` is the macro for a single-column,
    // single-row query like this `EXISTS` check.)
    todo!("optimistic-versioned update: 200 on version match, 409 on stale version, 404 if the row doesn't exist")
}
```

- [ ] **Step 4: Add the `PUT` method to the `/api/drawings/:id` route in `lib.rs`**

```rust
.route(
    "/api/drawings/:id",
    get(drawings::get_drawing).put(drawings::update_drawing),
)
```

- [ ] **Step 5: Implement `update_drawing`, then run the tests to verify they pass**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test`
Expected: all tests pass — including the 409-on-stale-version and 404-on-unknown-id cases, which is the part most worth double-checking by hand.

- [ ] **Step 6: Commit**

```bash
git add api/src/drawings.rs api/src/lib.rs api/tests/drawings_test.rs
git commit -m "feat(api): PUT /api/drawings/:id with optimistic versioning"
```

---

### Task 8: `DELETE /api/drawings/:id`

**Files:**
- Modify: `api/src/drawings.rs`
- Modify: `api/src/lib.rs`
- Modify: `api/tests/drawings_test.rs`

**Interfaces:**
- Consumes: `AppState`, `AppError`.
- Produces: `pub async fn delete_drawing(State(AppState), Path(Uuid)) -> Result<StatusCode, AppError>` — `204 No Content` on success, `404 Not Found` if the row doesn't exist.

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/drawings_test.rs`:
```rust
#[tokio::test]
async fn delete_drawing_removes_it_and_get_then_404s() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/drawings")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "title": "Doomed" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let created = body_json(create).await;
    let id = created["id"].as_str().unwrap();

    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/drawings/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

    let get_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/drawings/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_drawing_returns_404_for_unknown_id() {
    let pool = test_pool().await;
    let app = excalistore_api::build_router(AppState { pool });
    let unknown_id = uuid::Uuid::new_v4();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/drawings/{unknown_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test drawings_test delete_drawing`
Expected: FAIL — no `DELETE` route exists yet.

- [ ] **Step 3: Implement `delete_drawing` yourself**

Add to `api/src/drawings.rs`:
```rust
pub async fn delete_drawing(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // DELETE FROM drawings WHERE id = $1, bound to `id`, via
    // `sqlx::query!("...", id).execute(&state.pool).await?`.
    // `execute` (not `fetch_*`, since DELETE returns no rows) gives you a
    // result with `.rows_affected()` — 0 means no row had that id, so
    // return `AppError::NotFound`; otherwise return `StatusCode::NO_CONTENT`
    // (204, matching the test's expectation for a successful delete).
    todo!("delete the drawing by id; 404 if it doesn't exist, otherwise 204 No Content")
}
```

- [ ] **Step 4: Add the `DELETE` method to the `/api/drawings/:id` route in `lib.rs`**

```rust
.route(
    "/api/drawings/:id",
    get(drawings::get_drawing)
        .put(drawings::update_drawing)
        .delete(drawings::delete_drawing),
)
```

- [ ] **Step 5: Implement `delete_drawing`, then run the full test suite to verify it passes**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test`
Expected: all tests pass — this completes all 5 v0.1 endpoints from spec §4.

- [ ] **Step 6: Commit**

```bash
git add api/src/drawings.rs api/src/lib.rs api/tests/drawings_test.rs
git commit -m "feat(api): DELETE /api/drawings/:id"
```

---

### Task 9: Mode A `compose.yaml`, `.env.example`, end-to-end backend smoke test

**Files:**
- Create: `compose.yaml`
- Create: `.env.example`

**Interfaces:**
- Consumes: `api/src/main.rs` (Task 3), `api/migrations/` (Task 2).
- Produces: a running local Postgres reachable at `localhost:5432` with credentials matching `.env.example`.

- [ ] **Step 1: Write `compose.yaml` (Postgres only — Mode A per spec §10)**

`compose.yaml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: excalistore
      POSTGRES_PASSWORD: password
      POSTGRES_DB: excalistore
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 2: Write `.env.example`**

`.env.example`:
```
DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore
STATIC_DIR=frontend/dist
```

- [ ] **Step 3: Stop any ad-hoc Postgres container from Task 2 and start Compose instead**

```bash
docker rm -f excalistore-postgres 2>/dev/null || true
docker compose up -d postgres
cp .env.example .env
export DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore
```

- [ ] **Step 4: Run the full backend test suite against Compose Postgres**

Run: `cd api && cargo test`
Expected: all tests from Tasks 1–8 pass unchanged (Compose exposes the same connection string as the ad-hoc container did).

- [ ] **Step 5: Manual end-to-end smoke test of `cargo run`**

```bash
cd api && cargo run &
sleep 2
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/api/drawings -H 'content-type: application/json' -d '{"title":"Smoke Test"}'
curl -s http://localhost:3000/api/drawings
kill %1
```
Expected: `health` returns `ok`; the `POST` returns `201` with a JSON drawing; the `GET` list includes `"Smoke Test"`.

- [ ] **Step 6: Commit**

```bash
git add compose.yaml .env.example
git commit -m "feat: Mode A docker compose (Postgres only) and .env.example"
```

---

### Task 10: Frontend scaffold — Vite + React + TypeScript + Vitest

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`

**Interfaces:**
- Produces: an `App` component rendering the text `"ExcaliStore"`, importable as `frontend/src/App.tsx` — Tasks 12–14 replace its body with real routing.

- [ ] **Step 1: Write `package.json`**

`frontend/package.json`:
```json
{
  "name": "excalistore-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@excalidraw/excalidraw": "^0.17.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.3",
    "vitest": "^2.0.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

`frontend/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: Write `vitest.setup.ts`**

`frontend/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Write `index.html`**

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ExcaliStore</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `App.tsx` and `main.tsx`**

`frontend/src/App.tsx`:
```tsx
export function App() {
  return <h1>ExcaliStore</h1>;
}
```

`frontend/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: Install dependencies and verify the build and test runner both work**

```bash
cd frontend && npm install
npm run build
npm test
```
Expected: `npm run build` produces `frontend/dist/` with no errors; `npm test` reports "no test files found" (expected — none exist yet) without crashing.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/vitest.setup.ts frontend/index.html frontend/src/App.tsx frontend/src/main.tsx
git commit -m "feat(frontend): Vite + React + TypeScript + Vitest scaffold"
```

---

### Task 11: Typed API client — `frontend/src/api/api.ts`

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api/api.ts`
- Test: `frontend/src/api/api.test.ts`

**Interfaces:**
- Consumes: backend contract from Tasks 4–8 (`GET/POST /api/drawings`, `GET/PUT/DELETE /api/drawings/:id`).
- Produces: `listDrawings(): Promise<DrawingSummary[]>`, `createDrawing(input: CreateDrawingInput): Promise<Drawing>`, `getDrawing(id: string): Promise<Drawing>`, `updateDrawing(id: string, input: UpdateDrawingInput): Promise<Drawing>`, `deleteDrawing(id: string): Promise<void>`, and `class ConflictError extends Error` thrown by `updateDrawing` on HTTP 409 — Tasks 12–14 import these and nothing else to talk to the backend.

- [ ] **Step 1: Write the types**

`frontend/src/types.ts`:
```ts
export interface DrawingScene {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface DrawingSummary {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Drawing {
  id: string;
  title: string;
  scene: DrawingScene;
  owner_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDrawingInput {
  title: string;
}

export interface UpdateDrawingInput {
  title: string;
  scene: DrawingScene;
  version: number;
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/api/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listDrawings, createDrawing, updateDrawing, deleteDrawing, ConflictError } from "./api";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, ...response })
  );
}

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("listDrawings GETs /api/drawings and returns parsed JSON", async () => {
    const mockData = [{ id: "1", title: "Test", version: 1, created_at: "", updated_at: "" }];
    mockFetchOnce({ json: async () => mockData });

    const result = await listDrawings();

    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith("/api/drawings");
  });

  it("createDrawing POSTs the title and returns the created drawing", async () => {
    const mockDrawing = {
      id: "1",
      title: "New",
      scene: { elements: [], appState: {}, files: {} },
      owner_id: null,
      version: 1,
      created_at: "",
      updated_at: "",
    };
    mockFetchOnce({ status: 201, json: async () => mockDrawing });

    const result = await createDrawing({ title: "New" });

    expect(result).toEqual(mockDrawing);
    expect(fetch).toHaveBeenCalledWith(
      "/api/drawings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New" }),
      })
    );
  });

  it("updateDrawing throws ConflictError on HTTP 409", async () => {
    mockFetchOnce({ ok: false, status: 409, json: async () => ({ error: "conflict" }) });

    await expect(
      updateDrawing("1", {
        title: "X",
        scene: { elements: [], appState: {}, files: {} },
        version: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("deleteDrawing DELETEs /api/drawings/:id", async () => {
    mockFetchOnce({ status: 204 });

    await deleteDrawing("42");

    expect(fetch).toHaveBeenCalledWith(
      "/api/drawings/42",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `./api` module does not exist.

- [ ] **Step 4: Implement the API client**

`frontend/src/api/api.ts`:
```ts
import type {
  Drawing,
  DrawingSummary,
  CreateDrawingInput,
  UpdateDrawingInput,
} from "../types";

const BASE_URL = "/api/drawings";

export class ConflictError extends Error {
  constructor() {
    super("drawing was modified since it was loaded");
    this.name = "ConflictError";
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 409) {
    throw new ConflictError();
  }
  if (!response.ok) {
    throw new Error(`request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listDrawings(): Promise<DrawingSummary[]> {
  const response = await fetch(BASE_URL);
  return handleResponse<DrawingSummary[]>(response);
}

export async function createDrawing(input: CreateDrawingInput): Promise<Drawing> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Drawing>(response);
}

export async function getDrawing(id: string): Promise<Drawing> {
  const response = await fetch(`${BASE_URL}/${id}`);
  return handleResponse<Drawing>(response);
}

export async function updateDrawing(
  id: string,
  input: UpdateDrawingInput
): Promise<Drawing> {
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Drawing>(response);
}

export async function deleteDrawing(id: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (response.status === 409) {
    throw new ConflictError();
  }
  if (!response.ok) {
    throw new Error(`request failed with status ${response.status}`);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test`
Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/api.ts frontend/src/api/api.test.ts
git commit -m "feat(frontend): typed API client for drawings"
```

---

### Task 12: Drawing list UI — `DrawingList` + `DrawingsPage`

**Files:**
- Create: `frontend/src/components/DrawingList.tsx`
- Test: `frontend/src/components/DrawingList.test.tsx`
- Create: `frontend/src/pages/DrawingsPage.tsx`
- Modify: `frontend/package.json` (add `react-router-dom` is already present from Task 10)

**Interfaces:**
- Consumes: `DrawingSummary` (Task 11 `types.ts`), `listDrawings`/`deleteDrawing` (Task 11 `api.ts`).
- Produces: `DrawingList({ drawings, onOpen, onDelete })` presentational component; `DrawingsPage` container component that Task 14 mounts at route `/`.

- [ ] **Step 1: Write the failing test for `DrawingList`**

`frontend/src/components/DrawingList.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DrawingList } from "./DrawingList";

const drawings = [
  { id: "1", title: "First", version: 1, created_at: "", updated_at: "" },
  { id: "2", title: "Second", version: 1, created_at: "", updated_at: "" },
];

describe("DrawingList", () => {
  it("renders a button per drawing title", () => {
    render(<DrawingList drawings={drawings} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("calls onOpen with the drawing id when a title is clicked", () => {
    const onOpen = vi.fn();
    render(<DrawingList drawings={drawings} onOpen={onOpen} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText("First"));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("calls onDelete with the drawing id when delete is clicked", () => {
    const onDelete = vi.fn();
    render(<DrawingList drawings={drawings} onOpen={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete First"));
    expect(onDelete).toHaveBeenCalledWith("1");
  });

  it("shows an empty state when there are no drawings", () => {
    render(<DrawingList drawings={[]} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no drawings yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./DrawingList` does not exist.

- [ ] **Step 3: Implement `DrawingList`**

`frontend/src/components/DrawingList.tsx`:
```tsx
import type { DrawingSummary } from "../types";

interface DrawingListProps {
  drawings: DrawingSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function DrawingList({ drawings, onOpen, onDelete }: DrawingListProps) {
  if (drawings.length === 0) {
    return <p>No drawings yet. Create one to get started.</p>;
  }

  return (
    <ul>
      {drawings.map((drawing) => (
        <li key={drawing.id}>
          <button onClick={() => onOpen(drawing.id)}>{drawing.title}</button>
          <button onClick={() => onDelete(drawing.id)} aria-label={`Delete ${drawing.title}`}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: all 4 `DrawingList` tests pass.

- [ ] **Step 5: Add `react-router-dom` navigation and implement `DrawingsPage`**

`frontend/src/pages/DrawingsPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DrawingList } from "../components/DrawingList";
import { listDrawings, deleteDrawing } from "../api/api";
import type { DrawingSummary } from "../types";

export function DrawingsPage() {
  const [drawings, setDrawings] = useState<DrawingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    const data = await listDrawings();
    setDrawings(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string) {
    await deleteDrawing(id);
    await refresh();
  }

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h1>Drawings</h1>
      <button onClick={() => navigate("/drawings/new")}>New drawing</button>
      <DrawingList
        drawings={drawings}
        onOpen={(id) => navigate(`/drawings/${id}`)}
        onDelete={handleDelete}
      />
    </div>
  );
}
```

No test file for `DrawingsPage` in this task — it is exercised by the routing test in Task 14, which renders it inside a `MemoryRouter` with a mocked `api` module.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DrawingList.tsx frontend/src/components/DrawingList.test.tsx frontend/src/pages/DrawingsPage.tsx
git commit -m "feat(frontend): drawing list UI"
```

---

### Task 13: Autosave — `useAutosave` hook + `SaveStatus` component

**Files:**
- Create: `frontend/src/hooks/useAutosave.ts`
- Test: `frontend/src/hooks/useAutosave.test.ts`
- Create: `frontend/src/components/SaveStatus.tsx`
- Test: `frontend/src/components/SaveStatus.test.tsx`
- Modify: `frontend/package.json` (add `@testing-library/react-hooks`-equivalent — `renderHook` ships in `@testing-library/react` v16, already present)

**Interfaces:**
- Produces: `export type SaveStatusValue = "idle" | "saving" | "saved" | "error"`; `useAutosave<T>(value: T, onSave: (value: T) => Promise<void>, delayMs?: number): SaveStatusValue` — skips saving on the first render, debounces by `delayMs` (default 1500ms per spec §3's "~1–2 seconds"), sets `"error"` if `onSave` rejects; `SaveStatus({ status: SaveStatusValue })` renders exactly the three labels from spec §3 (`✓ Saved`, `⟳ Saving…`, `⚠ Save failed — retry`) and nothing for `"idle"`.

- [ ] **Step 1: Write the failing tests for `useAutosave`**

`frontend/src/hooks/useAutosave.test.ts`:
```ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  it("does not save on the initial render", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave("initial", onSave, 1000));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("debounces and calls onSave with the latest value after the delay", () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ value }) => useAutosave(value, onSave, 1000), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });
    rerender({ value: "c" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("sets status to error when onSave rejects", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValue(new Error("save failed"));
    const { result, rerender } = renderHook(({ value }) => useAutosave(value, onSave, 1000), {
      initialProps: { value: "a" },
    });

    rerender({ value: "b" });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current).toBe("error");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `./useAutosave` does not exist.

- [ ] **Step 3: Implement `useAutosave`**

`frontend/src/hooks/useAutosave.ts`:
```ts
import { useEffect, useRef, useState } from "react";

export type SaveStatusValue = "idle" | "saving" | "saved" | "error";

export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  delayMs = 1500
): SaveStatusValue {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setStatus("saving");
      onSave(value)
        .then(() => setStatus("saved"))
        .catch(() => setStatus("error"));
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return status;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test`
Expected: all 3 `useAutosave` tests pass.

- [ ] **Step 5: Write the failing tests for `SaveStatus`**

`frontend/src/components/SaveStatus.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SaveStatus } from "./SaveStatus";

describe("SaveStatus", () => {
  it.each([
    ["saving", "⟳ Saving…"],
    ["saved", "✓ Saved"],
    ["error", "⚠ Save failed — retry"],
  ] as const)("renders the label for status %s", (status, label) => {
    render(<SaveStatus status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders nothing for idle status", () => {
    const { container } = render(<SaveStatus status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `./SaveStatus` does not exist.

- [ ] **Step 7: Implement `SaveStatus`**

`frontend/src/components/SaveStatus.tsx`:
```tsx
import type { SaveStatusValue } from "../hooks/useAutosave";

const LABELS: Record<SaveStatusValue, string> = {
  idle: "",
  saving: "⟳ Saving…",
  saved: "✓ Saved",
  error: "⚠ Save failed — retry",
};

export function SaveStatus({ status }: { status: SaveStatusValue }) {
  const label = LABELS[status];
  if (!label) return null;
  return <span role="status">{label}</span>;
}
```

- [ ] **Step 8: Run the full frontend test suite to verify everything passes**

Run: `cd frontend && npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useAutosave.ts frontend/src/hooks/useAutosave.test.ts frontend/src/components/SaveStatus.tsx frontend/src/components/SaveStatus.test.tsx
git commit -m "feat(frontend): autosave hook and save-status UI"
```

---

### Task 14: Editor page, new-drawing redirect, and routing wire-up

**Files:**
- Create: `frontend/src/pages/NewDrawingPage.tsx`
- Create: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `getDrawing`/`updateDrawing`/`createDrawing` (Task 11), `useAutosave`/`SaveStatus` (Task 13), `DrawingsPage` (Task 12), `Excalidraw` from `@excalidraw/excalidraw`.
- Produces: `App` mounting routes `/` → `DrawingsPage`, `/drawings/new` → `NewDrawingPage`, `/drawings/:id` → `EditorPage`, matching spec §3 Routing exactly.

- [ ] **Step 1: Implement `NewDrawingPage`**

`frontend/src/pages/NewDrawingPage.tsx`:
```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createDrawing } from "../api/api";

export function NewDrawingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    createDrawing({ title: "Untitled drawing" }).then((drawing) => {
      navigate(`/drawings/${drawing.id}`, { replace: true });
    });
  }, [navigate]);

  return <p>Creating drawing…</p>;
}
```

- [ ] **Step 2: Implement `EditorPage`**

`frontend/src/pages/EditorPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import { getDrawing, updateDrawing } from "../api/api";
import { useAutosave } from "../hooks/useAutosave";
import { SaveStatus } from "../components/SaveStatus";
import type { Drawing, DrawingScene } from "../types";

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [pendingScene, setPendingScene] = useState<DrawingScene | null>(null);

  useEffect(() => {
    if (!id) return;
    getDrawing(id).then(setDrawing);
  }, [id]);

  const status = useAutosave(pendingScene, async (scene) => {
    if (!id || !drawing || !scene) return;
    const updated = await updateDrawing(id, {
      title: drawing.title,
      scene,
      version: drawing.version,
    });
    setDrawing(updated);
  });

  if (!drawing) {
    return <p>Loading…</p>;
  }

  return (
    <div style={{ height: "100vh" }}>
      <SaveStatus status={status} />
      <Excalidraw
        initialData={{ elements: drawing.scene.elements, appState: drawing.scene.appState }}
        onChange={(elements, appState, files) => {
          setPendingScene({ elements, appState, files });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the failing routing test**

`frontend/src/App.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { DrawingsPage } from "./pages/DrawingsPage";
import * as api from "./api/api";

vi.mock("./api/api");

describe("DrawingsPage routing", () => {
  it("renders the drawings list heading after loading", async () => {
    vi.mocked(api.listDrawings).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<DrawingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Drawings")).toBeInTheDocument());
    expect(screen.getByText(/no drawings yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `vi.mock("./api/api")` auto-mock leaves `listDrawings` undefined until `DrawingsPage` exists and is wired; run first to confirm the mock/import path resolves and the assertion fails meaningfully (e.g. heading never appears without the component rendering the loading→loaded transition correctly). If the test errors instead of failing an assertion, fix the import path before proceeding.

- [ ] **Step 5: Wire real routing into `App.tsx`**

`frontend/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DrawingsPage } from "./pages/DrawingsPage";
import { EditorPage } from "./pages/EditorPage";
import { NewDrawingPage } from "./pages/NewDrawingPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DrawingsPage />} />
        <Route path="/drawings/new" element={<NewDrawingPage />} />
        <Route path="/drawings/:id" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: the routing test passes.

- [ ] **Step 7: Import Excalidraw's stylesheet and run a full build**

`frontend/src/main.tsx` — add the CSS import:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@excalidraw/excalidraw/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Run: `cd frontend && npm run build`
Expected: builds cleanly with no TypeScript errors.

- [ ] **Step 8: Manual smoke test against the running backend**

With Postgres up (Task 9) and `cargo run` running the API on port 3000:
```bash
cd frontend && npm run dev
```
Open `http://localhost:5173`, click "New drawing", confirm it redirects to `/drawings/:id` and the Excalidraw canvas loads; draw something and confirm `⟳ Saving…` then `✓ Saved` appear within ~2 seconds; reload the page and confirm the drawing persisted.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/NewDrawingPage.tsx frontend/src/pages/EditorPage.tsx frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx
git commit -m "feat(frontend): editor page, new-drawing redirect, routing"
```

---

### Task 15: Single production Docker image, README

**Files:**
- Create: `Dockerfile`
- Modify: `api/src/lib.rs`
- Create: `README.md`

**Interfaces:**
- Consumes: `frontend/dist` (Task 10's `npm run build` output), `api` binary (Task 3+).
- Produces: `build_router(state: AppState) -> Router` now also serves static files from `$STATIC_DIR` (default `frontend/dist`) with an `index.html` SPA fallback for any unmatched non-`/api` path.

- [ ] **Step 1: Write the failing test for static file serving**

Append to `api/tests/health_test.rs`:
```rust
#[tokio::test]
async fn unmatched_route_falls_back_to_index_html() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>ExcaliStore</html>").unwrap();
    std::env::set_var("STATIC_DIR", dir.path().to_str().unwrap());

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect(&database_url)
        .await
        .unwrap();

    let app = excalistore_api::build_router(excalistore_api::AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/drawings/some-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    std::env::remove_var("STATIC_DIR");
}
```
Add `tempfile = "3"` to `[dev-dependencies]` in `api/Cargo.toml`:
```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test health_test unmatched_route`
Expected: FAIL — `/drawings/some-id` currently 404s with no fallback configured.

- [ ] **Step 3: Add static file serving with SPA fallback to `lib.rs`**

`api/src/lib.rs`:
```rust
pub mod drawings;
pub mod error;

use axum::{routing::get, Router};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

pub fn build_router(state: AppState) -> Router {
    let api_router = Router::new()
        .route("/health", get(health))
        .route(
            "/api/drawings",
            get(drawings::list_drawings).post(drawings::create_drawing),
        )
        .route(
            "/api/drawings/:id",
            get(drawings::get_drawing)
                .put(drawings::update_drawing)
                .delete(drawings::delete_drawing),
        )
        .with_state(state);

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".to_string());
    let index_path = format!("{static_dir}/index.html");
    let serve_dir = ServeDir::new(&static_dir).fallback(ServeFile::new(index_path));

    api_router.fallback_service(serve_dir)
}

async fn health() -> &'static str {
    "ok"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test --test health_test`
Expected: `unmatched_route_falls_back_to_index_html` and `health_returns_200_ok` both pass.

- [ ] **Step 5: Write the multi-stage `Dockerfile`**

`Dockerfile`:
```dockerfile
# ---- frontend build ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM rust:1.79-slim AS backend-build
WORKDIR /app/api
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
COPY api/migrations ./migrations
RUN cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-build /app/api/target/release/excalistore-api ./excalistore-api
COPY --from=backend-build /app/api/migrations ./migrations
COPY --from=frontend-build /app/frontend/dist ./static

ENV STATIC_DIR=/app/static
EXPOSE 3000
CMD ["./excalistore-api"]
```

- [ ] **Step 6: Build the image and smoke test it end-to-end**

```bash
docker build -t excalistore:v0.1 .
docker network inspect excalistore-net >/dev/null 2>&1 || docker network create excalistore-net
docker run -d --name excalistore-postgres-e2e --network excalistore-net \
  -e POSTGRES_USER=excalistore -e POSTGRES_PASSWORD=password -e POSTGRES_DB=excalistore \
  postgres:16
sleep 3
docker run -d --name excalistore-e2e --network excalistore-net -p 3000:3000 \
  -e DATABASE_URL=postgres://excalistore:password@excalistore-postgres-e2e:5432/excalistore \
  excalistore:v0.1
sleep 2
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/api/drawings -H 'content-type: application/json' -d '{"title":"Container Test"}'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
docker rm -f excalistore-e2e excalistore-postgres-e2e
docker network rm excalistore-net
```
Expected: `health` returns `ok`; the `POST` returns `201`; the final `curl` to `/` returns `200` (the SPA `index.html` served from the compiled frontend).

- [ ] **Step 7: Write `README.md`**

`README.md`:
```markdown
# ExcaliStore

Self-hosted, persistent web app for storing and organizing Excalidraw
drawings — Rust/Axum backend, React frontend, PostgreSQL storage.

See [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) for the full architecture
and roadmap.

## Local development (v0.1 — no auth)

1. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
2. Start Postgres:
   ```bash
   docker compose up -d postgres
   ```
3. Run the backend (applies migrations automatically on startup):
   ```bash
   cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo run
   ```
4. Run the frontend dev server (in a second terminal):
   ```bash
   cd frontend && npm install && npm run dev
   ```
5. Open http://localhost:5173.

## Tests

```bash
cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test
cd frontend && npm test
```

## Production image

```bash
docker build -t excalistore:latest .
docker run -p 3000:3000 -e DATABASE_URL=postgres://... excalistore:latest
```

The image serves the compiled frontend and the `/api/*` backend from a
single container on port 3000. Postgres is not bundled — run it separately.
```

- [ ] **Step 8: Commit**

```bash
git add api/src/lib.rs api/tests/health_test.rs api/Cargo.toml Dockerfile README.md
git commit -m "feat: single production Docker image serving frontend + API, README"
```

---

## Self-Review

**Spec coverage:**
- §1 (division of responsibility, Excalidraw untouched) — reflected in File Structure responsibilities and Task 14 (thin `EditorPage` wrapping `<Excalidraw>` with no drawing logic).
- §2 (single repo, `frontend/`+`api/` layout) — File Structure matches exactly.
- §3 (routing `/`, `/drawings/:id`, `/drawings/new`; server-generated UUID; autosave debounce + 3 UI states) — Tasks 12–14 (routing), Task 4 (server generates `Uuid::new_v4()`), Task 13 (debounce + exact status labels).
- §4 (5 endpoints, opaque JSON scene) — Tasks 4–8; `scene` typed `serde_json::Value` throughout, never destructured server-side.
- §5 (schema, nullable `owner_id`, optimistic versioning) — Task 2 (schema), Task 7 (versioned `UPDATE`).
- §6/§7 (SQLx migrations, compile-time `query_as!`) — Task 2, Tasks 4–8.
- §10 Mode A (bare Postgres compose, no `AuthContext`) — Task 9; no auth code anywhere in this plan.
- §12 (single production image, DB excluded) — Task 15.
- §16 v0.1 checklist — every bullet maps 1:1 to a task (migrations→Task 2, handlers→Tasks 4–8, no `AuthContext`→Global Constraints + no auth code written, React list/editor/autosave/routing→Tasks 12–14, `compose.yaml`→Task 9, `.env.example`→Task 9, `Dockerfile`→Task 15, `README.md`→Task 15).
- §20 immediate next step ordering — this plan follows the same order (migrations → main.rs/router → handlers → error.rs → compose/.env → frontend → Dockerfile → README), with `error.rs` pulled earlier (Task 3) since handlers depend on `AppError` existing first.

**Placeholder scan:** no "TBD"/"handle appropriately"/"similar to Task N" phrasing anywhere; every test step contains a real, complete assertion, not a description of one. The `todo!()` handler bodies in Tasks 4–8 are the one deliberate exception (see Global Constraints "Learning exception") — each is a signature plus a full comment-spec of the SQL/logic to write, not an unspecified gap.

**Type consistency:** `Drawing`/`DrawingSummary`/`CreateDrawing`/`UpdateDrawing` field names and types are identical everywhere they're used (Tasks 4–8, and mirrored in `frontend/src/types.ts` in Task 11). `AppState { pool }` and `build_router(state: AppState) -> Router` signatures are introduced once (Task 3) and never renamed. `SaveStatusValue` is defined once (Task 13) and consumed with the same name in `EditorPage` (Task 14). `ConflictError` is defined once (Task 11) and used identically in its own tests and (implicitly, via `updateDrawing`) in `EditorPage`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-29-excalistore-v0.1-persistence-mvp.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
