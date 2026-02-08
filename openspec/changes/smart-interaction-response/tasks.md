## 1. sendResponse 按键格式扩展

- [x] 1.1 在 `src/agents/claude-code.ts` 的 `sendResponse()` 方法中新增 `"Enter"` 格式：仅调用 `bridge.sendEnter()`
- [x] 1.2 新增 `"Escape"` 格式：仅调用 `bridge.sendEscape()`
- [x] 1.3 新增 `"keys:K1,K2,..."` 通用按键序列格式：解析逗号分隔的按键名，逐个发送，间隔 100ms。支持 Enter/Escape/Up/Down/Left/Right/Tab/Space/Backspace 和单字符 literal

## 2. state-analyzer 提示词强化

- [x] 2.1 更新 `prompts/state-analyzer.md`，在 suggestedAction 部分明确列出所有支持的 value 格式（Enter、Escape、arrow:dir:N、keys:K1,K2,...、文本）
- [x] 2.2 在提示词中增加危险性判断指引：非危险操作（读取、查看、构建、测试）倾向确认；危险操作（删除、force push、覆盖、DROP）返回 escalate

## 3. Scheduler waiting_input 处理重构

- [x] 3.1 修改 `src/core/scheduler.ts` 的 `monitorTask()` 中 `waiting_input` 分支：当 `suggestedAction.value` 不存在时，调用 `stateDetector.analyzeState(paneContent, taskContext)` 获取 LLM 判断
- [x] 3.2 LLM 返回有效 `suggestedAction.value` 时，调用 `adapter.sendResponse()` 并设置 `setCooldown(3000)`
- [x] 3.3 LLM 返回 `escalate` 或分析失败时，emit `need_human` 事件
- [x] 3.4 新增 waiting_input 重试计数器：同一轮 waiting_input 自动响应超过 3 次后 emit `need_human` 并停止自动响应

## 4. 测试

- [x] 4.1 新增 `sendResponse` 测试：验证 `"Enter"`、`"Escape"`、`"keys:Down,Down,Enter"` 格式正确执行
- [x] 4.2 新增 Scheduler 测试：验证 waiting_input 无 value 时触发 Layer 2 分析
- [x] 4.3 新增 Scheduler 测试：验证 waiting_input 重试 3 次后 escalate
- [x] 4.4 运行 `npx vitest run` 确保所有测试通过
- [x] 4.5 运行 `npx biome check src/` 确保代码规范
- [x] 4.6 运行 `npm run build` 确保编译通过
