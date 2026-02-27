## Context

CLIPilot 是一个元编排器，通过 tmux 控制执行 agent（如 Claude Code）。当前架构中，Scheduler 的 `monitorTask()` 方法内嵌了一个 switch 语句来处理 StateDetector 的信号，直接执行 suggestedAction。这种"反射式"决策缺乏目标感知、上下文积累和扩展能力。

当前 LLMClient 已在类型和 provider 层面完整支持 tool use（`ToolDefinition`、`ToolCallContent`、`CompletionOptions.tools`），Anthropic 和 OpenAI-compatible 两个 provider 均已实现 tool 参数传递。

## Goals / Non-Goals

**Goals:**
- 引入 MainAgent 作为核心决策实体，持有持续对话上下文，通过 tool use 做出执行决策
- 实现分层信号路由：高置信度信号走快速通道，低置信度信号由 MainAgent 推理决策
- 实现上下文压缩机制：按窗口余量触发，压缩后注入系统提示词的 History 模块
- 实现 SignalRouter 自适应 tmux 抓取：检测 /opsx 相关内容时自动扩大抓取行数
- MainAgent 能通过生成含 /opsx 命令的 prompt 引导执行 agent 使用 spec-driven 工作流

**Non-Goals:**
- 不在 MainAgent 系统提示词中维护 spec/OpenSpec 内容（spec 留在 CLI 工具内部）
- 不修改 AgentAdapter 接口（sendPrompt/sendResponse/shutdown 保持不变）
- 不修改 TmuxBridge 接口
- 不实现 MainAgent 的流式输出（MainAgent 是后台决策者，不需要向用户实时展示推理过程）
- 不支持多 agent 并行编排（保持现有的单 agent 串行模式）

## Decisions

### Decision 1: MainAgent 使用 LLM tool use 循环而非硬编码 switch

**选择**: MainAgent 通过 `llmClient.complete()` + `tools` 参数实现决策，每次信号输入触发一轮 tool use 循环。

**替代方案**:
- A) 保留 switch 但添加 LLM 审查步骤 → 仍然是硬编码决策树，只是多了一层确认，不够灵活
- B) 完全自由的 LLM 文本输出 + 解析 → 不可靠，容易输出格式不一致

**理由**: Tool use 给 LLM 明确的"动作空间"，既保证输出结构化，又允许 LLM 自由推理。MainAgent 可以在一轮中调用多个 tool（先 fetch_more 再 send_to_agent），这是 switch 无法实现的。

### Decision 2: 分层信号路由（方案 B + 快速通道通知）

**选择**: SignalRouter 根据信号类型和置信度分流：
- `active` conf>0.7 → 快速通道：忽略，仅追加 `[NOTIFY]` 到对话历史
- `completed` conf≥0.9（Layer 2 确认）→ 快速通道：自动标记完成 + `[NOTIFY]`
- `waiting_input` / `error` / `completed` conf<0.9 / `idle` → MainAgent 通道：`[DECISION_NEEDED]`

**替代方案**:
- A) 所有信号都过 MainAgent → 每个 poll 周期（2秒）都可能触发 LLM 调用，延迟和成本过高
- B) 完全不过 MainAgent → 回到现在的问题

**理由**: 大部分时间 agent 处于 `active` 状态，跳过这些信号可以减少 90% 以上的 LLM 调用。关键决策点（交互、错误、完成确认）才需要推理。

### Decision 3: 模块化系统提示词 + 模板变量替换

**选择**: `main-agent.md` 使用 `{{variable}}` 占位符定义模块（goal、task_graph_summary、compressed_history、memory），由 ContextManager 在每次调用前动态替换。

**替代方案**:
- A) 将动态内容放入 user message 而非 system prompt → system prompt 失去全局视角
- B) 使用多个 system message → 部分 provider 不支持多个 system message

**理由**: 复用现有 PromptLoader 的 `{{variable}}` 模式（已在 `{{memory}}` 中使用），ContextManager 管理所有模块的值。压缩时只需更新 `compressed_history` 模块并清空 conversation。

### Decision 4: 上下文压缩触发策略

