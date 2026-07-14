# Clean-room Skills

A small, provider-neutral TypeScript implementation of progressively disclosed
agent skills. It is intentionally independent from the restored source tree in
the parent repository.

## Skill format

Create `~/.my-agent/skills/code-review/SKILL.md` or
`<project>/.my-agent/skills/code-review/SKILL.md`:

```md
---
name: code-review
description: Review code for correctness and regressions
allowed-tools:
  - read_file
  - search_files
user-invocable: true
model-invocable: true
execution: isolated
version: "1"
---

Review the requested changes.

User request: {{args}}
```

Only the documented frontmatter keys are accepted. The directory name and
`name` must match. Symbolic-link skill directories and files are rejected.
Markdown shell substitution is not implemented.

## Usage

```ts
import {
  SkillLoader,
  SkillRegistry,
  SkillTool,
  SkillWatcher,
} from '@gsms/skills-core'

const loader = new SkillLoader()
const registry = new SkillRegistry()
const watcher = new SkillWatcher(loader, registry, {
  onDiagnostics: diagnostics => console.error(diagnostics),
})

await watcher.start()

// Put this compact listing in the model's initial context.
const availableSkills = registry.formatForModel()

const skillTool = new SkillTool(registry)
const modelTool = skillTool.asModelTool({
  availableTools: ['read_file', 'search_files', 'write_file'],
  authorizeProjectSkill: skill => confirmProjectSkill(skill),
  runIsolated: request => runAgentInIsolatedContext(request),
  onInvocation: record => auditLog(record),
})
```

`allowed-tools` declares the tools a skill expects or may pre-authorize. It
cannot name a tool that is absent from `availableTools`. Inline skills return a
new user message and do not hide other visible tools; the host runtime's normal
tool surface and permission policy still apply. Isolated skills delegate
execution to the supplied `runIsolated` adapter with the declared tool subset.
Project skills require an authorization callback on first execution.

## Commands

```sh
npm install
npm test
npm run typecheck
```
