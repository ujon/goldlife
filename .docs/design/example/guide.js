/* 사이 Design Guide — generated visual demos */
function mascot(state, size) {
  return `<div class="sai sai--${state}" style="--sai:${size}px">
    <div class="sai-rings"><i></i><i></i></div><div class="sai-antenna"><b></b></div>
    <div class="sai-body"><div class="sai-gloss"></div>
      <div class="sai-face"><div class="sai-eyes"><span class="eye"><i></i></span><span class="eye"><i></i></span></div>
      <div class="sai-cheek l"></div><div class="sai-cheek r"></div><div class="sai-mouth"></div></div></div>
    <div class="sai-spark s1">✦</div><div class="sai-spark s2">✦</div><div class="sai-think">···</div></div>`;
}
const MIC = `<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>`;
const SPIN = `<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V4z"/></svg>`;

/* ---- colors ---- */
const COLORS = [
  ["코럴 · Coral", "#FF6B5E", "주요 강조 · 따뜻함 · CTA 그라데이션 시작"],
  ["바이올렛 · Violet", "#B45EE8", "‘사이/AI’ · 마스코트 · 그라데이션 중심"],
  ["인디고 · Indigo", "#5B6CFF", "차분함 · AI · 그라데이션 끝"],
  ["잉크 · Ink", "#211C2B", "본문 텍스트 · 다크 버튼"],
  ["뮤트 · Muted", "#6B6478", "보조 텍스트"],
  ["라인 · Line", "#ECE7F3", "구분선 · 보더"],
  ["배경 · BG", "#FAF7F4", "화면 배경(웜 뉴트럴)"],
  ["카드 · Card", "#FFFFFF", "카드 표면"],
];
const SITU = [
  ["혼자","🙋","var(--s-solo)"],["친구","🧑‍🤝‍🧑","var(--s-friend)"],["커플","💑","var(--s-couple)"],
  ["가족","👨‍👩‍👧","var(--s-family)"],["모임","🎉","var(--s-group)"],
];
const TYPE = [
  ["Display","34 / 800 / -0.035em","오늘 뭐하지?"],
  ["H1 · 질문","28 / 800 / -0.025em","누구랑 놀까?"],
  ["H2 · 섹션","22 / 800 / -0.02em","너에게 딱인 3개"],
  ["H3 · 카드 제목","19 / 800","비 오는 날 실내픽"],
  ["Body","15 / 500","친구랑 같이 뭔가 하고 싶다고 했고…"],
  ["Body-sm","13 / 500","예산보다 8,000원 여유 있어"],
  ["Label","12 / 800 / 0.04em","ESTIMATED COST"],
];
const STATES = [
  ["idle","평상시","홈·대기·로그인 인사"],
  ["listening","듣는 중","시간·예산·AI질문(메인만)"],
  ["thinking","생각 중","추천 생성·AI 분석"],
  ["talking","말하는 중","추천 이유 읽기·TTS"],
  ["happy","신남","추천 완성·좋아요 반응"],
];

