/* 사이 — demo content & mode-aware copy */
const KEYWORDS = [
  { id: "escape", e: "🧩", l: "방탈출", v: "스릴 폭발", hot: true },
  { id: "wine",   e: "🍷", l: "분위기 맛집", v: "무드 만점" },
  { id: "class",  e: "🎨", l: "원데이클래스", v: "같이 만들기" },
  { id: "night",  e: "🌃", l: "야경 스팟", v: "낭만 가득" },
  { id: "bowl",   e: "🎳", l: "볼링", v: "승부욕 ㅋㅋ" },
  { id: "cafe",   e: "☕", l: "감성 카페", v: "수다 타임", hot: true },
];

const MBTI = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];

const CONTENT = {
  duo: {
    s0hint: "💑 폰을 둘 사이에 놓아주세요",
    s1speech: "이번 주말 15만원으로 여친이랑 놀거야",
    budget: 150000,
    s2q: "둘의 MBTI는?",
    mbtiSpeech: { me: "ENTP", you: "ISFJ" },
    s2speechText: "ENTP, ISFJ",
    s3q: "두 사람 성향 + 요즘 트렌드 키워드야",
    s4q: "AI 친구들이 너희 보고 토론했어 👀",
    s4head: "둘 사이, 합의 봤어",
    s5q: "너희를 위한 코스",
    council: [
      { who: "ENTP · 너", cls: "a", side: "left",  avatar: "ENTP", text: "오 방탈출 완전 새롭다 가보자ㅋㅋ" },
      { who: "ISFJ · 상대", cls: "b", side: "right", avatar: "ISFJ", text: "분위기 맛집이 편하고 좋을 듯 🍷" },
      { who: "트렌드", cls: "t", side: "left", avatar: "📈", text: "둘 다 넣어서 코스 짜자. 요즘 그게 국룰" },
    ],
    tally: [
      { id: "wine", label: "분위기 맛집", votes: 3, pct: 100, win: true },
      { id: "escape", label: "방탈출", votes: 2, pct: 66 },
      { id: "night", label: "야경", votes: 1, pct: 33 },
    ],
    ttsWin: "둘 다 만족할 코스로 방탈출이랑 분위기 맛집 골랐어!",
    budgetTotal: 142000,
    courses: [
      { slot: "🎯 둘의 PICK · 액티비티", cls: "a", id: "act", name: "○○ 방탈출 카페 · 홍대", price: 53000,
        ph: "activity photo", badges: [["☀️ 실내 OK","w"],["📍 1.2km","b"],["스릴 만점",""]] },
      { slot: "🍽️ 둘의 PICK · 맛집", cls: "b", id: "food", name: "○○ 와인 비스트로", price: 89000,
        ph: "restaurant photo", badges: [["분위기 맛집","b"],["📍 도보 5분","b"],["2인 코스",""]] },
    ],
    happyLine: "14.2만에 딱 맞췄어! 둘 다 만족할 코스야 🎉",
  },
  solo: {
    s0hint: "🙋 내 곁의 AI, 사이랑 가볍게 가볼까",
    s1speech: "주말에 혼자 10만원으로 놀고 싶어",
    budget: 100000,
    s2q: "네 MBTI는?",
    mbtiSpeech: { me: "ENTP", you: null },
    s2speechText: "ENTP",
    s3q: "네 성향 + 요즘 트렌드 키워드야",
    s4q: "AI 친구들이 너 분석했어 👀",
    s4head: "너한테 딱인 거 골랐어",
    s5q: "너를 위한 코스",
    council: [
      { who: "ENTP · 너", cls: "a", side: "left", avatar: "ENTP", text: "혼자 방탈출도 의외로 꿀잼ㅋㅋ 가보자" },
      { who: "사이 · 취향 대변", cls: "s", side: "right", avatar: "사이", text: "근데 넌 분위기 좋은 데서 쉬는 것도 좋아하잖아" },
      { who: "트렌드", cls: "t", side: "left", avatar: "📈", text: "요즘 혼놀 원데이클래스 인기 폭발 중" },
    ],
    tally: [
      { id: "class", label: "원데이클래스", votes: 2, pct: 100, win: true },
      { id: "escape", label: "방탈출", votes: 1, pct: 50 },
      { id: "cafe", label: "감성 카페", votes: 1, pct: 50 },
    ],
    ttsWin: "혼자서 즐기기 좋은 원데이클래스랑 감성 카페로 골랐어!",
    budgetTotal: 90000,
    courses: [
      { slot: "🎯 너의 PICK · 액티비티", cls: "a", id: "act", name: "○○ 도자기 원데이클래스", price: 38000,
        ph: "activity photo", badges: [["☀️ 실내 OK","w"],["📍 1.2km","a"],["혼자 OK",""]] },
      { slot: "☕ 너의 PICK · 카페", cls: "s", id: "food", name: "○○ 루프탑 감성 카페", price: 52000,
        ph: "cafe photo", badges: [["분위기 甲","w"],["📍 도보 7분","a"],["1인석 있음",""]] },
    ],
    happyLine: "9만에 알차게 짰어! 혼놀 제대로다 🎉",
  },
};
window.KEYWORDS = KEYWORDS; window.MBTI = MBTI; window.CONTENT = CONTENT;
