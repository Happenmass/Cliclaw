## Context

当前 CLIPilot 的 5 个系统提示词以 TypeScript 模板字符串硬编码在 `src/llm/prompts.ts` 中，通过 `DEFAULT_PROMPTS` 对象导出给 `PromptLoader` 作为 Layer 1 默认值。`PromptLoader` 已实现三层加载机制（内置 → 用户级 → 项目级），但 Layer 1 的数据源是编译后的 JS 常量而非文件系统。

## Goals / Non-Goals

**Goals:**
- 将提示词从 `.ts` 源码完全迁移到 `prompts/*.md` 文件
- `PromptLoader` Layer 1 从包内 `prompts/` 目录读取 `.md` 文件
- 删除 `src/llm/prompts.ts`
- 保持三层覆盖机制不变
- 构造函数支持注入 `builtinDir` 以便测试

**Non-Goals:**
- 不改变 Layer 2（`~/.clipilot/prompts/`）和 Layer 3（项目级）的行为
- 不改变模板变量替换机制（`{{memory}}` 等）
- 不添加 `clipilot init` 命令或自动拷贝提示词到用户目录

## Decisions

### D1: 包内 `.md` 文件放在项目根目录 `prompts/`

`.md` 文件放在包根目录 `prompts/` 下，而非 `src/prompts/` 或 `dist/prompts/`。

理由：`prompts/` 是静态资源不需要编译，放在根目录语义清晰。`tsc` 的 `rootDir` 是 `src/`，不会处理根目录的 `.md` 文件。npm 打包时默认包含（无 `files` 字段限制）。

### D2: 通过 `import.meta.url` 定位包根目录

`prompt-loader.ts` 使用 `import.meta.url` → `fileURLToPath` → `dirname` 两级向上，定位到包根目录的 `prompts/`。

```
运行时：dist/llm/prompt-loader.js
  → dirname(dirname(__filename)) → 包根目录
  → join("prompts") → prompts/
```

开发态和 npm 安装后路径结构一致，无需区分环境。

替代方案：`process.cwd()` 相对路径 — 被拒绝，因为 `cwd` 不一定是包安装目录。

### D3: 构造函数接受可选 `builtinDir` 参数

```typescript
constructor(builtinDir?: string)
```

未传入时自动用 `import.meta.url` 推导。测试时传入临时目录，避免 mock `import.meta.url`。

### D4: `prompts.ts` 完全删除，不保留 fallback

不保留任何硬编码 fallback。如果包内 `.md` 文件缺失，该提示词为空字符串（与当前 `getRaw()` 对缺失 key 的行为一致）。

## Risks / Trade-offs

- **[风险] 包内 `.md` 文件缺失** → 构建/发布流程中确保 `prompts/` 目录完整。未来若加 `files` 字段需显式包含 `"prompts"`。
- **[权衡] 异步文件读取 vs 同步常量** → Layer 1 从同步的 `import` 变为异步 `readFile`，但 `load()` 本就是异步方法，无影响。
