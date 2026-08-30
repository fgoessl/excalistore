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