import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const exaoneUrl = process.env.EXAONE_URL || "http://127.0.0.1:8080/v1/chat/completions";
const model = process.env.EXAONE_MODEL || "exaone-local";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeHints(payload) {
  const values = [
    ...(Array.isArray(payload.hints) ? payload.hints : []),
    ...(Array.isArray(payload.rankingHints) ? payload.rankingHints : []),
  ];
  const joined = values.join(" ").toLowerCase();
  const constraints =
    typeof payload.constraints === "object" ? JSON.stringify(payload.constraints).toLowerCase() : String(payload.constraints || "").toLowerCase();
  const corpus = joined + constraints;
  const noAlcohol = /no.?alcohol|술.?제외|술.?빼|술.?없|논알콜|alcohol.*no/.test(corpus);

  return {
    wantsIndoor: /indoor|실내|비|rain/.test(corpus),
    wantsOutdoor: /outdoor|야외|산책|루프탑/.test(corpus),
    wantsQuiet: /quiet|조용|차분|대화/.test(corpus),
    wantsActive: /active|활동|게임|스포츠|방탈출|클라이밍/.test(corpus),
    noAlcohol,
    wantsAlcohol: /alcohol|술|맥주|칵테일|바|펍/.test(corpus) && !noAlcohol,
    budget: /budget|저렴|가성비|싸|예산/.test(corpus),
    near: /near|가까|근처|이동/.test(corpus),
  };
}

async function analyzeConversation(conversation, feedback) {
  const system = [
    "You are EXAONE model from LG AI Research, a helpful assistant.",
    "너는 친구들의 한국어 대화를 듣고 놀거리 추천 조건을 정리하는 분석기다.",
    "반드시 JSON 객체만 출력한다. 마크다운 코드블록을 쓰지 않는다.",
  ].join("\n");

  const user = [
    "다음 대화에서 놀거리 추천에 필요한 조건만 추출해줘.",
    "출력 스키마:",
    '{"mood":["짧은 한국어 태그"],"constraints":["짧은 한국어 조건"],"reply":"한 문장 추천 코멘트","hints":["indoor|outdoor|quiet|active|noAlcohol|alcohol|budget|near 중 필요한 키"]}',
    `대화: ${conversation}`,
    `사용자 피드백: ${feedback.join(", ") || "없음"}`,
  ].join("\n");

  const upstream = await fetch(exaoneUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 260,
    }),
  });

  if (!upstream.ok) {
    throw new Error(`EXAONE server returned ${upstream.status}`);
  }

  const completion = await upstream.json();
  const content = completion.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed) throw new Error("EXAONE response did not contain JSON");

  return {
    mood: Array.isArray(parsed.mood) ? parsed.mood.slice(0, 4) : ["가벼운 친구 모임"],
    constraints: Array.isArray(parsed.constraints) ? parsed.constraints.slice(0, 4) : ["조건 더 필요"],
    reply: typeof parsed.reply === "string" ? parsed.reply : "대화 기준으로 후보를 좁혔어요.",
    hints: normalizeHints(parsed),
    raw: parsed,
  };
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(__dirname, normalized);
  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/analyze") {
    try {
      const body = JSON.parse(await readBody(request));
      const conversation = String(body.conversation || "").trim();
      const feedback = Array.isArray(body.feedback) ? body.feedback.map(String) : [];
      if (!conversation) return sendJson(response, 400, { error: "conversation is required" });

      const analysis = await analyzeConversation(conversation, feedback);
      return sendJson(response, 200, analysis);
    } catch (error) {
      return sendJson(response, 502, {
        error: "EXAONE analysis failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return serveStatic(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MVP server: http://localhost:${port}`);
  console.log(`EXAONE upstream: ${exaoneUrl}`);
});
