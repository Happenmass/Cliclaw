## ADDED Requirements

### Requirement: exec_command tool definition
MainAgent SHALL expose an `exec_command` tool with the following parameters:
- `command` (string, required): The bash command to execute
- `cwd` (string, optional): Working directory for execution
- `timeout` (number, optional): Timeout in milliseconds, default 30000

#### Scenario: Basic command execution
- **WHEN** MainAgent calls `exec_command` with `command: "ls -la /home/user/project"`
- **THEN** the system executes the command via `bash -c` and returns stdout content

#### Scenario: Command with explicit cwd
- **WHEN** MainAgent calls `exec_command` with `command: "cat package.json"` and `cwd: "/home/user/project"`
- **THEN** the command executes in the specified directory and returns the file content

### Requirement: exec_command cwd fallback chain
When `cwd` is not specified in the tool call, the system SHALL resolve the working directory in this order:
1. `sessionWorkingDir` (set by `create_session` when a session exists)
2. `process.cwd()` (fallback when no session exists)

#### Scenario: cwd inherits session working directory
- **WHEN** `create_session` was called with `working_dir: "/home/user/project"` and `exec_command` is called without `cwd`
- **THEN** the command executes in `/home/user/project`

#### Scenario: cwd falls back to process.cwd before session creation
- **WHEN** no session has been created yet and `exec_command` is called without `cwd`
- **THEN** the command executes in `process.cwd()`

#### Scenario: explicit cwd overrides session working directory
- **WHEN** `create_session` was called with `working_dir: "/home/user/project"` and `exec_command` is called with `cwd: "/tmp"`
- **THEN** the command executes in `/tmp`, ignoring the session working directory

### Requirement: exec_command output truncation
The system SHALL truncate `exec_command` output (stdout + stderr combined) to 10000 characters. When truncation occurs, the system SHALL append a notice indicating the output was truncated and the total original length.

#### Scenario: Output within limit
- **WHEN** a command produces 5000 characters of output
- **THEN** the full output is returned without modification

#### Scenario: Output exceeds limit
- **WHEN** a command produces 25000 characters of output
- **THEN** only the first 10000 characters are returned, followed by a truncation notice such as `\n\n[Output truncated: 25000 chars total, showing first 10000]`

### Requirement: exec_command timeout
The system SHALL enforce a timeout on `exec_command` execution. The default timeout SHALL be 30000 milliseconds. When timeout is exceeded, the process SHALL be killed and an error message returned.

#### Scenario: Command completes within timeout
- **WHEN** `exec_command` runs `ls` which completes in 50ms
- **THEN** the output is returned normally

#### Scenario: Command exceeds timeout
- **WHEN** `exec_command` runs a command that takes longer than the specified timeout
- **THEN** the process is killed and the tool returns an error message indicating timeout

#### Scenario: Custom timeout
- **WHEN** `exec_command` is called with `timeout: 5000`
- **THEN** the command is killed if it runs longer than 5 seconds

### Requirement: exec_command error handling
When the executed command exits with a non-zero exit code, the system SHALL return both stdout and stderr content with the exit code, rather than throwing an error.

#### Scenario: Command fails with non-zero exit code
- **WHEN** `exec_command` runs `cat nonexistent.txt` which exits with code 1
- **THEN** the tool returns the stderr content prefixed with the exit code, such as `[exit code: 1]\ncat: nonexistent.txt: No such file or directory`

#### Scenario: Command not found
- **WHEN** `exec_command` runs `nonexistent_binary`
- **THEN** the tool returns an error message indicating the command was not found

### Requirement: exec_command read-only prompt constraint
The `main-agent.md` prompt SHALL include explicit guidance that `exec_command` is for read-only reconnaissance only. The prompt SHALL specify:
- An allowed operations list: reading files, browsing directories, searching code, checking environment info, inspecting metadata
- A prohibited operations list: writing/creating/deleting files, running tests or builds, executing git operations, installing dependencies, any command with side effects
- A fallback rule: when uncertain whether a command is read-only, use `send_to_agent` instead

#### Scenario: Prompt includes exec_command guidance
- **WHEN** the system prompt is constructed for MainAgent
- **THEN** it contains the "Execution Paths" section with both allowed and prohibited operation lists for `exec_command`
