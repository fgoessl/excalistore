use axum::{Json, extract::{Path, State}, http::StatusCode};
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

pub async fn list_drawings(State(state): State<AppState>) -> Result<Json<Vec<Drawing>>, AppError> {
    let drawings = sqlx::query_as!(Drawing, "SELECT id, title, scene, owner_id, version, created_at, updated_at FROM drawings ORDER BY created_at").fetch_all(&state.pool).await?;
    Ok(Json(drawings))
}


pub async fn fetch_drawing(
    State(state): State<AppState>,
    Path(id): Path<Uuid>
) -> Result<Json<Drawing>, AppError>{
    let drawing = sqlx::query_as!(
        Drawing,
        "SELECT id, title, scene, owner_id, version, created_at, updated_at FROM drawings WHERE id = $1",
        id
    ).fetch_one(&state.pool).await?;
    Ok(Json(drawing))
}

pub async fn create_drawing(
    State(state): State<AppState>,
    Json(body): Json<CreateDrawing>,
) -> Result<(StatusCode, Json<Drawing>), AppError> {
    let id = Uuid::new_v4();
    let drawing = sqlx::query_as!(
        Drawing,
        r#"
        INSERT INTO drawings (id, title, scene)
        VALUES ($1, $2, $3)
        RETURNING id, title, scene, owner_id, version, created_at, updated_at
        "#,
        id,
        body.title,
        body.scene
    )
    .fetch_one(&state.pool)
    .await?;

    metrics::counter!("excalistore_drawings_created_total").increment(1);

    Ok((StatusCode::CREATED, Json(drawing)))
}
