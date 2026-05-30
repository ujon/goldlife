const places = [
  {
    name: "문래 보드게임 라운지",
    area: "홍대",
    category: "보드게임",
    indoor: true,
    active: false,
    quiet: true,
    alcohol: false,
    price: 12000,
    minutes: 12,
    duration: "2~3시간",
    vibe: ["친구", "가성비", "비오는날"],
    summary: "앉아서 길게 떠들면서 놀기 좋은 실내 선택지.",
    color: "#136f63",
  },
  {
    name: "합정 미션 방탈출",
    area: "홍대",
    category: "방탈출",
    indoor: true,
    active: true,
    quiet: false,
    alcohol: false,
    price: 24000,
    minutes: 9,
    duration: "1시간",
    vibe: ["친구", "활동적", "몰입"],
    summary: "결정이 안 날 때 바로 집중할 수 있는 팀 플레이.",
    color: "#2457a6",
  },
  {
    name: "연남 LP 바",
    area: "홍대",
    category: "바",
    indoor: true,
    active: false,
    quiet: true,
    alcohol: true,
    price: 28000,
    minutes: 16,
    duration: "1~2시간",
    vibe: ["음악", "조용함", "밤"],
    summary: "말을 많이 하지 않아도 분위기가 이어지는 음악 바.",
    color: "#7a3f98",
  },
  {
    name: "성수 팝업 전시",
    area: "성수",
    category: "전시",
    indoor: true,
    active: false,
    quiet: true,
    alcohol: false,
    price: 15000,
    minutes: 8,
    duration: "1~2시간",
    vibe: ["데이트", "사진", "실내"],
    summary: "가볍게 보고 이동하기 좋은 실내 전시 코스.",
    color: "#d96c2c",
  },
  {
    name: "서울숲 산책 + 포토부스",
    area: "성수",
    category: "산책",
    indoor: false,
    active: false,
    quiet: true,
    alcohol: false,
    price: 8000,
    minutes: 14,
    duration: "1~2시간",
    vibe: ["저렴함", "사진", "가벼움"],
    summary: "날씨가 괜찮을 때 비용 부담 없이 흐름을 만들기 좋음.",
    color: "#0f7b95",
  },
  {
    name: "성수 실내 클라이밍",
    area: "성수",
    category: "클라이밍",
    indoor: true,
    active: true,
    quiet: false,
    alcohol: false,
    price: 22000,
    minutes: 11,
    duration: "2시간",
    vibe: ["활동적", "도전", "친구"],
    summary: "카페 말고 몸 쓰는 선택지를 원할 때 잘 맞음.",
    color: "#c04d2c",
  },
  {
    name: "강남 다트 펍",
    area: "강남",
    category: "다트",
    indoor: true,
    active: true,
    quiet: false,
    alcohol: true,
    price: 26000,
    minutes: 10,
    duration: "1~2시간",
    vibe: ["밤", "게임", "술"],
    summary: "술도 괜찮고 텐션을 올리고 싶을 때 빠른 후보.",
    color: "#8d5a21",
  },
  {
    name: "강남 프라이빗 노래방",
    area: "강남",
    category: "노래방",
    indoor: true,
    active: true,
    quiet: false,
    alcohol: false,
    price: 18000,
    minutes: 7,
    duration: "1~2시간",
    vibe: ["친구", "활동적", "심야"],
    summary: "의견이 갈릴 때 실패 확률이 낮은 익숙한 선택.",
    color: "#b63f6a",
  },
  {
    name: "이태원 루프탑 라운지",
    area: "이태원",
    category: "루프탑",
    indoor: false,
    active: false,
    quiet: false,
    alcohol: true,
    price: 35000,
    minutes: 13,
    duration: "1~2시간",
    vibe: ["야경", "술", "분위기"],
    summary: "날씨가 좋고 분위기 전환이 필요할 때 어울림.",
    color: "#2d5f7f",
  },
  {
    name: "해방촌 공방 원데이",
    area: "이태원",
    category: "공방",
    indoor: true,
    active: false,
    quiet: true,
    alcohol: false,
    price: 30000,
    minutes: 18,
    duration: "2시간",
    vibe: ["만들기", "데이트", "실내"],
    summary: "대화가 끊겨도 할 일이 있는 차분한 실내 활동.",
    color: "#8b6f2a",
  },
  {
    name: "잠실 심야 영화",
    area: "잠실",
    category: "영화",
    indoor: true,
    active: false,
    quiet: true,
    alcohol: false,
    price: 16000,
    minutes: 6,
    duration: "2~3시간",
    vibe: ["실내", "조용함", "늦은시간"],
    summary: "늦은 시간에 말보다 함께 보는 흐름이 필요할 때 좋음.",
    color: "#3c596f",
  },
  {
    name: "잠실 볼링장",
    area: "잠실",
    category: "볼링",
    indoor: true,
    active: true,
    quiet: false,
    alcohol: false,
    price: 17000,
    minutes: 15,
    duration: "1~2시간",
    vibe: ["활동적", "친구", "가성비"],
    summary: "앉아 있기 답답할 때 부담 없이 움직일 수 있음.",
    color: "#a83d30",
  },
];

