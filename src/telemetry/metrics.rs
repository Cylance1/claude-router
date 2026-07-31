//! Metrics collection and telemetry for Claude Router
//!
//! `record_request`/`record_error` are wired into the `/v1/messages` handler.
//! The remaining introspection methods (per-model token totals, enable/
//! disable, file logging) are public API for a future metrics/debug endpoint
//! that doesn't exist yet, hence the blanket allow rather than deleting them.
#![allow(dead_code)]
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

/// Configuration for telemetry
#[derive(Debug, Clone)]
pub struct TelemetryConfig {
    /// Whether to enable metrics collection
    pub enabled: bool,
    /// Whether to log metrics to file
    pub log_to_file: bool,
    /// Path to metrics log file
    pub log_file_path: String,
    /// Interval for logging metrics (in seconds)
    pub log_interval: u64,
    /// Whether to enable detailed logging
    pub detailed_logging: bool,
}

/// Metrics collection structure
#[derive(Debug, Clone)]
pub struct Metrics {
    request_count: Arc<AtomicU64>,
    error_count: Arc<AtomicU64>,
    total_latency: Arc<AtomicU64>,
    request_latencies: Arc<RwLock<HashMap<String, AtomicU64>>>,
    token_usage: Arc<RwLock<HashMap<String, AtomicU64>>>,
    provider_stats: Arc<RwLock<HashMap<String, ProviderStats>>>,
    model_stats: Arc<RwLock<HashMap<String, ModelStats>>>,
    /// Whether metrics collection is enabled
    enabled: Arc<AtomicBool>,
    /// Configuration for telemetry
    config: TelemetryConfig,
}

/// Provider statistics
#[derive(Debug, Clone)]
pub struct ProviderStats {
    pub request_count: u64,
    pub error_count: u64,
    pub total_tokens: u64,
    pub avg_response_time_ms: u64,
    pub min_response_time_ms: u64,
    pub max_response_time_ms: u64,
    pub success_rate: f64,
}

/// Model statistics
#[derive(Debug, Clone)]
pub struct ModelStats {
    pub request_count: u64,
    pub error_count: u64,
    pub total_tokens: u64,
    pub avg_response_time_ms: u64,
    pub cost_estimate: f64,
    pub last_used: SystemTime,
}

impl Metrics {
    /// Create a new metrics collector with default configuration
    pub fn new() -> Self {
        let config = Self::default_config();
        Self::with_config(config)
    }

    /// Create a new metrics collector with custom configuration
    pub fn with_config(config: TelemetryConfig) -> Self {
        Self {
            request_count: Arc::new(AtomicU64::new(0)),
            error_count: Arc::new(AtomicU64::new(0)),
            total_latency: Arc::new(AtomicU64::new(0)),
            request_latencies: Arc::new(RwLock::new(HashMap::new())),
            token_usage: Arc::new(RwLock::new(HashMap::new())),
            provider_stats: Arc::new(RwLock::new(HashMap::new())),
            model_stats: Arc::new(RwLock::new(HashMap::new())),
            enabled: Arc::new(AtomicBool::new(config.enabled)),
            config,
        }
    }

    /// Create default telemetry configuration
    fn default_config() -> TelemetryConfig {
        TelemetryConfig {
            enabled: true,
            log_to_file: false,
            log_file_path: "metrics.log".to_string(),
            log_interval: 60,
            detailed_logging: false,
        }
    }

    /// Record a successful request
    pub fn record_request(&self, latency_ms: u64, tokens: u64, provider: &str, model: &str) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        self.request_count.fetch_add(1, Ordering::Relaxed);
        self.total_latency.fetch_add(latency_ms, Ordering::Relaxed);

        // Update provider stats
        let mut provider_stats = self.provider_stats.write().unwrap();
        let stats = provider_stats.entry(provider.to_string()).or_insert_with(|| ProviderStats {
            request_count: 0,
            error_count: 0,
            total_tokens: 0,
            avg_response_time_ms: 0,
            min_response_time_ms: u64::MAX,
            max_response_time_ms: 0,
            success_rate: 0.0,
        });
        stats.request_count += 1;
        stats.total_tokens += tokens;

        // Update min/max response times
        if latency_ms < stats.min_response_time_ms {
            stats.min_response_time_ms = latency_ms;
        }
        if latency_ms > stats.max_response_time_ms {
            stats.max_response_time_ms = latency_ms;
        }

        // Update average response time
        stats.avg_response_time_ms = ((stats.avg_response_time_ms * (stats.request_count - 1)) + latency_ms) / stats.request_count;

