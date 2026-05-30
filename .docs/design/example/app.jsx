/* 사이 (SAI) — interactive prototype app */
const { useState, useEffect, useRef, useCallback } = React;

const PAL_LIST = [
  ["#FF6B5E", "#B45EE8", "#5B6CFF"],
  ["#FF7A4D", "#C26BD0", "#1FAE9C"],
  ["#FF5C8A", "#B65AD4", "#3E7BFF"],
];

const man = (n) => { const m = n / 10000; return (Number.isInteger(m) ? m : m.toFixed(1)) + "만"; };
const won = (n) => "₩" + n.toLocaleString("en-US");

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#FF6B5E", "#B45EE8", "#5B6CFF"],
  "radius": 20,
  "showMascot": true,
  "sound": true,
  "startMode": "ask"
}/*EDITMODE-END*/;

const MicIcon = () => (<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>);
const SpinIcon = () => (<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-6-6V4z"/></svg>);

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [screen, setScreen] = useState("s0");
  const [mode, setMode] = useState(null);          // 'solo' | 'duo'
  const [mic, setMic] = useState("idle");          // idle | listening | processing
  const [transcript, setTranscript] = useState("");
  const [budgetShown, setBudgetShown] = useState(false);
  const [mbti, setMbti] = useState({ me: null, you: null });
  const [activeSlot, setActiveSlot] = useState("me");
  const [picks, setPicks] = useState({});          // {kwId: 'a'|'b'|'s'}
  const [council, setCouncil] = useState(0);       // # visible msgs
  const [bars, setBars] = useState(false);
  const [tts, setTts] = useState(false);
  const [coursesIn, setCoursesIn] = useState(false);
  const [s5loading, setS5loading] = useState(true);
  const [sheet, setSheet] = useState(null);        // course obj
  const timers = useRef([]);
  const C = mode ? CONTENT[mode] : null;

  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const speak = useCallback((text) => {
    if (!t.sound) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "ko-KR"; u.rate = 1.05; u.pitch = 1.12;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) {}
  }, [t.sound]);

  // ----- voice simulation -----
  const typeOut = (text, done) => {
    let i = 0; setTranscript("");
    const id = setInterval(() => { i++; setTranscript(text.slice(0, i)); if (i >= text.length) { clearInterval(id); done && done(); } }, 52);
    timers.current.push(id);
  };
  const runVoice = (speech, onDone) => {
    if (mic !== "idle") return;
    setMic("listening"); setTranscript("");
    after(1500, () => {
      setMic("processing");
      after(750, () => { setMic("idle"); typeOut(speech, onDone); });
    });
  };

  const go = (s) => { clearTimers(); setScreen(s); };

  const restart = () => {
    clearTimers(); try { window.speechSynthesis.cancel(); } catch (e) {}
    setMode(null); setMic("idle"); setTranscript(""); setBudgetShown(false);
    setMbti({ me: null, you: null }); setActiveSlot("me"); setPicks({});
    setCouncil(0); setBars(false); setTts(false); setCoursesIn(false); setS5loading(true);
    setSheet(null); setScreen("s0");
  };

  const chooseMode = (m) => { setMode(m); };

  // S2 grid pick
  const pickMbti = (val) => {
    if (mode === "solo") { setMbti({ me: val, you: null }); return; }
    if (activeSlot === "me") { setMbti((p) => ({ ...p, me: val })); setActiveSlot("you"); }
    else { setMbti((p) => ({ ...p, you: val })); }
  };

  // S3 keyword toggle
  const toggleKw = (id) => {
    setPicks((p) => {
      const n = { ...p };
      if (n[id]) { delete n[id]; return n; }
      if (mode === "solo") { n[id] = "a"; return n; }
      const owners = Object.values(n);
      const aCount = owners.filter((x) => x === "a").length;
      const bCount = owners.filter((x) => x === "b").length;
      n[id] = aCount <= bCount ? "a" : "b";
      return n;
    });
  };

  // ----- S4 council orchestration -----
  useEffect(() => {
    if (screen !== "s4" || !C) return;
    setCouncil(0); setBars(false); setTts(false);
    C.council.forEach((_, i) => after(700 + i * 1250, () => setCouncil(i + 1)));
    const afterAll = 700 + C.council.length * 1250;
    after(afterAll + 400, () => setBars(true));
    after(afterAll + 900, () => { setTts(true); speak(C.ttsWin); });
    return clearTimers;
  }, [screen, C]);

  // ----- S5 loading -----
  useEffect(() => {
    if (screen !== "s5" || !C) return;
    setS5loading(true); setCoursesIn(false);
    after(1300, () => { setS5loading(false); after(80, () => setCoursesIn(true)); });
    return clearTimers;
  }, [screen, C]);

  // mascot state per screen
  const mascotState = (() => {
    if (mic === "listening") return "listening";
    if (mic === "processing") return "thinking";
    if (screen === "s3") return "thinking";
    if (screen === "s4") return tts ? "talking" : "thinking";
    if (screen === "s5" && !s5loading) return "happy";
    return "idle";
  })();

  // test/demo nav hook (fresh closures each render)
  useEffect(() => {
    window.__sai = { go, chooseMode, setMbti, setBudgetShown, setPicks, setMode, restart };
  });

  // apply palette vars
  const palVars = { ["--pa"]: t.palette[0], ["--mid"]: t.palette[1], ["--pb"]: t.palette[2],
    ["--grad"]: `linear-gradient(90deg, ${t.palette[0]}, ${t.palette[1]} 55%, ${t.palette[2]})`,
    ["--grad-v"]: `linear-gradient(180deg, ${t.palette[0]}, ${t.palette[1]} 50%, ${t.palette[2]})`,
    ["--cardr"]: t.radius + "px" };

  const progIdx = { s1: 0, s2: 1, s3: 2, s4: 3 }[screen];
  const Prog = () => (progIdx == null ? null : (
    <div className="prog">{[0,1,2,3].map((i) => <i key={i} className={i <= progIdx ? "on" : ""}></i>)}</div>
  ));
  const M = (props) => t.showMascot ? <Mascot {...props} /> : null;
  const selCount = Object.keys(picks).length;

  return (
    <div id="app" style={{ ...palVars, ["--line"]: "#EFEAF6" }}>
      <div className="meridian"></div>
      <div className="sysbar"><span>9:41</span><span className="right">●●● ▾ ▮</span></div>

      <div className="stage">
        {/* ================= S0 ================= */}
        <Screen on={screen === "s0"}>
          <div className="topbar"><span className="brandmark"><b>사이</b> · SAI</span></div>
          <div className="center" style={{ marginTop: 18 }}>
            <M state="idle" size={150} />
          </div>
          <h1 className="head" style={{ textAlign: "center", marginTop: 6 }}>오늘 누구랑 놀까?</h1>
          <p className="sub" style={{ textAlign: "center" }}>음성으로 “혼자” 또는 “여친이랑” 이라고 말해도 돼</p>
          <div className="modegrid">
            <button className={"modecard solo" + (mode === "solo" ? " sel" : "")} onClick={() => chooseMode("solo")}>
              <span className="ic">🙋</span>
              <span><span className="t">혼자</span><span className="d">내 곁의 사이랑, 혼놀 코스</span></span>
            </button>
            <button className={"modecard duo" + (mode === "duo" ? " sel" : "")} onClick={() => chooseMode("duo")}>
              <span className="ic">💑</span>
              <span><span className="t">둘이서</span><span className="d">폰을 사이에 두고 번갈아</span></span>
            </button>
          </div>
          {mode && <div className="modehint">{CONTENT[mode].s0hint}</div>}
          <button className="cta push" disabled={!mode} onClick={() => go("s1")}>시작하기 →</button>
        </Screen>

        {/* ================= S1 budget ================= */}
        <Screen on={screen === "s1"}>
          <div className="topbar"><Prog /><span className="brandmark"><b>사이</b></span></div>
          <div className="eyebrow" style={{ marginTop: 16 }}>STEP 1 · 예산</div>
          <h1 className="head">이번 주말,<br />얼마로 놀까?</h1>
          {mode === "duo" && <div className="turn a" style={{ marginTop: 12 }}><span className="pp"></span>지금 너 차례 · A</div>}
          <div className={"transcript" + (transcript ? "" : " empty")} style={{ marginTop: 12 }}>
            {transcript ? <Hl text={transcript} /> : "여기에 네 말이 받아쓰기로 떠올라"}
            {mic === "idle" && transcript && <span className="caret"></span>}
          </div>
          {budgetShown && (
            <div className="budget" style={{ marginTop: 12 }}>
              <div className="bl"><span>💰 예산</span><span><b>{man(C.budget)}</b> 인식됨</span></div>
            </div>
          )}
          <div className="push center" style={{ gap: 14 }}>
            <MicBlock mic={mic} mascot={<M state={mascotState} size={120} />}
              onTap={() => runVoice(C.s1speech, () => setBudgetShown(true))} />
            <div className="fallback-label">못 알아들으면 골라줘</div>
            <div className="chips">
              {[100000,150000,200000].map((b) => (
                <button key={b} className={"chip" + (budgetShown && C.budget === b ? " on" : "")}
                  onClick={() => { C.budget = b; setBudgetShown(true); setTranscript("이번 주말 " + man(b) + "으로 놀거야"); }}>{man(b)}</button>
              ))}
            </div>
            <button className="cta" style={{ alignSelf: "stretch" }} disabled={!budgetShown} onClick={() => go("s2")}>다음 →</button>
          </div>
        </Screen>

        {/* ================= S2 MBTI ================= */}
        <Screen on={screen === "s2"}>
          <div className="topbar"><Prog /><span className="brandmark"><b>사이</b></span></div>
          <div className="eyebrow" style={{ marginTop: 16 }}>STEP 2 · 성향</div>
          <h1 className="head">{C ? C.s2q : ""}</h1>
          <div className="slots">
            <div className={"slot me" + (mbti.me ? " filled" : "") + (activeSlot === "me" && mode === "duo" ? "" : "")}>
              <div className="who">{mode === "solo" ? "● 나" : "● 나 (A)"}</div>
              <div className={"val" + (mbti.me ? "" : " ph")}>{mbti.me || "—"}</div>
            </div>
            {mode === "duo" && (
              <div className={"slot you" + (mbti.you ? " filled" : "")}>
                <div className="who">● 상대 (B)</div>
                <div className={"val" + (mbti.you ? "" : " ph")}>{mbti.you || "—"}</div>
              </div>
            )}
          </div>
          <div className={"transcript" + (transcript ? "" : " empty")} style={{ marginTop: 14 }}>
            {transcript ? <Hl text={transcript} /> : (mode === "solo" ? "“나 ENTP야” 라고 말해봐" : "“ENTP랑 ISFJ야” 라고 말해봐")}
          </div>
          <div className="fallback-label">또는 직접 골라줘 (탭)</div>
          <div className="mbti-grid">
            {MBTI.map((m) => {
              const cls = mbti.me === m ? " pick-me" : mbti.you === m ? " pick-you" : "";
              return <button key={m} className={"mbti-cell" + cls} onClick={() => pickMbti(m)}>{m}</button>;
            })}
          </div>
          <div className="push center" style={{ gap: 12, marginTop: 16 }}>
            <MicBlock mic={mic} compact mascot={<M state={mascotState} size={86} />}
              onTap={() => runVoice(C.s2speechText, () => setMbti(C.mbtiSpeech))} />
            <button className="cta" style={{ alignSelf: "stretch" }}
              disabled={!(mbti.me && (mode === "solo" || mbti.you))} onClick={() => go("s3")}>다음 →</button>
          </div>
        </Screen>

        {/* ================= S3 keywords ================= */}
        <Screen on={screen === "s3"}>
          <div className="topbar"><Prog /><span className="brandmark"><b>사이</b></span></div>
          <div className="hostdock" style={{ marginTop: 14 }}>
            <M state="thinking" size={66} />
            <div className="said"><span className="nm">사이</span>{C ? C.s3q : ""} — 끌리는 거 골라봐!</div>
          </div>
          {mode === "duo" && <p className="sub"><b style={{color:"var(--pa)"}}>● A</b> 와 <b style={{color:"var(--pb)"}}>● B</b> 가 번갈아 탭하면 돼</p>}
          <div className="kw-grid">
            {KEYWORDS.map((k) => {
              const owner = picks[k.id];
              return (
                <button key={k.id} className={"kwcard" + (owner ? (mode === "solo" ? " sela" : owner === "a" ? " sela" : " selb") : "")} onClick={() => toggleKw(k.id)}>
                  {owner ? <span className={"pick " + (mode === "solo" ? "a" : owner)}>{mode === "solo" ? "✓" : owner.toUpperCase()}</span>
                    : k.hot ? <span className="hot">🔥 HOT</span> : null}
                  <span className="emoji">{k.e}</span>
                  <span className="label">{k.l}</span>
                  <span className="vibe">{k.v}</span>
                </button>
              );
            })}
          </div>
          <button className="cta push" disabled={selCount === 0} onClick={() => go("s4")}>
            {selCount === 0 ? "끌리는 거 골라봐" : `다음 · ${selCount}개 골랐어 →`}
          </button>
        </Screen>

        {/* ================= S4 council ================= */}
        <Screen on={screen === "s4"}>
          <div className="topbar"><Prog /><span className="brandmark"><b>사이</b></span></div>
          <div className="hostdock" style={{ marginTop: 12 }}>
            <M state={tts ? "talking" : "thinking"} size={62} />
            <div className="said"><span className="nm">사이</span>{C ? C.s4q : ""}</div>
          </div>
          <h1 className="head sm" style={{ marginTop: 14 }}>{C ? C.s4head : ""}</h1>
          <div className="council">
            {C && C.council.map((m, i) => (
              <div key={i} className={"pmsg " + (m.side === "right" ? "right " : "") + (i < council ? "in" : "")}>
                <div className={"ava " + m.cls}>{m.avatar}</div>
                <div className="bubble"><span className={"who " + m.cls}>{m.who}</span>{m.text}</div>
              </div>
            ))}
          </div>
          {C && council >= C.council.length && (
            <div className="tally" style={{ marginTop: 14 }}>
              {C.tally.map((o) => (
                <div key={o.id} className={"row" + (o.win ? " win" : "")}>
                  <span className="nm">{o.label}</span>
                  <span className="bar"><i style={{ width: bars ? o.pct + "%" : 0 }}></i></span>
                  <span className="vt">{o.votes}표</span>
                </div>
              ))}
            </div>
          )}
          {tts && (
            <div className="ttsbar"><span className="wave"><i></i><i></i><i></i><i></i></span>🔊 “{C.ttsWin}”</div>
          )}
          <button className="cta push" disabled={!tts} onClick={() => go("s5")}>코스 보러가기 →</button>
        </Screen>

        {/* ================= S5 course ================= */}
        <Screen on={screen === "s5"}>
          <div className="topbar"><span className="brandmark"><b>사이</b></span><button className="restart" onClick={restart}>↺ 처음부터</button></div>
          {!s5loading && (
            <div className="hostdock" style={{ marginTop: 8 }}>
              <M state="happy" size={78} />
              <div className="said"><span className="nm">사이</span>{C.happyLine}</div>
            </div>
          )}
          {s5loading ? (
            <>
              <h1 className="head sm" style={{ marginTop: 14 }}>코스 짜는 중…</h1>
              {[0,1].map((i) => (
                <div key={i} className="skel"><div className="sh img"></div><div className="sh line w60"></div><div className="sh line w40"></div></div>
              ))}
            </>
          ) : (
            <>
              <div className={"budget" + (C.budgetTotal > C.budget ? " over" : "")}>
                <div className="bl"><span>💰 {C.s5q} · 예산 합계</span><span><b>{man(C.budgetTotal)}</b> / {man(C.budget)}</span></div>
                <div className="meter"><i style={{ width: coursesIn ? Math.min(100, (C.budgetTotal / C.budget) * 100) + "%" : 0 }}></i></div>
              </div>
              {C.courses.map((co, i) => (
                <div key={co.id} className={"course" + (coursesIn ? " in" : "")} style={{ animationDelay: i * 0.12 + "s" }} onClick={() => setSheet(co)}>
                  <image-slot id={"sai-" + mode + "-" + co.id} shape="rect" placeholder={co.ph}></image-slot>
                  <div className="ci">
                    <span className="price">{won(co.price)}</span>
                    <div className={"slot-l " + co.cls}>{co.slot}</div>
                    <div className="nm">{co.name}</div>
                    <div className="meta">{co.badges.map((b, j) => <span key={j} className={"badge " + b[1]}>{b[0]}</span>)}</div>
                    <div className="deeplink-row">탭하면 예약 페이지로 →</div>
                  </div>
                </div>
              ))}
              <button className="cta ghost push" onClick={() => go("s4")}>↩ 다시 추천받기</button>
            </>
          )}
        </Screen>
      </div>

      {/* ================= S6 deeplink sheet ================= */}
      <div className={"sheet" + (sheet ? " open" : "")} onClick={() => setSheet(null)}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="grab"></div>
          <div className="ext">{sheet && sheet.cls === "b" ? "캐치테이블" : "마이리얼트립"}으로 이동</div>
          <h3>{sheet ? sheet.name : ""}</h3>
          <p>{sheet ? won(sheet.price) : ""} · 실제 예약 페이지로 이동해서 바로 예약할 수 있어. 로그인·결제는 외부에서 진행돼.</p>
          <button className="cta" onClick={() => { go("s6done"); setSheet(null); }}>예약 페이지 열기 ↗</button>
          <button className="cta ghost" onClick={() => setSheet(null)}>닫기</button>
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="브랜드" />
        <TweakColor label="두 컬러 팔레트" value={t.palette} options={PAL_LIST} onChange={(v) => setTweak("palette", v)} />
        <TweakSlider label="카드 라운드" value={t.radius} min={8} max={28} unit="px" onChange={(v) => setTweak("radius", v)} />
        <TweakSection label="마스코트 · 음성" />
        <TweakToggle label="마스코트 '사이' 표시" value={t.showMascot} onChange={(v) => setTweak("showMascot", v)} />
        <TweakToggle label="TTS 음성 읽기" value={t.sound} onChange={(v) => setTweak("sound", v)} />
        <TweakButton label="처음부터 다시" onClick={restart} />
      </TweaksPanel>
    </div>
  );
}

