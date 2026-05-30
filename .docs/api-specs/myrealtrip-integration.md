# 마이리얼트립 사용 가능 API 정리

마이리얼트립 마케팅파트너 REST API와 MCP 도구 중 프로토타입에서 바로 활용할 수 있는 API 표면적을 정리한다.

마지막 확인일: 2026-05-30

## 공통

REST Base URL:

```text
https://partner-ext-api.myrealtrip.com
```

REST 인증:

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

MCP endpoint:

```text
https://mcp-servers.myrealtrip.com/mcp
```

공통 응답 형태:

```json
{
  "data": {},
  "meta": {
    "totalCount": 0
  },
  "result": {
    "status": 200,
    "message": "SUCCESS",
    "code": "success"
  }
}
```

Rate limit:

| API군 | 한도 |
| --- | ---: |
| 항공권 조회 | 1,000건/분 |
| 숙소 지역 자동완성 | 1,000건/분 |
| 숙소 검색 | 50건/분 |
| 투어티켓 검색·카테고리·상세 | 200건/분 |
| 투어티켓 옵션 | 50건/분 |
| 투어티켓 캘린더 | 100건/분 |

제약:

- `429 Too Many Requests`: `X-RateLimit-Remaining` 확인 후 1분 이상 대기 또는 backoff.
- 비항공 리포트 조회 기간: 최대 6개월.
- 항공 리포트 조회 기간: 최대 1개월.
- 기간 초과나 필수 파라미터 누락은 `400 Bad Request`.

## REST 상품 API

### 항공권 조회

항공 API는 공항 선택 API와 최저가 캘린더 API로 나뉜다. 캘린더 계열 4종은 순서대로 모두 호출하는 API가 아니라 목적에 맞는 하나를 선택한다.

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `POST` | `/v1/products/flight/airport-autocomplete` | 공항·도시 키워드 검색 | `keyword*`, `size` | `airports[].airport.code`, `city`, `country` |
| `POST` | `/v1/products/flight/airports` | 전체 공항 목록 조회 | `sort`, `order`, `size`, `page` | 공항 목록, `page`, `size` |
| `POST` | `/v1/products/flight/calendar` | 특정 출발지-도착지의 날짜별 최저가 | `depCityCd*`, `arrCityCd*`, `period*`, `startDate*`, `endDate*` | `departureDate`, `returnDate`, `totalPrice`, `airline`, `transfer` |
| `POST` | `/v1/products/flight/calendar/window` | 180일 슬라이딩 윈도우 최저가 | `depCityCd*`, `arrCityCd*`, `period*` | 날짜별 최저가 |
| `POST` | `/v1/products/flight/calendar/lowest` | 다중 목적지 최저가 | `depCityCd*`, `arrCityCds*`, `period*` | 목적지별 최저가 |
| `POST` | `/v1/products/flight/calendar/bulk-lowest` | 전체 목적지 최저가 대량 조회 | `depCityCd*`, `period*` | 전체 목적지 최저가 |

주의:

- 항공 최저가 API의 `depCityCd`, `arrCityCd`, `arrCityCds`는 이름은 city code지만 실제 입력은 IATA 공항코드다.
- 공항 자동완성 응답에서 `city.code`가 아니라 `airport.code`를 사용한다. 예: 서울 `SEL`이 아니라 인천 `ICN`.
- `calendar/window`, `calendar/lowest`, `calendar/bulk-lowest`는 국제선만 지원한다.

### 숙소 조회

숙소 API는 지역 검색 후 `regionId`로 숙소 목록을 조회하는 흐름이다.

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `POST` | `/v1/products/accommodation/region-autocomplete` | 지역 자동완성 | `keyword*`, `isDomestic*` | `regions[].regionId`, `name`, `subName`, `type` |
| `POST` | `/v1/products/accommodation/search` | 숙소 검색 | `regionId*`, `checkIn*`, `checkOut*`, `adultCount*`, `childCount`, `starRating`, `page`, `size` | `items[].itemId`, `itemName`, `salePrice`, `starRating`, `reviewScore`, `reviewCount`, `imageUrl` |

활용 포인트:

