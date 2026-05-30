# CLAUDE.md

App-local reminder. Root `../CLAUDE.md` is the primary agent guide.

- Stack: SvelteKit, Svelte 5, TypeScript, bun.
- Product/API context: read `../.docs/*`, especially `../.docs/PRD.md` and `../.docs/api-specs/`; if no `openapi.json` exists, check API spec Markdown files.
- Use Svelte 5 runes and avoid legacy Svelte syntax.
- Run `npx @sveltejs/mcp svelte-autofixer <file>` after editing Svelte files.
