// 로컬 ComfyUI 호출 (Electron 메인 프로세스 / Node 22+). Electron 에 의존하지 않아 단독 테스트 가능.
//  흐름: /upload/image → /prompt → (ws 진행률 + /history/{id} 확인) → /view
//  주의: 사용자가 준 FLUX.2 Klein 이미지 편집 워크플로는 "마스크 입력이 없다".
//        여기서는 이미지+지시문만 넣고, 원본 보존(칠한 영역만 반영)은 앱 화면 쪽 합성으로 처리한다.
'use strict';
const { randomUUID } = require('crypto');

const DEFAULT_NODES = { image: '76', prompt: '75:74', output: '9', scale: '75:80' };

/** 워크플로(API 형식 JSON)에서 이미지 입력·프롬프트·출력·해상도 노드를 찾는다 */
function detectNodes(wf) {
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) throw new Error('ComfyUI "API 형식" 워크플로 JSON 이 아닙니다. (ComfyUI 메뉴 → 내보내기 → API 형식)');
  if (wf.nodes && wf.links) throw new Error('이 파일은 화면 저장 형식입니다. ComfyUI 에서 "Export (API)" 로 다시 내보내 주세요.');
  const ids = Object.keys(wf);
  const cls = id => wf[id] && wf[id].class_type;
  // 어떤 노드가 다른 노드 입력으로 쓰이는지 (실제 연결된 LoadImage 고르기)
  const used = new Set();
  for (const id of ids) for (const v of Object.values((wf[id] && wf[id].inputs) || {})) if (Array.isArray(v) && typeof v[0] === 'string') used.add(v[0]);
  const pick = (pref, test) => (wf[pref] && test(pref)) ? pref : ids.find(test);
  const isLoad = id => cls(id) === 'LoadImage';
  const image = pick(DEFAULT_NODES.image, id => isLoad(id) && used.has(id)) || pick(DEFAULT_NODES.image, isLoad);
  const isText = id => /CLIPTextEncode/.test(cls(id) || '') && typeof (wf[id].inputs || {}).text === 'string';
  // 빈 문자열이 아닌(=긍정) 프롬프트 우선
  const prompt = pick(DEFAULT_NODES.prompt, id => isText(id) && wf[id].inputs.text.trim() !== '') || pick(DEFAULT_NODES.prompt, isText);
  const output = pick(DEFAULT_NODES.output, id => /SaveImage|PreviewImage/.test(cls(id) || ''));
  const scale = pick(DEFAULT_NODES.scale, id => cls(id) === 'ImageScaleToTotalPixels');
  const loadImages = ids.filter(isLoad);
  const maskInputs = ids.filter(id => /Mask|Inpaint/i.test(cls(id) || ''));
  const warnings = [];
  if (!image) warnings.push('LoadImage 노드를 찾지 못했습니다.');
  if (!prompt) warnings.push('프롬프트(CLIPTextEncode) 노드를 찾지 못했습니다.');
  if (!output) warnings.push('SaveImage 노드를 찾지 못했습니다.');
  if (loadImages.length > 1) warnings.push(`LoadImage 노드가 ${loadImages.length}개입니다(${loadImages.join(', ')}). 실제 연결된 ${image} 번을 사용합니다.`);
  if (!maskInputs.length) warnings.push('이 워크플로에는 마스크 입력이 없습니다. 칠한 영역만 원본에 합성하는 방식으로 원본을 보존합니다.');
  if (scale && wf[scale].inputs && wf[scale].inputs.megapixels !== undefined) warnings.push(`해상도 노드(${scale}) megapixels=${wf[scale].inputs.megapixels}. 앱이 작업 영역 크기에 맞춰 조정합니다.`);
  return { image, prompt, output, scale, hasMask: maskInputs.length > 0, warnings };
}

function friendly(err, base) {
  const m = String((err && (err.cause && err.cause.code)) || (err && err.message) || err);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i.test(m)) return new Error(`ComfyUI(${base})에 연결할 수 없어요. ComfyUI 가 켜져 있는지, 주소/포트가 맞는지 확인해 주세요.`);
  if (/out of memory|OutOfMemory|CUDA out of memory|allocation/i.test(m)) return new Error('그래픽카드 메모리가 부족해요. 지울 영역을 작게 나누거나 해상도(메가픽셀)를 낮춰 주세요.');
  return err instanceof Error ? err : new Error(m);
}

