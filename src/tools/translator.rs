//! Tool translator for converting between different provider tool formats
//!
//! Not currently wired into the live path: Claude Code and OpenRouter's
//! OpenAI-compatible function calling both identify tools by the same
//! name/schema, so no renaming is needed between them - the translation
//! that actually matters (Anthropic tool_use/tool_result blocks <->
//! OpenAI-style tool_calls/tool-role messages) is handled directly in
//! `providers::openrouter`. Kept as a standalone utility for a future
//! provider that genuinely needs name/argument remapping.
#![allow(dead_code)]
use serde_json::Value;
use std::collections::HashMap;

/// Configuration for tool translation
#[derive(Debug, Clone)]
pub struct ToolTranslationConfig {
    /// Mapping from provider tool names to anthropic tool names
    pub anthropic_mapping: HashMap<String, String>,
    /// Mapping from anthropic tool names to provider tool names
    pub provider_mapping: HashMap<String, String>,
    /// Argument mappings for specific tools
    pub argument_mappings: HashMap<String, HashMap<String, String>>,
}

/// Tool translator for converting between provider formats
pub struct ToolTranslator {
    config: ToolTranslationConfig,
}

impl ToolTranslator {
    /// Create a new tool translator with default configuration
    pub fn new() -> Self {
        let config = Self::default_config();
        Self::with_config(config)
    }

    /// Create a new tool translator with custom configuration
    pub fn with_config(config: ToolTranslationConfig) -> Self {
        Self { config }
    }

    /// Create default tool translation configuration
    fn default_config() -> ToolTranslationConfig {
        let mut anthropic_mapping = HashMap::new();
        let mut provider_mapping = HashMap::new();
        let mut argument_mappings = HashMap::new();

        // Provider to Anthropic mappings
        anthropic_mapping.insert("terminal".to_string(), "bash".to_string());
        anthropic_mapping.insert("file_operation".to_string(), "file_editor".to_string());
        anthropic_mapping.insert("python".to_string(), "python_interpreter".to_string());
        anthropic_mapping.insert("http_request".to_string(), "web_search".to_string());

        // Create reverse mapping
        for (provider_tool, anthropic_tool) in &anthropic_mapping {
            provider_mapping.insert(anthropic_tool.clone(), provider_tool.clone());
        }

        // Argument mappings
        let mut terminal_args = HashMap::new();
        terminal_args.insert("cmd".to_string(), "command".to_string());
        argument_mappings.insert("terminal".to_string(), terminal_args);

        let mut bash_args = HashMap::new();
        bash_args.insert("command".to_string(), "cmd".to_string());
        argument_mappings.insert("bash".to_string(), bash_args);

        let mut file_op_args = HashMap::new();
        file_op_args.insert("operation".to_string(), "action".to_string());
        file_op_args.insert("file_path".to_string(), "path".to_string());
        argument_mappings.insert("file_operation".to_string(), file_op_args);

        let mut file_editor_args = HashMap::new();
        file_editor_args.insert("action".to_string(), "operation".to_string());
        file_editor_args.insert("path".to_string(), "file_path".to_string());
        argument_mappings.insert("file_editor".to_string(), file_editor_args);

        ToolTranslationConfig {
            anthropic_mapping,
            provider_mapping,
            argument_mappings,
        }
    }

    /// Translate tool call from provider format to Anthropic format
    pub fn translate_to_anthropic(&self, tool_name: &str, arguments: &Value) -> (String, Value) {
        let translated_name = self
            .config
            .anthropic_mapping
            .get(tool_name)
            .unwrap_or(&tool_name.to_string())
            .clone();

        let translated_args = self.translate_arguments_to_anthropic(tool_name, arguments);

        (translated_name, translated_args)
    }

