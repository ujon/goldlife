# API Fuse Docs

API Fuse는 한국 API 생태계를 단일 게이트웨이로 묶은 **AI 에이전트용 통합 API Gateway**다. 카카오맵, 네이버맵, 캐치테이블, 요기요, 기상청, 법령, 당근마켓 등 한국 주요 서비스 API를 하나의 API 키로 호출할 수 있다.

마지막 확인일: 2026-05-30

## 공통

- Source: API Fuse 공식 사이트, API 문서, Playground.
- Spec file: `openapi.json`
- Spec type: OpenAPI 3.1.0
- Official site: <https://apifuse.com/ko>
- API docs: <https://platform.apifuse.com/docs>
- API reference: <https://platform.apifuse.com/docs/api>
- OpenAPI artifact: <https://platform.apifuse.com/api/openapi.json>
- Playground: <https://platform.apifuse.com/playground>
- NPM: <https://www.npmjs.com/package/@apifuse/provider-sdk>
- Signup: <https://platform.apifuse.com/login>
- Auth: `Authorization: Bearer YOUR_API_KEY`
- Production gateway: `https://api.apifuse.com/v1/{providerId}/{operationId}`
- MCP endpoint: `https://api.apifuse.com/mcp`
- MCP: compatible
- Status: local spec captured, smoke test pending.

확인 메모:

- 공식 사이트는 한국 API 16개, 125 operations를 안내한다.
- 2026-05-30에 내려받은 `openapi.json` 기준으로는 provider 15개, path operation 109개가 확인된다.
- CatchTable 예약 생성/취소/내 상태 등 일부 operation은 provider connection이 필요하다. 조회성 operation 대부분은 API Fuse key만 있으면 호출 가능하도록 표시되어 있다.

## 제공 리소스

### 통합 API Gateway

한국 빅테크, 공공, 민간 서비스를 단일 인증과 표준 JSON 응답으로 호출한다.

- 현재 제공: 한국 주요 서비스 16개 API, 125 operations
- 확장 계획: 500+ operations
- 무료 early access
- 서비스별 OAuth가 필요한 경우 one-click 연결
- 서버사이드 CORS 프록시 제공
- 언어 지원: JavaScript, Python, curl

## 현재 OpenAPI 기준 provider 요약

| Provider ID | 서비스 | Operations | 인증/연결 메모 | 사이 활용도 |
|---|---|---:|---|---|
| `kakaomap-api` | KakaoMap Place Search and Directions | 9 | API Fuse key only | P0 |
| `naver-map-api` | Naver Map API | 9 | API Fuse key only | P0 |
| `kma-forecast` | KMA Forecast Data | 3 | API Fuse key only | P0 |
| `airkorea-realtime` | AirKorea Real-time Air Pollution | 1 | API Fuse key only | P0 |
| `catchtable` | CatchTable Restaurant Search and Reservations | 12 | 검색/상세/리뷰/대기 조회는 key only, 예약/취소/내 상태는 connection 필요 | P0 |
| `modu-parking` | Modu Parking | 5 | API Fuse key only | P1 |
| `yogiyo-api` | Yogiyo | 6 | 조회는 key only, 주문/인증 계열은 실제 사용 전 검증 필요 | P1 |
| `naver-flight` | Naver Flight API | 2 | API Fuse key only | P1 |
| `daiso-api` | Daiso Product and Store Data | 17 | API Fuse key only | P2 |
| `market-kurly` | Market Kurly product data | 3 | API Fuse key only | P2 |
| `ohouse-deals` | Ohouse Store and Contents API | 24 | API Fuse key only | P2 |
| `danawa-price` | Danawa price comparison | 3 | API Fuse key only | P2 |
| `daangn-marketplace` | Daangn public listings | 8 | API Fuse key only | P2 |
| `delivery-api` | Carrier List and Delivery Tracking | 3 | API Fuse key only | 제외 후보 |
| `law-service` | National Law Information Search and Lookup | 4 | API Fuse key only | 제외 후보 |

## 주요 카테고리와 사용 가능 API

| 카테고리 | 통합 서비스 | 활용 |
|---|---|---|
| 지도/내비 | 카카오맵, 네이버맵 | 장소 검색, 경로, 대중교통 |
| 음식/예약 | 캐치테이블, 요기요 | 맛집 검색, 예약/음식 후보 |
| 쇼핑 | 다이소, 마켓컬리, 오늘의집, 다나와, 당근마켓 | 가격비교, 쇼핑 큐레이션 |
| 물류/주차 | 배송조회, 모두의주차장 | 배송 추적, 주차장 탐색 |
| 날씨/공공 | 기상청 KMA, 에어코리아, 항공편 검색 | 날씨, 미세먼지, 항공편 |
| 법률 | 한국 법령 DB, 용어 정의 | 법률 리서치, 용어 설명 |

