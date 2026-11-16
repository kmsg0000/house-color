// web/index.html → widget-html.mjs (앱 화면) + colors.mjs (노루페인트 색상표) 생성
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'web', 'index.html'), 'utf8');
const m = html.match(/const SETS = (\[.*?\]);\n/s);
if (!m) throw new Error('색상 데이터를 찾지 못했습니다');
const sets = JSON.parse(m[1]);
writeFileSync(join(here, 'colors.mjs'), '// 자동 생성: node build.mjs\nexport const SETS = ' + JSON.stringify(sets) + ';\n');
writeFileSync(join(here, 'widget-html.mjs'), '// 자동 생성: node build.mjs\nexport const WIDGET_HTML = ' + JSON.stringify(html) + ';\n');
console.log('ok:', sets.map(s => s.name + ' ' + s.colors.length).join(', '), '| widget', (html.length / 1024).toFixed(0) + 'KB');
