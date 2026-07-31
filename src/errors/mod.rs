//! Error definitions and handling for Claude Router
//!
//! `RouterError`/`ErrorType` are used by the provider layer (see
//! `ProviderError`, used in `providers::openrouter`). The other typed error
//! wrappers here (`ConfigError`, `NetworkError`, `AuthenticationError`) are a
//! general-purpose error taxonomy for callers to adopt as those code paths
//! grow real error handling; they aren't all wired up yet, hence the blanket
//! allow below rather than per-item annotations.
#![allow(dead_code)]
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Custom error type for Claude Router
#[derive(Debug, Serialize, Deserialize)]
pub struct RouterError {
    pub error_type: ErrorType,
    pub message: String,
    pub details: Option<String>,
}

/// Types of errors that can occur in Claude Router
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ErrorType {
    ConfigurationError,
    ProviderError,
    ValidationError,
    NetworkError,
    TranslationError,
    StreamingError,
    InternalError,
    AuthenticationError,
    RateLimitError,
    TimeoutError,
    InvalidRequestError,
    ModelNotFoundError,
    ToolExecutionError,
}

impl RouterError {
    /// Create a new router error
    pub fn new(error_type: ErrorType, message: impl Into<String>) -> Self {
        Self {
            error_type,
            message: message.into(),
            details: None,
        }
    }

    /// Create a new router error with details
    pub fn with_details(
        error_type: ErrorType,
        message: impl Into<String>,
        details: impl Into<String>,
    ) -> Self {
        Self {
            error_type,
            message: message.into(),
            details: Some(details.into()),
        }
    }

    /// Create a new router error with a source error
    pub fn with_source(
        error_type: ErrorType,
        message: impl Into<String>,
        source: Box<dyn std::error::Error + Send + Sync>,
    ) -> Self {
        Self {
            error_type,
            message: message.into(),
            details: Some(source.to_string()),
        }
    }

    /// Convert to Axum response
    pub fn into_response(self) -> Response {
        let status = match self.error_type {
            ErrorType::ConfigurationError => StatusCode::BAD_REQUEST,
            ErrorType::ProviderError => StatusCode::BAD_GATEWAY,
            ErrorType::ValidationError => StatusCode::BAD_REQUEST,
            ErrorType::NetworkError => StatusCode::BAD_GATEWAY,
            ErrorType::TranslationError => StatusCode::BAD_REQUEST,
            ErrorType::StreamingError => StatusCode::BAD_REQUEST,
            ErrorType::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorType::AuthenticationError => StatusCode::UNAUTHORIZED,
            ErrorType::RateLimitError => StatusCode::TOO_MANY_REQUESTS,
            ErrorType::TimeoutError => StatusCode::REQUEST_TIMEOUT,
            ErrorType::InvalidRequestError => StatusCode::BAD_REQUEST,
            ErrorType::ModelNotFoundError => StatusCode::NOT_FOUND,
            ErrorType::ToolExecutionError => StatusCode::BAD_REQUEST,
        };

        let body = serde_json::to_string(&self).unwrap_or_else(|_| "{}".to_string());

        (status, [("content-type", "application/json")], body).into_response()
    }

    /// Get HTTP status code for this error
    pub fn status_code(&self) -> StatusCode {
        match self.error_type {
            ErrorType::ConfigurationError => StatusCode::BAD_REQUEST,
            ErrorType::ProviderError => StatusCode::BAD_GATEWAY,
            ErrorType::ValidationError => StatusCode::BAD_REQUEST,
            ErrorType::NetworkError => StatusCode::BAD_GATEWAY,
            ErrorType::TranslationError => StatusCode::BAD_REQUEST,
            ErrorType::StreamingError => StatusCode::BAD_REQUEST,
            ErrorType::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorType::AuthenticationError => StatusCode::UNAUTHORIZED,
            ErrorType::RateLimitError => StatusCode::TOO_MANY_REQUESTS,
            ErrorType::TimeoutError => StatusCode::REQUEST_TIMEOUT,
            ErrorType::InvalidRequestError => StatusCode::BAD_REQUEST,
            ErrorType::ModelNotFoundError => StatusCode::NOT_FOUND,
            ErrorType::ToolExecutionError => StatusCode::BAD_REQUEST,
        }
    }

    /// Add context to the error
    pub fn context(mut self, context: impl Into<String>) -> Self {
        if let Some(ref mut details) = self.details {
            *details = format!("{}: {}", context.into(), details);
        } else {
            self.details = Some(context.into());
        }
        self
    }

    /// Chain another error as context
    pub fn caused_by<E: std::error::Error + Send + Sync + 'static>(
        mut self,
        source: E,
    ) -> Self {
        if let Some(ref mut details) = self.details {
            *details = format!("{}: {}", details, source);
        } else {
            self.details = Some(source.to_string());
        }
        self
    }
}

impl fmt::Display for RouterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.error_type, self.message)?;
        if let Some(ref details) = self.details {
            write!(f, " ({})", details)?;
        }
        Ok(())
    }
}

impl std::error::Error for RouterError {}

/// Result type for Claude Router operations
pub type RouterResult<T> = Result<T, RouterError>;

/// Convert anyhow::Error to RouterError
impl From<anyhow::Error> for RouterError {
    fn from(error: anyhow::Error) -> Self {
        RouterError::new(ErrorType::InternalError, error.to_string())
    }
}

