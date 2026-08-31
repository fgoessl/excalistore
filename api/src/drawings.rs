use axum::{Json, extract::{Path, State}, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AppState, error::AppError};

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

#[derive(Debug, Deserialize)]
pub struct UpdateDrawing {
    pub title: String,
    pub scene: serde_json::Value,
    pub version: i64
}

fn default_scene() -> serde_json::Value {
    serde_json::json!({ "elements": [], "appState": {}, "files": {} })
}

pub async fn list_drawings(State(state): State<AppState>) -> Result<Json<Vec<Drawing>>, AppError> {
    let drawings = sqlx::query_as!(Drawing, "SELECT id, title, scene, owner_id, version, created_at, updated_at FROM drawings ORDER BY created_at").fetch_all(&state.pool).await?;
    tracing::debug!(count = drawings.len(), "listed drawings");
    Ok(Json(drawings))
}


pub async fn fetch_drawing(
    State(state): State<AppState>,
    Path(id): Path<Uuid>
) -> Result<Json<Drawing>, AppError>{
    let drawing: Drawing = sqlx::query_as!(
        Drawing,
        "SELECT id, title, scene, owner_id, version, created_at, updated_at FROM drawings WHERE id = $1",
        id
    ).fetch_one(&state.pool).await?;
    tracing::debug!(%id, "fetched drawing");
    Ok(Json(drawing))
}

pub async fn create_drawing(
    State(state): State<AppState>,
    Json(body): Json<CreateDrawing>,
) -> Result<(StatusCode, Json<Drawing>), AppError> {
    let id = Uuid::new_v4();
    let drawing: Drawing = sqlx::query_as!(
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
    tracing::debug!(%id, title = %drawing.title, "created drawing");

    Ok((StatusCode::CREATED, Json(drawing)))
}


pub async fn update_drawing(
    State(state): State<AppState>, 
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDrawing>)
 -> Result<(StatusCode, Json<Drawing>), AppError>{
    let drawing: Option<Drawing> = sqlx::query_as!(
        Drawing,
        r#"
        UPDATE drawings 
        SET title = $2, scene = $3, version = $4 + 1, updated_at = now()
        WHERE id = $1 AND version = $4
        RETURNING id, title, scene, owner_id, version, created_at, updated_at
        "#,
        id,
        body.title,
        body.scene,
        body.version
    )
    .fetch_optional(&state.pool)
    .await?;

    match drawing{
        Some(drawing) => {
            metrics::counter!("excalistore_drawings_updated_total").increment(1);
            tracing::debug!(%id, new_version = drawing.version, "updated drawing");
            Ok((StatusCode::OK, Json(drawing)))
        }
        None => {
            let id_exists: bool = sqlx::query_scalar!(
            r#"SELECT EXISTS ( SELECT 1 FROM drawings WHERE id = $1)"#,
            id).fetch_one(&state.pool).await?.unwrap_or(false);
            if id_exists {
                tracing::debug!(%id, requested_version = body.version, "update conflict: stale version");
                return Err(AppError::Conflict)
            }
            tracing::debug!(%id, "update failed: drawing not found");
            Err(AppError::NotFound)

        }
    }

    
}