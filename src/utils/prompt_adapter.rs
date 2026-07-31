//! Prompt adapters for optimizing prompts for different providers
//!
//! `PromptAdapter::new`/`adapt_prompt` are wired into `core::router::ModelRouter`.
//! The rest (runtime reconfiguration, registering extra adapters, per-adapter
//! `new()` constructors) is public API for callers who want to customize
//! adapters beyond the router's defaults, hence the blanket allow.
#![allow(dead_code)]
use crate::providers::traits::Message;
use std::collections::HashMap;

/// Configuration for prompt adapters
#[derive(Debug, Clone)]
pub struct PromptAdapterConfig {
    /// Whether to add reasoning instructions for DeepSeek models
    pub deepseek_reasoning: bool,
    /// Whether to enforce JSON format for Qwen models
    pub qwen_json_format: bool,
    /// Whether to encourage function calling for OpenAI models
    pub openai_functions: bool,
    /// Custom instructions for different providers
    pub custom_instructions: HashMap<String, String>,
}

/// Prompt adapter for customizing prompts for different providers
pub struct PromptAdapter {
    config: PromptAdapterConfig,
    adapters: HashMap<String, Box<dyn ProviderAdapter>>,
}

impl PromptAdapter {
    /// Create a new prompt adapter with default configuration
    pub fn new() -> Self {
        let config = Self::default_config();
        Self::with_config(config)
    }

    /// Create a new prompt adapter with custom configuration
    pub fn with_config(config: PromptAdapterConfig) -> Self {
        let mut adapters: HashMap<String, Box<dyn ProviderAdapter>> = HashMap::new();

        // Register adapters for different providers
        adapters.insert("deepseek".to_string(), Box::new(DeepSeekAdapter::with_config(config.deepseek_reasoning)));
        adapters.insert("qwen".to_string(), Box::new(QwenAdapter::with_config(config.qwen_json_format)));
        adapters.insert("openai".to_string(), Box::new(OpenAIAdapter::with_config(config.openai_functions)));

        Self { config, adapters }
    }

    /// Create default prompt adapter configuration
    fn default_config() -> PromptAdapterConfig {
        let mut custom_instructions = HashMap::new();
        custom_instructions.insert("deepseek".to_string(), "Please think through this step by step and explain your reasoning.".to_string());
        custom_instructions.insert("qwen".to_string(), "Provide your response in valid JSON format.".to_string());
        custom_instructions.insert("openai".to_string(), "Feel free to use functions when appropriate to complete the task.".to_string());

        PromptAdapterConfig {
            deepseek_reasoning: true,
            qwen_json_format: true,
            openai_functions: true,
            custom_instructions,
        }
    }

    /// Adapt prompt for a specific provider
    pub fn adapt_prompt(&self, provider_name: &str, messages: Vec<Message>) -> Vec<Message> {
        if let Some(adapter) = self.adapters.get(provider_name) {
            adapter.adapt_messages(messages)
        } else {
            // Return original messages if no adapter found
            messages
        }
    }

    /// Get list of supported providers
    pub fn supported_providers(&self) -> Vec<String> {
        self.adapters.keys().cloned().collect()
    }

    /// Add a custom adapter
    pub fn add_adapter(&mut self, provider_name: String, adapter: Box<dyn ProviderAdapter>) {
        self.adapters.insert(provider_name, adapter);
    }

    /// Update configuration
    pub fn update_config(&mut self, config: PromptAdapterConfig) {
        self.config = config.clone();
        // Rebuild adapters with new configuration
        self.adapters.clear();
        self.adapters.insert("deepseek".to_string(), Box::new(DeepSeekAdapter::with_config(config.deepseek_reasoning)));
        self.adapters.insert("qwen".to_string(), Box::new(QwenAdapter::with_config(config.qwen_json_format)));
        self.adapters.insert("openai".to_string(), Box::new(OpenAIAdapter::with_config(config.openai_functions)));
    }
}

/// Trait for provider-specific adapters
pub trait ProviderAdapter: Send + Sync {
    /// Adapt messages for this provider
    fn adapt_messages(&self, messages: Vec<Message>) -> Vec<Message>;

    /// Get provider name
    fn provider_name(&self) -> &str;
}

/// Adapter for DeepSeek models
pub struct DeepSeekAdapter {
    enable_reasoning: bool,
}

impl DeepSeekAdapter {
    pub fn new() -> Self {
        Self {
            enable_reasoning: true,
        }
    }

    pub fn with_config(enable_reasoning: bool) -> Self {
        Self {
            enable_reasoning,
        }
    }
}

impl ProviderAdapter for DeepSeekAdapter {
    fn adapt_messages(&self, messages: Vec<Message>) -> Vec<Message> {
        if !self.enable_reasoning {
            return messages;
        }

        // DeepSeek benefits from explicit reasoning instructions
        let mut adapted_messages = messages.clone();

        // Add reasoning encouragement to system message or first message
        if let Some(first_message) = adapted_messages.first_mut() {
            if first_message.role == "system" {
                if let Some(first_content) = first_message.content.first_mut() {
                    if let Some(ref mut text) = first_content.text {
                        text.push_str("\n\nPlease think through this step by step and explain your reasoning.");
                    }
                }
            }
        }

        adapted_messages
    }

