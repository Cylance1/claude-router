//! Application state for Claude Router
use crate::core::router::ModelRouter;
use crate::telemetry::metrics::Metrics;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub router: Arc<RwLock<ModelRouter>>,
    pub metrics: Arc<Metrics>,
}