//! Implementation of the Anthropic /v1/messages endpoint
use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive},
    response::{IntoResponse, Response, Sse},
};
use futures::stream::{self, BoxStream, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;

use crate::providers::traits::{
    CompletionRequest, CompletionResponse, ContentBlock as ProviderContentBlock,
    ContentSource as ProviderContentSource, Message as ProviderMessage, Tool as ProviderTool,
    ToolChoice as ProviderToolChoice,
};
use crate::state::AppState;

/// Request structure for the messages endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct MessagesRequest {
    /// The model that will complete your prompt
    pub model: Option<String>,

    /// Messages to send to the model
    pub messages: Vec<Message>,

    /// System prompt
    pub system: Option<String>,

    /// Sampling temperature
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    /// Maximum number of tokens to generate
    pub max_tokens: u32,

    /// Whether to stream the response
    #[serde(default)]
    pub stream: bool,

    /// Tools available to the model
    pub tools: Option<Vec<Tool>>,

    /// How to handle tool usage
    pub tool_choice: Option<ToolChoice>,
}

fn default_temperature() -> f32 {
    1.0
}

/// Message structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Message {
    pub role: String,
    pub content: Content,
}

/// Content enum for message content
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Content {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

/// Content block structure
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },

    #[serde(rename = "image")]
    Image { source: ContentSource },

    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: Option<bool>,
    },
}

/// Content source structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ContentSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

/// Tool structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    #[serde(rename = "input_schema")]
    pub input_schema: serde_json::Value,
}

/// Tool choice structure
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum ToolChoice {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "any")]
    Any,
    #[serde(rename = "tool")]
    Tool { name: String },
}

/// Response structure for the messages endpoint
#[derive(Debug, Clone, Serialize)]
pub struct MessagesResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub response_type: String,
    pub model: String,
    pub role: String,
    pub content: Vec<ContentBlock>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Usage,
}

/// Usage structure
#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Error response structure
#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    pub error: ErrorDetails,
}