const state = {
  activeFeedback: new Set(),
  lastAnalysis: null,
  recognition: null,
  listening: false,
  speechBaseText: "",
  finalTranscript: "",
  requestId: 0,
};

const $ = (selector) => document.querySelector(selector);

const input = $("#conversationInput");
const listenButton = $("#listenButton");
const listenIcon = $("#listenIcon");
const speechStatus = $("#speechStatus");
const analysisLine = $("#analysisLine");
const conversationPreview = $("#conversationPreview");
const feedbackChips = $("#feedbackChips");
const resultCards = $("#resultCards");
const selectedArea = "홍대";
let recommendTimer = null;

function setListening(isListening) {
  document.body.classList.toggle("is-listening", isListening);
}

function setResultsVisible(isVisible) {
  document.body.classList.toggle("has-results", isVisible);
}

function previewText(text) {
  if (!text) return "대화를 듣고 있어요";
  return text.length > 42 ? `“${text.slice(0, 42)}...”` : `“${text}”`;
}

function analyzeConversation(text) {
  const normalized = text.toLowerCase();
  const wantsIndoor = /실내|비|추워|더워|안에서|카페 말고/.test(normalized);
  const wantsOutdoor = /야외|밖|산책|루프탑|날씨 좋/.test(normalized);
  const wantsQuiet = /조용|차분|이야기|대화|시끄럽/.test(normalized);
  const wantsActive = /활동|움직|액티비티|스포츠|게임|재밌게|텐션/.test(normalized);
  const noAlcohol = /술 말고|술은|술 싫|논알콜|안 마/.test(normalized);
  const wantsAlcohol = /술|맥주|칵테일|바|펍|한잔/.test(normalized) && !noAlcohol;
  const budget = /저렴|싸|가성비|비싼|돈 없|부담/.test(normalized);
  const near = /가까|멀리|이동|근처|주변|멀/.test(normalized);
  const cafeTired = /카페.*질|카페 말고|카페는/.test(normalized);
  const foodDone = /밥.*먹|식사.*했|배불/.test(normalized);
  const late = /밤|심야|늦/.test(normalized);

  const mood = [];
  if (wantsIndoor) mood.push("실내 선호");
  if (wantsActive) mood.push("활동적");
  if (wantsQuiet) mood.push("차분함");
  if (wantsAlcohol) mood.push("술 가능");
  if (noAlcohol) mood.push("술 제외");
  if (!mood.length) mood.push("가벼운 친구 모임");

  const constraints = [];
  if (near) constraints.push("이동 짧게");
  if (budget) constraints.push("예산 낮게");
  if (cafeTired) constraints.push("카페 제외");
  if (foodDone) constraints.push("식사 제외");
  if (late) constraints.push("늦은 시간 가능");
  if (wantsOutdoor) constraints.push("야외도 가능");
  if (!constraints.length) constraints.push("조건 더 필요");

  return {
    wantsIndoor,
    wantsOutdoor,
    wantsQuiet,
    wantsActive,
    noAlcohol,
    wantsAlcohol,
    budget,
    near,
    cafeTired,
    foodDone,
    late,
    mood,
    constraints,
  };
}