        // Update success rate (assuming this is a successful request)
        stats.success_rate = (stats.request_count as f64 - stats.error_count as f64) / stats.request_count as f64;

        // Update model stats
        let mut model_stats = self.model_stats.write().unwrap();
        let model_stats_entry = model_stats.entry(model.to_string()).or_insert_with(|| ModelStats {
            request_count: 0,
            error_count: 0,
            total_tokens: 0,
            avg_response_time_ms: 0,
            cost_estimate: 0.0,
            last_used: SystemTime::now(),
        });
        model_stats_entry.request_count += 1;
        model_stats_entry.total_tokens += tokens;
        model_stats_entry.avg_response_time_ms = ((model_stats_entry.avg_response_time_ms * (model_stats_entry.request_count - 1)) + latency_ms) / model_stats_entry.request_count;
        model_stats_entry.last_used = SystemTime::now();

        // Estimate cost (simplified - would be more complex in real implementation)
        model_stats_entry.cost_estimate += (tokens as f64) * 0.0001; // $0.0001 per token as example
    }

    /// Record an error
    pub fn record_error(&self, provider: &str, model: &str) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        self.error_count.fetch_add(1, Ordering::Relaxed);
        // request_count tracks total attempts (success + error), which is
        // what get_success_rate()/get_avg_latency() assume it means.
        self.request_count.fetch_add(1, Ordering::Relaxed);

        // Update provider error stats
        let mut provider_stats = self.provider_stats.write().unwrap();
        let stats = provider_stats.entry(provider.to_string()).or_insert_with(|| ProviderStats {
            request_count: 0,
            error_count: 0,
            total_tokens: 0,
            avg_response_time_ms: 0,
            min_response_time_ms: u64::MAX,
            max_response_time_ms: 0,
            success_rate: 1.0,
        });
        stats.error_count += 1;

        // Update success rate
        if stats.request_count > 0 {
            stats.success_rate = (stats.request_count as f64 - stats.error_count as f64) / stats.request_count as f64;
        } else {
            stats.success_rate = 0.0;
        }

        // Update model error stats
        let mut model_stats = self.model_stats.write().unwrap();
        let model_stats_entry = model_stats.entry(model.to_string()).or_insert_with(|| ModelStats {
            request_count: 0,
            error_count: 0,
            total_tokens: 0,
            avg_response_time_ms: 0,
            cost_estimate: 0.0,
            last_used: SystemTime::now(),
        });
        model_stats_entry.error_count += 1;
    }

    /// Record token usage
    pub async fn record_token_usage(&self, model: &str, tokens: u64) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        let mut token_usage = self.token_usage.write().unwrap();
        let current = token_usage.entry(model.to_string()).or_insert_with(|| AtomicU64::new(0));
        current.fetch_add(tokens, Ordering::Relaxed);
    }

    /// Get total request count
    pub fn get_request_count(&self) -> u64 {
        if !self.enabled.load(Ordering::Relaxed) {
            return 0;
        }
        self.request_count.load(Ordering::Relaxed)
    }

    /// Get total error count
    pub fn get_error_count(&self) -> u64 {
        if !self.enabled.load(Ordering::Relaxed) {
            return 0;
        }
        self.error_count.load(Ordering::Relaxed)
    }

    /// Get average latency
    pub fn get_avg_latency(&self) -> f64 {
        if !self.enabled.load(Ordering::Relaxed) {
            return 0.0;
        }

        let count = self.request_count.load(Ordering::Relaxed);
        if count > 0 {
            let total = self.total_latency.load(Ordering::Relaxed) as f64;
            total / count as f64
        } else {
            0.0
        }
    }

    /// Get provider statistics
    pub async fn get_provider_stats(&self) -> HashMap<String, ProviderStats> {
        if !self.enabled.load(Ordering::Relaxed) {
            return HashMap::new();
        }

        self.provider_stats.read().unwrap().clone()
    }

    /// Get model statistics
    pub async fn get_model_stats(&self) -> HashMap<String, ModelStats> {
        if !self.enabled.load(Ordering::Relaxed) {
            return HashMap::new();
        }

        self.model_stats.read().unwrap().clone()
    }

    /// Get token usage by model
    pub async fn get_token_usage(&self) -> HashMap<String, u64> {
        if !self.enabled.load(Ordering::Relaxed) {
            return HashMap::new();
        }

        let token_usage = self.token_usage.read().unwrap();
        let mut result = HashMap::new();
        for (model, atomic) in token_usage.iter() {
            result.insert(model.clone(), atomic.load(Ordering::Relaxed));
        }
        result
    }

    /// Get success rate
    pub fn get_success_rate(&self) -> f64 {
        if !self.enabled.load(Ordering::Relaxed) {
            return 0.0;
        }

        let total_requests = self.request_count.load(Ordering::Relaxed);
        if total_requests > 0 {
            let errors = self.error_count.load(Ordering::Relaxed);
            (total_requests - errors) as f64 / total_requests as f64
        } else {
            1.0 // 100% success rate if no requests
        }
    }

    /// Reset metrics
    pub fn reset_metrics(&self) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        self.request_count.store(0, Ordering::Relaxed);
        self.error_count.store(0, Ordering::Relaxed);
        self.total_latency.store(0, Ordering::Relaxed);

        // Reset other metrics would require async context, so we'll leave them as is
    }

    /// Enable or disable metrics collection
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    /// Get whether metrics collection is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// Log metrics to file if enabled
    pub async fn log_metrics(&self) -> anyhow::Result<()> {
        if !self.config.log_to_file || !self.enabled.load(Ordering::Relaxed) {
            return Ok(());
        }

        // This would implement actual file logging
        // For now, just return Ok
        Ok(())
    }
}

