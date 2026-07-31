//! Provider trait definitions for Claude Router
use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Common completion request structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stream: Option<bool>,
    pub tools: Option<Vec<Tool>>,
    pub tool_choice: Option<ToolChoice>,
}

/// How the model should decide whether to use a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolChoice {
    Auto,
    Any,
    Tool(String),
}

/// Message structure
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub role: String,
    pub content: Vec<ContentBlock>,
}

/// Content block structure
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
    pub source: Option<ContentSource>,
    /// tool_use: the tool call's id. tool_result: unused (see tool_use_id).
    pub id: Option<String>,
    /// tool_use: the tool's name.
    pub name: Option<String>,
    /// tool_use: the tool's input arguments.
    pub input: Option<serde_json::Value>,
    /// tool_result: the id of the tool_use this result answers.
    pub tool_use_id: Option<String>,
    /// tool_result: whether the tool execution errored.
    pub is_error: Option<bool>,
}

/// Content source structure
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

/// Tool structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Common completion response structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub id: String,
    pub model: String,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

/// Choice structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: Option<Message>,
    pub delta: Option<Delta>,
    pub finish_reason: Option<String>,
}

/// Delta structure for streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    pub role: Option<String>,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
}

/// A (possibly partial) tool call fragment as it arrives during streaming.
/// `id` and `name` are only present on the chunk that starts the tool call;
/// `arguments` arrives incrementally across many chunks and must be
/// accumulated by index by the caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// Usage structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Generic provider trait that all providers must implement
#[async_trait]
pub trait Provider: Send + Sync {
    /// Get the name of the provider
    fn name(&self) -> &str;

    /// Complete a request
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse>;

    /// Stream a completion request
    async fn stream_complete(&self, request: CompletionRequest) -> Result<futures::stream::BoxStream<'static, Result<CompletionResponse>>>;

    /// Check if provider supports tools
    fn supports_tools(&self) -> bool;

    /// Check if provider supports streaming
    fn supports_streams(&self) -> bool;
}