- 추천 랭킹은 `salePrice`, `starRating`, `reviewScore`, `reviewCount`를 함께 사용한다.
- 검색 결과의 `itemId`로 `https://www.myrealtrip.com/offers/{itemId}` 상품 URL을 만들 수 있다.
- 숙소 `page`는 0부터 시작하고 `size`는 최대 50이다.

### 투어티켓 조회

투어티켓 API는 검색 후 `gid`로 상세·옵션·캘린더를 선택 조회한다.

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `POST` | `/v1/products/tna/categories` | 도시별 카테고리 목록 | `city*` | `categories[].name`, `categories[].value`, `totalCount` |
| `POST` | `/v1/products/tna/search` | 투어·티켓·액티비티 상품 검색 | `keyword*`, `category`, `minPrice`, `maxPrice`, `sort`, `page`, `size` | `items[].gid`, `itemName`, `salePrice`, `priceDisplay`, `reviewScore`, `reviewCount`, `productUrl`, `deepLink` |
| `POST` | `/v1/products/tna/detail` | 상품 상세 | `gid*` | `title`, `description`, `reviewScore`, `included`, `excluded`, `itineraries` |
| `POST` | `/v1/products/tna/options` | 특정 날짜의 옵션과 실제 가격 | `gid*`, `selectedDate*` | `options[].id`, `name`, `salePrice`, `currency`, `availablePurchaseQuantity` |
| `POST` | `/v1/products/tna/calendars` | 월별 예약 가능 여부와 시작가 | `gid*`, `selectedDate*` | `date`, `basePrice`, `blockDates`, `excludedOptionDates`, `instantConfirm` |

주의:

- 투어 검색의 `page`는 1부터 시작한다. 숙소·항공의 0-based page와 다르다.
- 카테고리 값은 도시마다 다르므로 `/v1/products/tna/categories`의 `value`를 그대로 사용한다.
- `basePrice`는 표시용 문자열이다. 가격 계산에는 옵션 API의 숫자 `salePrice`를 사용한다.
- 상세·옵션·캘린더는 필요한 것만 선택 호출한다.

## REST 링크·리포트 API

### 마이링크

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `POST` | `/v1/mylink` | 마케팅 파트너용 단축 링크 생성 | `targetUrl*` | `mylink`, `mylinkId` |
| `POST` | `/v1/products/flight/fare-query-landing-url` | 항공 운임 조회 랜딩 URL 생성 | `depAirportCd*`, `arrAirportCd*`, `tripTypeCd*`, `depDate`, `arrDate`, `adult`, `child`, `infant`, `airline`, `cabinClass` | 항공 운임 조회 URL |

`/v1/mylink`의 `targetUrl`은 마이리얼트립 도메인만 허용된다. 상품 검색 API 결과의 `productUrl` 또는 `https://www.myrealtrip.com/offers/{itemId}` 형태의 URL을 넣어 성과 추적 링크를 만든다.

### 수익 현황

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/revenues` | 비항공 수익 현황 | `dateSearchType*`, `startDate*`, `endDate*` | `reservationNo`, `salePrice`, `commissionBase`, `commission`, `commissionRate`, `utmContent`, `closingType` |
| `GET` | `/v1/revenues/flight` | 항공 수익 현황 | `dateSearchType*`, `startDate*`, `endDate*` | `reservationNo`, `salePrice`, `commission`, `commissionRate`, `closingType`, `reservedAt` |

메모:

- 수익 데이터는 전일까지 조회 가능하며 일정산 기준으로 갱신된다.
- 환불/부분환불은 `closingType`으로 구분하고 `commission`이 음수일 수 있다.
- 비항공 `commissionBase`는 2026-04-01 예약건부터 제공된다. 이전 예약건은 `null`일 수 있으므로 fallback은 `salePrice`.

### 예약 내역

| Method | Path | 용도 | 주요 입력 | 주요 출력 |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/reservations` | 비항공 예약 내역 | `dateSearchType*`, `startDate*`, `endDate*`, `statuses`, `page`, `pageSize` | `reservedAt`, `reservationNo`, `status`, `salePrice`, `city`, `country`, `productTitle`, `productCategory` |
| `GET` | `/v1/reservations/flight` | 항공 예약 내역 | `startDate*`, `endDate*`, `statuses` | `reservationNo`, `flightReservationNo`, `operationScope`, `tripType`, `status`, `airline`, `reservedAt`, `gid` |