function scorePlace(place, analysis) {
  let score = 0;

  if (place.area === selectedArea) score += 20;
  if (analysis.wantsIndoor && place.indoor) score += 16;
  if (analysis.wantsOutdoor && !place.indoor) score += 10;
  if (analysis.wantsQuiet && place.quiet) score += 13;
  if (analysis.wantsActive && place.active) score += 13;
  if (analysis.noAlcohol && !place.alcohol) score += 15;
  if (analysis.wantsAlcohol && place.alcohol) score += 9;
  if (analysis.budget && place.price <= 18000) score += 12;
  if (analysis.near && place.minutes <= 12) score += 10;
  if (analysis.cafeTired && place.category !== "카페") score += 4;
  if (analysis.late && place.vibe.includes("심야")) score += 8;

  if (state.activeFeedback.has("indoor") && place.indoor) score += 20;
  if (state.activeFeedback.has("near") && place.minutes <= 10) score += 18;
  if (state.activeFeedback.has("quiet") && place.quiet) score += 18;
  if (state.activeFeedback.has("active") && place.active) score += 18;
  if (state.activeFeedback.has("noAlcohol") && !place.alcohol) score += 18;
  if (state.activeFeedback.has("budget") && place.price <= 18000) score += 18;

  if (state.activeFeedback.has("noAlcohol") && place.alcohol) score -= 30;
  if (state.activeFeedback.has("indoor") && !place.indoor) score -= 24;
  if (analysis.noAlcohol && place.alcohol) score -= 24;
  if (analysis.wantsIndoor && !place.indoor) score -= 16;
  if (analysis.budget && place.price > 30000) score -= 8;

  return score;
}

function mergeAiAnalysis(localAnalysis, aiAnalysis) {
  const hints = aiAnalysis.hints || {};
  const wantsIndoor = localAnalysis.wantsIndoor || Boolean(hints.wantsIndoor);
  const wantsOutdoor = localAnalysis.wantsOutdoor || (Boolean(hints.wantsOutdoor) && !wantsIndoor);
  return {
    ...localAnalysis,
    wantsIndoor,
    wantsOutdoor,
    wantsQuiet: localAnalysis.wantsQuiet || Boolean(hints.wantsQuiet),
    wantsActive: localAnalysis.wantsActive || Boolean(hints.wantsActive),
    noAlcohol: localAnalysis.noAlcohol || Boolean(hints.noAlcohol),
    wantsAlcohol: localAnalysis.wantsAlcohol || Boolean(hints.wantsAlcohol),
    budget: localAnalysis.budget || Boolean(hints.budget),
    near: localAnalysis.near || Boolean(hints.near),
    mood: aiAnalysis.mood?.length ? aiAnalysis.mood : localAnalysis.mood,
    constraints: aiAnalysis.constraints?.length ? aiAnalysis.constraints : localAnalysis.constraints,
    reply: aiAnalysis.reply,
    source: "EXAONE",
  };
}

async function requestAiAnalysis(text) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversation: text,
      feedback: [...state.activeFeedback],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "EXAONE analysis failed");
  }

  return response.json();
}

function getRecommendations(analysis) {
  return places
    .map((place) => ({ ...place, score: scorePlace(place, analysis) }))
    .sort((a, b) => b.score - a.score || a.minutes - b.minutes)
    .slice(0, 3);
}

function renderAnalysis(analysis, pending = false) {
  const prefix = analysis.source === "EXAONE" ? "EXAONE" : "로컬";
  const text = analysis.reply || `${analysis.mood.join(", ")} · ${analysis.constraints.join(", ")}`;
  analysisLine.textContent = pending ? `${prefix}가 대화를 정리하는 중` : text;
}

async function recommend() {
  const text = input.value.trim();
  const currentRequestId = (state.requestId += 1);

  if (!text) {
    setResultsVisible(false);
    conversationPreview.textContent = "대화를 듣고 있어요";
    analysisLine.textContent = "대화가 들어오면 후보를 좁혀볼게요.";
    feedbackChips.hidden = true;
    resultCards.innerHTML = "";
    return;
  }

  setResultsVisible(true);
  const analysis = analyzeConversation(text);
  state.lastAnalysis = analysis;

  conversationPreview.textContent = previewText(text);
  renderAnalysis(analysis, true);
  feedbackChips.hidden = false;

  const recommendations = getRecommendations(analysis);
  renderCards(recommendations, analysis);

  try {
    const aiAnalysis = await requestAiAnalysis(text);
    if (currentRequestId !== state.requestId) return;

    const mergedAnalysis = mergeAiAnalysis(analysis, aiAnalysis);
    state.lastAnalysis = mergedAnalysis;
    renderAnalysis(mergedAnalysis);
    const aiRecommendations = getRecommendations(mergedAnalysis);
    renderCards(aiRecommendations, mergedAnalysis);
    if (!state.listening) speakSummary(aiRecommendations, mergedAnalysis);
  } catch {
    if (currentRequestId !== state.requestId) return;
    renderAnalysis(analysis);
    if (!state.listening) speakSummary(recommendations, analysis);
  }
}

