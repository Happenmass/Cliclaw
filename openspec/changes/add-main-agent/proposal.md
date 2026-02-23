## Why

当前 CLIPilot 的执行决策由 Scheduler 中的 switch 语句（`monitorTask` 的 `onStateChange` 回调）硬编码完成。StateDetector/ErrorAnalyzer 的输出被直接执行，没有一个中心化的推理实体来维护目标上下文、审查分析结果、积累执行经验。这导致：

1. 每次 LLM 调用（plan、generatePrompt、analyzeState、deepAnalyze）彼此隔离，无上下文积累
2. 分析器建议的动作被机械执行，无法结合任务目标判断合理性
3. 无法扩展到 spec-driven 工作流（如通过 /opsx 命令引导 agent）
4. Layer 3 deepAnalyze 能力在 Scheduler 中实际未被调用，被架构"孤立"

需要引入一个持有持续对话上下文的 Main Agent 作为核心决策大脑。

## What Changes

- **新增 MainAgent 模块**：持续对话的核心决策实体，通过 LLM tool use 做出执行决策（send_to_agent、respond_to_agent、mark_complete、mark_failed、request_replan、escalate_to_human、fetch_more）
- **新增 SignalRouter 模块**：对 StateDetector 信号进行分流——高置信度信号走快速通道（直接执行+通知 MainAgent），低置信度/需决策信号路由到 MainAgent
- **新增 ContextManager 模块**：管理 MainAgent 的对话历史、模块化系统提示词、按窗口余量触发上下文压缩
- **新增 main-agent.md 提示词**：模块化结构（Identity、Goal、TaskGraph、History、Memory、Agent Capabilities、Tools、Decision Guidelines）
- **新增 history-compressor.md 提示词**：将对话历史压缩为结构化摘要
- **瘦身 Scheduler**：移除 monitorTask 中的决策逻辑，仅保留任务循环调度，将 executeTask 委托给 MainAgent
- **瘦身 StateDetector**：移除 suggestedAction 输出（动作决策由 MainAgent 负责），仅保留状态检测和分类
- **移除 Planner.generatePrompt()**：prompt 生成由 MainAgent 自身完成（因为它拥有完整上下文）
- **SignalRouter 自适应抓取**：检测到 /opsx 命令或 spec 相关输出时自动扩大 tmux 抓取行数

## Capabilities

### New Capabilities
- `main-agent`: 核心决策 agent，持续对话推理、目标守护、执行决策、prompt 生成
- `signal-router`: 信号分流层，高置信度快速通道 + 低置信度路由到 MainAgent，自适应 tmux 抓取
- `context-manager`: 对话管理与上下文压缩，模块化系统提示词，滑动窗口压缩

### Modified Capabilities
- `agent-session-reuse`: Scheduler 的 executeTask 不再直接调用 adapter/stateDetector，改为委托给 MainAgent

## Impact

- **核心模块**：`src/core/scheduler.ts` 大幅瘦身，新增 `src/core/main-agent.ts`、`src/core/signal-router.ts`、`src/core/context-manager.ts`
- **状态检测**：`src/tmux/state-detector.ts` 移除 suggestedAction 相关逻辑
- **规划器**：`src/core/planner.ts` 移除 generatePrompt 方法
- **提示词**：新增 `prompts/main-agent.md`、`prompts/history-compressor.md`，简化 `prompts/state-analyzer.md`
- **LLM Client**：需要支持 tool use（tool definitions + tool call 解析），当前 LLMClient 可能需要扩展
- **主入口**：`src/main.ts` 初始化流程需要调整以组装新组件