비항공 예약 API는 페이징을 지원하며 `pageSize` 최대값은 300이다. 항공 예약 API는 조회 기간이 최대 1개월이다.

### 상태 확인

| Method | Path | 용도 | 인증 |
| --- | --- | --- | --- |
| `GET` | `/health` | REST 서버 상태 확인 | 불필요 |

확인된 응답:

```json
{ "status": "UP" }
```

## MCP 도구

MCP는 성과 트래킹 없이 AI 도구에서 직접 상품 데이터를 탐색할 때 쓴다. 공식 문서에서 확인한 도구는 아래와 같다.

| 도메인 | 도구 | 용도 |
| --- | --- | --- |
| 숙소 | `searchStays` | 목적지, 체크인/아웃 날짜 기반 숙소 검색 |
| 숙소 | `getStayDetail` | 숙소 상세, 객실, 리뷰, 편의시설 조회 |
| 항공 | `searchDomesticFlights` | 국내선 항공편 검색 |
| 항공 | `searchInternationalFlights` | 국제선 항공편 검색 |
| 항공 | `getPromotionAirlines` | 프로모션 항공사 목록 조회 |
| 항공 | `flightsFareCalendar` | 날짜별 최저가 비교 캘린더 조회 |
| 투어/액티비티 | `searchTnas` | 투어, 티켓, 액티비티 상품 검색 |
| 투어/액티비티 | `getTnaDetail` | 상품 상세 설명, 이미지, 리뷰 조회 |
| 투어/액티비티 | `getTnaOptions` | 날짜별 예약 가능 여부와 실제 가격 조회 |
| 투어/액티비티 | `getCategoryList` | 도시별 카테고리 목록 조회 |
| 공통 | `getCurrentTime` | 현재 한국 시간(KST) 조회 |

MCP endpoint는 GET 요청에 대해 `Use POST only` 오류를 반환했다. 실제 MCP 클라이언트에서는 HTTP POST transport로 호출해야 한다.

## 조합 패턴

### 여행 추천·큐레이션

1. 사용자 목적지와 일정에서 도메인 결정.
2. 항공은 공항 자동완성 후 캘린더 API 중 하나 호출.
3. 숙소는 지역 자동완성 후 숙소 검색 호출.
4. 투어티켓은 카테고리 선택 여부에 따라 카테고리 API와 검색 API 호출.
5. 후보를 가격, 리뷰, 예약 가능성, 날짜 적합성으로 내부 랭킹.

### 여행 플래너

1. 항공 최저가로 출도착 후보 날짜 구성.
2. 숙소 검색으로 숙박 비용 범위 계산.
3. 투어티켓 검색과 캘린더/옵션으로 날짜별 액티비티 후보 생성.
4. 사용자 예산과 선호도에 맞춰 일정표 생성.

### 성과 분석

1. 노출 링크는 `/v1/mylink`로 만든다.
2. 비항공은 `/v1/revenues`, `/v1/reservations`를 6개월 이하 구간으로 수집한다.
3. 항공은 `/v1/revenues/flight`, `/v1/reservations/flight`를 1개월 이하 구간으로 수집한다.
4. `linkId`, `utmContent`, `reservationNo`, `commission` 기준으로 성과를 집계한다.

## 구현 메모

- REST API 키는 서버에서만 사용한다.
- 프론트엔드에서 마이리얼트립 REST API를 직접 호출하지 않는다.
- endpoint별 rate limit을 서버에서 throttle한다.
- 공항 목록, 숙소 지역 자동완성, 투어 카테고리 목록은 캐시 후보로 둔다.
- `result.status`, `result.code`, HTTP status를 함께 보고 내부 에러로 매핑한다.
- 429는 즉시 반복 재시도하지 않는다.
- 표시용 가격 문자열과 숫자 가격 필드를 분리해서 처리한다.

## 문서 출처

- 개발자센터: <https://docs.myrealtrip.com/#/api/intro>
- 시작하기: <https://docs.myrealtrip.com/#/api/getting-started>
- 에러 처리 가이드: <https://docs.myrealtrip.com/#/api/error-handling>
- 리소스: <https://docs.myrealtrip.com/#/api/resource>