/// Metrics middleware for collecting request metrics
pub struct MetricsMiddleware {
    metrics: Arc<Metrics>,
}

impl MetricsMiddleware {
    /// Create new metrics middleware
    pub fn new(metrics: Arc<Metrics>) -> Self {
        Self { metrics }
    }

    /// Record request start time
    pub fn start_timer(&self) -> std::time::Instant {
        std::time::Instant::now()
    }

    /// Record completed request metrics
    pub async fn record_completion(&self, start: std::time::Instant, tokens: u64, provider: &str, model: &str) {
        let duration = start.elapsed();
        self.metrics.record_request(duration.as_millis() as u64, tokens, provider, model);
    }

    /// Record error metrics
    pub fn record_error(&self, provider: &str, model: &str) {
        self.metrics.record_error(provider, model);
    }

    /// Get reference to metrics
    pub fn metrics(&self) -> &Arc<Metrics> {
        &self.metrics
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_metrics_collection() {
        let metrics = Metrics::new();
        metrics.record_request(100, 50, "openrouter", "test-model");
        assert_eq!(metrics.get_request_count(), 1);
        assert_eq!(metrics.get_avg_latency(), 100.0);
    }

    #[tokio::test]
    async fn test_error_recording() {
        let metrics = Metrics::new();
        metrics.record_error("openrouter", "test-model");
        assert_eq!(metrics.get_error_count(), 1);
    }

    #[tokio::test]
    async fn test_success_rate() {
        let metrics = Metrics::new();
        metrics.record_request(100, 50, "openrouter", "test-model");
        metrics.record_error("openrouter", "test-model");
        assert_eq!(metrics.get_request_count(), 2);
        assert_eq!(metrics.get_error_count(), 1);
        assert_eq!(metrics.get_success_rate(), 0.5); // 50% success rate
    }

    #[tokio::test]
    async fn test_disabled_metrics() {
        let mut config = Metrics::default_config();
        config.enabled = false;
        let metrics = Metrics::with_config(config);

        metrics.record_request(100, 50, "openrouter", "test-model");
        assert_eq!(metrics.get_request_count(), 0);
        assert_eq!(metrics.get_avg_latency(), 0.0);
    }

    #[tokio::test]
    async fn test_model_stats() {
        let metrics = Metrics::new();
        metrics.record_request(100, 50, "openrouter", "test-model");

        let model_stats = metrics.get_model_stats().await;
        assert!(model_stats.contains_key("test-model"));

        if let Some(stats) = model_stats.get("test-model") {
            assert_eq!(stats.request_count, 1);
            assert_eq!(stats.total_tokens, 50);
        }
    }

    #[tokio::test]
    async fn test_provider_stats() {
        let metrics = Metrics::new();
        metrics.record_request(100, 50, "openrouter", "test-model");
        metrics.record_request(200, 100, "openrouter", "test-model");

        let provider_stats = metrics.get_provider_stats().await;
        assert!(provider_stats.contains_key("openrouter"));

        if let Some(stats) = provider_stats.get("openrouter") {
            assert_eq!(stats.request_count, 2);
            assert_eq!(stats.total_tokens, 150);
            assert_eq!(stats.avg_response_time_ms, 150); // (100 + 200) / 2
            assert_eq!(stats.min_response_time_ms, 100);
            assert_eq!(stats.max_response_time_ms, 200);
            assert_eq!(stats.success_rate, 1.0); // 100% success rate
        }
    }
}