# CLAUDE.md

`AGENTS.md` is a symlink to this file. Keep this file as the single minimal source of agent guidance.

## Stack

- Frontend/app: SvelteKit, Svelte 5, TypeScript
- Database: PostgreSQL
- Package manager for `app/`: bun

## Product And Docs

- Read `.docs/*` before product/API/design work.
- Key docs live under `.docs/PRD.md` and `.docs/api-specs/`.
- Treat `.docs/api-specs/**/openapi.json` as source material for API wrappers when present.
- If no `openapi.json` exists for an API, check `.docs/api-specs/**/*.md` for available details.

## Svelte

- Use Svelte 5 runes mode: `$state`, `$derived`, `$props`, `$effect`.
- Prefer `$derived` over `$effect`; do not assign state inside effects.
- Use `onclick={...}` style events, keyed `{#each}`, and snippets/render tags instead of legacy Svelte patterns.
- When editing `.svelte`, `.svelte.ts`, or `.svelte.js`, use the vendored Svelte skills and run:

```bash
npx @sveltejs/mcp svelte-autofixer <file>
```

## Commits

- Before creating commits, read `.claude/rules/commit-conventions.md`.
- Do not edit `.agents/skills/**` by hand; pinned skills are controlled by `skills-lock.json`.
