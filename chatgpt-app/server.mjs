// 우리집 외벽 색 바꾸기 — ChatGPT 앱용 MCP 서버
// 표준 웹 fetch 핸들러 하나로 Cloudflare Workers / ChatGPT Sites / Node(node-server.mjs) 어디서나 동작한다.
// MCP "Streamable HTTP" 무상태(stateless) 방식: POST /mcp 로 JSON-RPC 요청 → JSON 응답.
import { SETS } from './colors.mjs';
import { WIDGET_HTML } from './widget-html.mjs';

const SERVER_INFO = { name: 'house-color', title: '우리집 외벽 색 바꾸기', version: '1.0.0' };
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const WIDGET_URI = 'ui://widget/house-color-v1.html';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/* ---------------- colour helpers ---------------- */
const LIN = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fxyz = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function hexLab(hex) {
  const r = LIN(parseInt(hex.slice(0, 2), 16)), g = LIN(parseInt(hex.slice(2, 4), 16)), b = LIN(parseInt(hex.slice(4, 6), 16));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = fxyz(x), fy = fxyz(y), fz = fxyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const normCode = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const setById = id => SETS.find(s => s.id === id) || SETS[0];
const chip = (s, c) => ({ collection: s.name, set: s.id, code: c[0], name: c[1] || '', hex: c[2] });
function byCode(code, setId) {
  const n = normCode(code); if (!n) return null;
  const order = setId ? [setById(setId), ...SETS.filter(s => s.id !== setId)] : SETS;
  for (const s of order) for (const c of s.colors) { const cc = normCode(c[0]); if (cc === n || cc === n + 'A' || cc + 'A' === n) return chip(s, c); }
  return null;
}
function nearest(hex, setId, k = 1) {
  hex = String(hex || '').replace('#', '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(hex)) return [];
  const t = hexLab(hex), s = setById(setId);
  return s.colors.map(c => { const l = hexLab(c[2]); return [(l[0] - t[0]) ** 2 + (l[1] - t[1]) ** 2 + (l[2] - t[2]) ** 2, c]; })
    .sort((a, b) => a[0] - b[0]).slice(0, k).map(([, c]) => chip(s, c));
}
function search(query, setId, limit) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ''); const sets = setId ? [setById(setId)] : SETS; const out = [];
  for (const s of sets) for (const c of s.colors) { if ((c[0] + c[1]).toLowerCase().replace(/\s+/g, '').includes(q)) { out.push(chip(s, c)); if (out.length >= limit) return out; } }
  return out;
}

