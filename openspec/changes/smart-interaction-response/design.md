## Context

CLIPilot 通过 tmux 控制 Claude Code，当 Claude Code 遇到需要用户交互的场景（权限确认、菜单选择等），StateDetector 的 Layer 1.5 regex 检测到 `waiting_input` 状态。当前 Scheduler 对 `waiting_input` 的处理策略是：如果 `suggestedAction.value` 存在则使用它，否则默认发送 `"y"`。

问题在于 Claude Code 的交互 UI 有多种形式：
- `(y/n)` 提示 — 输入 "y" 有效
- 编号选择菜单（`❯ 1. Yes / 2. No / 3. ...`）— 需要 Enter 或方向键
- 自由文本输入 — 需要 LLM 理解语义后生成内容

Layer 1.5 作为 regex 层无法理解交互语义，不应做决策。所有 `waiting_input` 的响应决策应交给 Layer 2 LLM。

## Goals / Non-Goals

**Goals:**
- 所有 `waiting_input` 场景由 LLM 分析并返回精确按键序列
- `sendResponse()` 支持丰富的按键序列格式（Enter、通用 keys 序列）
- LLM 根据操作危险性智能选择菜单选项（非危险默认确认，危险操作保守处理）

**Non-Goals:**
- 不改变 Layer 1.5 的检测逻辑（它仍然负责快速分类状态）
- 不新增 Layer 1.5 的自动回应能力（所有回应决策交给 LLM）
- 不修改 AgentAdapter 接口（sendResponse 签名不变）

## Decisions

### D1: waiting_input 统一走 Layer 2

**选择**: Layer 1.5 检测到 `waiting_input` 后，如果没有 `suggestedAction.value`，Scheduler 调用 `stateDetector.analyzeState()` 获取 LLM 判断。

**替代方案**: Layer 1.5 增加菜单模式识别和自动回应。
**否决原因**: regex 无法理解交互语义和危险性，硬编码规则容易遗漏场景。

### D2: 按键序列协议扩展

**选择**: 在现有 `"y"`、`"arrow:dir:N"` 基础上新增：
- `"Enter"` — 只按回车，不输入文本
- `"Escape"` — 按 Escape 键
- `"keys:K1,K2,..."` — 通用按键序列，每个按键间隔 100ms

**替代方案**: 用 JSON 格式 `{ "type": "keypress", "keys": [...] }` 表示。
**否决原因**: 当前 suggestedAction.value 是 string 类型，保持简单的字符串协议更一致。

### D3: LLM 回退后设置 cooldown

**选择**: Scheduler 通过 LLM 分析获取按键并执行后，调用 `setCooldown(3000)` 防止发送的按键触发误判。

**理由**: 与 sendPrompt 后的 cooldown 策略一致。

### D4: state-analyzer 提示词格式约束

**选择**: 在 `prompts/state-analyzer.md` 中明确列出所有支持的 `suggestedAction.value` 格式，并给出危险性判断指引。

**理由**: LLM 必须知道可用的按键格式才能返回可执行的指令。

## Risks / Trade-offs

- **[性能]** 每次 waiting_input 都需要 LLM 调用 → 增加约 1-3 秒延迟。可接受，因为这些交互本来就需要人类思考。
- **[LLM 错误]** LLM 可能返回无效的按键序列 → `sendResponse` 对无法识别的格式走 fallback（sendText + Enter），同时 Scheduler 在 LLM 分析失败时 emit `need_human` 而非盲目操作。
- **[死循环]** LLM 返回的按键无效 → 同一个 waiting_input 被反复检测 → 需要在 Scheduler 中增加重试计数器，同一 waiting_input 状态最多重试 3 次后 escalate。
