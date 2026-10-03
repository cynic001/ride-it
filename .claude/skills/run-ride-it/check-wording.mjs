#!/usr/bin/env node
/**
 * check-wording.mjs — UI 문구 점검 (용어집 docs/용어집.md 기준)
 *  1) 금지어: 사용자에게 보이는 한글 문구(strings.js 값, 다른 소스의 한글 리터럴, index.html, CSS content)에 쓰지 않는 말이 없어야 함
 *  2) 문구는 js/strings.js에서만: 다른 js의 한글 리터럴 0개(ui-kit.js·console 로그·브랜드 이름 제외)
 *  3) 설정값 숫자 하드코딩 금지: strings.js 값에 "1.5초"·"3번" 같은 숫자 직접 표기 없음({hold}·{hearts}로 받을 것)
 *  4) 문장 길이: 한 문장 45자 이하 권장 — 넘으면 경고(목록), 70자 넘으면 실패
 * 사용: node check-wording.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './polish-lib.mjs';

const BANNED = [
  ['게이트', '가속 지점'], ['밸런스', '균형 잡기'], ['이탈', '탈선'], ['랩', '바퀴'], ['턴', '커브'], ['피니쉬', '결승선'], ['피니시', '결승선'],
  ['클리어', '완주'], ['랭크', '등급'], ['스코어', '점수'], ['스테이지', '단계'], ['튜토리얼', '연습 코스'], ['노브', '손잡이'], ['게이지', '바'],
  ['프리셋', '화질'], ['토글', '켜기·끄기'], ['사운드', '소리'], ['플레이', '도전'], ['뒤로 떨어', '뒤로 미끄러'], ['HUD', '(쓰지 않음)'], ['FOV', '(쓰지 않음)'], ['부스터 타이어', '도움 가속'],
];
// "랩"은 "스타트랩" 같은 말과 겹치지 않게 앞뒤가 한글이 아닐 때만, "턴"은 "돌아"처럼 다른 말 속에서는 제외
const wordRe = w => new RegExp(w === '랩' ? '(?<![가-힣])랩(?![가-힣])' : w === '턴' ? '(?<![가-힣])턴(?![가-힣])' : w === '게이지' ? '(?<![가-힣])게이지' : w);
const BRAND = ['떨어진다'];

function stripJs(text) {
  const out = []; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; let j = i + 1; while (j < n && text[j] !== q) j += text[j] === '\\' ? 2 : 1; out.push(text.slice(i, j + 1)); i = j + 1; }
    else if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); i = j < 0 ? n : j; }
    else if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i); i = j < 0 ? n : j + 2; }
    else { out.push(c); i++; }
  }
  return out.join('');
}
const hangul = /[가-힣]/;
const problems = [], warns = [];
const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));

// strings.js 값
const sfile = fs.readFileSync(path.join(ROOT, 'js/strings.js'), 'utf8');
const entries = [...sfile.matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)].map(m => [m[1], m[2]]);
for (const [k, v] of entries) {
  const plain = v.replace(/<[^>]+>/g, '').replace(/\{\w+\}/g, '#');
  for (const [bad, good] of BANNED) if (wordRe(bad).test(plain)) problems.push(`금지어 "${bad}"(→ ${good}) — strings.js ${k}: ${plain}`);
  if (/\d(\.\d+)?\s*초|\d\s*번(?!째)/.test(plain.replace(/#/g, ''))) problems.push(`설정값 숫자 직접 표기 — strings.js ${k}: ${plain}`);
  if (k.startsWith('credits.') || k.startsWith('stage.')) continue; // 고유 이름·출처 표기는 길이 검사 제외
  for (const sent of plain.split(/(?<=[.!?])\s+|\s—\s/).map(x => x.trim()).filter(Boolean)) {
    const len = sent.replace(/#/g, '0').length;
    if (len > 70) problems.push(`문장이 너무 김(${len}자) — ${k}: ${sent}`);
    else if (len > 45) warns.push(`문장이 김(${len}자) — ${k}: ${sent}`);
  }
}
check_other();
function check_other() {
  for (const f of files) {
    if (f === 'strings.js' || f === 'ui-kit.js') continue;
    const t = stripJs(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
    t.split('\n').forEach((line, i) => {
      if (!hangul.test(line) || /console\./.test(line)) return;
      const rest = BRAND.reduce((l, b) => l.split(b).join(''), line);
      if (hangul.test(rest)) problems.push(`strings.js 밖의 한글 문구 — js/${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 'css')).filter(x => x.endsWith('.css')).map(x => 'css/' + x)]) {
    let t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    t = f.endsWith('.css') ? t.replace(/\/\*[\s\S]*?\*\//g, '') : t.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    const lines = f.endsWith('.css') ? t.split('\n').filter(l => /content:\s*['"][^'"]*[가-힣]/.test(l)) : t.split('\n').filter(l => /<title>|aria-label|alt=|>[^<]*[가-힣]/.test(l) && hangul.test(l));
    lines.forEach(l => { const rest = BRAND.reduce((x, b) => x.split(b).join(''), l); if (hangul.test(rest) && !/<title>|<meta|apple-mobile-web-app-title/.test(l)) problems.push(`strings.js 밖의 한글 — ${f}: ${l.trim().slice(0, 100)}`); });
  }
}
console.log(`문구 ${entries.length}개 검사 — 경고 ${warns.length}개, 문제 ${problems.length}개`);
warns.forEach(w => console.log('WARN ' + w));
problems.forEach(p => console.log('FAIL ' + p));
process.exit(problems.length ? 1 : 0);