/* ---------------- tools ---------------- */
const FILE_SCHEMA = {
  type: 'object',
  description: '사용자가 채팅에 올린 건물 사진',
  properties: { download_url: { type: 'string' }, file_id: { type: 'string' }, mime_type: { type: 'string' }, file_name: { type: 'string' } },
  required: ['download_url', 'file_id'],
};
const TOOLS = [
  {
    name: 'paint_house',
    title: '외벽 색 바꾸기',
    description:
      '사용자가 올린 건물 사진에 노루페인트 색을 칠해 보여 주는 앱을 연다. 사진을 직접 보고 actions 를 만들어 넘겨라.\n' +
      '좌표는 사진 기준 0~1000 정규화(x: 왼→오, y: 위→아래).\n' +
      '- select: 칠할 표면 위의 점 2~6개. 그 표면의 넓고 고른 한가운데에 찍고 창문·문·그림자 경계·모서리·나무는 피한다. 같은 재질이 여러 면(층마다 나뉜 띠, 좌우 벽 등)이면 각 면마다 점을 찍는다. exclude 에는 칠하면 안 되는데 색이 비슷한 곳(흐린 하늘, 유리창, 간판, 옆 건물) 위의 점 0~5개를 넣는다.\n' +
      '- color: 그 부분의 색. 사용자가 색 번호를 말했으면 code 에, 아니면 find_colors 로 실제 노루페인트 색을 찾아 code 를 넣거나 hex 를 넣는다(가장 가까운 컬러칩으로 바뀜).\n' +
      '- erase: 지울 물체(나무·차·전봇대 등)를 감싸는 상자. 사용자가 원할 때만. 가능하면 먼저 너의 이미지 편집 기능으로 물체를 지운 사진을 만들어 그 사진을 photo 로 넘기는 것이 더 자연스럽다.\n' +
      '이전 요청에서 칠한 부분이 있으면 그 부분의 select/color 도 다시 포함해 전체 결과를 한 번에 보내라. part 이름은 짧은 한국어(벽, 지붕, 띠, 창틀 등).',
    inputSchema: {
      type: 'object',
      properties: {
        photo: FILE_SCHEMA,
        say: { type: 'string', description: '사용자에게 보여 줄 쉬운 존댓말 한두 문장' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['erase', 'select', 'color'] },
              part: { type: 'string' },
              points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
              exclude: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: 'select 에서 제외할 곳(하늘·유리·간판) 위의 점' },
              boxes: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } },
              code: { type: 'string', description: '노루페인트/PANTONE 색 번호 (예: WT 1001, 19-4052)' },
              hex: { type: 'string', description: 'rrggbb' },
              set: { type: 'string', enum: ['cgi', 'cvr', 'nr', 'pt'], description: 'cgi=노루컬러가이드(기본), cvr=Cover all, nr=NR(Anycolor), pt=PANTONE' },
            },
            required: ['type'],
          },
        },
      },
      required: ['photo', 'actions'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: {
      ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': WIDGET_URI,
      'openai/fileParams': ['photo'],
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': '외벽에 색을 칠하는 중…',
      'openai/toolInvocation/invoked': '외벽 색을 칠했어요',
    },
  },
  {
    name: 'find_colors',
    title: '노루페인트 색 찾기',
    description: '노루페인트 컬러차트(노루컬러가이드·Cover all·NR·PANTONE)에서 실제 색을 찾는다. query(번호·영문 이름 일부) 또는 hex(원하는 색과 가장 가까운 칩) 중 하나를 넣는다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }, hex: { type: 'string' },
        set: { type: 'string', enum: ['cgi', 'cvr', 'nr', 'pt'] },
        limit: { type: 'integer', minimum: 1, maximum: 30 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    _meta: { ui: { visibility: ['model', 'app'] } },
  },
];

function bytesToB64(buf) {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function callTool(name, args = {}) {
  if (name === 'find_colors') {
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 12));
    const list = args.hex ? nearest(args.hex, args.set, limit) : search(args.query || '', args.set, limit);
    return {
      content: [{ type: 'text', text: list.length ? list.map(c => `${c.collection} ${c.code} ${c.name} #${c.hex}`).join('\n') : '찾는 색이 없습니다.' }],
      structuredContent: { colors: list },
    };
  }
  if (name === 'paint_house') {
    const photo = args.photo || {};
    const actions = Array.isArray(args.actions) ? args.actions : [];
    // resolve colours to real chips so the model and the widget agree on exact codes
    const resolved = [];
    for (const a of actions) {
      if (!a || a.type !== 'color') continue;
      let c = a.code ? byCode(a.code, a.set) : null;
      if (!c && a.hex) c = nearest(a.hex, a.set || 'cgi', 1)[0] || null;
      if (c) { a.code = c.code; a.set = c.set; a.hex = c.hex; resolved.push({ part: a.part || '벽', ...c }); }
    }
    // fetch the photo server-side so the widget does not depend on file-host CSP/CORS
    const meta = {};
    if (photo.download_url) {
      try {
        const r = await fetch(photo.download_url);
        const len = Number(r.headers.get('content-length') || 0);
        if (r.ok && (!len || len <= MAX_PHOTO_BYTES)) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength <= MAX_PHOTO_BYTES) { meta.photo_b64 = bytesToB64(buf); meta.photo_mime = photo.mime_type || r.headers.get('content-type') || 'image/jpeg'; }
        }
      } catch { /* widget falls back to getFileDownloadUrl */ }
    }
    const say = typeof args.say === 'string' ? args.say : '';
    return {
      content: [{ type: 'text', text: (say ? say + '\n' : '') + (resolved.length ? '적용한 색: ' + resolved.map(r => `${r.part}=${r.collection} ${r.code} ${r.name}`).join(', ') : '칠할 색이 지정되지 않았습니다.') }],
      structuredContent: { say, photo: { file_id: photo.file_id || '', download_url: photo.download_url || '', mime_type: photo.mime_type || '' }, actions, resolved },
      _meta: meta,
    };
  }
  throw Object.assign(new Error('Unknown tool: ' + name), { rpc: -32602 });
}

