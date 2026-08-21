# AGENTS.md

## Core Purpose
WireParity tests whether SDKs generated from the same OpenAPI spec produce semantically equivalent HTTP requests across languages.

## Guidelines
- **Stack**: Main orchestration code is TypeScript and Node. Keep documentation and configuration concise.
- **Scope**: Work on one subsystem at a time. Do not build future features unless explicitly requested.
- **Code Changes**: Prefer small diffs and simple abstractions. Do not change application code unless tasked.
- **Context**: Read only files relevant to the current task.
- **Verification**: Always run relevant tests and typecheck (`pnpm typecheck && pnpm test`) before finishing a task.
- **Version Control**: After each completed working task, commit and push using short lowercase conventional commit messages.
