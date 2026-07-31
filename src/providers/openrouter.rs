//! OpenRouter client implementation
//!
//! OpenRouter exposes an OpenAI-compatible `/chat/completions` endpoint, which
//! has a notably different wire shape than the Anthropic API: assistant
//! `content` is a plain string (or `null` when the reply is only tool calls),
//! tool calls live in a separate `tool_calls` array, and tool *results* are
//! their own `tool`-role messages rather than content blocks embedded in a
//! user message. All of the conversion logic below exists to bridge that gap.
use crate::errors::ProviderError;
use crate::providers::traits::{
    CompletionRequest, CompletionResponse, ContentBlock, Delta, Message, Provider, ToolCallDelta,
    ToolChoice,
};
use crate::utils::json_repair::JsonRepair;
use anyhow::Result;
use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::{self, BoxStream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;

// ---------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------

/// OpenRouter chat completion request
#[derive(Debug, Clone, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<OpenRouterMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<OpenRouterTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<Value>,
}

/// OpenRouter message structure. Different roles use different subsets of
/// these fields: `tool` messages carry `tool_call_id`; assistant messages
/// that invoked tools carry `tool_calls` (and may omit `content` entirely).
#[derive(Debug, Clone, Serialize)]
struct OpenRouterMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<OpenRouterContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenRouterRequestToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum OpenRouterContent {
    Text(String),
    Parts(Vec<OpenRouterContentPart>),
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum OpenRouterContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageSource },
}

#[derive(Debug, Clone, Serialize)]
struct ImageSource {
    url: String,
}

#[derive(Debug, Clone, Serialize)]
struct OpenRouterRequestToolCall {
    id: String,
    r#type: String,
    function: OpenRouterRequestFunctionCall,
}

#[derive(Debug, Clone, Serialize)]
struct OpenRouterRequestFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Clone, Serialize)]
struct OpenRouterTool {
    r#type: String,
    function: OpenRouterToolFunction,
}

#[derive(Debug, Clone, Serialize)]
struct OpenRouterToolFunction {
    name: String,
    description: String,
    parameters: Value,
}