function Screen({ on, children }) {
  const ref = useRef(null);
  const prev = useRef(false);
  useEffect(() => {
    if (on && !prev.current && ref.current) {
      ref.current.animate(
        [{ opacity: 0, transform: "translateX(30px)" }, { opacity: 1, transform: "none" }],
        { duration: 360, easing: "cubic-bezier(.4,0,.2,1)" }
      );
    }
    prev.current = on;
  }, [on]);
  return <div ref={ref} className={"screen" + (on ? " active" : "")}>{children}</div>;
}
function Hl({ text }) {
  // highlight 만원 amounts & MBTI
  const parts = text.split(/(\d+\s*만원?|[EI][NS][TF][JP])/g);
  return <>{parts.map((p, i) => /(\d+\s*만원?|[EI][NS][TF][JP])/.test(p) ? <b key={i}>{p}</b> : p)}</>;
}
function MicBlock({ mic, onTap, mascot, compact }) {
  const label = mic === "listening" ? "듣고 있어…" : mic === "processing" ? "알아듣는 중…" : "탭해서 말하기 🎙️";
  return (
    <div className="micwrap">
      {!compact && mascot}
      <button className={"mic " + mic} onClick={onTap} aria-label="음성 입력">
        <span className="in">{mic === "processing" ? <SpinIcon /> : <MicIcon />}</span>
      </button>
      <div className={"miclabel" + (mic !== "idle" ? " live" : "")}>{label}</div>
      {mic === "listening" && <div className="eq"><i></i><i></i><i></i><i></i><i></i></div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
