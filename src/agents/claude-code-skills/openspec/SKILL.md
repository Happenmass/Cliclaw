---
name: openspec
description: "Spec-driven development workflow for structured changes"
type: agent-capability
commands:
  - /opsx:explore
  - /opsx:propose
  - /opsx:apply
  - /opsx:archive
when:
  files: ["openspec"]
---

# OpenSpec Skill

OpenSpec 提供规范驱动的开发工作流。适用于涉及多文件、架构变更、需要前期规划的复杂任务。

## 适用场景

- 涉及多文件/模块的复杂功能
- 需要设计决策的架构变更
- 需要规范和任务跟踪的变更

## 命令

### /opsx:explore
进入探索模式——思考问题、调查代码库、讨论需求。在提出正式方案前使用，帮助澄清问题和方向。

### /opsx:propose
提出变更方案——一步生成所有产物：proposal.md, design.md, specs/, tasks.md。适合目标明确的变更。

### /opsx:apply
按 tasks.md 中的任务列表逐步实现。读取 proposal, design, specs 作为上下文。

### /opsx:archive
归档已完成的变更，将 delta specs 同步到主 specs。

## 工作流

1. **探索** (`/opsx:explore`) — 可选：思考问题、调查现状
2. **提案** (`/opsx:propose`) — 定义要做什么、怎么做
3. **实现** (`/opsx:apply`) — 按任务列表逐步执行
4. **归档** (`/opsx:archive`) — 完成并归档

## Tips for MainAgent

- 复杂任务优先使用 `/opsx:propose` 进行规划后再实现
- 涉及重大重构时，先用 `/opsx:explore` 探索
- 构建包含 OpenSpec 命令的 prompt 时，附上具体的文件路径、函数名、约束条件等上下文
