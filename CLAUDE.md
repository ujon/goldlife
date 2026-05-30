# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is a symlink to this file, so Codex CLI (and other AGENTS.md-aware agents) follow the same rules from a single source of truth.

## Repository state

This repo is a pre-source-code scaffold. There is no `package.json`, no source tree, no build/lint/test tooling configured, and no git history yet. The only contents are vendored agent skills:

- `skills-lock.json` pins two Svelte skills from `sveltejs/ai-tools` (`svelte-code-writer`, `svelte-core-bestpractices`).
- `.agents/skills/` contains the materialized copies of those skill bundles, including reference docs for runes, snippets, each blocks, `@attach`, `bind`, await expressions, and reactivity.

The presence of these pinned skills — and nothing else — signals that the intended stack is **Svelte 5 / SvelteKit**. Use that as the default when scaffolding new code, unless the user says otherwise.

## Svelte tooling

When working on `.svelte`, `.svelte.ts`, or `.svelte.js` files, the `@sveltejs/mcp` CLI is available via `npx` (no install needed):

```bash
# Discover available doc sections, then fetch specific ones
npx @sveltejs/mcp list-sections
npx @sveltejs/mcp get-documentation "$state,$derived,$effect"

# Lint a Svelte file or inline snippet (escape $ as \$ in inline code)
npx @sveltejs/mcp svelte-autofixer ./src/lib/Component.svelte
npx @sveltejs/mcp svelte-autofixer ./Component.svelte --svelte-version 4
```

Run `svelte-autofixer` on any Svelte component before considering it done.

## Svelte 5 conventions enforced by the vendored skills

Future Claude instances should treat these as project defaults — they come from `.agents/skills/svelte-core-bestpractices/SKILL.md` and override habits from older Svelte:

- **Runes mode only.** Use `$state`, `$derived`, `$props`, `$effect`. No `export let`, no `$:`, no `$$props`/`$$restProps`, no stores for shared reactivity (use classes with `$state` fields).
- **Reactivity scope.** Only wrap a variable in `$state` if a `$derived`, `$effect`, or template expression depends on it. Use `$state.raw` for large objects that are reassigned rather than mutated (e.g. API responses).
- **Prefer `$derived` over `$effect`.** Effects are an escape hatch; never assign state inside one. For complex expressions use `$derived.by`. For props-derived values, always use `$derived` so they update when props change.
- **Events.** Use `onclick={...}` (and other `on*` attributes), not `on:click`. Use `<svelte:window>` / `<svelte:document>` for global listeners instead of `onMount`/`$effect`.
- **Templates.** Use `{#snippet}` + `{@render}` instead of `<slot>`; use keyed `{#each}` (never index-as-key); use `{@attach ...}` instead of `use:action`; use `<DynamicComponent>` instead of `<svelte:component>`; use a self-import + `<Self>` instead of `<svelte:self>`.
- **Styling cross-component.** Prefer CSS custom properties passed as attributes (`<Child --color="red" />`) over `:global`. Pass JS values into CSS via `style:--name={value}`.
- **State sharing.** Prefer `createContext` (type-safe) over `setContext`/`getContext`, and prefer context over module-scope state (avoids SSR cross-user leaks).
- **Async.** `await` expressions in components require Svelte ≥ 5.36 and `experimental.async` in `svelte.config.js` — only reach for them if those are set.

## Commit conventions

Commit message **body is written in Korean**, but **do not use a Conventional Commits prefix** (`feat:`, `fix:`, `chore:`, etc.).

Format:

```
<Subject line — one-line Korean summary of the change>

## summary
<1–3 sentences in Korean explaining the motivation and context>

## changes
- <Concrete change 1, in Korean>
- <Concrete change 2, in Korean>
- <Add as many bullets as needed>
```

Rules:
- The subject line starts directly with the Korean summary — no prefix, no scope tag.
- Header names `## summary` and `## changes` stay in English; their bodies are Korean.
- `## changes` is a bulleted list (`- `), one concrete change per item.
- Bodies should explain *why* the change was made, not just *what* changed.
- These rules apply to both Claude Code and Codex CLI (`AGENTS.md` is a symlink to this file).

Example:

```
로그인 폼 검증 로직 단순화

## summary
중복되던 검증 분기를 한 곳으로 모아 유지보수 비용을 줄이기 위한 작업.

## changes
- 이메일/비밀번호 검증을 `validateLoginInput` 헬퍼로 통합
- 사용되지 않던 `legacyCheck` 제거
- 검증 실패 시 메시지 키를 i18n 사전으로 일원화
```

## Updating skills

The pinned skills have content hashes in `skills-lock.json`. If `.agents/skills/**` is edited by hand, the hash will diverge from the lockfile; treat the lockfile as the source of truth and re-sync rather than committing drift.
