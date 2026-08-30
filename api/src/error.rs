use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::json;


#[derive(Debug)]
pub enum AppError{
    NotFound,
    Conflict,
    Database(sqlx::Error)
}


impl From <sqlx::Error> for AppError{

    fn from(err: sqlx::Error) -> AppError{
        match err{
            sqlx::Error::RowNotFound => AppError::NotFound,
            _ => AppError::Database(err),
        }

    }

}

impl IntoResponse for AppError{
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, "entry not found"),
            AppError::Conflict => (StatusCode::CONFLICT, "conflict in database"),
            AppError::Database(err) => {
                tracing::error!(%err, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "database error")
            }
        };
        (status, Json(json!({"error": message}))).into_response()
    }   
}