const RESOURCE = {
  uri: WIDGET_URI,
  name: 'house-color-widget',
  title: '우리집 외벽 색 바꾸기 화면',
  mimeType: 'text/html;profile=mcp-app',
};
function resourceMeta(env) {
  const m = {
    ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
    'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
    'openai/widgetPrefersBorder': true,
    'openai/widgetDescription': '건물 사진에 ChatGPT가 고른 노루페인트 색이 칠해진 결과 화면. 사용자는 여기서 비교·저장하거나 손으로 고칠 수 있다.',
    'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
  };
  if (env && env.WIDGET_DOMAIN) { m.ui.domain = env.WIDGET_DOMAIN; m['openai/widgetDomain'] = env.WIDGET_DOMAIN; }
  return m;
}

/* ---------------- JSON-RPC ---------------- */
async function rpc(msg, env) {
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  try {
    let result;
    switch (method) {
      case 'initialize': {
        const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
        result = { protocolVersion: v, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, serverInfo: SERVER_INFO,
          instructions: '한국 사용자의 건물 외벽 색 시뮬레이터. 사용자가 사진과 함께 색을 바꾸거나 물체를 지우라고 하면 paint_house 를 호출하라. 실제 색 번호가 필요하면 find_colors 를 써라.' };
        break;
      }
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: TOOLS }; break;
      case 'tools/call': result = await callTool(params.name, params.arguments || {}); break;
      case 'resources/list': result = { resources: [{ ...RESOURCE, _meta: resourceMeta(env) }] }; break;
      case 'resources/templates/list': result = { resourceTemplates: [] }; break;
      case 'resources/read':
        if (params.uri !== WIDGET_URI) throw Object.assign(new Error('Unknown resource'), { rpc: -32002 });
        result = { contents: [{ ...RESOURCE, text: WIDGET_HTML, _meta: resourceMeta(env) }] };
        break;
      case 'prompts/list': result = { prompts: [] }; break;
      default:
        if (method && method.startsWith('notifications/')) return null;
        throw Object.assign(new Error('Method not found: ' + method), { rpc: -32601 });
    }
    return isNotification ? null : { jsonrpc: '2.0', id, result };
  } catch (e) {
    if (isNotification) return null;
    if (method === 'tools/call' && !e.rpc) return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '오류: ' + e.message }], isError: true } };
    return { jsonrpc: '2.0', id, error: { code: e.rpc || -32603, message: e.message } };
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/' || url.pathname === '/health') {
    return new Response('우리집 외벽 색 바꾸기 MCP 서버가 동작 중입니다. ChatGPT 에는 ' + url.origin + '/mcp 주소를 넣으세요.', { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });
  }
  if (url.pathname !== '/mcp') return new Response('Not found', { status: 404, headers: CORS });
  if (request.method === 'GET' || request.method === 'DELETE') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST', ...CORS } });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  let body;
  try { body = await request.json(); } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS }); }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map(m => rpc(m, env)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(batch ? replies : replies[0]), { headers: { 'content-type': 'application/json', ...CORS } });
}

// Cloudflare Workers / ChatGPT Sites style entry
export default { fetch: (request, env) => handle(request, env) };
