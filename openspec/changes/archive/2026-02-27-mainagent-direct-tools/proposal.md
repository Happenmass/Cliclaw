## Why

MainAgent 目前是一个"盲人指挥官"——它只能通过 tmux agent 间接感知环境。想读一个文件需要 `send_to_agent("cat foo.txt")` → 等 agent 执行 → 捕获 pane 输出 → 解析，一个 100ms 能完成的事情变成 10 秒级操作。此外 `create_session` 硬编码 `process.cwd()`，LLM 无法根据 goal 动态选择目标目录，导致 agent 总是在 clipilot 自身目录下启动。

## What Changes

- **新增 `exec_command` 工具**：MainAgent 可直接执行 bash 命令进行环境侦察（只读），无需通过 tmux agent 中转
- **`create_session` 新增 `working_dir` 参数**：LLM 可根据 goal 分析自行决定 agent 的工作目录，不再硬编码
- **新增 `sessionWorkingDir` 状态**：MainAgent 维护当前 session 工作目录，`exec_command` 不带 cwd 时自动继承
- **Prompt 更新**：新增 "Execution Paths" 段落，明确 `exec_command` 只读边界和侦察→指挥→观察→迭代的工作模式

## Capabilities

### New Capabilities
- `direct-exec`: MainAgent 直接执行 bash 命令的能力，严格限制为只读侦察操作（读文件、浏览目录、搜索代码、检查环境），所有修改和验证操作必须通过 agent 执行

### Modified Capabilities
- `goal-driven-execution`: create_session 工具新增 working_dir 参数，LLM 可动态决定 agent 工作目录；新增 sessionWorkingDir 状态管理；prompt 新增 Execution Paths 执行路径指导

## Impact

- `src/core/main-agent.ts` — 新增工具定义、执行逻辑、状态字段
- `prompts/main-agent.md` — 新增 Execution Paths 段落
- `test/core/main-agent.test.ts` — 新增 exec_command 和 working_dir 测试
- 无破坏性变更，所有现有工具行为不变
