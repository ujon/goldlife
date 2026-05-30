# Commit conventions

Commit message body is written in Korean, but do not use a Conventional Commits prefix (`feat:`, `fix:`, `chore:`, etc.).

## Format

```text
<Subject line - one-line Korean summary of the change>

## summary
<1-3 sentences in Korean explaining the motivation and context>

## changes
- <Concrete change 1, in Korean>
- <Concrete change 2, in Korean>
- <Add as many bullets as needed>
```

## Rules

- The subject line starts directly with the Korean summary. Do not add a prefix or scope tag.
- Header names `## summary` and `## changes` stay in English. Their bodies are written in Korean.
- `## changes` is a bulleted list (`- `), one concrete change per item.
- Bodies should explain why the change was made, not just what changed.
- These rules apply to both Claude Code and Codex CLI.

## Example

```text
로그인 폼 검증 로직 단순화

## summary
중복되던 검증 분기를 한 곳으로 모아 유지보수 비용을 줄이기 위한 작업.

## changes
- 이메일/비밀번호 검증을 `validateLoginInput` 헬퍼로 통합
- 사용되지 않던 `legacyCheck` 제거
- 검증 실패 시 메시지 키를 i18n 사전으로 일원화
```
