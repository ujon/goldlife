# GenRank 기능 목록

이 문서는 `api-docs.json` 기준으로 확인된 기능 범위를 기획 참고용으로 정리합니다.

## 지원 기능

| 기능 범주 | 가능한 기능 | 주요 입력 | 주요 출력 | 기획 참고 |
| --- | --- | --- | --- | --- |
| 카테고리 탐색 | 랭킹 카테고리 트리 또는 flat list 조회 | `locale`, `tree` | 카테고리 ID, slug, 이름, 계층 | 어떤 주제의 랭킹을 볼지 선택 |
| 카테고리 질문 조회 | 특정 카테고리에 포함된 curated question 조회 | category ID 또는 slug | 질문 ID, 문장, slug, 언어 | 랭킹을 만든 질문의 맥락 확인 |
| 랭킹 조회 | 카테고리별 entity GenRank 순위 조회 | category, language, page, limit | entity, 점수, 순위, 변화량 | 트렌드/인기도 후보 추출 |
| 랭킹 히스토리 | 질문별 주간 리더보드 히스토리 조회 | question ID, limit | 주차별 rank/score 변화 | 상승/하락 추세 확인 |
| 검색 | entity 또는 published question 검색 | 검색어, limit, language | entity 후보, question 후보 | 이름만 있을 때 ID 찾기 |
| Entity 상세 | entity 상세와 질문별 점수 조회 | entity ID | entity 정보, 질문별 score | 특정 브랜드/장소/상품의 AI 노출도 확인 |
| Entity 히스토리 | entity의 월간 랭킹 변화 조회 | entity ID, optional question ID | 월별 rank/score, 변화량 | 지속 상승/하락 판단 |
| Question 상세 | 질문의 최신 raw AI 응답과 추출 entity 조회 | question ID | 질문 정보, 모델별 응답, 추출 entity | AI가 어떤 근거로 추천했는지 확인 |
| 연관 질문 | 특정 질문과 관련된 질문 조회 | question ID, limit | related question 목록 | 인접 관심사 확장 |
| 문서 조회 | API docs JSON 조회 | 없음 | 문서 JSON | 클라이언트 동적 문서 확인 |

## 현재 한계

- 읽기 전용 공개 GET API입니다.
- 데이터는 월 1회 polling 기준이라 실시간 트렌드가 아닙니다.
- OpenAPI가 아니라 자체 문서 JSON이므로 자동 클라이언트 생성에는 바로 쓰기 어렵습니다.