function renderCards(recommendations, analysis) {
  resultCards.innerHTML = recommendations
    .map((place, index) => {
      const reason = buildReason(place, analysis);
      const tags = place.vibe.map((tag) => `<span>${tag}</span>`).join("");
      return `
        <article class="place-card">
          <div class="place-top">
            <div class="place-art" style="background:${place.color}">${index + 1}</div>
            <div class="place-body">
              <h3>${place.name}</h3>
              <p>${place.summary}</p>
              <div class="meta-row">
                <span>${place.area}</span>
                <span>${place.category}</span>
                <span>${place.minutes}분</span>
                <span>약 ${place.price.toLocaleString("ko-KR")}원</span>
                <span>${place.duration}</span>
              </div>
            </div>
          </div>
          <div class="reason">${reason}</div>
          <div class="tag-row" style="padding: 0 14px 14px">${tags}</div>
        </article>
      `;
    })
    .join("");
}

function buildReason(place, analysis) {
  const reasons = [];
  if (place.area === selectedArea) reasons.push("현재 위치와 맞고");
  if (analysis.wantsIndoor && place.indoor) reasons.push("실내 조건을 만족하고");
  if (analysis.wantsQuiet && place.quiet) reasons.push("대화하기 좋은 분위기고");
  if (analysis.wantsActive && place.active) reasons.push("몸을 쓰는 활동이고");
  if ((analysis.noAlcohol || state.activeFeedback.has("noAlcohol")) && !place.alcohol) {
    reasons.push("술 없이도 가능한 후보라서");
  }
  if ((analysis.budget || state.activeFeedback.has("budget")) && place.price <= 18000) {
    reasons.push("가격 부담이 낮아서");
  }
  if ((analysis.near || state.activeFeedback.has("near")) && place.minutes <= 12) {
    reasons.push("이동이 짧아서");
  }

  const sentence = reasons.length ? reasons.join(" ") : "대화에서 나온 조건과 전반적으로 맞아서";
  return `추천 이유: ${sentence} 우선순위가 높아요.`;
}

function speakSummary(recommendations, analysis) {
  if (!("speechSynthesis" in window) || !recommendations.length) return;
  window.speechSynthesis.cancel();
  const top = recommendations[0];
  const text = `지금 대화 기준으로는 ${analysis.mood.join(", ")} 쪽이 좋아 보여요. 첫 번째 추천은 ${top.name}입니다.`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 1.03;
  window.speechSynthesis.speak(utterance);
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    listenButton.disabled = true;
    listenIcon.textContent = "불가";
    speechStatus.textContent = "음성 인식 미지원";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onstart = () => {
    state.listening = true;
    setListening(true);
    state.speechBaseText = input.value.trim();
    state.finalTranscript = "";
    listenIcon.textContent = "중지";
    speechStatus.textContent = "듣는 중";
  };

  recognition.onend = () => {
    state.listening = false;
    setListening(false);
    listenIcon.textContent = "듣기";
    speechStatus.textContent = "준비됨";
    recommend();
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) {
        state.finalTranscript += ` ${event.results[i][0].transcript}`;
      } else {
        interimTranscript += ` ${event.results[i][0].transcript}`;
      }
    }
    input.value = `${state.speechBaseText} ${state.finalTranscript} ${interimTranscript}`.trim();
    setResultsVisible(Boolean(input.value));
    conversationPreview.textContent = previewText(input.value);
    scheduleRecommend();
  };

  recognition.onerror = () => {
    speechStatus.textContent = "마이크 권한 또는 인식 오류";
    setListening(false);
  };

  state.recognition = recognition;
}

function scheduleRecommend() {
  window.clearTimeout(recommendTimer);
  recommendTimer = window.setTimeout(recommend, 450);
}

input.addEventListener("input", scheduleRecommend);

listenButton.addEventListener("click", () => {
  if (!state.recognition) return;
  if (state.listening) {
    state.recognition.stop();
  } else {
    state.recognition.start();
  }
});

feedbackChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-feedback]");
  if (!button) return;
  const key = button.dataset.feedback;
  if (state.activeFeedback.has(key)) {
    state.activeFeedback.delete(key);
    button.classList.remove("active");
  } else {
    state.activeFeedback.add(key);
    button.classList.add("active");
  }
  if (input.value.trim()) recommend();
});

setupSpeechRecognition();
