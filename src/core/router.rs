//! Model router for Claude Router
use crate::core::config::Config;
use crate::core::rules_engine::RulesEngine;
use crate::providers::traits::{Provider, CompletionRequest, CompletionResponse};
use crate::utils::prompt_adapter::PromptAdapter;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;

/// Model router responsible for routing requests to appropriate providers
#[derive(Clone)]
pub struct ModelRouter {
    config: Config,
    rules_engine: RulesEngine,
    providers: HashMap<String, Arc<dyn Provider>>,
    prompt_adapter: Arc<PromptAdapter>,
}

impl ModelRouter {
    /// Create a new model router
    pub fn new(config: Config) -> Self {
        let rules_engine = RulesEngine::new(config.clone());

        Self {
            config,
            rules_engine,
            providers: HashMap::new(),
            prompt_adapter: Arc::new(PromptAdapter::new()),
        }
    }

    /// Add a provider to the router
    pub fn add_provider(&mut self, name: &str, provider: Arc<dyn Provider>) {
        self.providers.insert(name.to_string(), provider);
    }

    /// Route a request to the appropriate provider based on role
    pub async fn route_request(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse> {
        // Select role based on request content
        let role = self.select_role(&request);

        // Get model for the role
        let model = self.resolve_model(&role);

        // Update request with the selected model
        let mut routed_request = request.clone();
        routed_request.model = model;

        // Adapt the prompt for the model family we're about to call
        routed_request.messages = self.prompt_adapter.adapt_prompt(
            Self::provider_family_for_model(&routed_request.model),
            routed_request.messages,
        );

        // Route to appropriate provider
        if let Some(provider) = self.providers.get("openrouter") {
            provider.complete(routed_request).await
        } else {
            Err(anyhow::anyhow!("No provider available for routing"))
        }
    }

    /// Route a streaming request to the appropriate provider based on role
    pub async fn route_stream_request(
        &self,
        request: CompletionRequest,
    ) -> Result<futures::stream::BoxStream<'static, Result<CompletionResponse>>> {
        // Select role based on request content
        let role = self.select_role(&request);

        // Get model for the role
        let model = self.resolve_model(&role);

        // Update request with the selected model
        let mut routed_request = request.clone();
        routed_request.model = model;
        routed_request.stream = Some(true);

        // Adapt the prompt for the model family we're about to call
        routed_request.messages = self.prompt_adapter.adapt_prompt(
            Self::provider_family_for_model(&routed_request.model),
            routed_request.messages,
        );

        // Route to appropriate provider
        if let Some(provider) = self.providers.get("openrouter") {
            provider.stream_complete(routed_request).await
        } else {
            Err(anyhow::anyhow!("No provider available for routing"))
        }
    }

    /// Resolve a role to a concrete model id, falling back to the default
    /// role's model (not the default role's *name*) if the role is unknown.
    fn resolve_model(&self, role: &str) -> String {
        self.get_model_for_role(role)
            .or_else(|| self.get_model_for_role(&self.config.get_default_role()))
            .unwrap_or_else(|| self.config.get_default_role())
    }

    /// Guess which prompt-adapter family a model id belongs to, based on
    /// the OpenRouter model slug (e.g. "deepseek/deepseek-r1").
    fn provider_family_for_model(model: &str) -> &'static str {
        let lower = model.to_lowercase();
        if lower.contains("deepseek") {
            "deepseek"
        } else if lower.contains("qwen") {
            "qwen"
        } else if lower.contains("gpt") || lower.contains("openai") {
            "openai"
        } else {
            "unknown"
        }
    }

    /// Select the appropriate role based on message content
    pub fn select_role(&self, request: &CompletionRequest) -> String {
        // Extract text content from messages for role selection
        let content: String = request.messages.iter()
            .flat_map(|msg| &msg.content)
            .filter_map(|block| block.text.as_ref())
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        self.rules_engine.select_role(&content)
    }

    /// Get the model name for a given role
    pub fn get_model_for_role(&self, role: &str) -> Option<String> {
        self.config.get_model_for_role(role)
    }

    /// Get all available roles
    pub fn get_roles(&self) -> Vec<String> {
        self.rules_engine.get_roles()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_creation() {
        // This would require mocking the config
        // let config = Config::load().expect("Failed to load config");
        // let router = ModelRouter::new(config);
        // assert!(true); // Placeholder
    }
}