## ADDED Requirements

### Requirement: Layer 2 LLM 驱动的交互响应

当 StateDetector 检测到 `waiting_input` 状态且没有具体 `suggestedAction.value` 时，Scheduler SHALL 调用 Layer 2 LLM 分析（`stateDetector.analyzeState()`）获取精确的按键序列，而非默认发送 `"y"`。

#### Scenario: 菜单选择交互
- **WHEN** Claude Code 显示带编号的选择菜单（如 `❯ 1. Yes / 2. No`）
- **THEN** Scheduler 调用 Layer 2 分析，LLM 返回具体按键序列（如 `"Enter"` 或 `"keys:1,Enter"`），Scheduler 通过 `adapter.sendResponse()` 执行该序列

#### Scenario: LLM 分析返回 escalate
- **WHEN** LLM 判断交互涉及危险操作且不确定如何回应
- **THEN** Scheduler SHALL emit `need_human` 事件，不自动执行任何按键

#### Scenario: LLM 分析失败
- **WHEN** Layer 2 LLM 调用出错或返回无 value 的结果
- **THEN** Scheduler SHALL emit `need_human` 事件，不执行默认回退

### Requirement: sendResponse 支持扩展按键格式

`ClaudeCodeAdapter.sendResponse()` SHALL 支持以下 response 格式：

1. `"Enter"` — 仅发送 Enter 键
2. `"Escape"` — 仅发送 Escape 键
3. `"arrow:<direction>:<count>"` — 发送方向键 count 次后按 Enter（已有）
4. `"keys:<Key1>,<Key2>,..."` — 通用按键序列，每个按键间隔 100ms
5. `(y/n)` 上下文检测 — 发送 `"y"` + Enter（已有）
6. 其他文本 — 作为 sendText + Enter（已有）

`keys:` 格式支持的按键名：`Enter`、`Escape`、`Up`、`Down`、`Left`、`Right`、`Tab`、`Space`、`Backspace`，以及任何单字符（作为 literal 发送）。

#### Scenario: 按 Enter 确认当前选中项
- **WHEN** sendResponse 收到 `"Enter"`
- **THEN** SHALL 仅调用 `bridge.sendEnter(paneTarget)`，不发送任何文本

#### Scenario: 按 Escape 取消
- **WHEN** sendResponse 收到 `"Escape"`
- **THEN** SHALL 仅调用 `bridge.sendEscape(paneTarget)`

#### Scenario: 通用按键序列
- **WHEN** sendResponse 收到 `"keys:Down,Down,Enter"`
- **THEN** SHALL 依次发送 Down、Down、Enter 键，每个按键间隔 100ms

#### Scenario: 单字符按键
- **WHEN** sendResponse 收到 `"keys:1,Enter"`
- **THEN** SHALL 发送 literal `"1"` 然后 Enter，间隔 100ms

### Requirement: state-analyzer 提示词明确按键格式

`prompts/state-analyzer.md` SHALL 包含对 `suggestedAction.value` 的明确格式说明，列出所有支持的按键格式，并指导 LLM 根据操作危险性选择回应策略。

#### Scenario: LLM 返回精确按键
- **WHEN** LLM 分析一个非危险操作的权限确认菜单
- **THEN** LLM SHALL 返回 `suggestedAction.value` 为 `"Enter"` 或对应选项的按键序列

#### Scenario: LLM 识别危险操作
- **WHEN** LLM 分析一个涉及 `rm -rf`、`DROP TABLE`、`force push` 等危险操作的确认
- **THEN** LLM SHALL 返回 `suggestedAction.type` 为 `"escalate"`

### Requirement: waiting_input 重试保护

Scheduler SHALL 对同一个 `waiting_input` 状态的自动响应进行计数。如果对同一轮 waiting_input 已经尝试自动响应 3 次仍未解决，SHALL emit `need_human` 事件并停止自动响应。

#### Scenario: 重试次数耗尽
- **WHEN** Scheduler 已对当前 waiting_input 状态自动响应 3 次
- **THEN** SHALL emit `need_human` 事件，附带原因说明已达到最大自动响应次数
