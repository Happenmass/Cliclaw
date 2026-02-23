## 1. 提示词创建

- [x] 1.1 创建 `prompts/main-agent.md` — 模块化系统提示词，包含 Identity、Goal（{{goal}}）、Task Graph（{{task_graph_summary}}）、History（{{compressed_history}}）、Memory（{{memory}}）、Agent Capabilities（/opsx 命令说明）、Tools 说明、Decision Guidelines（信号类型和决策原则）
- [x] 1.2 创建 `prompts/history-compressor.md` — 压缩提示词，指引 LLM 将对话历史压缩为结构化摘要（已完成任务、当前进展、关键决策、已知问题）
- [x] 1.3 简化 `prompts/state-analyzer.md` — 移除 suggestedAction 相关内容（格式说明、示例、Danger Assessment 章节），仅保留 status/confidence/detail 的输出格式

## 2. ContextManager 实现

- [x] 2.1 创建 `src/core/context-manager.ts` — 实现 ContextManager 类，包含 modules Map、conversation 数组、getSystemPrompt()（模板变量替换）、addMessage()、getMessages()、updateModule() 方法
- [x] 2.2 实现 shouldCompress() — token 估算（字符数/4）与阈值比较（contextWindowLimit * compressionThreshold）
- [x] 2.3 实现 compress() — 调用 LLM（history-compressor.md）压缩对话历史，更新 compressed_history 模块，清空 conversation
- [x] 2.4 编写 ContextManager 单元测试 — 覆盖模块替换、消息管理、压缩触发判断、压缩执行

## 3. SignalRouter 实现

- [x] 3.1 创建 `src/core/signal-router.ts` — 实现 SignalRouter 类，包含信号分流逻辑（active/completed 高置信度→快速通道，其余→MainAgent 通道）
- [x] 3.2 实现自适应抓取 — captureContext 状态管理（defaultLines/expandedLines），/opsx 检测和 spec 关键词检测触发扩展抓取
- [x] 3.3 实现 notifyPromptSent(prompt) 方法 — 检查 prompt 是否包含 /opsx 命令，设置 expandUntilNextTask 标志
- [x] 3.4 实现快速通道通知 — 快速通道处理后通过 ContextManager 追加 [NOTIFY] 消息到 MainAgent 对话历史
- [x] 3.5 编写 SignalRouter 单元测试 — 覆盖分流逻辑、自适应抓取、快速通道通知

## 4. MainAgent 实现

- [x] 4.1 创建 `src/core/main-agent.ts` — MainAgent 类骨架，包含构造函数（接收 ContextManager、SignalRouter、LLMClient、Planner、AgentAdapter、TmuxBridge、TaskGraph 等依赖）
- [x] 4.2 定义 7 个 tool 的 ToolDefinition — send_to_agent、respond_to_agent、fetch_more、mark_complete、mark_failed、request_replan、escalate_to_human
- [x] 4.3 实现 handleSignal() — 信号格式化为 user message、压缩检查、LLM tool use 循环（调用 complete → 执行 tool → 追加结果 → 继续直到无 tool call 或终止性 tool）
- [x] 4.4 实现各 tool 执行函数 — send_to_agent 调用 adapter.sendPrompt + setCooldown + notifyPromptSent；respond_to_agent 调用 adapter.sendResponse；fetch_more 调用 bridge.capturePane；mark_complete/mark_failed 更新 TaskGraph；request_replan 调用 planner.replan；escalate_to_human 触发事件
- [x] 4.5 实现 executeTask(task) — 注入 [TASK_READY] 信号、触发 LLM 推理、启动 SignalRouter 监控、循环处理信号直到终止、返回 TaskResult
- [x] 4.6 编写 MainAgent 单元测试 — 覆盖信号处理、tool use 循环、多步推理、终止条件

## 5. StateDetector 简化

- [x] 5.1 修改 `src/tmux/state-detector.ts` — PaneAnalysis 接口移除 suggestedAction 字段，quickPatternCheck() 返回值不再包含 suggestedAction，analyzeState() 和 deepAnalyze() 不再返回 suggestedAction
- [x] 5.2 更新 StateDetector 相关测试 — 移除所有 suggestedAction 断言

## 6. Scheduler 瘦身与组装

- [x] 6.1 瘦身 `src/core/scheduler.ts` — 移除 monitorTask() 方法及其 switch 决策逻辑，executeTask() 改为调用 mainAgent.executeTask(task)，移除 handleFailure()（由 MainAgent 内部处理）
- [x] 6.2 移除 `src/core/planner.ts` 的 generatePrompt() 方法 — 同步删除 `prompts/prompt-generator.md`
- [x] 6.3 更新 `src/main.ts` — 初始化 ContextManager、SignalRouter、MainAgent，调整组件组装顺序，将 MainAgent 传入 Scheduler 构造函数
- [x] 6.4 更新 Scheduler 相关测试 — 适配新的委托逻辑

## 7. 集成测试与验证

- [x] 7.1 编写端到端集成测试 — 模拟完整的 Goal → Plan → Execute → Monitor → Complete 流程，验证 MainAgent 的信号处理和 tool use 循环 (5 integration tests)
- [x] 7.2 验证现有测试全部通过 — 运行 `npm test`，修复因接口变更导致的测试失败 (162 tests all passing)