/// Error details structure
#[derive(Debug, Clone, Serialize)]
pub struct ErrorDetails {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

/// Handle POST /v1/messages
pub async fn handle_messages(
    State(state): State<AppState>,
    Json(payload): Json<MessagesRequest>,
) -> Result<Response, StatusCode> {
    if payload.max_tokens == 0 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let completion_request = convert_to_completion_request(payload).map_err(|e| {
        tracing::error!("Failed to convert request: {:?}", e);
        StatusCode::BAD_REQUEST
    })?;

    let requested_model = completion_request.model.clone();
    let is_stream = completion_request.stream.unwrap_or(false);
    let start = std::time::Instant::now();

    if is_stream {
        let stream_result = {
            let router = state.router.read().await;
            router.route_stream_request(completion_request).await
        };

        match stream_result {
            Ok(stream) => {
                state.metrics.record_request(
                    start.elapsed().as_millis() as u64,
                    0,
                    "openrouter",
                    &requested_model,
                );
                Ok(handle_streaming_response(stream).into_response())
            }
            Err(e) => {
                tracing::error!("Failed to route streaming request: {:?}", e);
                state.metrics.record_error("openrouter", &requested_model);
                Ok(Json(create_error_response(&e.to_string(), "internal_error")).into_response())
            }
        }
    } else {
        let response_result = {
            let router = state.router.read().await;
            router.route_request(completion_request).await
        };

        match response_result {
            Ok(response) => {
                let tokens = response
                    .usage
                    .as_ref()
                    .map(|u| u.total_tokens as u64)
                    .unwrap_or(0);
                state.metrics.record_request(
                    start.elapsed().as_millis() as u64,
                    tokens,
                    "openrouter",
                    &response.model,
                );
                Ok(handle_regular_response(response).into_response())
            }
            Err(e) => {
                tracing::error!("Failed to route request: {:?}", e);
                state.metrics.record_error("openrouter", &requested_model);
                Ok(Json(create_error_response(&e.to_string(), "internal_error")).into_response())
            }
        }
    }
}

/// Convert Anthropic API request to internal completion request
fn convert_to_completion_request(
    request: MessagesRequest,
) -> Result<CompletionRequest, StatusCode> {
    let mut messages: Vec<ProviderMessage> = Vec::new();

    if let Some(system) = request.system {
        if !system.is_empty() {
            messages.push(ProviderMessage {
                role: "system".to_string(),
                content: vec![text_block(system)],
            });
        }
    }

    messages.extend(request.messages.into_iter().map(|msg| {
        let content_blocks = match msg.content {
            Content::Text(text) => vec![text_block(text)],
            Content::Blocks(blocks) => {
                blocks.into_iter().map(convert_anthropic_block).collect()
            }
        };

        ProviderMessage {
            role: msg.role,
            content: content_blocks,
        }
    }));

    let tools = request.tools.map(|tools| {
        tools
            .into_iter()
            .map(|tool| ProviderTool {
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
            })
            .collect()
    });

    let tool_choice = request.tool_choice.map(|tc| match tc {
        ToolChoice::Auto => ProviderToolChoice::Auto,
        ToolChoice::Any => ProviderToolChoice::Any,
        ToolChoice::Tool { name } => ProviderToolChoice::Tool(name),
    });

    Ok(CompletionRequest {
        model: request.model.unwrap_or_default(),
        messages,
        temperature: Some(request.temperature),
        max_tokens: Some(request.max_tokens),
        stream: Some(request.stream),
        tools,
        tool_choice,
    })
}

fn text_block(text: String) -> ProviderContentBlock {
    ProviderContentBlock {
        content_type: "text".to_string(),
        text: Some(text),
        source: None,
        id: None,
        name: None,
        input: None,
        tool_use_id: None,
        is_error: None,
    }
}

fn convert_anthropic_block(block: ContentBlock) -> ProviderContentBlock {
    match block {
        ContentBlock::Text { text } => text_block(text),
        ContentBlock::Image { source } => ProviderContentBlock {
            content_type: "image".to_string(),
            text: None,
            source: Some(ProviderContentSource {
                source_type: source.source_type,
                media_type: source.media_type,
                data: source.data,
            }),
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            is_error: None,
        },
        ContentBlock::ToolUse { id, name, input } => ProviderContentBlock {
            content_type: "tool_use".to_string(),
            text: None,
            source: None,
            id: Some(id),
            name: Some(name),
            input: Some(input),
            tool_use_id: None,
            is_error: None,
        },
        ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => ProviderContentBlock {
            content_type: "tool_result".to_string(),
            text: Some(content),
            source: None,
            id: None,
            name: None,
            input: None,
            tool_use_id: Some(tool_use_id),
            is_error,
        },
    }
}

/// Map an OpenAI-style finish_reason to an Anthropic stop_reason
fn map_stop_reason(finish_reason: Option<&str>) -> String {
    match finish_reason {
        Some("tool_calls") => "tool_use",
        Some("length") => "max_tokens",
        Some("stop") | None => "end_turn",
        Some(_) => "end_turn",
    }
    .to_string()
}

fn convert_provider_block_to_anthropic(block: &ProviderContentBlock) -> ContentBlock {
    match block.content_type.as_str() {
        "tool_use" => ContentBlock::ToolUse {
            id: block.id.clone().unwrap_or_default(),
            name: block.name.clone().unwrap_or_default(),
            input: block.input.clone().unwrap_or(Value::Null),
        },
        _ => ContentBlock::Text {
            text: block.text.clone().unwrap_or_default(),
        },
    }
}

/// Handle regular (non-streaming) response
fn handle_regular_response(response: CompletionResponse) -> Json<MessagesResponse> {
    let usage = response
        .usage
        .as_ref()
        .map(|u| Usage {
            input_tokens: u.prompt_tokens,
            output_tokens: u.completion_tokens,
        })
        .unwrap_or(Usage {
            input_tokens: 0,
            output_tokens: 0,
        });

    let (content, stop_reason) = if let Some(choice) = response.choices.first() {
        let content = if let Some(message) = &choice.message {
            if message.content.is_empty() {
                vec![ContentBlock::Text {
                    text: String::new(),
                }]
            } else {
                message
                    .content
                    .iter()
                    .map(convert_provider_block_to_anthropic)
                    .collect()
            }
        } else {
            vec![ContentBlock::Text {
                text: String::new(),
            }]
        };
        (content, map_stop_reason(choice.finish_reason.as_deref()))
    } else {
        (
            vec![ContentBlock::Text {
                text: String::new(),
            }],
            "end_turn".to_string(),
        )
    };

    Json(MessagesResponse {
        id: response.id,
        response_type: "message".to_string(),
        model: response.model,
        role: "assistant".to_string(),
        content,
        stop_reason: Some(stop_reason),
        stop_sequence: None,
        usage,
    })
}

// ---------------------------------------------------------------------
// Streaming: translate provider chunks into the real Anthropic SSE
// event sequence (message_start / content_block_* / message_delta /
// message_stop), matching https://docs.anthropic.com/en/api/messages-streaming
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
struct SseMessageStart {
    id: String,
    #[serde(rename = "type")]
    msg_type: String,
    role: String,
    model: String,
    content: Vec<Value>,
    stop_reason: Option<String>,
    stop_sequence: Option<String>,
    usage: Usage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum SseContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum SseDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
}

#[derive(Debug, Clone, Serialize)]
struct SseMessageDelta {
    stop_reason: Option<String>,
    stop_sequence: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SseError {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum StreamEvent {
    #[serde(rename = "message_start")]
    MessageStart { message: SseMessageStart },
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: usize,
        content_block: SseContentBlock,
    },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { index: usize, delta: SseDelta },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: usize },
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: SseMessageDelta,
        usage: Usage,
    },
    #[serde(rename = "message_stop")]
    MessageStop {},
    #[serde(rename = "error")]
    Error { error: SseError },
}

