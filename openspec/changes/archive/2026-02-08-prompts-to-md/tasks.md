## 1. 创建包内提示词 .md 文件

- [x] 1.1 创建 `prompts/` 目录，将 `prompts.ts` 中 5 个提示词常量的内容分别写入对应 `.md` 文件（保留 `{{memory}}` 占位符）
- [x] 1.2 验证 5 个 `.md` 文件内容与原常量一致

## 2. 改造 PromptLoader

- [x] 2.1 修改 `src/llm/prompt-loader.ts`：构造函数接受可选 `builtinDir` 参数，未传入时通过 `import.meta.url` 推导包内 `prompts/` 路径
- [x] 2.2 修改 `load()` 方法：Layer 1 从 `builtinDir` 读取 `.md` 文件，移除 `import { DEFAULT_PROMPTS }`

## 3. 删除 prompts.ts

- [x] 3.1 删除 `src/llm/prompts.ts`
- [x] 3.2 确认 `src/` 中无任何对 `prompts.ts` 的残留引用

## 4. 更新测试

- [x] 4.1 修改 `test/llm/prompt-loader.test.ts`：移除 `import { DEFAULT_PROMPTS }`，改用临时 `.md` 文件作为 builtinDir 进行断言
- [x] 4.2 运行 `npx vitest run` 确保所有测试通过

## 5. 验证

- [x] 5.1 运行 `npx biome check src/` 确保代码规范
- [x] 5.2 运行 `npm run build` 确保编译通过
