# Rocketpunch API 명세

- 출처: OBA 노션 페이지에서 참조한 Rocketpunch Open API 문서
- 로컬 원본: `.docs/.addniner/sponsor-docs/rocketpunch/openapi.json`
- 명세 파일: `openapi.json`
- 명세 형식: OpenAPI 3.1.0
- 기본 URL: `https://openapi.rocketpunch.com`
- 인증: `X-OBA-API-Key`
- 키 발급: 행사 기준 별도 빌더 가입 없음. 행사 운영팀이 팀별 API 키를 배포
- 상태: 클라이언트 생성 가능, smoke test 필요

## 참고

- OpenAPI 설명에는 Rocketpunch 포털에서 App 등록 후 appKey를 발급받는 흐름도 언급되어 있습니다. 행사에서는 OBA 노션 안내에 따라 운영팀이 배포한 키를 사용합니다.
- 노션 페이지는 이 API를 실제 서비스에 영향 없는 샌드박스 환경으로 설명합니다.