**选择**: 基于 token 估算，当 `systemPrompt + conversation` 的 token 数超过上下文窗口的 70% 时触发压缩。使用 LLM 调用 `history-compressor.md` 将对话历史压缩为结构化摘要，注入 `{{compressed_history}}` 模块，然后清空 conversation。

**替代方案**:
- A) 固定轮次触发（每 20 轮）→ 短对话浪费，长对话可能不够
- B) 滑动窗口丢弃旧消息 → 丢失上下文，不如压缩

**理由**: 按窗口余量触发更精确，自适应不同长度的信号。压缩保留了关键决策和经验，而滑动窗口会完全丢弃。

### Decision 5: 自适应 tmux 抓取 + fetch_more 兜底（模式 C）

**选择**: SignalRouter 维护 `captureContext`，检测到 /opsx 命令或 spec 关键词时自动扩大抓取行数（50→300）。MainAgent 仍可通过 `fetch_more` tool 手动请求更多行。

**替代方案**:
- A) 纯 MainAgent fetch_more → 每次都需要 LLM 推理后才知道需要更多内容，多一轮延迟
- B) 纯自适应 → 可能有边界 case 遗漏

**理由**: 自适应覆盖 80% 场景（检测到 /opsx 就扩大），fetch_more 覆盖剩余 20%（未知场景的兜底）。

### Decision 6: StateDetector 简化——移除 suggestedAction

**选择**: StateDetector 的输出从 `PaneAnalysis { status, confidence, detail, suggestedAction }` 简化为 `PaneAnalysis { status, confidence, detail }`。`state-analyzer.md` 提示词中移除 suggestedAction 相关指引。

**理由**: 动作决策权完全交给 MainAgent。StateDetector 只负责"感知"（这是什么状态），不负责"决策"（该做什么）。这使职责划分更清晰。

### Decision 7: Planner.generatePrompt() 移除

**选择**: 移除 `Planner.generatePrompt()` 方法和 `prompts/prompt-generator.md` 文件。Prompt 生成由 MainAgent 在 `[TASK_READY]` 信号处理中直接完成。

**理由**: MainAgent 拥有完整上下文（goal、history、memory、task graph），比独立的 Planner LLM 调用能生成更精确的 prompt。Planner 保留 `plan()` 和 `replan()` 方法作为纯工具。

### Decision 8: MainAgent tools 定义

**选择**: 7 个 tools：

| Tool | 终止性 | 说明 |
|------|--------|------|
| `send_to_agent` | 否 | 发送 prompt 给执行 agent |
| `respond_to_agent` | 否 | 回应交互请求 (y/n, 菜单等) |
| `fetch_more` | 否 | 抓取更多 tmux 输出行 |
| `mark_complete` | 是 | 标记当前任务完成 |
| `mark_failed` | 是 | 标记当前任务失败 |
| `request_replan` | 是 | 请求 Planner 重规划 |
| `escalate_to_human` | 是 | 升级给人工处理 |

"终止性" tool 执行后退出当前信号的 tool use 循环，返回任务状态变更结果给 Scheduler。"非终止性" tool 执行后继续循环，让 LLM 看到结果后继续推理（支持多步推理如 fetch_more → send_to_agent）。

## Risks / Trade-offs

**[延迟增加]** MainAgent 的 LLM 推理为每个需决策的信号增加 1-3 秒延迟。
→ 缓解: 分层路由确保只有真正需要决策的信号（约 10-20%）才走 MainAgent 通道。

**[成本增加]** MainAgent 持续对话会积累 token，压缩本身也消耗一次 LLM 调用。
→ 缓解: 快速通道减少调用频率；压缩触发在窗口 70%，留出余量；压缩后对话重置。

**[压缩丢失信息]** 压缩不可避免地丢失细节。
→ 缓解: 压缩提示词要求保留关键决策记录、已知问题、错误解决方案。Task graph 始终在系统提示词中完整呈现，不依赖压缩历史。

**[Tool use 可靠性]** LLM 可能生成无效的 tool call 参数。
→ 缓解: 在 tool 执行层做参数校验，无效调用返回错误信息让 LLM 修正。

**[向后兼容]** StateDetector 接口变更（移除 suggestedAction）影响现有测试。
→ 缓解: 一次性迁移，更新所有相关测试。
