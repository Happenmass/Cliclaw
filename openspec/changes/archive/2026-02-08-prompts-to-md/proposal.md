## Why

系统提示词硬编码在 `src/llm/prompts.ts` 的 TypeScript 模板字符串中，用户无法直观查看和参考默认提示词内容，且提示词的维护与代码编译耦合。将提示词迁移为独立 `.md` 文件随包分发，使其成为可读、可版本化、可独立编辑的一等资源。

## What Changes

- **删除** `src/llm/prompts.ts`，不再以 TypeScript 常量存储提示词
- **新增** `prompts/` 目录（包根），放置 5 个 `.md` 文件作为内置默认提示词
- **修改** `src/llm/prompt-loader.ts`，Layer 1 从包内 `prompts/` 目录读取 `.md` 文件（通过 `import.meta.url` 定位），不再 import `DEFAULT_PROMPTS`
- **修改** `PromptLoader` 构造函数，接受可选 `builtinDir` 参数以支持测试注入
- **修改** 相关测试，移除对 `prompts.ts` 导出的依赖

## Capabilities

### New Capabilities

- `builtin-prompt-files`: 内置提示词以 `.md` 文件随包分发，PromptLoader 从文件系统读取默认提示词

### Modified Capabilities

## Impact

- `src/llm/prompts.ts` — 删除
- `src/llm/prompt-loader.ts` — Layer 1 数据源变更
- `test/llm/prompt-loader.test.ts` — 断言方式变更
- `package.json` — 可能需要在 `files` 字段中包含 `prompts/`（当前无 `files` 字段，默认全部打包）
