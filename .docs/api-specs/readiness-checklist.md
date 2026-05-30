# 서비스 연결용 API/MCP 체크리스트

목적: SAI 서비스 백엔드에 붙일 후원사 리소스를 빠르게 판단하기 위한 표입니다. REST API로 붙일지, MCP client로 붙일지, API spec과 key가 충분한지, 현재 MVP에 넣을지 한 곳에서 봅니다.

범례: ✅ 가능/준비됨, ❌ 불가/불필요, 🟡 일부 가능/확인 필요, ⚪ 해당 없음, ❓ 미확인.

## SAI 직접 사용 대상

| 리소스 | 역할 | 연결 / Spec 상태 | Key / 인증 |
| --- | --- | --- | --- |
| API Fuse | 맛집(캐치테이블), 날씨(기상청), 동선(카카오맵) | 🟡 REST gateway 우선, MCP도 가능. OpenAPI 3.1 embedded라 provider별 추출 필요 | ✅ 셀프 발급. ApiFuse 단일 API key |
| Myrealtrip | 투어/액티비티, 항공, 숙박, 예약 딥링크 | 🟡 REST API + MCP. 로컬 OpenAPI 없음, 문서 기반 endpoint catalog 필요 | ✅ 마케팅파트너 가입 후 Bearer API key. MCP는 인증 불필요로 기재 |
| GenRank | 트렌드/키워드 시드 | ✅ REST API. Custom API docs JSON 있음, OpenAPI는 아님 | ❌ 무인증 공개 GET |
| tobl.ai / Cocoun | MBTI/취향 페르소나 council, 투표 결과 | 🟡 Remote MCP. tool 정보 있음, 실제 `tools/list` schema 필요 | ✅ cocoun.org `/builder`에서 X-API-Key 셀프 발급 |
| LG U+ / EXAONE | 한국어 음성 NLU, 페르소나 카피 생성 | 🟡 Friendli serverless model runtime. OpenAI-compatible Chat Completions 방식 | 🟡 Friendli API key 발급 필요 |
| Swing | 택시 ETA, 주변 공유 모빌리티 보조 정보 | ✅ REST API. OpenAPI 3.0.1 있음, 2 paths | ✅ 운영팀 현장 배포 stage key. `X-API-KEY` |

## SAI 제외 / 후순위 리소스

| 리소스 | 역할 | 제외 / 후순위 이유 | 참고 상태 |
| --- | --- | --- | --- |
| Rocketpunch | 채용/커리어/비즈니스 SNS 데이터 | SAI의 데이트·혼놀·여행 코스 추천과 직접 무관 | ✅ OpenAPI 3.1.0 있음. `secondary/rocketpunch`에 보관 |
| Gangnam Unni | 뷰티/의료 확장 후보 | 현재 PRD 핵심 코스 구성 요소가 아님 | 🟡 Remote MCP. `tools/list` JSON 없음 |
| CryptoQuant | 크립토/온체인/시장 데이터 | SAI 도메인과 무관 | 🟡 REST/MCP docs만 있음, OpenAPI 없음 |
| Maroo | 블록체인 RPC/Agent Wallet | SAI 코스 추천과 무관 | 🟡 표준 EVM RPC는 사용 가능. MAWS/MCP schema 없음 |
| GGUI | 생성형 UI OSS/MCP 템플릿 | PRD에 퀄리티 미달로 미사용 명시. 제품 데이터 API도 아님 | 🟡 MCP/OSS template. `tools/list` schema 없음 |
| GS Neotek / MISO | AI 에이전트/워크플로우 플랫폼 | PRD 파이프라인에 없고 API/SDK 문서도 없음 | ❓ 현재 API spec 없음 |
| Moat AI / Tower Standalone | OSS starter app | 우리 앱의 데이터/API 파이프라인과 직접 무관 | ⚪ 후원사 제공 API spec 아님 |
| Nexon | Unreal package / game server env | SAI 모바일 웹/코스 추천과 무관 | ⚪ API spec 아님 |
