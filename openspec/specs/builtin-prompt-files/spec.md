## ADDED Requirements

### Requirement: 内置提示词以 .md 文件随包分发
包根目录 `prompts/` 下 SHALL 包含 5 个 `.md` 文件：`planner.md`、`state-analyzer.md`、`error-analyzer.md`、`prompt-generator.md`、`session-summarizer.md`。每个文件的内容 SHALL 与原 `prompts.ts` 中对应常量的内容一致（包括 `{{memory}}` 占位符）。

#### Scenario: 包内提示词文件完整
- **WHEN** clipilot 包被安装或从源码构建
- **THEN** `prompts/` 目录下存在全部 5 个 `.md` 文件，内容非空

### Requirement: PromptLoader Layer 1 从包内 prompts/ 目录读取
`PromptLoader.load()` 的 Layer 1 SHALL 从包内 `prompts/` 目录读取 `.md` 文件作为默认值，而非从 TypeScript 常量导入。

#### Scenario: 无自定义文件时返回包内默认值
- **WHEN** `~/.clipilot/prompts/` 和项目级 `.clipilot/prompts/` 均不存在自定义文件
- **THEN** `PromptLoader.resolve("planner")` 返回包内 `prompts/planner.md` 的内容（经模板变量替换后）

#### Scenario: 用户级文件覆盖包内默认值
- **WHEN** `~/.clipilot/prompts/planner.md` 存在
- **THEN** `PromptLoader.resolve("planner")` 返回用户级文件内容，而非包内默认值

### Requirement: PromptLoader 构造函数支持注入 builtinDir
`PromptLoader` 构造函数 SHALL 接受可选的 `builtinDir` 参数。未传入时 SHALL 通过 `import.meta.url` 自动推导包内 `prompts/` 路径。

#### Scenario: 测试时注入临时目录
- **WHEN** `new PromptLoader("/tmp/test-prompts")` 并调用 `load()`
- **THEN** Layer 1 从 `/tmp/test-prompts/` 读取 `.md` 文件

#### Scenario: 生产环境自动定位
- **WHEN** `new PromptLoader()` 并调用 `load()`
- **THEN** Layer 1 从包根目录的 `prompts/` 读取 `.md` 文件

### Requirement: prompts.ts 完全删除
`src/llm/prompts.ts` SHALL 被删除。项目中 SHALL NOT 存在任何对该文件的导入引用。

#### Scenario: 无残留引用
- **WHEN** 在 `src/` 目录中搜索 `from.*prompts`
- **THEN** 无任何匹配结果
