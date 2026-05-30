# GenRank API Docs

- Source: GenRank API Docs JSON referenced from OBA Notion pages.
- Local source: `.docs/.addniner/sponsor-docs/genrank/api-docs.json`
- Spec file: `api-docs.json`
- Spec type: custom API docs JSON, not OpenAPI.
- Base URL: `https://www.genrank.com`
- Auth: none.
- Status: manual wrapper ready, smoke test pending.

Notes:

- This file is structured enough to write typed fetch wrappers, but it cannot be used directly with OpenAPI client generators.
- The API is read-only public GET according to the OBA Notion page.