## 사이(SAI) 우선 사용 operation

### P0: 추천 품질에 바로 필요한 API

| 목적 | Operation | 사용 이유 | 주요 입력 | 주요 출력 |
|---|---|---|---|---|
| 장소 후보 검색 | `POST /v1/kakaomap-api/search` | 현재 위치 주변 맛집/카페/공원/전시 등 후보 수집 | `query`, `lat`, `lng`, `radius`, `page` | 장소명, 주소, 좌표, 카테고리, 거리, `confirm_id` |
| 장소 상세 | `POST /v1/kakaomap-api/place` | 후보 상세 검증과 외부 링크 확보 | `confirm_id` | 장소 상세, 좌표, 주소 등 |
| 장소 리뷰 | `POST /v1/kakaomap-api/place-reviews` | 아기 동반/분위기/혼잡도 힌트 추출 | `confirm_id` | 리뷰 목록 |
| 도보 경로 | `POST /v1/kakaomap-api/walk-directions` | 짧은 동선/아기 동반 이동 부담 계산 | 출발/도착 좌표 | 거리, 시간, 경로 |
| 대중교통 경로 | `POST /v1/kakaomap-api/transit-directions` | 차 없는 사용자 이동성 판단 | 출발/도착 좌표 | 이동 시간, 환승 등 |
| 자동차 경로 | `POST /v1/kakaomap-api/car-directions` | 가족/아기 동반, 주차 중심 동선 판단 | 출발/도착 좌표 | 이동 시간, 거리 |
| 보조 장소 검색 | `POST /v1/naver-map-api/search` | 카카오맵 결과 보강, 네이버 URL 확보 | `query`, `lat`, `lng`, `page`, `size` | 장소명, 주소, 좌표, 전화, 네이버맵 URL |
| 보조 장소 상세 | `POST /v1/naver-map-api/place` | 편의시설/상세 정보 보강 | place id | 상세 정보 |
| 보조 리뷰 | `POST /v1/naver-map-api/place-reviews` | 리뷰 기반 동행 적합성 판단 | place id | 리뷰 목록 |
| 현재/단기 날씨 | `POST /v1/kma-forecast/weather-by-address` | 주소 기반 날씨 추천 분기 | address | 날씨 예보 |
| 단기예보 | `POST /v1/kma-forecast/short-forecast` | 위치 기반 날씨 추천 분기 | grid/date/time | 단기예보 |
| 미세먼지 | `POST /v1/airkorea-realtime/realtime` | 야외/실내 가중치 판단 | station/region 계열 입력 | 대기질 등급/측정값 |
| 맛집 검색 | `POST /v1/catchtable/search` | 예약 가능한 식당 후보 수집 | `keyword`, `lat`, `lon`, `limit`, `offset`, `sort` | 식당명, 주소, 평점, 리뷰수, `shopRef` |
| 맛집 상세 | `POST /v1/catchtable/shop` | 음식 종류, 위치, 상세 후보 검증 | `shopRef` | 식당 상세 |
| 맛집 리뷰 | `POST /v1/catchtable/reviews` | 분위기/아기 동반 가능성/만족도 힌트 | `shopRef` | 리뷰 목록 |
| 예약 가능 시간 | `POST /v1/catchtable/availability` | 실행 가능한 추천인지 검증 | `shopRef`, 날짜/인원 | 예약 가능 슬롯 |
| 대기 정보 | `POST /v1/catchtable/waiting-info` | 웨이팅 가능성과 혼잡도 판단 | `shopRef` | 대기 상태 |

### P1: 있으면 추천 완성도가 올라가는 API

| 목적 | Operation | 사용 이유 |
|---|---|---|
| 주차장 검색 | `POST /v1/modu-parking/search-parking` | 아기 동반/가족 코스에서 주차 접근성 확인 |
| 주차 상세 | `POST /v1/modu-parking/parking-detail` | 가격, 주소, 구매 가능성 확인 |
| 공유주차 가능 여부 | `POST /v1/modu-parking/check-availability` | 실제 사용 가능성 확인 |
| 요기요 식당 검색 | `POST /v1/yogiyo-api/find-restaurants` | 외식 fallback 또는 배달 fallback |
| 요기요 식당/메뉴 상세 | `POST /v1/yogiyo-api/restaurant-full` | 메뉴·가격 기반 fallback 구성 |
| 요기요 주문 미리보기 | `POST /v1/yogiyo-api/order-preview` | 주문형 fallback의 예상 비용 확인 |
| 국내/국제 항공 왕복 | `POST /v1/naver-flight/search-flights` | 하루/주말 이상 여행형 확장 |
| 항공 편도 | `POST /v1/naver-flight/search-oneway-flights` | 여행형 확장 |

### P2: 쇼핑/집콕/온라인 fallback API

