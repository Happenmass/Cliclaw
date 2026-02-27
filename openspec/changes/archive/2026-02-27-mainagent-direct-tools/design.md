## Context

MainAgent 当前拥有 12 个内置工具，全部围绕"通过 tmux agent 间接操作"设计。它无法直接观察文件系统、目录结构或项目环境。`create_session` 工具在 `main-agent.ts:610` 硬编码 `workingDir: process.cwd()`，LLM 无法指定 agent 工作目录。

底层基础设施已就绪：`LaunchOptions` 接口有 `workingDir` 字段，`TmuxBridge.createSession` 支持 `cwd` 参数，`ClaudeCodeAdapter.launch` 会传递 `opts.workingDir`。只是 `create_session` 工具层没有暴露这个参数。

## Goals / Non-Goals

**Goals:**
- MainAgent 获得直接执行 bash 命令的能力，用于环境侦察（只读）
- `create_session` 支持 LLM 动态指定 agent 工作目录
- 建立清晰的 exec_command 只读边界，通过 prompt 约束
- exec_command 的 cwd 自动继承 session 工作目录

**Non-Goals:**
- 不改变现有 agent 交互工具的行为
- 不在代码层面限制 exec_command 可执行的命令（约束在 prompt 层面）
- 不引入新的 agent adapter 或 tmux 会话管理逻辑
- 不修改 StateDetector、SignalRouter 等组件

## Decisions

### Decision 1: exec_command 通过 child_process 直接执行

使用 `child_process.execFile("bash", ["-c", command])` 直接执行，不经过 tmux。

**理由**: MainAgent 需要快速、同步地获取结果。经过 tmux 会引入状态检测延迟和文字解析的不可靠性。直接执行 100ms 内返回，tmux 路径需要 5-10 秒。

**替代方案**: 在 tmux 中开一个专用的侦察 pane —— 过重，且仍需要解析 pane 输出。

### Decision 2: 只读约束在 prompt 层面而非代码层面

不在 `executeTool` 中做命令白名单/黑名单过滤，约束完全通过 `main-agent.md` prompt 实现。

**理由**:
1. MainAgent 已能通过 `send_to_agent` 间接执行任何命令，代码层限制可绕过
2. 命令黑名单容易被绕过（`/bin/rm` vs `rm`，管道组合等）
3. LLM 的 prompt 约束对 tool-use 场景已足够可靠
4. 保持实现简洁

**替代方案**: 代码层黑名单（`rm`, `mv`, `git` 等）—— 易绕过、维护成本高、假安全感。

### Decision 3: cwd 三级 fallback 策略

`exec_command` 的工作目录解析顺序：
1. 参数显式指定的 `cwd` → 用它
2. `sessionWorkingDir`（create_session 时设置）→ 用它
3. `process.cwd()` → fallback

**理由**: session 创建后，MainAgent 的后续侦察操作大概率在同一个项目目录下，自动继承避免 LLM 每次写绝对路径。

### Decision 4: create_session 的 working_dir 由 LLM 决定

不从 CLI `--cwd` 参数自动传递，也不从 goal 中解析路径。完全由 LLM 根据 goal 内容和 exec_command 侦察结果自行决定。

**理由**: LLM 可能需要先 `exec_command("ls ~/projects")` 确认目录存在和结构，然后再决定在哪里启动 agent。硬编码路径会限制灵活性。

### Decision 5: 输出截断保护

`exec_command` 的 stdout+stderr 输出截断到 **10000 字符**，超出部分截断并附提示。默认 timeout 30 秒。

**理由**: 防止 `cat` 大文件或输出爆炸的命令耗尽 LLM context。10000 字符足以覆盖大多数侦察场景。

## Risks / Trade-offs

**[LLM 越界使用 exec_command 修改文件]** → Prompt 约束 + 明确的正面/负面操作列表。如果 prompt 约束不够，未来可在代码层加检测日志作为第二道防线。

**[exec_command 执行长时间命令阻塞主循环]** → 默认 30 秒 timeout。MainAgent 的 tool-use loop 是串行的，一个工具执行时 loop 暂停，timeout 保证不会无限阻塞。

**[输出截断导致信息丢失]** → LLM 可以用 `head -100`、`tail -50` 等方式主动控制输出范围，prompt 中引导这一实践。