fn to_sse_event(event: StreamEvent) -> Event {
    let name = match &event {
        StreamEvent::MessageStart { .. } => "message_start",
        StreamEvent::ContentBlockStart { .. } => "content_block_start",
        StreamEvent::ContentBlockDelta { .. } => "content_block_delta",
        StreamEvent::ContentBlockStop { .. } => "content_block_stop",
        StreamEvent::MessageDelta { .. } => "message_delta",
        StreamEvent::MessageStop { .. } => "message_stop",
        StreamEvent::Error { .. } => "error",
    };
    Event::default()
        .event(name)
        .json_data(&event)
        .unwrap_or_else(|_| Event::default().event("error").data("{}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Text,
    Tool,
}

struct StreamCtx {
    started: bool,
    input_tokens: u32,
    output_tokens: u32,
    current_block: Option<(usize, BlockKind)>,
    next_index: usize,
    tool_indices: HashMap<usize, usize>,
    stop_reason: Option<String>,
}

impl StreamCtx {
    fn new() -> Self {
        Self {
            started: false,
            input_tokens: 0,
            output_tokens: 0,
            current_block: None,
            next_index: 0,
            tool_indices: HashMap::new(),
            stop_reason: None,
        }
    }
}

fn ensure_block(
    ctx: &mut StreamCtx,
    events: &mut Vec<Event>,
    kind: BlockKind,
    id: Option<String>,
    name: Option<String>,
) -> usize {
    if let Some((idx, current_kind)) = ctx.current_block {
        if current_kind == kind && kind == BlockKind::Text {
            return idx;
        }
    }

    if let Some((idx, _)) = ctx.current_block.take() {
        events.push(to_sse_event(StreamEvent::ContentBlockStop { index: idx }));
    }

    let index = ctx.next_index;
    ctx.next_index += 1;
    ctx.current_block = Some((index, kind));

    let content_block = match kind {
        BlockKind::Text => SseContentBlock::Text {
            text: String::new(),
        },
        BlockKind::Tool => SseContentBlock::ToolUse {
            id: id.unwrap_or_default(),
            name: name.unwrap_or_default(),
            input: json!({}),
        },
    };
    events.push(to_sse_event(StreamEvent::ContentBlockStart {
        index,
        content_block,
    }));

    index
}

fn process_chunk(ctx: &mut StreamCtx, resp: CompletionResponse) -> Vec<Event> {
    let mut events = Vec::new();

    if !ctx.started {
        ctx.started = true;
        events.push(to_sse_event(StreamEvent::MessageStart {
            message: SseMessageStart {
                id: resp.id.clone(),
                msg_type: "message".to_string(),
                role: "assistant".to_string(),
                model: resp.model.clone(),
                content: vec![],
                stop_reason: None,
                stop_sequence: None,
                usage: Usage {
                    input_tokens: 0,
                    output_tokens: 0,
                },
            },
        }));
    }

    if let Some(usage) = &resp.usage {
        ctx.input_tokens = usage.prompt_tokens;
        ctx.output_tokens = usage.completion_tokens;
    }

    if let Some(choice) = resp.choices.first() {
        if let Some(reason) = &choice.finish_reason {
            ctx.stop_reason = Some(map_stop_reason(Some(reason.as_str())));
        }

        if let Some(delta) = &choice.delta {
            if let Some(text) = &delta.content {
                if !text.is_empty() {
                    let idx = ensure_block(&mut *ctx, &mut events, BlockKind::Text, None, None);
                    events.push(to_sse_event(StreamEvent::ContentBlockDelta {
                        index: idx,
                        delta: SseDelta::TextDelta { text: text.clone() },
                    }));
                }
            }

            if let Some(tool_calls) = &delta.tool_calls {
                for tc in tool_calls {
                    let idx = if let Some(&existing) = ctx.tool_indices.get(&tc.index) {
                        existing
                    } else {
                        let idx = ensure_block(
                            &mut *ctx,
                            &mut events,
                            BlockKind::Tool,
                            tc.id.clone(),
                            tc.name.clone(),
                        );
                        ctx.tool_indices.insert(tc.index, idx);
                        idx
                    };

                    if let Some(args) = &tc.arguments {
                        if !args.is_empty() {
                            events.push(to_sse_event(StreamEvent::ContentBlockDelta {
                                index: idx,
                                delta: SseDelta::InputJsonDelta {
                                    partial_json: args.clone(),
                                },
                            }));
                        }
                    }
                }
            }
        }
    }

    events
}

fn closing_events(ctx: &mut StreamCtx) -> Vec<Event> {
    let mut events = Vec::new();
    if let Some((idx, _)) = ctx.current_block.take() {
        events.push(to_sse_event(StreamEvent::ContentBlockStop { index: idx }));
    }
    events.push(to_sse_event(StreamEvent::MessageDelta {
        delta: SseMessageDelta {
            stop_reason: Some(
                ctx.stop_reason
                    .clone()
                    .unwrap_or_else(|| "end_turn".to_string()),
            ),
            stop_sequence: None,
        },
        usage: Usage {
            input_tokens: ctx.input_tokens,
            output_tokens: ctx.output_tokens,
        },
    }));
    events.push(to_sse_event(StreamEvent::MessageStop {}));
    events
}

struct UnfoldState {
    inner: BoxStream<'static, anyhow::Result<CompletionResponse>>,
    ctx: StreamCtx,
    queue: VecDeque<Event>,
    finished: bool,
}

/// Handle streaming response
fn handle_streaming_response(
    stream: BoxStream<'static, anyhow::Result<CompletionResponse>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let state = UnfoldState {
        inner: stream,
        ctx: StreamCtx::new(),
        queue: VecDeque::new(),
        finished: false,
    };

    let sse_stream = stream::unfold(state, |mut state| async move {
        loop {
            if let Some(event) = state.queue.pop_front() {
                return Some((Ok(event), state));
            }
            if state.finished {
                return None;
            }

            match state.inner.next().await {
                Some(Ok(resp)) => {
                    let events = process_chunk(&mut state.ctx, resp);
                    state.queue.extend(events);
                }
                Some(Err(e)) => {
                    tracing::error!("Error in streaming response: {:?}", e);
                    if state.ctx.started {
                        state.queue.extend(closing_events(&mut state.ctx));
                    } else {
                        state.queue.push_back(to_sse_event(StreamEvent::Error {
                            error: SseError {
                                error_type: "api_error".to_string(),
                                message: e.to_string(),
                            },
                        }));
                    }
                    state.finished = true;
                }
                None => {
                    if state.ctx.started {
                        state.queue.extend(closing_events(&mut state.ctx));
                    }
                    state.finished = true;
                }
            }
        }
    });

    Sse::new(sse_stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive-text"),
    )
}

/// Create error response
fn create_error_response(message: &str, error_type: &str) -> ErrorResponse {
    ErrorResponse {
        response_type: "error".to_string(),
        error: ErrorDetails {
            error_type: error_type.to_string(),
            message: message.to_string(),
        },
    }
}
