## 1. exec_command 工具

- [x] 1.1 在 `TOOL_DEFINITIONS` 中添加 `exec_command` 工具定义（command, cwd?, timeout? 参数）
- [x] 1.2 在 MainAgent 中添加 `sessionWorkingDir` 实例变量，初始化为 `process.cwd()`
- [x] 1.3 在 `executeTool` 中实现 `exec_command` 的执行逻辑：`child_process.execFile("bash", ["-c", command])`，cwd 三级 fallback（显式参数 → sessionWorkingDir → process.cwd()），默认 30s timeout
- [x] 1.4 实现输出截断逻辑：stdout+stderr 合并，超过 10000 字符截断并附提示
- [x] 1.5 实现错误处理：非零退出码返回 stderr + exit code，命令超时返回 timeout 错误

## 2. create_session working_dir 支持

- [x] 2.1 在 `create_session` 工具定义中添加 `working_dir` 可选参数
- [x] 2.2 在 `create_session` 执行逻辑中：使用 `working_dir` 参数替代硬编码的 `process.cwd()`，不传则 fallback 到 `process.cwd()`
- [x] 2.3 `create_session` 成功后更新 `sessionWorkingDir` 状态
- [x] 2.4 添加目录存在性校验：`working_dir` 指向不存在的路径时返回错误

## 3. Prompt 更新

- [x] 3.1 在 `prompts/main-agent.md` 中添加 "Execution Paths" 段落，包含 exec_command 只读允许列表、禁止列表、fallback 规则
- [x] 3.2 在 "Execution Paths" 段落中描述 send_to_agent 的职责范围和侦察→指挥→观察→迭代工作模式

## 4. 测试

- [x] 4.1 测试 exec_command 基本执行（运行 `echo hello`，验证输出）
- [x] 4.2 测试 exec_command cwd fallback 链（无 session → process.cwd，有 session → sessionWorkingDir，显式 cwd → 使用显式值）
- [x] 4.3 测试 exec_command 输出截断（超过 10000 字符时截断并附提示）
- [x] 4.4 测试 exec_command 错误处理（非零退出码、命令超时）
- [x] 4.5 测试 create_session 接受 working_dir 参数并传递给 adapter.launch
- [x] 4.6 测试 create_session 更新 sessionWorkingDir 状态
- [x] 4.7 测试 create_session working_dir 目录不存在时返回错误
