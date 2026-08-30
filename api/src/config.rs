use std::fmt;

use secrecy::{ExposeSecret, SecretString};

/// A validated Postgres connection URL that never prints its password.
///
/// The raw connection string (secret included) lives behind `secrecy::Secret`
/// — the only way to get it out is the explicit, greppable `.expose_secret()`
/// call inside `as_str()`. That's the real safety property: even a future
/// accessor added to this type would have to deliberately call
/// `expose_secret()` to leak it; a derived/careless `Debug` impl can't.
///
/// The `Debug` impl below additionally does its own redaction (via `url`'s
/// parsing, which correctly handles percent-encoding/IPv6/etc.) so the host
/// and database name — genuinely useful in a log line — stay visible while
/// only the password is hidden, rather than hiding the whole value the way
/// `Secret`'s own default `Debug` would.
pub struct DatabaseUrl(SecretString);

impl DatabaseUrl {
    pub fn parse(raw: &str) -> Result<Self, url::ParseError> {
        url::Url::parse(raw)?; // validate shape; parsed value itself isn't kept
        Ok(Self(SecretString::from(raw)))
    }

    /// The real connection string, password included — this is what
    /// actually gets handed to `sqlx::PgPool::connect`.
    pub fn as_str(&self) -> &str {
        self.0.expose_secret()
    }
}

impl fmt::Debug for DatabaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Safe to unwrap: `parse()` already validated this string as a URL.
        let mut redacted =
            url::Url::parse(self.0.expose_secret()).expect("validated at construction");
        if redacted.password().is_some() {
            let _ = redacted.set_password(Some("***"));
        }
        write!(f, "DatabaseUrl({redacted})")
    }
}
