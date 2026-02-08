# CLIPilot

TUI meta-orchestrator that commands coding agents (like Claude Code) via tmux to accomplish complex development tasks.

CLIPilot takes a high-level development goal, breaks it into a task graph using an LLM planner, and orchestrates coding agents in tmux sessions to execute the plan — all managed through an interactive terminal UI.

## Prerequisites

- **Node.js** >= 20.0.0
- **tmux** installed and available in PATH

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux
```

## Installation

```bash
# Clone and install
git clone <repo-url>
cd clipilot
npm install
npm run build

# Or link globally
npm link
```

## Quick Start

```bash
# Run with a goal
clipilot "Add JWT authentication to this Express app"

# Specify a provider and model
clipilot -p openai -m gpt-4o "Refactor the database layer"

# Dry run (plan only, no execution)
clipilot --dry-run "Redesign the API"

# List available providers
clipilot --list-providers
```

## Configuration

CLIPilot stores configuration in `~/.clipilot/config.json`. You can edit it directly, or use the interactive configuration TUI.

### Interactive Config TUI

There are two ways to open the configuration interface:

#### 1. Standalone command

```bash
clipilot config
```

This opens a full-screen configuration TUI where you can adjust all settings.

#### 2. Runtime hotkey

While CLIPilot is running, press **`c`** to open the configuration overlay. Press **`Esc`** to return to the dashboard.

### Config TUI Navigation

```
╭─ CLIPilot Configuration ─────────────────╮
│                                           │
│  → Default Provider    anthropic          │
│    Model               claude-sonnet-4-5  │
│    API Key             ********           │
│    Autonomy Level      medium             │
│    Default Agent       claude-code        │
│    Base URL            (not set)          │
│                                           │
│  Configure the LLM provider for planning  │
│                                           │
│  ↑↓ Navigate  Enter Change  Esc Close     │
╰───────────────────────────────────────────╯
```

| Key | Action |
|-----|--------|
| `↑` / `k` | Move cursor up |
| `↓` / `j` | Move cursor down |
| `Enter` | Change selected value (opens submenu, text input, or cycles value) |
| `Esc` | Close config / go back |

### Configuration Items

| Item | Type | Description |
|------|------|-------------|
| **Default Provider** | Submenu | Select from 12 built-in LLM providers |
| **Model** | Submenu | Select from the current provider's model list, or enter a custom model name |
| **API Key** | Text input | API key for the selected provider (displayed masked as `********`) |
| **Autonomy Level** | Cycle | `low` → `medium` → `high` → `full` |
| **Default Agent** | Cycle | The coding agent to use (currently: `claude-code`) |
| **Base URL** | Text input | Custom API endpoint URL (optional, for proxies or self-hosted) |

Changes are saved immediately to `~/.clipilot/config.json` — no explicit save step needed.

### Config File Format

```json
{
  "defaultAgent": "claude-code",
  "autonomyLevel": "medium",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "apiKey": "sk-...",
    "baseUrl": "https://api.anthropic.com"
  }
}
```

## CLI Options

```
clipilot [options] [goal]

Arguments:
  goal                    Development goal to accomplish

Options:
  -a, --agent <name>      Coding agent (default: claude-code)
  -p, --provider <name>   LLM provider for planning
  -m, --model <id>        LLM model ID
  --base-url <url>        Custom API base URL
  --autonomy <level>      low | medium | high | full (default: medium)
  --dry-run               Plan only, don't execute
  --list-providers        List all available LLM providers
  --cwd <path>            Working directory (default: current)
  -h, --help              Show help
  -v, --version           Show version
```

## Supported LLM Providers

| Provider | Models | Env Variable |
|----------|--------|-------------|
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4.1, o3, o4-mini | `OPENAI_API_KEY` |
| Anthropic | claude-opus-4-6, claude-sonnet-4-5, claude-haiku-4-5 | `ANTHROPIC_API_KEY` |
| OpenRouter | Multi-provider aggregator | `OPENROUTER_API_KEY` |
| DeepSeek | deepseek-chat, deepseek-reasoner | `DEEPSEEK_API_KEY` |
| Google Gemini | gemini-2.5-flash, gemini-2.5-pro | `GEMINI_API_KEY` |
| Groq | llama-3.3-70b-versatile | `GROQ_API_KEY` |
| Mistral | mistral-large-latest, codestral-latest | `MISTRAL_API_KEY` |
| xAI (Grok) | grok-3, grok-3-mini | `XAI_API_KEY` |
| Together AI | Llama models | `TOGETHER_API_KEY` |
| Moonshot (Kimi) | moonshot-v1-auto | `MOONSHOT_API_KEY` |
| MiniMax | MiniMax-Text-01 | `MINIMAX_API_KEY` |
| Ollama (Local) | llama3.3 (local models) | — |

## Runtime Hotkeys

While CLIPilot is running:

| Key | Action |
|-----|--------|
| `q` | Quit |
| `p` | Pause / Resume |
| `c` | Open configuration overlay |
| `s` | Steer (send instructions to agent) |
| `Tab` | Switch agent view |

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit

# Lint & format
npm run check
npm run format
```

## Project Structure

```
src/
├── main.ts                    # Entry point
├── cli.ts                     # CLI argument parsing
├── core/                      # Core logic
│   ├── planner.ts             # LLM-driven task planner
│   ├── scheduler.ts           # Task scheduler
│   ├── session.ts             # Session management
│   └── task.ts                # Task graph data structure
├── tmux/                      # tmux integration
│   ├── bridge.ts              # tmux command wrapper
│   ├── state-detector.ts      # Agent state detection
│   └── types.ts               # tmux types
├── agents/                    # Agent adapters
│   ├── adapter.ts             # Adapter interface
│   └── claude-code.ts         # Claude Code adapter
├── llm/                       # LLM client
│   ├── client.ts              # LLM API client
│   ├── prompts.ts             # Prompt templates
│   ├── types.ts               # LLM types
│   └── providers/             # Provider registry
│       ├── registry.ts        # Built-in providers
│       ├── anthropic.ts       # Anthropic protocol
│       └── openai-compatible.ts
├── tui/                       # Terminal UI
│   ├── app.ts                 # TUI application
│   ├── dashboard.ts           # Main dashboard
│   ├── config-view.ts         # Configuration view
│   ├── config-app.ts          # Standalone config entry
│   ├── task-list.ts           # Task list component
│   ├── log-stream.ts          # Log stream component
│   ├── agent-preview.ts       # Agent output preview
│   └── components/            # UI primitives
│       ├── renderer.ts        # Diff rendering engine
│       ├── box.ts             # Border container
│       ├── text.ts            # Text component
│       ├── container.ts       # Layout container
│       ├── progress.ts        # Progress bar
│       ├── select-list.ts     # Selection list
│       └── text-input.ts      # Text input
└── utils/
    ├── config.ts              # Configuration management
    └── logger.ts              # Logging
```

## License

MIT
