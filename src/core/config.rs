//! Configuration management for Claude Router
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

/// OpenRouter configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRouterConfig {
    pub api_key: String,
    pub base_url: String,
}

/// Role configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleConfig {
    pub model: String,
    pub description: Option<String>,
}

/// Routing rule configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub pattern: String,
    pub role: String,
    pub description: Option<String>,
}

/// Telemetry configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryConfig {
    pub enabled: bool,
    pub metrics_file: String,
    pub log_level: String,
}

/// Routing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingConfig {
    pub rules: Vec<RoutingRule>,
}

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub openrouter: OpenRouterConfig,
    pub roles: HashMap<String, RoleConfig>,
    pub routing: RoutingConfig,
    pub default_role: String,
    pub telemetry: TelemetryConfig,
}

impl Config {
    /// Load configuration from a YAML file
    pub fn from_file(path: &str) -> Result<Self> {
        let contents = fs::read_to_string(path)?;
        let mut config: Config = serde_yaml::from_str(&contents)?;

        // Environment variable always wins over whatever is checked into the file,
        // so a real key never has to live in a tracked config file.
        if let Ok(api_key) = std::env::var("OPENROUTER_API_KEY") {
            config.openrouter.api_key = api_key;
        }

        Ok(config)
    }

    /// Load configuration, preferring a local `config/config.yaml` and
    /// falling back to the tracked `config/default.yaml` template.
    pub fn load() -> Result<Self> {
        if std::path::Path::new("config/config.yaml").exists() {
            Self::from_file("config/config.yaml")
        } else {
            Self::from_file("config/default.yaml")
        }
    }

    /// Get the model name for a given role
    pub fn get_model_for_role(&self, role: &str) -> Option<String> {
        self.roles.get(role).map(|r| r.model.clone())
    }

    /// Get the default role
    pub fn get_default_role(&self) -> String {
        self.default_role.clone()
    }

    /// Get routing rules
    pub fn get_routing_rules(&self) -> &Vec<RoutingRule> {
        &self.routing.rules
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_loading() {
        // This would require a test config file
        // let config = Config::load().expect("Failed to load config");
        // assert_eq!(config.server.host, "127.0.0.1");
    }
}