| 목적 | Operation | 사용 이유 |
|---|---|---|
| 다이소 상품 검색 | `POST /v1/daiso-api/search_products` | 저예산 집콕/준비물 추천 |
| 다이소 매장 검색 | `POST /v1/daiso-api/search_stores` | 근처 구매 가능성 확인 |
| 다이소 재고 | `POST /v1/daiso-api/get_store_inventory` | 실제 구매 가능성 확인 |
| 마켓컬리 상품 검색 | `POST /v1/market-kurly/search-products` | 집밥/홈파티 fallback |
| 오늘의집 상품 검색 | `POST /v1/ohouse-deals/search_products` | 홈데코/집콕 활동 fallback |
| 오늘의집 콘텐츠 검색 | `POST /v1/ohouse-deals/search_cards` | 집에서 할 활동/인테리어 콘텐츠 큐레이션 |
| 다나와 상품 검색 | `POST /v1/danawa-price/search-products` | 가격비교 |
| 다나와 가격 비교 | `POST /v1/danawa-price/compare-products` | 예산 최적화 |
| 당근 중고 검색 | `POST /v1/daangn-marketplace/used-goods-search` | 저예산 중고 구매 fallback |

### 제외 또는 후순위 API

| Provider | 이유 |
|---|---|
| `law-service` | 사이의 시간/예산 활동 추천 MVP와 직접 관련 낮음 |
| `delivery-api` | 물류 추적은 추천 흐름과 직접 관련 낮음 |
| `daangn-marketplace`의 부동산/차량/일자리 | 활동 추천 MVP와 직접 관련 낮음 |

## CatchTable connection 필요 operation

OpenAPI metadata 기준 아래 operation은 `x-apifuse-connection-required: true`다. 데모/MVP에서는 조회성 API를 먼저 쓰고, 실제 예약 생성은 후순위로 둔다.

| Operation | 용도 |
|---|---|
| `POST /v1/catchtable/reserve` | 예약 생성 |
| `POST /v1/catchtable/cancel-reservation` | 예약 취소 |
| `POST /v1/catchtable/reservation-detail` | 예약 상세 |
| `POST /v1/catchtable/register-waiting` | 원격 웨이팅 등록 |
| `POST /v1/catchtable/cancel-waiting` | 웨이팅 취소 |
| `POST /v1/catchtable/my-status` | 내 예약/웨이팅 상태 |

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

## 추천 파이프라인 예시

### 일반 친구/커플 코스

1. `kma-forecast/weather-by-address` 또는 `short-forecast`로 날씨 확인.
2. `airkorea-realtime/realtime`으로 미세먼지 확인.
3. `kakaomap-api/search`와 `naver-map-api/search`로 장소 후보 수집.
4. `catchtable/search`로 맛집 후보 수집.
5. `kakaomap-api/walk-directions` 또는 `transit-directions`로 코스 동선 계산.
6. `catchtable/availability`로 예약 가능성 확인.
7. AI가 시간·예산·취향·날씨·동선을 합쳐 추천 카드 3개 생성.

### 아기 동반 코스

1. 날씨/미세먼지를 먼저 확인하고, 나쁘면 실내 후보로 강하게 전환.
2. 지도 검색어를 `유모차`, `수유실`, `키즈 프렌들리`, `식물원`, `실내 체험`, `대형 카페` 등으로 확장.
3. `kakaomap-api/place-reviews`, `naver-map-api/place-reviews`로 아기 인프라 힌트 확인.
4. `modu-parking/search-parking`으로 주차 가능성을 보강.
5. 아기 인프라를 필수 필터로 적용한 뒤 부모 취향을 반영.

주의: OpenAPI가 편의시설 필드를 별도 구조화해 보장하는 것은 아니다. 아기 인프라는 장소 상세, 카테고리, 리뷰, 검색어 매칭을 종합한 휴리스틱으로 판단하고, 확실하지 않으면 카드에 `정보 확인 필요`로 표시한다.

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
- OpenAPI의 server는 문서용 proxy(`/api/proxy/call`)로 잡혀 있다. 실제 production 호출은 공식 문서의 `https://api.apifuse.com/v1/{providerId}/{operationId}`를 사용한다.
- OpenAPI metadata의 `x-apifuse-connection-required`, `x-read-only`, `x-rate-limit`를 wrapper 생성 시 반영한다.

## 로컬 스펙 상태

현재 로컬에는 APIFuse `openapi.json`을 저장해두었다.

```text
.docs/api-specs/apifuse/
  README.md
  openapi.json
```

TODO:

- API Fuse 계정/API key 확보
- P0 operation smoke test
- CatchTable connection 필요 operation은 실제 계정 연결 범위 확인
- 아기 인프라 판단용 검색어/리뷰 휴리스틱 정의
