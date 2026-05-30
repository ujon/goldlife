# GenRank API 문서

- 출처: OBA 노션 페이지에서 참조한 GenRank API Docs JSON
- 로컬 원본: `.docs/.addniner/sponsor-docs/genrank/api-docs.json`
- 명세 파일: `api-docs.json`
- 명세 형식: 자체 API 문서 JSON, OpenAPI 아님
- 기본 URL: `https://www.genrank.com`
- 인증: 없음
- 키 발급: 없음. 가입이나 API 키가 필요하지 않음
- 상태: 수동 wrapper 작성 가능, smoke test 필요

## 참고

- 이 파일은 타입이 있는 fetch wrapper를 작성하기에는 충분히 구조화되어 있지만, OpenAPI 클라이언트 생성기에 바로 사용할 수는 없습니다.
- OBA 노션 페이지 기준으로 읽기 전용 공개 GET API입니다.
