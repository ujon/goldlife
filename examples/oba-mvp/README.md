# 오늘 뭐하지 MVP

친구들과의 대화를 입력하거나 브라우저 음성 인식으로 받아서, EXAONE 로컬 모델이 조건을 추출하고 놀거리 후보 3개를 카드로 추천하는 모바일 웹 MVP입니다.

## 실행

EXAONE 3.5 공식 가이드의 로컬 실행 방식(`llama.cpp` + GGUF)을 기준으로 실행합니다.

```bash
brew install llama.cpp
llama-server \
  -hf LGAI-EXAONE/EXAONE-3.5-2.4B-Instruct-GGUF:Q4_K_M \
  --host 127.0.0.1 \
  --port 8080 \
  -c 4096 \
  --alias exaone-local
```

다른 터미널에서 MVP 서버를 실행합니다.

```bash
cd /Users/addniner/Repository/oba/mvp
node server.mjs
```

브라우저에서 `http://localhost:5173`으로 접속합니다.

## 현재 포함된 것

- 모바일 원페이지 대화 모드
- 브라우저 Web Speech API 기반 음성 입력
- EXAONE 3.5 2.4B 로컬 모델 기반 조건 추출
- 로컬 키워드 분석 fallback
- 샘플 놀거리 데이터 기반 추천 랭킹
- 대화 중 inline 피드백 반영
- 브라우저 TTS 기반 음성 요약

## 다음 단계

- 카카오맵/네이버맵 API로 실제 장소 검색 연결
- GGUI MCP 도구로 추천 카드 UI를 에이전트가 동적으로 렌더링
- 실제 LG U+ 제출용으로 EXAONE 사용 흐름과 Voice AI 데모 시나리오 정리