/// Convert one internal message into zero or more OpenRouter messages.
fn convert_message(msg: &Message) -> Vec<OpenRouterMessage> {
    let mut parts: Vec<OpenRouterContentPart> = Vec::new();
    let mut tool_calls: Vec<OpenRouterRequestToolCall> = Vec::new();
    let mut tool_results: Vec<OpenRouterMessage> = Vec::new();
    let mut has_image = false;

    for block in &msg.content {
        match block.content_type.as_str() {
            "image" => {
                has_image = true;
                if let Some(source) = &block.source {
                    parts.push(OpenRouterContentPart::ImageUrl {
                        image_url: ImageSource {
                            url: format!("data:{};base64,{}", source.media_type, source.data),
                        },
                    });
                }
            }
            "tool_use" => {
                tool_calls.push(OpenRouterRequestToolCall {
                    id: block.id.clone().unwrap_or_default(),
                    r#type: "function".to_string(),
                    function: OpenRouterRequestFunctionCall {
                        name: block.name.clone().unwrap_or_default(),
                        arguments: block
                            .input
                            .as_ref()
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "{}".to_string()),
                    },
                });
            }
            "tool_result" => {
                let mut content = block.text.clone().unwrap_or_default();
                if block.is_error.unwrap_or(false) {
                    content = format!("Error: {}", content);
                }
                tool_results.push(OpenRouterMessage {
                    role: "tool".to_string(),
                    content: Some(OpenRouterContent::Text(content)),
                    tool_calls: None,
                    tool_call_id: block.tool_use_id.clone(),
                });
            }
            // "text" and anything else we don't specially recognize
            _ => {
                if let Some(text) = &block.text {
                    parts.push(OpenRouterContentPart::Text { text: text.clone() });
                }
            }
        }
    }

    let mut messages = Vec::new();

    if !parts.is_empty() || !tool_calls.is_empty() {
        let content = if parts.is_empty() {
            None
        } else if has_image {
            Some(OpenRouterContent::Parts(parts))
        } else {
            // Plain-text-only messages are sent as a bare string for
            // maximum compatibility with models that reject array content.
            let joined = parts
                .into_iter()
                .filter_map(|p| match p {
                    OpenRouterContentPart::Text { text } => Some(text),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            Some(OpenRouterContent::Text(joined))
        };

        messages.push(OpenRouterMessage {
            role: msg.role.clone(),
            content,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            tool_call_id: None,
        });
    }

    messages.extend(tool_results);
    messages
}

// ---------------------------------------------------------------------
// Non-streaming response types
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct ChatCompletionResponse {
    id: String,
    model: String,
    choices: Vec<ResponseChoice>,
    usage: Option<ResponseUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseChoice {
    index: u32,
    message: Option<ResponseMessage>,
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseMessage {
    /// Plain string (or absent/null when the reply is only tool calls) -
    /// NOT an array of content blocks like the Anthropic API.
    content: Option<String>,
    tool_calls: Option<Vec<ResponseToolCall>>,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseToolCall {
    id: String,
    function: ResponseFunctionCall,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ResponseUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

// ---------------------------------------------------------------------
// Streaming response types (OpenAI-style SSE chunks)
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct StreamChunk {
    id: String,
    model: String,
    choices: Vec<StreamChoice>,
    usage: Option<ResponseUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamChoice {
    index: u32,
    #[serde(default)]
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct StreamDelta {
    role: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<StreamToolCallDelta>>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamToolCallDelta {
    index: usize,
    id: Option<String>,
    function: Option<StreamFunctionDelta>,
}

#[derive(Debug, Clone, Deserialize)]
struct StreamFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

fn convert_stream_chunk(chunk: StreamChunk) -> CompletionResponse {
    let choices = chunk
        .choices
        .into_iter()
        .map(|choice| {
            let tool_calls = choice.delta.tool_calls.map(|tcs| {
                tcs.into_iter()
                    .map(|tc| ToolCallDelta {
                        index: tc.index,
                        id: tc.id,
                        name: tc.function.as_ref().and_then(|f| f.name.clone()),
                        arguments: tc.function.and_then(|f| f.arguments),
                    })
                    .collect()
            });

            crate::providers::traits::Choice {
                index: choice.index,
                message: None,
                delta: Some(Delta {
                    role: choice.delta.role,
                    content: choice.delta.content,
                    tool_calls,
                }),
                finish_reason: choice.finish_reason,
            }
        })
        .collect();

    CompletionResponse {
        id: chunk.id,
        model: chunk.model,
        choices,
        usage: chunk.usage.map(|u| crate::providers::traits::Usage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
        }),
    }
}

/// Incremental state for parsing an SSE byte stream into complete `data:`
/// payloads, since chunks can split lines (or even a single line) arbitrarily.
struct SseState {
    inner: BoxStream<'static, Result<Bytes>>,
    buf: String,
    pending: VecDeque<String>,
    done: bool,
}

/// OpenRouter provider implementation
pub struct OpenRouterProvider {
    client: Client,
    api_key: String,
    base_url: String,
    json_repair: JsonRepair,
}

impl OpenRouterProvider {
    /// Create a new OpenRouter provider
    pub fn new(api_key: String, base_url: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            api_key,
            base_url,
            json_repair: JsonRepair::new(3),
        }
    }

    /// Convert our internal request to OpenRouter format
    fn convert_request(&self, request: &CompletionRequest) -> ChatCompletionRequest {
        let messages = request.messages.iter().flat_map(convert_message).collect();

        let tools = request.tools.as_ref().map(|tools| {
            tools
                .iter()
                .map(|tool| OpenRouterTool {
                    r#type: "function".to_string(),
                    function: OpenRouterToolFunction {
                        name: tool.name.clone(),
                        description: tool.description.clone(),
                        parameters: tool.input_schema.clone(),
                    },
                })
                .collect()
        });

        let tool_choice = request.tool_choice.as_ref().map(|tc| match tc {
            ToolChoice::Auto => Value::String("auto".to_string()),
            ToolChoice::Any => Value::String("required".to_string()),
            ToolChoice::Tool(name) => serde_json::json!({
                "type": "function",
                "function": { "name": name }
            }),
        });

        ChatCompletionRequest {
            model: request.model.clone(),
            messages,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            stream: request.stream,
            tools,
            tool_choice,
        }
    }

    /// Convert OpenRouter response to our internal format, repairing
    /// malformed tool-call argument JSON along the way (flaky models
    /// occasionally emit near-miss JSON for function arguments).
    fn convert_response(&self, response: ChatCompletionResponse) -> CompletionResponse {
        let choices = response
            .choices
            .into_iter()
            .map(|choice| {
                let message = choice.message.map(|msg| {
                    let mut content = Vec::new();

                    if let Some(text) = msg.content {
                        if !text.is_empty() {
                            content.push(ContentBlock {
                                content_type: "text".to_string(),
                                text: Some(text),
                                source: None,
                                id: None,
                                name: None,
                                input: None,
                                tool_use_id: None,
                                is_error: None,
                            });
                        }
                    }

                    if let Some(tool_calls) = msg.tool_calls {
                        for tc in tool_calls {
                            let input = self
                                .json_repair
                                .parse_with_repair(&tc.function.arguments)
                                .unwrap_or_else(|_| Value::Object(Default::default()));

                            content.push(ContentBlock {
                                content_type: "tool_use".to_string(),
                                text: None,
                                source: None,
                                id: Some(tc.id),
                                name: Some(tc.function.name),
                                input: Some(input),
                                tool_use_id: None,
                                is_error: None,
                            });
                        }
                    }

                    Message {
                        role: "assistant".to_string(),
                        content,
                    }
                });

                crate::providers::traits::Choice {
                    index: choice.index,
                    message,
                    delta: None,
                    finish_reason: choice.finish_reason,
                }
            })
            .collect();

        CompletionResponse {
            id: response.id,
            model: response.model,
            choices,
            usage: response.usage.map(|usage| crate::providers::traits::Usage {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            }),
        }
    }
}

#[async_trait]
impl Provider for OpenRouterProvider {
    fn name(&self) -> &str {
        "openrouter"
    }

    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse> {
        let mut openrouter_request = self.convert_request(&request);
        openrouter_request.stream = Some(false);

        let url = format!("{}/chat/completions", self.base_url);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "https://github.com/anthropics/claude-code") // Required by OpenRouter
            .header("X-Title", "Claude Router") // Required by OpenRouter
            .json(&openrouter_request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(ProviderError::new(
                "openrouter",
                format!("API error ({}): {}", status, error_text),
            )
            .into());
        }

        let openrouter_response: ChatCompletionResponse = response.json().await?;
        Ok(self.convert_response(openrouter_response))
    }

    async fn stream_complete(
        &self,
        request: CompletionRequest,
    ) -> Result<BoxStream<'static, Result<CompletionResponse>>> {
        let mut openrouter_request = self.convert_request(&request);
        openrouter_request.stream = Some(true);

        let url = format!("{}/chat/completions", self.base_url);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "https://github.com/anthropics/claude-code") // Required by OpenRouter
            .header("X-Title", "Claude Router") // Required by OpenRouter
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .json(&openrouter_request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(ProviderError::new(
                "openrouter",
                format!("API error ({}): {}", status, error_text),
            )
            .into());
        }

        let byte_stream = response
            .bytes_stream()
            .map(|r| r.map_err(anyhow::Error::from))
            .boxed();

        let state = SseState {
            inner: byte_stream,
            buf: String::new(),
            pending: VecDeque::new(),
            done: false,
        };

        let stream = stream::unfold(state, |mut state| async move {
            loop {
                if let Some(data) = state.pending.pop_front() {
                    if data == "[DONE]" {
                        state.done = true;
                        continue;
                    }
                    if data.is_empty() {
                        continue;
                    }
                    return match serde_json::from_str::<StreamChunk>(&data) {
                        Ok(chunk) => Some((Ok(convert_stream_chunk(chunk)), state)),
                        Err(e) => Some((
                            Err(anyhow::anyhow!(
                                "Failed to parse OpenRouter stream chunk: {} ({})",
                                e,
                                data
                            )),
                            state,
                        )),
                    };
                }

                if state.done {
                    return None;
                }

                match state.inner.next().await {
                    Some(Ok(bytes)) => {
                        state.buf.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = state.buf.find("\n\n") {
                            let event: String = state.buf.drain(..pos + 2).collect();
                            for line in event.lines() {
                                let line = line.trim_end_matches('\r');
                                if let Some(rest) = line.strip_prefix("data:") {
                                    state.pending.push_back(rest.trim().to_string());
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        state.done = true;
                        return Some((Err(e), state));
                    }
                    None => {
                        state.done = true;
                    }
                }
            }
        });

        Ok(Box::pin(stream))
    }

    fn supports_tools(&self) -> bool {
        true
    }

    fn supports_streams(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_creation() {
        let provider = OpenRouterProvider::new(
            "test_key".to_string(),
            "https://openrouter.ai/api/v1".to_string(),
        );
        assert_eq!(provider.name(), "openrouter");
    }

    #[test]
    fn test_convert_message_plain_text() {
        let msg = Message {
            role: "user".to_string(),
            content: vec![ContentBlock {
                content_type: "text".to_string(),
                text: Some("hello".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: None,
                is_error: None,
            }],
        };

        let converted = convert_message(&msg);
        assert_eq!(converted.len(), 1);
        match &converted[0].content {
            Some(OpenRouterContent::Text(text)) => assert_eq!(text, "hello"),
            _ => panic!("expected plain text content"),
        }
    }

    #[test]
    fn test_convert_message_tool_use() {
        let msg = Message {
            role: "assistant".to_string(),
            content: vec![ContentBlock {
                content_type: "tool_use".to_string(),
                text: None,
                source: None,
                id: Some("call_1".to_string()),
                name: Some("get_weather".to_string()),
                input: Some(serde_json::json!({"city": "NYC"})),
                tool_use_id: None,
                is_error: None,
            }],
        };

        let converted = convert_message(&msg);
        assert_eq!(converted.len(), 1);
        let tool_calls = converted[0].tool_calls.as_ref().unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "call_1");
        assert_eq!(tool_calls[0].function.name, "get_weather");
    }

    #[test]
    fn test_convert_message_tool_result_becomes_tool_message() {
        let msg = Message {
            role: "user".to_string(),
            content: vec![ContentBlock {
                content_type: "tool_result".to_string(),
                text: Some("sunny".to_string()),
                source: None,
                id: None,
                name: None,
                input: None,
                tool_use_id: Some("call_1".to_string()),
                is_error: None,
            }],
        };

        let converted = convert_message(&msg);
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].role, "tool");
        assert_eq!(converted[0].tool_call_id, Some("call_1".to_string()));
    }
}
