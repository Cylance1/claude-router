# Claude Router

Claude Router is a middleware application that sits between Claude Code and OpenRouter, 
allowing Claude Code to transparently use any model available on OpenRouter while maintaining 
full compatibility with Claude Code's expected Anthropic API.

## Features

- **Anthropic API Compatibility**: Exposes the full Anthropic API that Claude Code expects
- **Intelligent Model Routing**: Routes requests to appropriate models based on content and rules
- **Tool Translation**: Translates tool calls between different provider formats
- **Structured Output Repair**: Automatically repairs malformed JSON responses
- **Provider Agnostic**: Designed to support multiple LLM providers beyond OpenRouter
- **Extensible Architecture**: Modular design allows for easy extension and customization

## Architecture

```
Claude Code
      │
Anthropic API
      │
      ▼
Claude Router
      │
      ▼
OpenRouter
      │
┌──────────────────────────────┐
│ GPT-5                        │
│ DeepSeek                     │
│ Qwen                         │
│ Kimi                         │
│ GLM                          │
│ Gemini                       │
│ Future Providers             │
└──────────────────────────────┘
```

## Modules

1. **Anthropic Compatibility Layer** - Implements the Anthropic API endpoints
2. **OpenRouter Client** - Handles communication with OpenRouter
3. **Model Router** - Routes requests to appropriate models based on logical roles
4. **Rule Engine** - Determines which role to use based on message content
5. **Tool Translation Layer** - Translates tool calls between provider formats
6. **Structured Output Repair** - Fixes malformed JSON responses
7. **Prompt Adapter** - Optimizes prompts for different providers
8. **Streaming Manager** - Handles real-time streaming responses
9. **Telemetry** - Tracks metrics and performance
10. **Configuration** - Manages YAML-based configuration

## Installation

```bash
cargo build --release
```

## Configuration

Create a `config.yaml` file based on the example in the `config` directory.

## Usage

```bash
cargo run
```

## License

MIT