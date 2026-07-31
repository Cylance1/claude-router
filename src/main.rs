use anyhow::Result;
use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;

mod api;
mod core;
mod providers;
mod tools;
mod utils;
mod streaming;
mod telemetry;
mod errors;
mod state;

use crate::api::v1::messages::handle_messages;
use crate::core::config::Config;
use crate::core::router::ModelRouter;
use crate::providers::openrouter::OpenRouterProvider;
use crate::state::AppState;
use crate::telemetry::metrics::Metrics;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_max_level(Level::INFO)
        .init();

    info!("Starting Claude Router");

    // Load configuration
    let config = Config::load().map_err(|e| {
        eprintln!("Failed to load configuration: {}", e);
        e
    })?;
    info!("Configuration loaded successfully");

    // Initialize provider
    let openrouter_provider = Arc::new(OpenRouterProvider::new(
        config.openrouter.api_key.clone(),
        config.openrouter.base_url.clone(),
    )) as Arc<dyn providers::traits::Provider>;

    // Initialize router
    let mut router = ModelRouter::new(config.clone());
    router.add_provider("openrouter", openrouter_provider);

    // Create shared state
    let shared_state = Arc::new(RwLock::new(router));

    // Create application state
    let app_state = AppState {
        router: shared_state,
        metrics: Arc::new(Metrics::new()),
    };

    // Build our application with a route
    let app = Router::new()
        .route("/v1/messages", post(handle_messages))
        .route("/health", get(health_check))
        .with_state(app_state);

    // Run our app with hyper
    info!("Listening on {}:{}", config.server.host, config.server.port);

    axum::serve(
        tokio::net::TcpListener::bind(&format!("{}:{}", config.server.host, config.server.port)).await?,
        app
    )
    .await?;

    Ok(())
}

/// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}
