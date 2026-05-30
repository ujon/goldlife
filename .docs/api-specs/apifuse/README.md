# API Fuse Docs

API Fuse는 한국 API 생태계를 단일 게이트웨이로 묶은 **AI 에이전트용 통합 API Gateway**다. 카카오맵, 네이버맵, 캐치테이블, 요기요, 기상청, 법령, 당근마켓 등 한국 주요 서비스 API를 하나의 API 키로 호출할 수 있다.

마지막 확인일: 2026-05-30

## 공통

- Source: API Fuse 공식 사이트, API 문서, Playground.
- Spec file: local `openapi.json` not captured yet.
- Spec type: auto-generated OpenAPI 3.1 according to API Fuse documentation.
- Official site: <https://apifuse.com/ko>
- API docs: <https://platform.apifuse.ai/docs>
- Playground: <https://platform.apifuse.com/playground>
- NPM: <https://www.npmjs.com/package/@apifuse/provider-sdk>
- Signup: <https://platform.apifuse.com/login>
- Auth: single API key.
- MCP: compatible.
- Status: account/API key required before local spec capture and smoke test.

## 제공 리소스

### 통합 API Gateway

한국 빅테크, 공공, 민간 서비스를 단일 인증과 표준 JSON 응답으로 호출한다.

- 현재 제공: 한국 주요 서비스 16개 API, 125 operations
- 확장 계획: 500+ operations
- 무료 early access
- 서비스별 OAuth가 필요한 경우 one-click 연결
- 서버사이드 CORS 프록시 제공
- 언어 지원: JavaScript, Python, curl

## 주요 카테고리

| 카테고리 | 통합 서비스 | 활용 |
|---|---|---|
| 지도/내비 | 카카오맵, 네이버맵 | 장소 검색, 경로, 대중교통 |
| 음식/예약 | 캐치테이블, 요기요 | 맛집 검색, 예약/음식 후보 |
| 쇼핑 | 다이소, 마켓컬리, 오늘의집, 다나와, 당근마켓 | 가격비교, 쇼핑 큐레이션 |
| 물류/주차 | 배송조회, 모두의주차장 | 배송 추적, 주차장 탐색 |
| 날씨/공공 | 기상청 KMA, 에어코리아, 항공편 검색 | 날씨, 미세먼지, 항공편 |
| 법률 | 한국 법령 DB, 용어 정의 | 법률 리서치, 용어 설명 |

## 사이(SAI)에서의 활용

API Fuse는 사이 추천 파이프라인에서 **한국 로컬 컨텍스트**를 채우는 핵심 게이트웨이다.

| 기능 | API Fuse 활용 |
|---|---|
| 현재 위치 기반 후보 수집 | 카카오맵/네이버맵 장소 검색 |
| 동선 계산 | 지도/대중교통/경로 API |
| 맛집 후보 | 캐치테이블, 요기요 |
| 날씨 판단 | 기상청 KMA, 에어코리아 |
| 아기 동반 추천 | 지도 장소 정보, 주차, 실내 대피 가능 후보, 키즈 프렌들리 장소 후보 |
| 가격/구매 fallback | 다이소, 마켓컬리, 오늘의집, 다나와, 당근마켓 |

## 빌더가 할 수 있는 것

- 다중 서비스 통합 푸드·예약 에이전트
- 한국 로컬 어시스턴트: 지도 + 날씨 + 로컬 비즈니스
- 가격비교·쇼핑 큐레이션 봇
- 물류·주차 추적 대시보드
- 법률 리서치 어시스턴트

## 가입 / 인증 / 사용

1. <https://platform.apifuse.com/login> 에서 무료 early access 가입.
2. API 키 발급.
3. API 문서 또는 Playground에서 필요한 operation 확인.
4. 단일 API 키로 통합 서비스 호출.
5. 서비스별 OAuth가 필요한 경우 one-click 연결.

## 구현 메모

- API 키는 서버에서만 사용한다.
- 프론트엔드에서 API Fuse를 직접 호출하지 않는다.
- API Fuse 응답을 앱 내부 추천 후보 스키마로 매핑한다.
- 외부 서비스별 장애나 rate limit은 API Fuse wrapper에서 내부 에러 코드로 통일한다.
- `docs`와 `Playground`를 endpoint, request, response의 단일 출처로 본다.
- 계정 접근 후 auto-generated OpenAPI 3.1 스펙을 내려받을 수 있으면 `.docs/api-specs/apifuse/openapi.json`으로 저장한다.

## 로컬 스펙 상태

현재 로컬에는 APIFuse `openapi.json`이 없다.

```text
.docs/api-specs/apifuse/
  README.md
```

TODO:

- API Fuse 계정/API key 확보
- Playground에서 실제 operation 목록 확인
- auto-generated OpenAPI 3.1 스펙 export 경로 확인
- 가능하면 `openapi.json` 저장
- 사이 MVP에서 필요한 operation만 smoke test
