use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::json;
use strum::{EnumDiscriminants, EnumIter, IntoStaticStr};


#[derive(Debug, EnumDiscriminants)]
#[strum_discriminants(name(AppErrorKind))]
#[strum_discriminants(derive(EnumIter, IntoStaticStr))]
#[strum_discriminants(strum(serialize_all = "snake_case"))]
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
        // Same AppErrorKind -> &'static str conversion metrics.rs uses to
        // pre-register these labels at 0, so the labels here can never
        // drift out of sync with the ones metrics.rs knows about.
        let kind: AppErrorKind = (&self).into();
        let label: &'static str = kind.into();
        metrics::counter!("excalistore_errors_total", "kind" => label).increment(1);

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

    #[tokio::test]
    async fn into_response_increments_the_errors_total_counter() {
        // In the real app this happens once, inside build_router(), before
        // any request can be served — do the same here, since this test
        // never calls build_router() itself.
        crate::metrics::init();

        // Not asserting an exact count: other tests in this same binary
        // may also call .into_response() on AppError::Conflict and share
        // the same process-wide metrics recorder, so >= 1 (not == 1) is
        // the only thing guaranteed regardless of test execution order.
        let _ = AppError::Conflict.into_response();

        let rendered = crate::metrics::metrics_handler().await;
        let line = rendered
            .lines()
            .find(|line| line.starts_with(r#"excalistore_errors_total{kind="conflict"}"#))
            .expect("conflict counter line must be present in /metrics output");

        let value: f64 = line
            .rsplit(' ')
            .next()
            .expect("counter line must have a value")
            .parse()
            .expect("counter value must be a number");

        assert!(
            value >= 1.0,
            "expected the conflict counter to have been incremented, got {value}"
        );
    }
}