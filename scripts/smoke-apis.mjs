import fs from 'node:fs';

const DEFAULT_TIMEOUT_MS = 15_000;

function loadEnv(file = '.env') {
  if (!fs.existsSync(file)) return {};

  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((env, line) => {
      const index = line.indexOf('=');
      if (index === -1) return env;

      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
      return env;
    }, {});
}

const env = {
  ...loadEnv('.env'),
  ...process.env
};

const includeSecondary = process.argv.includes('--include-secondary');

function hasValue(key) {
  return Boolean(env[key] && env[key].trim());
}

function skip(name, reason) {
  return {
    name,
    status: 'SKIP',
    reason
  };
}

function pass(name, detail) {
  return {
    name,
    status: 'PASS',
    detail
  };
}

function fail(name, error) {
  return {
    name,
    status: 'FAIL',
    error: error instanceof Error ? error.message : String(error)
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const summary = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
      throw new Error(`HTTP ${response.status}: ${summary}`);
    }

    return {
      response,
      body
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runTest(name, test) {
  try {
    return await test();
  } catch (error) {
    return fail(name, error);
  }
}

function summarizeCount(value) {
  return Array.isArray(value) ? value.length : undefined;
}

const primaryTests = [
  ['GenRank docs', async () => {
    const baseUrl = env.GENRANK_BASE_URL || 'https://www.genrank.com';
    const { body } = await fetchJson(`${baseUrl}/api/docs`);
    const endpoints = body?.endpoints ?? [];

    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      throw new Error('GenRank docs 응답에 endpoints 배열이 없습니다.');
    }

    return pass('GenRank docs', `${endpoints.length} endpoints`);
  }],

  ['GenRank categories', async () => {
    const baseUrl = env.GENRANK_BASE_URL || 'https://www.genrank.com';
    const { body } = await fetchJson(`${baseUrl}/api/categories?tree=false&locale=ko`);
    const count = body?.count ?? summarizeCount(body?.categories);

    if (!Array.isArray(body?.categories)) {
      throw new Error('GenRank categories 응답에 categories 배열이 없습니다.');
    }

    return pass('GenRank categories', `${count} categories`);
  }],

  ['tobl tools/list', async () => {
    if (!hasValue('TOBL_MCP_URL') || !hasValue('TOBL_API_KEY')) {
      return skip('tobl tools/list', 'TOBL_MCP_URL 또는 TOBL_API_KEY 없음');
    }

    const { body } = await fetchJson(env.TOBL_MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.TOBL_API_KEY
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      })
    });
    const tools = body?.result?.tools ?? [];

    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error('tobl tools/list 응답에 tools 배열이 없습니다.');
    }

    return pass('tobl tools/list', `${tools.length} tools`);
  }],

  ['Swing vehicles/search', async () => {
    if (!hasValue('SWING_BASE_URL') || !hasValue('SWING_API_KEY')) {
      return skip('Swing vehicles/search', 'SWING_BASE_URL 또는 SWING_API_KEY 없음');
    }

    const { body } = await fetchJson(`${env.SWING_BASE_URL}/v1/vehicles/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.SWING_API_KEY
      },
      body: JSON.stringify({
        lat: 37.5665,
        lng: 126.978,
        radius: 1500,
        count: 5
      })
    });

    return pass('Swing vehicles/search', responseShape(body));
  }],

  ['Swing taxi/eta', async () => {
    if (!hasValue('SWING_BASE_URL') || !hasValue('SWING_API_KEY')) {
      return skip('Swing taxi/eta', 'SWING_BASE_URL 또는 SWING_API_KEY 없음');
    }

    const { body } = await fetchJson(`${env.SWING_BASE_URL}/v1/taxi/eta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.SWING_API_KEY
      },
      body: JSON.stringify({
        startLat: 37.5665,
        startLng: 126.978,
        endLat: 37.5172,
        endLng: 127.0473
      })
    });

    return pass('Swing taxi/eta', responseShape(body));
  }],

  ['Myrealtrip health', async () => {
    const { body } = await fetchJson('https://partner-ext-api.myrealtrip.com/health');
    return pass('Myrealtrip health', responseShape(body));
  }],

  ['Myrealtrip airport autocomplete', async () => {
    if (!hasValue('MYREALTRIP_API_KEY')) {
      return skip('Myrealtrip airport autocomplete', 'MYREALTRIP_API_KEY 없음');
    }

    const { body } = await fetchJson('https://partner-ext-api.myrealtrip.com/v1/products/flight/airport-autocomplete', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.MYREALTRIP_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        keyword: '서울',
        size: 5
      })
    });

    return pass('Myrealtrip airport autocomplete', responseShape(body));
  }],

  ['API Fuse AirKorea realtime', async () => {
    if (!hasValue('API_FUSE_API_KEY')) {
      return skip('API Fuse AirKorea realtime', 'API_FUSE_API_KEY 없음');
    }

    const { body } = await fetchJson('https://api.apifuse.com/v1/airkorea-realtime/realtime', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.API_FUSE_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        stationName: '동작구',
        dataTerm: 'DAILY'
      })
    });

    return pass('API Fuse AirKorea realtime', responseShape(body));
  }],

  ['EXAONE chat completions', async () => {
    if (!hasValue('EXAONE_API_KEY') || !hasValue('EXAONE_BASE_URL') || !hasValue('EXAONE_MODEL')) {
      return skip('EXAONE chat completions', 'EXAONE_API_KEY, EXAONE_BASE_URL, EXAONE_MODEL 중 누락');
    }

    const { body } = await fetchJson(`${env.EXAONE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.EXAONE_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: env.EXAONE_MODEL,
        messages: [
          {
            role: 'user',
            content: 'ping'
          }
        ],
        max_tokens: 8
      })
    });

    const choiceCount = summarizeCount(body?.choices);
    if (!choiceCount) {
      throw new Error('EXAONE 응답에 choices 배열이 없습니다.');
    }

    return pass('EXAONE chat completions', `${choiceCount} choices`);
  }]
];

const secondaryTests = [
  ['Rocketpunch job categories', async () => {
    if (!hasValue('ROCKETPUNCH_API_KEY')) {
      return skip('Rocketpunch job categories', 'ROCKETPUNCH_API_KEY 없음');
    }

    const { body } = await fetchJson('https://openapi.rocketpunch.com/api/v1/codes/job-categories', {
      headers: {
        'x-oba-api-key': env.ROCKETPUNCH_API_KEY
      }
    });

    return pass('Rocketpunch job categories', responseShape(body));
  }]
];

const tests = includeSecondary ? [...primaryTests, ...secondaryTests] : primaryTests;

function responseShape(body) {
  if (body === null || body === undefined) return 'empty body';
  if (Array.isArray(body)) return `array(${body.length})`;
  if (typeof body !== 'object') return typeof body;

  const keys = Object.keys(body);
  return `object keys: ${keys.slice(0, 8).join(', ') || '(none)'}`;
}

const results = [];
for (const [name, test] of tests) {
  results.push(await runTest(name, test));
}

const maxNameLength = Math.max(...results.map((result) => result.name.length));
for (const result of results) {
  const name = result.name.padEnd(maxNameLength);
  if (result.status === 'PASS') {
    console.log(`PASS ${name} ${result.detail}`);
  } else if (result.status === 'SKIP') {
    console.log(`SKIP ${name} ${result.reason}`);
  } else {
    console.log(`FAIL ${name} ${result.error}`);
  }
}

const failures = results.filter((result) => result.status === 'FAIL');
const skipped = results.filter((result) => result.status === 'SKIP');
const passed = results.filter((result) => result.status === 'PASS');

console.log('');
console.log(`Summary: ${passed.length} passed, ${skipped.length} skipped, ${failures.length} failed`);
if (!includeSecondary) {
  console.log('Secondary tests skipped by default. Use --include-secondary to include them.');
}

if (failures.length > 0) {
  process.exitCode = 1;
}