/// Convert RouterError to Axum response
impl IntoResponse for RouterError {
    fn into_response(self) -> Response {
        let status = match self.error_type {
            ErrorType::ConfigurationError => StatusCode::BAD_REQUEST,
            ErrorType::ProviderError => StatusCode::BAD_GATEWAY,
            ErrorType::ValidationError => StatusCode::BAD_REQUEST,
            ErrorType::NetworkError => StatusCode::BAD_GATEWAY,
            ErrorType::TranslationError => StatusCode::BAD_REQUEST,
            ErrorType::StreamingError => StatusCode::BAD_REQUEST,
            ErrorType::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorType::AuthenticationError => StatusCode::UNAUTHORIZED,
            ErrorType::RateLimitError => StatusCode::TOO_MANY_REQUESTS,
            ErrorType::TimeoutError => StatusCode::REQUEST_TIMEOUT,
            ErrorType::InvalidRequestError => StatusCode::BAD_REQUEST,
            ErrorType::ModelNotFoundError => StatusCode::NOT_FOUND,
            ErrorType::ToolExecutionError => StatusCode::BAD_REQUEST,
        };

        let body = serde_json::to_string(&self).unwrap_or_else(|_| "{}".to_string());

        (status, [("content-type", "application/json")], body).into_response()
    }
}

/// Configuration error
#[derive(Debug)]
pub struct ConfigError {
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl ConfigError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source<E: std::error::Error + Send + Sync + 'static>(
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Self {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Configuration error: {}", self.message)?;
        if let Some(ref source) = self.source {
            write!(f, " (source: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|e| e.as_ref() as _)
    }
}

/// Provider error
#[derive(Debug)]
pub struct ProviderError {
    pub provider: String,
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl ProviderError {
    pub fn new(provider: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            provider: provider.into(),
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source<E: std::error::Error + Send + Sync + 'static>(
        provider: impl Into<String>,
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Self {
            provider: provider.into(),
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Provider '{}' error: {}", self.provider, self.message)?;
        if let Some(ref source) = self.source {
            write!(f, " (source: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for ProviderError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|e| e.as_ref() as _)
    }
}

/// Network error
#[derive(Debug)]
pub struct NetworkError {
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl NetworkError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source<E: std::error::Error + Send + Sync + 'static>(
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Self {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

impl fmt::Display for NetworkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Network error: {}", self.message)?;
        if let Some(ref source) = self.source {
            write!(f, " (source: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for NetworkError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|e| e.as_ref() as _)
    }
}

/// Authentication error
#[derive(Debug)]
pub struct AuthenticationError {
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl AuthenticationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            source: None,
        }
    }

    pub fn with_source<E: std::error::Error + Send + Sync + 'static>(
        message: impl Into<String>,
        source: E,
    ) -> Self {
        Self {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

impl fmt::Display for AuthenticationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Authentication error: {}", self.message)?;
        if let Some(ref source) = self.source {
            write!(f, " (source: {})", source)?;
        }
        Ok(())
    }
}

impl std::error::Error for AuthenticationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|e| e.as_ref() as _)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_error_creation() {
        let error = RouterError::new(ErrorType::InternalError, "Test error");
        assert_eq!(error.message, "Test error");
    }

    #[test]
    fn test_error_display() {
        let error = RouterError::new(ErrorType::InternalError, "Test error");
        let display = format!("{}", error);
        assert!(display.contains("InternalError"));
        assert!(display.contains("Test error"));
    }

    #[test]
    fn test_router_error_with_details() {
        let error = RouterError::with_details(
            ErrorType::ConfigurationError,
            "Config error",
            "Missing required field",
        );
        assert_eq!(error.message, "Config error");
        assert_eq!(error.details, Some("Missing required field".to_string()));
    }

    #[test]
    fn test_error_status_codes() {
        let error = RouterError::new(ErrorType::AuthenticationError, "Auth failed");
        assert_eq!(error.status_code(), StatusCode::UNAUTHORIZED);

        let error = RouterError::new(ErrorType::RateLimitError, "Rate limited");
        assert_eq!(error.status_code(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_error_context() {
        let error = RouterError::new(ErrorType::InternalError, "Test error")
            .context("Additional context");
        assert!(error.details.is_some());
    }

    #[test]
    fn test_config_error() {
        let error = ConfigError::new("Invalid config");
        assert_eq!(error.message, "Invalid config");

        let error_with_source = ConfigError::with_source(
            "Invalid config",
            std::io::Error::new(std::io::ErrorKind::Other, "IO error"),
        );
        assert!(error_with_source.source.is_some());
    }

    #[test]
    fn test_provider_error() {
        let error = ProviderError::new("openrouter", "API error");
        assert_eq!(error.provider, "openrouter");
        assert_eq!(error.message, "API error");

        let error_with_source = ProviderError::with_source(
            "openrouter",
            "API error",
            std::io::Error::new(std::io::ErrorKind::Other, "IO error"),
        );
        assert!(error_with_source.source.is_some());
    }

    #[test]
    fn test_into_response() {
        let error = RouterError::new(ErrorType::InternalError, "Test error");
        let response = error.into_response();
        // Just check that it doesn't panic
        assert!(true);
    }
}