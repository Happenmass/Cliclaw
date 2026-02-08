## Why

CLIPilot 在自动控制 Claude Code 时，遇到选择菜单（如权限确认的 1/2/3 选项）无法正确响应。当前 Layer 1.5 regex 检测到 `waiting_input` 后，默认发送 `"y"` + Enter，但 Claude Code 的菜单 UI 需要的是 Enter（确认当前选中项）或方向键选择 + Enter。这导致交互卡死在循环检测中。

## What Changes

- Layer 1.5 检测到 `waiting_input` 且无具体 `value` 时，不再默认发 `"y"`，改为触发 Layer 2 LLM 分析获取精确按键序列
- 更新 state-analyzer 提示词，要求 LLM 返回具体的按键指令（`Enter`、`arrow:down:N`、`keys:K1,K2,...`），并根据操作危险性判断选择哪个选项
- `sendResponse()` 新增 `"Enter"`（只按回车）和 `"keys:K1,K2,..."`（通用按键序列）两种格式支持
- Scheduler 中 `waiting_input` 处理增加 Layer 2 回退逻辑

## Capabilities

### New Capabilities
- `smart-interaction`: 智能交互响应系统——LLM 驱动的菜单选择与按键序列生成

### Modified Capabilities

## Impact

- `prompts/state-analyzer.md` — 提示词强化 suggestedAction.value 格式
- `src/core/scheduler.ts` — waiting_input 分支逻辑重构
- `src/agents/claude-code.ts` — sendResponse 新增按键格式解析
- `src/agents/adapter.ts` — 可能无需改动（接口已足够）
- `src/tmux/state-detector.ts` — 可能无需改动（analyzeState 已有）