async function jfetch(url, opts, timeoutMs = 30000) {
  const r = await fetch(url, { ...opts, signal: opts && opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const msg = j && (j.error && (j.error.message || j.error.type) || j.message) || text.slice(0, 300) || ('HTTP ' + r.status);
    const ne = j && j.node_errors && Object.keys(j.node_errors).length ? ' / 노드 오류: ' + Object.entries(j.node_errors).map(([k, v]) => k + ': ' + ((v.errors || []).map(e => e.message + (e.details ? ' (' + e.details + ')' : '')).join(', '))).join('; ') : '';
    throw new Error('ComfyUI 오류: ' + msg + ne);
  }
  return j;
}

async function systemStats(base) {
  try {
    const j = await jfetch(base.replace(/\/$/, '') + '/system_stats', {}, 8000);
    const d = (j.devices || [])[0] || {};
    return { ok: true, version: (j.system || {}).comfyui_version || '', device: d.name || '', vramTotal: d.vram_total || 0, vramFree: d.vram_free || 0 };
  } catch (e) { throw friendly(e, base); }
}

/**
 * @param {object} o
 * @param {string} o.baseUrl  예: http://127.0.0.1:8188
 * @param {object} o.workflow API 형식 JSON
 * @param {Buffer} o.image    PNG/JPEG 바이트
 * @param {string} o.prompt   편집 지시
 * @param {object} [o.nodes]  {image,prompt,output,scale}
 * @param {number} [o.megapixels]
 * @param {(p:{stage:string,value?:number,max?:number,queue?:number,text?:string})=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{image:Buffer, mime:string, promptId:string}>}
 */
async function runWorkflow(o) {
  const base = String(o.baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const progress = o.onProgress || (() => {});
  const wf = JSON.parse(JSON.stringify(o.workflow));
  // raw: 앱이 직접 만든 그래프(SAM 등) — 노드 자동 탐지/프롬프트 없이 실행
  const det = o.raw ? {} : detectNodes(wf);
  const nodes = { ...det, ...(o.nodes || {}) };
  if (!nodes.image || !wf[nodes.image]) throw new Error('이미지 입력 노드가 없습니다: ' + nodes.image);
  if (!o.raw && (!nodes.prompt || !wf[nodes.prompt])) throw new Error('프롬프트 노드가 없습니다: ' + nodes.prompt);
  const clientId = randomUUID();
  const deadline = Date.now() + (o.timeoutMs || 15 * 60 * 1000);
  let promptId = null, ws = null;
  const cleanup = () => { try { ws && ws.close(); } catch { /* ignore */ } };
  const cancel = async () => {
    try { await fetch(base + '/interrupt', { method: 'POST' }); } catch { /* ignore */ }
    if (promptId) { try { await fetch(base + '/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) }); } catch { /* ignore */ } }
  };
  try {
    // 1) upload
    progress({ stage: 'upload', text: '사진 올리는 중' });
    const fd = new FormData();
    const name = `housecolor_${Date.now()}.png`;
    fd.append('image', new Blob([o.image], { type: 'image/png' }), name);
    fd.append('overwrite', 'true');
    fd.append('type', 'input');
    const up = await jfetch(base + '/upload/image', { method: 'POST', body: fd, signal: o.signal }, 60000);
    wf[nodes.image].inputs.image = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
    // 2) prompt / resolution / seed
    if (nodes.prompt && wf[nodes.prompt]) wf[nodes.prompt].inputs.text = String(o.prompt || '');
    if (nodes.scale && wf[nodes.scale] && wf[nodes.scale].inputs && o.megapixels) wf[nodes.scale].inputs.megapixels = Number(o.megapixels);
    for (const id of Object.keys(wf)) {
      const inp = wf[id].inputs || {};
      for (const k of ['seed', 'noise_seed']) if (typeof inp[k] === 'number') inp[k] = Math.floor(Math.random() * 2 ** 48);
    }
    // 3) progress over websocket (optional)
    if (typeof WebSocket === 'function') {
      try {
        ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws?clientId=' + clientId);
        ws.onmessage = ev => {
          if (typeof ev.data !== 'string') return;
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          const d = m.data || {};
          if (promptId && d.prompt_id && d.prompt_id !== promptId) return;
          if (m.type === 'progress') progress({ stage: 'run', value: d.value, max: d.max, text: `생성 중 ${d.value}/${d.max}` });
          else if (m.type === 'executing' && d.node) progress({ stage: 'run', text: '처리 중 (노드 ' + d.node + ')' });
          else if (m.type === 'execution_cached') progress({ stage: 'run', text: '캐시 사용' });
        };
        ws.onerror = () => {};
      } catch { ws = null; }
    }
    if (o.signal) o.signal.addEventListener('abort', cancel, { once: true });
    progress({ stage: 'queue', text: 'ComfyUI 에 작업 보내는 중' });
    const q = await jfetch(base + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal: o.signal }, 60000);
    promptId = q.prompt_id;
    if (!promptId) throw new Error('ComfyUI 가 작업 번호를 주지 않았어요.');
    // 4) wait for history
    let hist = null, lastQueueCheck = 0;
    while (true) {
      if (o.signal && o.signal.aborted) throw new Error('취소했어요.');
      if (Date.now() > deadline) { await cancel(); throw new Error('시간이 너무 오래 걸려 취소했어요. 영역을 작게 하거나 해상도를 낮춰 보세요.'); }
      const h = await jfetch(base + '/history/' + encodeURIComponent(promptId), {}, 20000).catch(() => null);
      if (h && h[promptId]) {
        hist = h[promptId];
        const st = hist.status || {};
        if (st.status_str === 'error') {
          const em = (st.messages || []).find(x => x[0] === 'execution_error');
          const det2 = em ? (em[1].exception_message || em[1].exception_type || '') + (em[1].node_type ? ' [' + em[1].node_type + ']' : '') : '알 수 없는 오류';
          throw friendly(new Error('ComfyUI 실행 오류: ' + det2), base);
        }
        if (st.completed || hist.outputs && Object.keys(hist.outputs).length) break;
      }
      if (Date.now() - lastQueueCheck > 3000) {
        lastQueueCheck = Date.now();
        const qq = await jfetch(base + '/queue', {}, 10000).catch(() => null);
        if (qq) {
          const pend = (qq.queue_pending || []);
          const pos = pend.findIndex(x => x[1] === promptId);
          if (pos >= 0) progress({ stage: 'queue', queue: pos + 1, text: `대기 중 (앞에 ${pos}개)` });
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    // 5) fetch output image
    const outs = hist.outputs || {};
    let img = (outs[nodes.output] && (outs[nodes.output].images || [])[0]) || null;
    if (!img) for (const v of Object.values(outs)) { if (v.images && v.images[0]) { img = v.images[0]; break; } }
    if (!img) throw new Error('ComfyUI 결과 이미지가 없어요. (출력 노드 ' + nodes.output + ')');
    progress({ stage: 'download', text: '결과 받는 중' });
    const u = base + '/view?' + new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
    const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('결과 이미지를 받지 못했어요 (HTTP ' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    return { image: buf, mime: r.headers.get('content-type') || 'image/png', promptId };
  } catch (e) {
    throw friendly(e, base);
  } finally {
    cleanup();
  }
}

// ---------- 정밀 선택: ComfyUI 기본 내장 SAM 3.1 (SAM3_Detect) ----------
//  필요: ComfyUI 최신 버전 + models/checkpoints/sam3.1_multiplex_fp16.safetensors
//  점(포함/제외)을 주면 그 표면의 마스크(흑백 PNG)를 돌려준다. 색은 앱이 칠하므로 컬러칩 색은 그대로.
const SAM_CKPT = 'sam3.1_multiplex_fp16.safetensors';
const clampPts = (a, n) => (Array.isArray(a) ? a : []).slice(0, n)
  .map(p => ({ x: Math.max(0, Math.round(Number(p && p.x))), y: Math.max(0, Math.round(Number(p && p.y))) }))
  .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

function buildSamGraph({ positive, negative, text, ckpt, threshold }) {
  const pos = clampPts(positive, 16), neg = clampPts(negative, 16);
  if (!pos.length && !(text && String(text).trim())) throw new Error('정밀 선택할 점이 없어요.');
  const det = { model: ['1', 0], image: ['2', 0], threshold: Number(threshold) || 0.5, refine_iterations: 2, individual_masks: false };
  const g = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt || SAM_CKPT } },
    '2': { class_type: 'LoadImage', inputs: { image: '' } },
    '4': { class_type: 'SAM3_Detect', inputs: det },
    '5': { class_type: 'MaskToImage', inputs: { mask: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'housecolor_mask' } },
  };
  if (pos.length) det.positive_coords = JSON.stringify(pos);
  if (neg.length) det.negative_coords = JSON.stringify(neg);
  if (!pos.length) { g['3'] = { class_type: 'CLIPTextEncode', inputs: { text: String(text).slice(0, 200), clip: ['1', 1] } }; det.conditioning = ['3', 0]; }
  return g;
}

function samFriendly(e, ckpt) {
  const m = String(e && e.message || e);
  if (/SAM3_Detect/.test(m) && /not found|does not exist|invalid|Cannot execute/i.test(m)) return new Error('이 ComfyUI 에는 SAM 3.1 노드가 없어요. ComfyUI 를 최신 버전으로 업데이트해 주세요.');
  if (/ckpt_name|not in list|value_not_in_list/i.test(m)) return new Error(`SAM 3.1 모델 파일이 없어요. ${ckpt || SAM_CKPT} 를 ComfyUI/models/checkpoints 폴더에 넣어 주세요.`);
  return e instanceof Error ? e : new Error(m);
}

/** @returns {Promise<{image:Buffer,mime:string}>} 흑백 마스크 PNG (흰색=선택) */
async function segment(o) {
  const graph = buildSamGraph(o);
  try {
    return await runWorkflow({ baseUrl: o.baseUrl, workflow: graph, raw: true, nodes: { image: '2', output: '6' }, image: o.image, onProgress: o.onProgress, signal: o.signal, timeoutMs: 5 * 60 * 1000 });
  } catch (e) { throw samFriendly(e, o.ckpt); }
}

module.exports = { detectNodes, runWorkflow, systemStats, segment, buildSamGraph, DEFAULT_NODES, SAM_CKPT };