    /// Translate tool call from Anthropic format to provider format
    pub fn translate_to_provider(&self, tool_name: &str, arguments: &Value) -> (String, Value) {
        let translated_name = self
            .config
            .provider_mapping
            .get(tool_name)
            .unwrap_or(&tool_name.to_string())
            .clone();

        let translated_args = self.translate_arguments_to_provider(tool_name, arguments);

        (translated_name, translated_args)
    }

    /// Translate arguments to Anthropic format
    fn translate_arguments_to_anthropic(&self, tool_name: &str, arguments: &Value) -> Value {
        // Check if we have specific argument mappings for this tool
        if let Some(arg_mapping) = self.config.argument_mappings.get(tool_name) {
            if let Some(obj) = arguments.as_object() {
                let mut new_obj = serde_json::Map::new();
                for (key, value) in obj {
                    // Map the key if we have a mapping, otherwise keep it as is
                    let new_key = arg_mapping.get(key).unwrap_or(key);
                    new_obj.insert(new_key.clone(), value.clone());
                }
                return Value::Object(new_obj);
            }
        }
        arguments.clone()
    }

    /// Translate arguments to provider format
    fn translate_arguments_to_provider(&self, tool_name: &str, arguments: &Value) -> Value {
        // Check if we have specific argument mappings for this tool. Note
        // this map (e.g. argument_mappings["bash"]) is already stored in the
        // anthropic->provider direction, so - unlike the name mapping - this
        // is a direct lookup, not a reverse one.
        if let Some(arg_mapping) = self.config.argument_mappings.get(tool_name) {
            if let Some(obj) = arguments.as_object() {
                let mut new_obj = serde_json::Map::new();
                for (key, value) in obj {
                    let new_key = arg_mapping.get(key).unwrap_or(key);
                    new_obj.insert(new_key.clone(), value.clone());
                }
                return Value::Object(new_obj);
            }
        }
        arguments.clone()
    }

    /// Add a new tool mapping
    pub fn add_tool_mapping(&mut self, provider_tool: &str, anthropic_tool: &str) {
        self.config.anthropic_mapping.insert(provider_tool.to_string(), anthropic_tool.to_string());
        self.config.provider_mapping.insert(anthropic_tool.to_string(), provider_tool.to_string());
    }

    /// Add argument mapping for a tool
    pub fn add_argument_mapping(&mut self, tool_name: &str, provider_arg: &str, anthropic_arg: &str) {
        self.config.argument_mappings
            .entry(tool_name.to_string())
            .or_insert_with(HashMap::new)
            .insert(provider_arg.to_string(), anthropic_arg.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_tool_translation() {
        let translator = ToolTranslator::new();

        // Test translation from provider to Anthropic
        let (name, args) = translator.translate_to_anthropic(
            "terminal",
            &json!({"cmd": "cargo build"})
        );
        assert_eq!(name, "bash");
        assert_eq!(args, json!({"command": "cargo build"}));

        // Test translation from Anthropic to provider
        let (name, args) = translator.translate_to_provider(
            "bash",
            &json!({"command": "cargo build"})
        );
        assert_eq!(name, "terminal");
        assert_eq!(args, json!({"cmd": "cargo build"}));
    }

    #[test]
    fn test_file_operation_translation() {
        let translator = ToolTranslator::new();

        // Test file operation translation
        let (name, args) = translator.translate_to_anthropic(
            "file_operation",
            &json!({"operation": "read", "file_path": "/path/to/file"})
        );
        assert_eq!(name, "file_editor");
        assert_eq!(args, json!({"action": "read", "path": "/path/to/file"}));
    }

    #[test]
    fn test_dynamic_mapping() {
        let mut translator = ToolTranslator::new();
        translator.add_tool_mapping("custom_tool", "new_tool");
        translator.add_argument_mapping("custom_tool", "input", "data");

        let (name, args) = translator.translate_to_anthropic(
            "custom_tool",
            &json!({"input": "test data"})
        );
        assert_eq!(name, "new_tool");
        assert_eq!(args, json!({"data": "test data"}));
    }
}