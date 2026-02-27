## MODIFIED Requirements

### Requirement: Simplified main.ts flow
The `main.ts` entry point SHALL execute in 3 phases:
1. **Bootstrap**: Initialize MemoryStore, EmbeddingProvider, sync memory files, discover skills, create ContextManager, SignalRouter, MainAgent
2. **Execution**: Call `mainAgent.executeGoal(goal)` directly
3. **Summary**: Generate session summary and persist to memory

#### Scenario: Normal execution
- **WHEN** user runs `clipilot "Fix the login bug"`
- **THEN** the system bootstraps, calls `executeGoal("Fix the login bug")`, and summarizes the session

## ADDED Requirements

### Requirement: create_session working_dir parameter
The `create_session` tool SHALL accept an optional `working_dir` parameter (string). When provided, the tmux session and coding agent SHALL be launched in the specified directory. When omitted, the system SHALL use `process.cwd()` as the working directory.

#### Scenario: create_session with explicit working_dir
- **WHEN** MainAgent calls `create_session` with `working_dir: "/home/user/my-app"`
- **THEN** the tmux session is created with cwd set to `/home/user/my-app` and the coding agent launches in that directory

#### Scenario: create_session without working_dir
- **WHEN** MainAgent calls `create_session` without `working_dir`
- **THEN** the tmux session is created with cwd set to `process.cwd()` (backward compatible)

#### Scenario: working_dir directory does not exist
- **WHEN** MainAgent calls `create_session` with `working_dir: "/nonexistent/path"`
- **THEN** the tool returns an error message indicating the directory does not exist

### Requirement: sessionWorkingDir state
MainAgent SHALL maintain a `sessionWorkingDir` instance variable that tracks the working directory of the current session. This variable SHALL be initialized to `process.cwd()` and updated when `create_session` is called with a `working_dir` parameter.

#### Scenario: sessionWorkingDir set on create_session
- **WHEN** `create_session` is called with `working_dir: "/home/user/project"`
- **THEN** `sessionWorkingDir` is set to `/home/user/project`

#### Scenario: sessionWorkingDir default
- **WHEN** MainAgent is instantiated and no session has been created
- **THEN** `sessionWorkingDir` equals `process.cwd()`

### Requirement: Prompt execution paths guidance
The `main-agent.md` prompt SHALL include an "Execution Paths" section that describes the two execution paths available to MainAgent:
1. `exec_command` for direct read-only reconnaissance
2. `send_to_agent` for all mutations, verification, and git operations

The section SHALL describe the four-step work pattern: Reconnoiter → Command → Observe → Iterate.

#### Scenario: Prompt contains execution paths
- **WHEN** the system prompt is rendered for MainAgent
- **THEN** it includes the "Execution Paths" section with guidance on when to use each path and the four-step work pattern