function swatch([nm,hex,desc]) {
  return `<div class="sw"><div class="chipc" style="background:${hex}"></div>
    <div class="meta"><div class="nm">${nm}</div><div class="hex">${hex}</div>
    <div class="note" style="font-size:12px;margin-top:4px">${desc}</div></div></div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  // logos: inject beads/faces already in HTML via classes; nothing needed.
  // color grid
  document.getElementById("colorgrid").innerHTML = COLORS.map(swatch).join("");
  // situation tints
  document.getElementById("situgrid").innerHTML = SITU.map(([nm,ic,c]) =>
    `<div class="sw"><div class="chipc" style="background:color-mix(in oklch, ${c} 16%, #fff); display:flex;align-items:center;justify-content:center;font-size:30px">${ic}</div>
     <div class="meta"><div class="nm">${nm}</div><div class="hex" style="color:${c}">${c}</div></div></div>`).join("");
  // type scale
  document.getElementById("typescale").innerHTML = TYPE.map(([nm,spec,sample]) => {
    const sz = parseInt(spec);
    return `<div class="typerow"><div class="tk"><div class="nm">${nm}</div><div class="px">${spec}</div></div>
      <div class="sample" style="font-size:${sz}px;font-weight:${spec.includes('800')?800:500};letter-spacing:${spec.includes('-0.035')?'-.035em':spec.includes('-0.025')?'-.025em':spec.includes('-0.02')?'-.02em':'0'}">${sample}</div></div>`;
  }).join("");
  // mascot states
  document.getElementById("statesheet").innerHTML = STATES.map(([s,nm,wh]) =>
    `<div class="statecard">${mascot(s,92)}<div class="nm">${nm}</div><div class="wh">${wh}</div></div>`).join("");
  // hero mascot + logo beads
  document.querySelectorAll("[data-mascot]").forEach(el => el.innerHTML = mascot(el.dataset.mascot, +el.dataset.size||120));
  // mic states
  document.getElementById("micstates").innerHTML = [
    ["idle","idle","<b>은은한 펄스</b><br>탭 유도"],
    ["listening","listening","<b>듣는 중</b><br>수신 링 확장 + 파형"],
    ["processing","processing","<b>알아듣는 중</b><br>스피너"],
  ].map(([cls,st,txt]) =>
    `<div class="miccol"><div class="mic ${cls}"><span class="in">${st==='processing'?SPIN:MIC}</span></div><div class="st">${txt}</div></div>`).join("");

  buildScreens();
});

/* ---------- mini screen mockups ---------- */
function scr(top, body) {
  return `<div class="mini"><div class="mtop"><span>9:41</span><span>●●● ▮</span></div><div class="mbody">${body}</div></div>`;
}
function buildScreens() {
  const G = `style="background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent"`;
  const stepper = (on) => `<div class="stepper">${[0,1,2,3,4].map(i=>`<i class="${i<=on?'on':''}"></i>`).join("")}</div>`;

  const login = scr("", `
    <div style="margin:auto 0;text-align:center">
      <div class="lockup" style="justify-content:center;margin-bottom:6px"><div class="bead" style="--b:34px"><span class="ant"></span><span class="ball"></span><span class="ey l"></span><span class="ey r"></span></div><span class="wordmark" style="font-size:30px">사이</span></div>
      <div class="note" style="font-size:11px;margin-bottom:18px">상황을 이해하는 AI 추천</div>
      <div class="field ph" style="margin-bottom:9px;font-size:13px;padding:11px 13px">이메일</div>
      <div class="field ph" style="margin-bottom:14px;font-size:13px;padding:11px 13px">비밀번호</div>
      <button class="btn primary" style="width:100%;height:44px;font-size:14px">로그인</button>
      <div class="note" style="font-size:11px;margin-top:12px">계정이 없어? <b style="color:var(--violet)">회원가입</b></div>
    </div>`);

  const loc = scr("", `
    <div style="text-align:center;margin-top:8px">${mascot('idle',92)}</div>
    <div style="font-size:18px;font-weight:800;letter-spacing:-.02em;margin-top:8px;text-align:center">근처에서<br>재밌는 거 찾아올게!</div>
    <div class="note" style="font-size:12px;text-align:center;margin-top:8px">위치를 알면 추천이 정확해져.<br>싫으면 지역을 직접 골라도 돼.</div>
    <div style="margin-top:auto"><button class="btn primary" style="width:100%;height:46px;font-size:14px">위치 허용하기</button>
    <button class="btn ghost" style="width:100%;height:40px;font-size:13px;margin-top:6px">지역 직접 고르기</button></div>`);

  const onb = scr("", `
    ${stepper(1)}
    <div class="qbubble" style="margin-top:16px"><div style="flex:0 0 46px">${mascot('idle',46)}</div>
      <div class="say"><span class="nm">사이</span>쉬는 날엔 보통 뭐가 좋아?</div></div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
      ${["맛집","전시","체험","산책","집에서 쉬기"].map((o,i)=>`<div class="chip" style="text-align:center;justify-content:center;${i===0?'background:var(--ink);color:#fff;border-color:var(--ink)':''}">${o}</div>`).join("")}
    </div>
    <div class="note" style="font-size:11px;text-align:center;margin-top:auto">탭으로 답해 · 음성 안 씀</div>`);

  const home = scr("", `
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px"><div style="flex:0 0 40px">${mascot('idle',40)}</div>
      <div><div style="font-size:16px;font-weight:800">안녕, 또 왔네 👋</div><div class="note" style="font-size:12px">지금 시간·예산만 알려주면 돼</div></div></div>
    <div style="margin:auto 0"><button class="btn primary" style="width:100%;height:58px;font-size:17px">오늘 뭐하지? 추천받기</button></div>
    <div class="label" style="margin-bottom:8px">최근 추천</div>
    <div class="chip accent" style="font-size:12px">친구랑 반나절 · 10만원 →</div>`);

  const situ = scr("", `
    ${stepper(0)}
    <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin-top:14px">오늘 누구랑?</div>
    <div class="note" style="font-size:12px;margin-bottom:14px">상황에 맞게 추천이 달라져</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${SITU.map(([nm,ic,c],i)=>`<div class="segc ${['solo','friend','couple','family','group'][i]} ${i===1?'on':''}" style="${i===1?`border-color:${c};background:color-mix(in oklch,${c} 8%,#fff)`:''}"><div class="ic">${ic}</div><div class="t">${nm}</div></div>`).join("")}
    </div>`);

  const time = scr("", `
    ${stepper(1)}
    <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin-top:14px">시간 얼마나 있어?</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
      ${["1시간","2-3시간","반나절","하루","이번 주말","직접 입력"].map((o,i)=>`<div class="chip" style="font-size:13px;${i===2?'background:var(--ink);color:#fff;border-color:var(--ink)':''}">${o}</div>`).join("")}
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div class="mic listening" style="width:62px;height:62px"><span class="in">${MIC}</span></div>
      <div class="note" style="font-size:11px"><b style="color:var(--violet)">“반나절 정도”</b> 말해도 돼 🎙️</div></div>`);

  const budget = scr("", `
    ${stepper(2)}
    <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin-top:14px">총 예산은?</div>
    <div class="note" style="font-size:12px">여러 명이면 다 합쳐서 · 1인당도 보여줄게</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
      ${["1만원","3만원","5만원","10만원","15만원+","직접"].map((o,i)=>`<div class="chip" style="font-size:13px;${i===3?'background:var(--ink);color:#fff;border-color:var(--ink)':''}">${o}</div>`).join("")}
    </div>
    <div class="rec" style="box-shadow:none;background:var(--bg);margin-top:14px"><div style="padding:12px 14px;font-size:12px;font-weight:700;color:var(--muted)">💰 10만원 · 2명 → <b ${G}>1인당 5만원</b></div></div>`);

  const aiq = scr("", `
    ${stepper(3)}
    <div class="qbubble" style="margin-top:16px"><div style="flex:0 0 46px">${mascot('thinking',46)}</div>
      <div class="say"><span class="nm">사이</span>오늘 비 와서 실내가 편할 듯! 친구랑 수다 위주가 좋아, 같이 뭔가 하는 게 좋아?</div></div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
      <div class="chip" style="justify-content:center">수다 위주 ☕</div>
      <div class="chip" style="justify-content:center;background:var(--ink);color:#fff;border-color:var(--ink)">같이 뭔가 하기 🎨</div>
    </div>
    <div class="note" style="font-size:11px;text-align:center;margin-top:auto">추가 질문은 1–2개만 · 음성도 가능</div>`);

  const recs = scr("", `
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0 6px"><div style="flex:0 0 34px">${mascot('happy',34)}</div><div style="font-size:15px;font-weight:800">너에게 딱인 3개 🎉</div></div>
    ${["비 오는 날 실내픽","수다 몰빵픽","새 경험 도전픽"].map((l,i)=>`
      <div class="rec" style="margin-bottom:8px;box-shadow:var(--e1)"><div class="top" style="padding:11px 13px 10px">
        <span class="lab" style="font-size:10px;padding:3px 8px">${l}</span>
        <div class="ttl" style="font-size:14px;margin-top:7px">${["원데이클래스 + 다이닝","디저트 카페 + 전시","방탈출 + 저녁"][i]}</div>
        <div class="note" style="font-size:11px;margin-top:5px">⏱ ${["4시간","3.5시간","4시간"][i]} · 💰 ${["9.2만","6.4만","9.8만"][i]} · ☔ 실내</div>
      </div></div>`).join("")}
    <div class="note" style="font-size:11px;text-align:center">라벨은 AI가 상황 따라 생성</div>`);

  const fb = scr("", `
    <div class="rec" style="box-shadow:var(--e1)"><div class="top" style="padding:13px 15px 10px">
      <span class="lab">🌧 비 오는 날 실내픽</span>
      <div class="ttl" style="font-size:16px">원데이클래스 + 캐주얼 다이닝</div>
      <div class="why" style="font-size:12px;padding:9px 11px"><span class="k">왜 이걸 골랐냐면</span>같이 뭔가 하고 싶다고 했고, 비가 와서 이동 짧은 실내 코스로 골랐어.</div></div>
      <div class="badges" style="padding:10px 15px"><span class="badge g">예산 8천 여유</span><span class="badge b">도보 6분</span><span class="badge w">실내</span></div>
    </div>
    <div class="fbbar" style="margin-top:12px"><div class="fbtn good on" style="height:44px;font-size:14px">👍 좋아</div><div class="fbtn bad" style="height:44px;font-size:14px">👎 별로</div></div>`);

  document.getElementById("screens1").innerHTML =
    [["로그인 / 회원가입","음성·마스코트 최소 · 깔끔",login],["위치 권한","코치 톤 · 거부해도 OK",loc],
     ["고정 온보딩","탭 응답 · 음성 안 씀",onb],["홈","추천 시작 · 최근 히스토리",home],
     ["상황 선택","혼자·친구·커플·가족·모임",situ]]
    .map(([t,s,m])=>`<div><div class="mockcap">${t} <span>· ${s}</span></div>${m}</div>`).join("");
  document.getElementById("screens2").innerHTML =
    [["사용 시간","칩 + 음성(메인)",time],["총 예산","칩 + 1인당 계산",budget],
     ["AI 추가 질문","1–2개 · 동적",aiq],["추천 3개","이유 우선 · AI 라벨",recs],
     ["상세 + 피드백","좋아요/별로예요",fb]]
    .map(([t,s,m])=>`<div><div class="mockcap">${t} <span>· ${s}</span></div>${m}</div>`).join("");
}