    fn provider_name(&self) -> &str {
        "deepseek"
    }
}

/// Adapter for Qwen models
pub struct QwenAdapter {
    enable_json_format: bool,
}

impl QwenAdapter {
    pub fn new() -> Self {
        Self {
            enable_json_format: true,
        }
    }

    pub fn with_config(enable_json_format: bool) -> Self {
        Self {
            enable_json_format,
        }
    }
}

impl ProviderAdapter for QwenAdapter {
    fn adapt_messages(&self, messages: Vec<Message>) -> Vec<Message> {
        if !self.enable_json_format {
            return messages;
        }

        // Qwen benefits from structured and concise prompts
        let mut adapted_messages = messages.clone();

        // Encourage valid JSON responses
        if let Some(first_message) = adapted_messages.first_mut() {
            if first_message.role == "system" {
                if let Some(first_content) = first_message.content.first_mut() {
                    if let Some(ref mut text) = first_content.text {
                        text.push_str("\n\nProvide your response in valid JSON format.");
                    }
                }
            }
        }

        adapted_messages
    }

    fn provider_name(&self) -> &str {
        "qwen"
    }
}

/// Adapter for OpenAI models
pub struct OpenAIAdapter {
    enable_functions: bool,
}

impl OpenAIAdapter {
    pub fn new() -> Self {
        Self {
            enable_functions: true,
        }
    }

    pub fn with_config(enable_functions: bool) -> Self {
        Self {
            enable_functions,
        }
    }
}

impl ProviderAdapter for OpenAIAdapter {
    fn adapt_messages(&self, messages: Vec<Message>) -> Vec<Message> {
        if !self.enable_functions {
            return messages;
        }

        // OpenAI models work well with function calling instructions
        let mut adapted_messages = messages.clone();

        // Add function calling encouragement to system message
        if let Some(first_message) = adapted_messages.first_mut() {
            if first_message.role == "system" {
                if let Some(first_content) = first_message.content.first_mut() {
                    if let Some(ref mut text) = first_content.text {
                        text.push_str("\n\nFeel free to use functions when appropriate to complete the task.");
                    }
                }
            }
        }

        adapted_messages
    }

    fn provider_name(&self) -> &str {
        "openai"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::traits::{ContentBlock, Message};

    #[test]
    fn test_prompt_adapter_creation() {
        let adapter = PromptAdapter::new();
        assert!(!adapter.supported_providers().is_empty());
    }

    #[test]
    fn test_deepseek_adapter() {
        let adapter = DeepSeekAdapter::new();
        let messages = vec![Message {
            role: "system".to_string(),
            content: vec![ContentBlock {
                content_type: "text".to_string(),
                text: Some("You are a helpful assistant.".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                is_error: None,
            }],
        }];

        let adapted = adapter.adapt_messages(messages);
        assert!(!adapted.is_empty());
    }

    #[test]
    fn test_qwen_adapter() {
        let adapter = QwenAdapter::new();
        let messages = vec![Message {
            role: "system".to_string(),
            content: vec![ContentBlock {
                content_type: "text".to_string(),
                text: Some("You are a helpful assistant.".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                is_error: None,
            }],
        }];

        let adapted = adapter.adapt_messages(messages);
        assert!(!adapted.is_empty());

        // Check that JSON instruction was added
        if let Some(first_message) = adapted.first() {
            if let Some(first_content) = first_message.content.first() {
                if let Some(ref text) = first_content.text {
                    assert!(text.contains("JSON"));
                }
            }
        }
    }

    #[test]
    fn test_openai_adapter() {
        let adapter = OpenAIAdapter::new();
        let messages = vec![Message {
            role: "system".to_string(),
            content: vec![ContentBlock {
                content_type: "text".to_string(),
                text: Some("You are a helpful assistant.".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                is_error: None,
            }],
        }];

        let adapted = adapter.adapt_messages(messages);
        assert!(!adapted.is_empty());

        // Check that function calling instruction was added
        if let Some(first_message) = adapted.first() {
            if let Some(first_content) = first_message.content.first() {
                if let Some(ref text) = first_content.text {
                    assert!(text.contains("functions"));
                }
            }
        }
    }

    #[test]
    fn test_disabled_adapters() {
        let deepseek_adapter = DeepSeekAdapter::with_config(false);
        let qwen_adapter = QwenAdapter::with_config(false);
        let openai_adapter = OpenAIAdapter::with_config(false);

        let messages = vec![Message {
            role: "system".to_string(),
            content: vec![ContentBlock {
                content_type: "text".to_string(),
                text: Some("You are a helpful assistant.".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                is_error: None,
            }],
        }];

        // Disabled adapters should return original messages unchanged
        assert_eq!(deepseek_adapter.adapt_messages(messages.clone()), messages);
        assert_eq!(qwen_adapter.adapt_messages(messages.clone()), messages);
        assert_eq!(openai_adapter.adapt_messages(messages.clone()), messages);
    }

    #[test]
    fn test_prompt_adapter_with_config() {
        let mut config = PromptAdapter::default_config();
        config.deepseek_reasoning = false;

        let mut adapter = PromptAdapter::new();
        adapter.update_config(config);

        assert!(!adapter.supported_providers().is_empty());
    }
}