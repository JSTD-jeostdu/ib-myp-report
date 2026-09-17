(() => {
  'use strict';

  const CRITS = ['A', 'B', 'C', 'D'];
  // IB는 학기 성적을 단순 평균으로 내는 것을 부적절한 방식으로 봄. 앱의 계산값은 교사 판단(best-fit)을 돕는 제안값이다.
  const AGGREGATES = { consistent: '일관된 수준', latest: '최근', highest: '최고', average: '평균' };
  const LEVEL_PICKS = { high: '높은 쪽', low: '낮은 쪽' };
  const SUBJECT_COLS = ['학년', '나이스 과목명', 'MYP 과목군', '성적표 표시명', '근거 합치는 방식'];
  const RULE_COLS = ['학년', '나이스 과목명', '나이스 영역명', 'Criterion', '배점', '수준'];
  const FILE_APP_ID = 'myp-report';
  const FILE_VERSION = 2;
  const EPS = 1e-6;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = (v) => String(v ?? '').trim();
  // 띄어쓰기·대소문자 차이를 무시하고 비교하기 위한 키
  const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
  const subjKeyOf = (grade, subject) => `${text(grade)}|${norm(subject)}`;
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

  let seq = 0;
  const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- state

  function defaultState() {
    return {
      demo: false, // 완성본 예시(가상 데이터)인지
      info: { school: '', title: 'IB MYP 성적표', year: '', semester: '', reportDate: todayStr() },
      levelPick: 'high',
      allowPartial: false, // 기준 4개를 모두 평가하지 않은 과목도 환산해 등급을 낼지 (학교 방침)
      atlUnit: 'category', // ATL 입력 단위: category(5개 범주) | cluster(10개 군집)
      cp: { scheme: 'three', showGrade: false, boundaries: { three: [...MYP.communityProject.three.boundaries], four: [...MYP.communityProject.four.boundaries] } },
      atl: {}, // 학번 → 'c:범주' 또는 'k:군집' → N|L|P|E
      learnerProfile: {}, // 학번 → { attrs: [], note }
      communityProject: {}, // 학번 → { title, supervisor, A, B, C, D }
      boundaries: [...MYP.defaultBoundaries],
      template: null, // { fileName, subjects: [], rules: [] }
      uploads: [], // 업로드한 나이스 파일 목록
      students: {}, // 학번 → 학생 정보
      scores: {}, // 학번 → 과목 키 → 영역 키 → { raw, uploadId }
      overrides: {}, // 학번 → 과목 키 → Criterion → 수정한 수준
      comments: {}, // 학번 → 종합 의견
      subjectComments: {}, // 학번 → 과목 키 → 과목 의견
      report: { showAtl: false, showLearnerProfile: false, showCommunityProject: false, showMypYear: true, showTeacher: true, showSubjectComment: false, showDescriptor: true, showCritNames: true, showBoundaries: true, showComment: false, showSignature: true, sign1: '담임', sign2: 'IB 코디네이터' },
    };
  }

  let state = defaultState();
  const ui = { step: 1, group: null, subject: 'all', excluded: new Set(), templateReport: null, neisErrors: [] };
  let dirty = false;

  function touch() {
    dirty = true;
  }

  // ---------------------------------------------------------------- template

  function parseRange(value) {
    const s = text(value).replace(/\s+/g, '');
    const m = s.match(/^(\d+(?:\.\d+)?)(?:[~～∼\-–](\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] != null ? Number(m[2]) : lo;
    return lo <= hi ? { lo, hi } : null;
  }

  function groupKeyOf(value) {
    const n = norm(value);
    if (!n) return null;
    if (n === '기타') return 'custom';
    const hit = Object.entries(MYP.subjects).find(([key, s]) => key !== 'custom' && (norm(s.ko) === n || norm(s.en) === n));
    return hit ? hit[0] : null;
  }

  function aggregateOf(value) {
    const n = norm(value);
    if (!n) return 'consistent';
    const hit = Object.entries(AGGREGATES).find(([key, label]) => key === n || norm(label) === n);
    return hit ? hit[0] : null;
  }

  function findHeader(rows, cols) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const cells = (rows[r] || []).map(norm);
      const idx = cols.map((c) => cells.indexOf(norm(c)));
      if (idx.every((i) => i >= 0)) return { row: r, idx };
    }
    return null;
  }

  function parseTemplateRows(subjectRows, ruleRows) {
    const errors = [];
    const warnings = [];
    const sh = subjectRows && findHeader(subjectRows, SUBJECT_COLS);
    const rh = ruleRows && findHeader(ruleRows, RULE_COLS);
    if (!subjectRows) errors.push('"과목" 시트가 없습니다.');
    else if (!sh) errors.push(`"과목" 시트에서 머리글(${SUBJECT_COLS.join(', ')})을 찾지 못했습니다.`);
    if (!ruleRows) errors.push('"규칙" 시트가 없습니다.');
    else if (!rh) errors.push(`"규칙" 시트에서 머리글(${RULE_COLS.join(', ')})을 찾지 못했습니다.`);
    if (errors.length) return { errors, warnings };

    const subjects = [];
    const seen = new Map();
    subjectRows.slice(sh.row + 1).forEach((row, i) => {
      const cells = sh.idx.map((c) => text(row[c]));
      if (!cells.some(Boolean)) return;
      const [grade, neis, group, display, agg] = cells;
      const where = `과목 시트 ${sh.row + i + 2}행`;
      if (!/^\d+$/.test(grade)) return errors.push(`${where}: 학년을 숫자로 적으세요.`);
      if (!neis) return errors.push(`${where}: 나이스 과목명이 비어 있습니다.`);
      const groupKey = groupKeyOf(group);
      if (!groupKey) return errors.push(`${where}: 알 수 없는 MYP 과목군 "${group}"`);
      const aggregate = aggregateOf(agg);
      if (!aggregate) return errors.push(`${where}: 근거 합치는 방식은 평균·최근·최고 중 하나로 적으세요. ("${agg}")`);
      const key = subjKeyOf(grade, neis);
      if (seen.has(key)) return errors.push(`${where}: ${grade}학년 ${neis} 과목이 ${seen.get(key)}과 중복됩니다.`);
      seen.set(key, where);
      subjects.push({ key, grade, neis, groupKey, display: display || neis, aggregate });
    });

    const rules = [];
    ruleRows.slice(rh.row + 1).forEach((row, i) => {
      const cells = rh.idx.map((c) => text(row[c]));
      if (!cells.some(Boolean)) return;
      const [grade, neis, area, crit, points, level] = cells;
      const where = `규칙 시트 ${rh.row + i + 2}행`;
      const key = subjKeyOf(grade, neis);
      if (!seen.has(key)) return errors.push(`${where}: 과목 시트에 없는 과목입니다. (${grade}학년 ${neis})`);
      if (!area) return errors.push(`${where}: 나이스 영역명이 비어 있습니다.`);
      const c = crit.toUpperCase();
      if (!CRITS.includes(c)) return errors.push(`${where}: Criterion은 A~D 중 하나로 적으세요. ("${crit}")`);
      const p = parseRange(points);
      if (!p) return errors.push(`${where}: 배점 "${points}"을(를) 읽지 못했습니다. 예: 10 또는 18~20`);
      const l = parseRange(level);
      if (!l || !Number.isInteger(l.lo) || !Number.isInteger(l.hi) || l.hi > 8) return errors.push(`${where}: 수준은 0~8 정수로 적으세요. 예: 8 또는 7~8 ("${level}")`);
      rules.push({ key, area, areaKey: norm(area), crit: c, lo: p.lo, hi: p.hi, levelLo: l.lo, levelHi: l.hi, where });
    });

    const groups = new Map();
    rules.forEach((r) => {
      const g = `${r.key}|${r.areaKey}|${r.crit}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    });
    groups.forEach((list) => {
      const sorted = [...list].sort((a, b) => a.lo - b.lo);
      const hasRange = sorted.some((r) => r.hi > r.lo);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.lo <= prev.hi + EPS) errors.push(`${cur.where}: ${cur.area} ${cur.crit}의 배점 구간이 ${prev.where}과 겹칩니다.`);
        else if (hasRange && cur.lo > prev.hi + 1 + EPS) warnings.push(`${cur.where}: ${cur.area} ${cur.crit}의 배점 ${fmtNum(prev.hi)}과 ${fmtNum(cur.lo)} 사이가 비어 있습니다.`);
      }
    });
    subjects.forEach((s) => {
      if (!rules.some((r) => r.key === s.key)) warnings.push(`${s.grade}학년 ${s.neis}: 규칙이 없습니다.`);
    });

    return { errors, warnings, subjects, rules: rules.map(({ where, ...r }) => r) };
  }

  let indexCache = { template: null, index: new Map() };
  function templateIndex() {
    const t = state.template;
    if (!t) return new Map();
    if (indexCache.template === t) return indexCache.index;
    const index = new Map();
    t.subjects.forEach((s) => index.set(s.key, { ...s, areas: [], crits: [] }));
    t.rules.forEach((r) => {
      const subj = index.get(r.key);
      if (!subj) return;
      let area = subj.areas.find((a) => a.key === r.areaKey);
      if (!area) subj.areas.push((area = { key: r.areaKey, name: r.area, crits: [] }));
      let crit = area.crits.find((c) => c.crit === r.crit);
      if (!crit) area.crits.push((crit = { crit: r.crit, bands: [] }));
      crit.bands.push({ lo: r.lo, hi: r.hi, levelLo: r.levelLo, levelHi: r.levelHi });
    });
    index.forEach((s) => {
      s.crits = CRITS.filter((c) => s.areas.some((a) => a.crits.some((x) => x.crit === c)));
      s.areas.forEach((a) => (a.max = a.crits.reduce((sum, c) => sum + Math.max(...c.bands.map((b) => b.hi)), 0)));
    });
    indexCache = { template: t, index };
    return index;
  }

  function templateAoa() {
    const moral = [
      ['과학윤리 글쓰기(논술형)', 'B', [[10, '7~8'], [8, '5~6'], [6, '3~4'], [4, '1~2'], [2, 0]]],
      ['과학윤리 글쓰기(논술형)', 'D', [[15, '7~8'], [13, '5~6'], [11, '3~4'], [9, '1~2'], [7, 0]]],
      ['자연관 글쓰기(논술형)', 'A', [[10, '7~8'], [8, '5~6'], [6, '3~4'], [4, '1~2'], [2, 0]]],
      ['자연관 글쓰기(논술형)', 'C', [[15, '7~8'], [13, '5~6'], [11, '3~4'], [9, '1~2'], [7, 0]]],
    ];
    return {
      guide: [
        ['MYP 기준 템플릿 작성 안내'],
        [],
        ['1. "과목" 시트: 성적표에 넣을 과목을 1행에 하나씩 적습니다. 여기 없는 과목은 나이스 파일을 올려도 성적표에서 빠집니다.'],
        ['   - 나이스 과목명: 나이스 파일의 "교과목 : ○○"과 같게 적습니다.'],
        [`   - MYP 과목군: ${Object.entries(MYP.subjects).filter(([k]) => k !== 'custom').map(([, s]) => s.ko).join(', ')}, 기타 중 하나`],
        ['   - 근거 합치는 방식: 같은 Criterion을 여러 영역에서 평가했을 때 일관된 수준 / 최근 / 최고 / 평균 중 하나 (비우면 일관된 수준)'],
        ['     IB는 학기 말 수준을 교사가 근거의 흐름과 일관성을 보고 판단하도록 하며, 단순 평균은 부적절한 방식으로 봅니다. 계산값은 제안값입니다.'],
        ['2. "규칙" 시트: 평가계획의 채점 기준표를 1행에 한 칸씩 옮겨 적습니다.'],
        ['   - 나이스 영역명: 나이스 파일 열 이름에서 "(만점 …)" 앞부분과 같게 적습니다. 띄어쓰기 차이는 무시합니다. 영역은 평가한 순서대로 적으세요.'],
        ['   - 배점: 한 점수(예: 10) 또는 구간(예: 18~20). 구간은 물결(~)로 적어야 엑셀이 날짜로 바꾸지 않습니다.'],
        ['   - 수준: 0~8 정수 또는 7~8처럼 범위. 범위는 앱의 설정(높은 쪽/낮은 쪽)에 따라 하나로 정해집니다.'],
        ['3. 한 영역을 여러 Criterion으로 나누어 채점하면(예: B 10점 + D 15점) 나이스에는 합계만 있으므로,'],
        ['   앱이 합계가 되는 배점 조합 중 기준별 점수 차가 가장 작은 조합을 고르고 "추정"으로 표시합니다.'],
        ['   추정값은 3단계 검토에서 학생별로 고칠 수 있습니다. 나이스에 영역을 Criterion별로 나누어 입력한 과목은 추정 없이 그대로 계산됩니다.'],
        ['4. 예시로 들어 있는 3학년 도덕 행은 실제 과목에 맞게 고치거나 지우세요.'],
      ],
      subjects: [SUBJECT_COLS, [3, '도덕', '개인과 사회', '도덕', '평균']],
      rules: [RULE_COLS, ...moral.flatMap(([area, crit, bands]) => bands.map(([p, l]) => [3, '도덕', area, crit, p, l]))],
      lists: [
        ['MYP 과목군', '근거 합치는 방식'],
        ...Object.entries(MYP.subjects).map(([k, s], i) => [k === 'custom' ? '기타' : s.ko, Object.values(AGGREGATES)[i] || '']),
      ],
    };
  }

  function downloadTemplate() {
    if (!requireXlsx()) return;
    const aoa = templateAoa();
    const wb = XLSX.utils.book_new();
    const add = (name, rows, cols) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = cols.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add('안내', aoa.guide, [110]);
    add('과목', aoa.subjects, [6, 16, 16, 16, 16]);
    add('규칙', aoa.rules, [6, 14, 28, 10, 8, 8]);
    add('목록', aoa.lists, [16, 16]);
    XLSX.writeFile(wb, 'MYP_기준템플릿.xlsx');
  }

  function applyTemplate(result, fileName) {
    ui.templateReport = { fileName, errors: result.errors, warnings: result.warnings };
    if (result.errors.length) return false;
    state.template = { fileName, subjects: result.subjects, rules: result.rules };
    touch();
    return true;
  }

  // ---------------------------------------------------------------- NEIS file

  function parseNeisRows(rows, fileName) {
    const headRow = rows.findIndex((r) => (r || []).some((c) => norm(c) === '성명'));
    if (headRow < 0) throw new Error('"성명" 머리글을 찾지 못했습니다. 나이스 "수행평가 강의실별 일람표"를 XLS data로 받은 파일인지 확인하세요.');
    const header = rows[headRow].map(text);
    const nameCol = header.findIndex((h) => norm(h) === '성명');
    const classCol = header.findIndex((h) => /^반\/?번호$/.test(norm(h)));
    if (classCol < 0) throw new Error('"반/번호" 머리글을 찾지 못했습니다.');

    const areas = [];
    header.forEach((h, col) => {
      const m = h.match(/^(.*?)\s*\(\s*만점\s*([\d.]+)[^)]*\)\s*$/);
      if (m && m[1].trim()) areas.push({ col, name: m[1].trim(), max: Number(m[2]) });
    });
    if (!areas.length) throw new Error('"(만점 …)"이 붙은 평가 영역 열을 찾지 못했습니다.');

    const meta = { grade: '', subject: '', year: '', semester: '', room: '', teacher: '' };
    rows.slice(0, headRow).flat().map(text).forEach((cell) => {
      const subj = cell.match(/^교과목\s*:\s*(.+)$/);
      if (subj) meta.subject = subj[1].trim();
      const term = cell.match(/(\d{4})\s*학년도\s*(\d)\s*학기.*?(\d)\s*학년/);
      if (term) [, meta.year, meta.semester, meta.grade] = term;
      const room = cell.match(/(\d+)\s*강의실/);
      if (room) meta.room = room[1];
      const teacher = cell.match(/교과담당교사\s*\(\s*([^)]*?)\s*\)/);
      if (teacher) meta.teacher = teacher[1];
    });
    if (!meta.subject) throw new Error('"교과목 : ○○" 줄을 찾지 못했습니다.');
    if (!meta.grade) throw new Error('"○학년도 ○학기 … ○학년" 줄에서 학년을 찾지 못했습니다.');

    const bodyRows = rows.slice(headRow + 1).filter((r) => /^\d+\s*\/\s*\d+$/.test(text(r?.[classCol])));
    const used = new Set([nameCol, classCol, ...areas.map((a) => a.col)]);
    const idCol = header.findIndex((_, col) => !used.has(col) && bodyRows.length && bodyRows.every((r) => /^\d{6,}$/.test(text(r[col]))));

    const students = bodyRows.map((r) => {
      const [cls, no] = text(r[classCol]).split('/').map((v) => String(Number(v)));
      return {
        hakbun: idCol >= 0 ? text(r[idCol]) : '',
        cls,
        no,
        name: text(r[nameCol]),
        scores: areas.map((a) => (typeof r[a.col] === 'number' ? r[a.col] : text(r[a.col]))),
      };
    });
    if (!students.length) throw new Error('학생 행이 없습니다.');
    return { fileName, ...meta, areas: areas.map(({ name, max }) => ({ name, max })), students };
  }

  function removeUpload(id) {
    Object.entries(state.scores).forEach(([sid, subjects]) => {
      Object.entries(subjects).forEach(([key, areas]) => {
        Object.entries(areas).forEach(([areaKey, entry]) => {
          if (entry.uploadId === id) delete areas[areaKey];
        });
        if (!Object.keys(areas).length) delete subjects[key];
      });
      if (!Object.keys(subjects).length) {
        delete state.scores[sid];
        delete state.students[sid];
        delete state.overrides[sid];
        delete state.comments[sid];
        delete state.subjectComments[sid];
        delete state.atl[sid];
        delete state.learnerProfile[sid];
        delete state.communityProject[sid];
        ui.excluded.delete(sid);
      }
    });
    state.uploads = state.uploads.filter((u) => u.id !== id);
  }

  function ingestNeis(p) {
    const key = subjKeyOf(p.grade, p.subject);
    const areas = p.areas.map((a) => ({ key: norm(a.name), name: a.name, max: a.max }));
    const replaced = state.uploads.filter((u) => u.key === key && u.room === p.room && u.areas.some((a) => areas.some((b) => b.key === a.key)));
    replaced.forEach((u) => removeUpload(u.id));

    const id = newId('f');
    state.uploads.push({ id, key, fileName: p.fileName, grade: p.grade, subject: p.subject, room: p.room, teacher: p.teacher || '', year: p.year, semester: p.semester, areas, count: p.students.length });
    p.students.forEach((s) => {
      const sid = s.hakbun || `${p.grade}-${s.cls}-${s.no}-${s.name}`;
      state.students[sid] = { id: sid, hakbun: s.hakbun, grade: p.grade, cls: s.cls, no: s.no, name: s.name };
      const bucket = ((state.scores[sid] ||= {})[key] ||= {});
      areas.forEach((a, i) => (bucket[a.key] = { raw: s.scores[i], uploadId: id }));
    });
    if (!state.info.year && p.year) state.info.year = p.year;
    if (!state.info.semester && p.semester) state.info.semester = p.semester;
    touch();
    return replaced.length > 0;
  }

  function uploadWarnings(u) {
    if (!state.template) return [];
    const subj = templateIndex().get(u.key);
    if (!subj) return [`템플릿에 ${u.grade}학년 "${u.subject}" 과목이 없어 성적표에서 빠집니다.`];
    const warnings = [];
    u.areas.forEach((a) => {
      const t = subj.areas.find((x) => x.key === a.key);
      if (!t) warnings.push(`영역 "${a.name}"이(가) 템플릿에 없어 반영되지 않습니다.`);
      else if (a.max && Math.abs(t.max - a.max) > EPS) warnings.push(`영역 "${a.name}": 나이스 만점은 ${fmtNum(a.max)}점인데 템플릿 배점 합은 ${fmtNum(t.max)}점입니다.`);
    });
    subj.areas.forEach((t) => {
      if (!state.uploads.some((x) => x.key === u.key && x.room === u.room && x.areas.some((a) => a.key === t.key))) {
        warnings.push(`템플릿 영역 "${t.name}"의 점수가 없습니다. 해당 파일을 올려 주세요.`);
      }
    });
    return warnings;
  }

  // ---------------------------------------------------------------- calculation

  function candidatePoints(bands) {
    const set = new Set();
    bands.forEach((b) => {
      if (b.hi - b.lo < EPS) set.add(b.lo);
      else for (let p = Math.ceil(b.lo - EPS); p <= b.hi + EPS; p++) set.add(p);
    });
    return [...set];
  }

  function bandOfPoints(bands, points) {
    return bands.find((b) => points >= b.lo - EPS && points <= b.hi + EPS) || null;
  }

  // 영역 합계를 기준별 배점으로 나눈다. 조합이 여러 개면 기준별 점수 차가 가장 작은 조합을 고른다.
  function splitScore(total, crits) {
    if (crits.length === 1) {
      return bandOfPoints(crits[0].bands, total)
        ? { points: { [crits[0].crit]: total }, estimated: false }
        : { error: `${fmtNum(total)}점이 배점 구간에 없습니다` };
    }
    const lists = crits.map((c) => candidatePoints(c.bands));
    const pick = [];
    let best = null;
    let bestSpread = Infinity;
    let count = 0;
    (function walk(i, sum) {
      if (i === lists.length) {
        if (Math.abs(sum - total) > EPS) return;
        count++;
        const mean = total / pick.length;
        const spread = pick.reduce((acc, p) => acc + (p - mean) ** 2, 0);
        if (spread < bestSpread - EPS) {
          bestSpread = spread;
          best = [...pick];
        }
        return;
      }
      for (const p of lists[i]) {
        if (sum + p > total + EPS) continue;
        pick.push(p);
        walk(i + 1, sum + p);
        pick.pop();
      }
    })(0, 0);
    if (!best) return { error: `${fmtNum(total)}점을 ${crits.map((c) => c.crit).join('+')} 배점으로 나눌 수 없습니다` };
    return { points: Object.fromEntries(crits.map((c, i) => [c.crit, best[i]])), estimated: count > 1 };
  }

  function aggregateLevels(levels, method) {
    if (!levels.length) return null;
    if (method === 'consistent') {
      // 가장 자주 나온 수준. 동률이면 더 나중 영역의 수준을 쓴다.
      const counts = new Map();
      levels.forEach((l) => counts.set(l, (counts.get(l) || 0) + 1));
      const top = Math.max(...counts.values());
      return [...levels].reverse().find((l) => counts.get(l) === top);
    }
    if (method === 'latest') return levels[levels.length - 1];
    if (method === 'highest') return Math.max(...levels);
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  }

  function parseOverride(raw) {
    const value = text(raw);
    if (value === '') return { level: null };
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 8) return { level: null, error: '0~8 사이의 정수' };
    return { level: n };
  }

  function gradeFromTotal(total) {
    let grade = null;
    state.boundaries.forEach((min, i) => {
      if (total >= Number(min)) grade = i + 1;
    });
    return grade;
  }

  function areaUploaded(key, areaKey) {
    return state.uploads.some((u) => u.key === key && u.areas.some((a) => a.key === areaKey));
  }

  function computeSubject(sid, key) {
    const subj = templateIndex().get(key);
    const scores = state.scores[sid]?.[key] || {};
    const r = { subj, areas: [], evidence: {}, finals: {}, issues: [], missing: [], sum: 0, total: null, grade: null, scaled: false, partial: false, estimated: false };
    if (!subj) return r;

    subj.areas.forEach((area) => {
      const entry = scores[area.key];
      const row = { area, raw: entry?.raw, points: null, levels: {}, estimated: false };
      r.areas.push(row);
      if (!entry || text(entry.raw) === '') {
        if (entry || areaUploaded(key, area.key)) r.issues.push(`${area.name}: 점수 없음`);
        return;
      }
      const n = typeof entry.raw === 'number' ? entry.raw : Number(text(entry.raw).replace(/,/g, ''));
      if (!Number.isFinite(n)) return r.issues.push(`${area.name}: "${text(entry.raw)}" (숫자 아님)`);
      const split = splitScore(n, area.crits);
      if (split.error) return r.issues.push(`${area.name}: ${split.error}`);
      row.points = split.points;
      row.estimated = split.estimated;
      area.crits.forEach((c) => {
        const band = bandOfPoints(c.bands, split.points[c.crit]);
        const level = state.levelPick === 'low' ? band.levelLo : band.levelHi;
        row.levels[c.crit] = level;
        (r.evidence[c.crit] ||= []).push(level);
      });
    });

    subj.crits.forEach((c) => {
      const auto = aggregateLevels(r.evidence[c] || [], subj.aggregate);
      const ov = parseOverride(state.overrides[sid]?.[key]?.[c]);
      const level = ov.level ?? auto;
      r.finals[c] = { auto, level, overridden: ov.level != null, error: ov.error };
      if (level == null) r.missing.push(c);
      else r.sum += level;
    });
    r.partial = subj.crits.length > 0 && subj.crits.length < 4;
    if (subj.crits.length && !r.missing.length && (!r.partial || state.allowPartial)) {
      r.scaled = r.partial;
      r.total = r.scaled ? Math.round((r.sum * 4) / subj.crits.length) : r.sum;
      r.grade = gradeFromTotal(r.total);
    }
    r.estimated = r.areas.some((a) => a.estimated);
    return r;
  }

  // ---------------------------------------------------------------- ATL · 학습자상 · 공동체 프로젝트

  function atlUnits() {
    const cats = MYP.atl.categories;
    return state.atlUnit === 'cluster'
      ? cats.flatMap((c) => c.clusters.map((k) => ({ key: `k:${k.key}`, ko: k.ko, en: k.en, group: c.ko })))
      : cats.map((c) => ({ key: `c:${c.key}`, ko: c.ko, en: c.en, group: '' }));
  }

  const STAGE_INPUT = { n: 'N', l: 'L', p: 'P', e: 'E', 1: 'N', 2: 'L', 3: 'P', 4: 'E', 초: 'N', 학: 'L', 실: 'P', 전: 'E' };
  // 빈칸이면 '', 읽을 수 없으면 null
  function parseStage(value) {
    const s = text(value);
    if (!s) return '';
    return STAGE_INPUT[s.toLowerCase()] ?? STAGE_INPUT[s[0].toLowerCase()] ?? null;
  }

  function cpScheme() {
    return MYP.communityProject[state.cp.scheme] || MYP.communityProject.three;
  }

  function cpResult(sid) {
    const scheme = cpScheme();
    const entry = state.communityProject[sid] || {};
    const crits = Object.keys(scheme.criteria);
    const levels = Object.fromEntries(crits.map((c) => [c, parseOverride(entry[c]).level]));
    const total = crits.every((c) => levels[c] != null) ? crits.reduce((sum, c) => sum + levels[c], 0) : null;
    let grade = null;
    if (total != null && state.cp.showGrade) {
      (state.cp.boundaries[state.cp.scheme] || []).forEach((min, i) => {
        if (total >= Number(min)) grade = i + 1;
      });
    }
    return { entry, crits, levels, total, max: crits.length * 8, grade, hasData: Boolean(text(entry.title) || crits.some((c) => levels[c] != null)) };
  }

  function subjectTeachers(sid, key) {
    const ids = new Set(Object.values(state.scores[sid]?.[key] || {}).map((e) => e.uploadId));
    return [...new Set(state.uploads.filter((u) => ids.has(u.id) && u.teacher).map((u) => u.teacher))].join(', ');
  }

  function studentSubjects(sid) {
    const scores = state.scores[sid] || {};
    return [...templateIndex().values()].filter((s) => scores[s.key]);
  }

  function sortedStudents() {
    const num = (v) => Number(v) || 0;
    return Object.values(state.students).sort((a, b) => num(a.grade) - num(b.grade) || num(a.cls) - num(b.cls) || num(a.no) - num(b.no) || a.name.localeCompare(b.name, 'ko'));
  }

  function classGroups() {
    const map = new Map();
    sortedStudents().forEach((s) => {
      const k = `${s.grade}-${s.cls}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    });
    return map;
  }

  function groupLabel(k) {
    const [grade, cls] = k.split('-');
    return `${grade}학년 ${cls}반`;
  }

  function boundaryRanges() {
    const b = state.boundaries.map(Number);
    return b.map((min, i) => ({ grade: i + 1, min, max: i < 6 ? b[i + 1] - 1 : 32 }));
  }

  function isAscending(list) {
    return list.every((v, i) => i === 0 || Number(v) > Number(list[i - 1]));
  }

  // ---------------------------------------------------------------- common UI

  function tip(message) {
    return `<button type="button" class="tip" data-tip="${esc(message)}" aria-label="도움말: ${esc(message)}">?</button>`;
  }

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2800);
  }

  function goStep(step) {
    ui.step = step;
    $$('.step').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.step) === step));
    [1, 2, 3, 4].forEach((n) => ($(`#step${n}`).hidden = n !== step));
    renderStep();
    window.scrollTo({ top: 0 });
  }

  function renderStep() {
    $('#demoBanner').hidden = !state.demo;
    [null, renderTemplateStep, renderNeisStep, renderReviewStep, renderReportStep][ui.step]();
  }

  function setPath(path, value) {
    const keys = path.split('.');
    let obj = state;
    keys.slice(0, -1).forEach((k) => (obj = obj[k]));
    obj[keys[keys.length - 1]] = value;
  }

  function getPath(path) {
    return path.split('.').reduce((obj, k) => obj?.[k], state);
  }

  // 텍스트 입력은 input 이벤트로, select/checkbox는 change 이벤트로만 처리해 중복 처리를 막는다.
  function isChoice(el) {
    return el.tagName === 'SELECT' || el.type === 'checkbox';
  }
  function wantsEvent(e) {
    return e.type === 'change' ? isChoice(e.target) : !isChoice(e.target);
  }

  function field(label, path, opts = {}) {
    return `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.tip ? tip(opts.tip) : ''}</span>
      <input type="${opts.type || 'text'}" data-bind="${path}" value="${esc(getPath(path))}" placeholder="${esc(opts.placeholder || '')}"></label>`;
  }

  function messageList(items, cls) {
    if (!items.length) return '';
    const shown = items.slice(0, 30);
    return `<ul class="msg-list ${cls}">${shown.map((m) => `<li>${esc(m)}</li>`).join('')}${items.length > shown.length ? `<li>외 ${items.length - shown.length}건</li>` : ''}</ul>`;
  }

  function dropzone(kind, title, desc, multiple) {
    return `<label class="dropzone" data-drop="${kind}">
      <input type="file" data-file="${kind}" accept=".xlsx,.xls,.csv" ${multiple ? 'multiple' : ''} hidden>
      <strong>${title}</strong><span>${desc}</span></label>`;
  }

  function requireXlsx() {
    if (window.XLSX) return true;
    alert('엑셀 파일을 읽는 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.');
    return false;
  }

  function readWorkbook(file) {
    return file.arrayBuffer().then((buf) => XLSX.read(buf, { type: 'array' }));
  }

  // ---------------------------------------------------------------- step 1: template

  function renderTemplateStep() {
    const rep = ui.templateReport;
    const index = templateIndex();
    const subjectRows = [...index.values()].map((s) => `
      <tr>
        <td>${esc(s.grade)}</td>
        <td><b>${esc(s.neis)}</b>${s.display !== s.neis ? `<small class="muted"> → ${esc(s.display)}</small>` : ''}</td>
        <td>${esc(MYP.subjects[s.groupKey].ko)}</td>
        <td>${AGGREGATES[s.aggregate]}</td>
        <td>${s.areas.length ? s.areas.map((a) => `<div class="area-line">${esc(a.name)} <span class="muted">(${fmtNum(a.max)}점)</span> → ${a.crits.map((c) => `<span class="crit-badge sm">${c.crit}</span>`).join('')}</div>`).join('') : '<span class="muted">규칙 없음</span>'}</td>
        <td>${CRITS.map((c) => {
          const n = s.areas.filter((a) => a.crits.some((x) => x.crit === c)).length;
          return `<span class="crit-count ${n ? '' : 'none'}">${c}×${n}</span>`;
        }).join('')}
          <div>${s.crits.length < 4 ? `<span class="tag">${state.allowPartial ? '환산 등급' : '수준만 보고 (등급 없음)'}</span>` : '<span class="tag ok">등급 산출</span>'}</div></td>
      </tr>`).join('');

    const boundsOk = isAscending(state.boundaries) && Number(state.boundaries[6]) <= 32;

    $('#step1').innerHTML = `
      <div class="card">
        <div class="card-head row">
          <div><h2>기준 템플릿</h2><p>학년·과목별 변환 규칙을 담은 엑셀 파일입니다. 평가계획의 채점 기준표를 옮겨 적어 학기 초에 한 번 만들고, 학기 말에 다시 씁니다.</p></div>
          <button type="button" class="btn" data-act="download-template">빈 양식 내려받기</button>
        </div>
        ${dropzone('template', state.template ? '다른 템플릿으로 바꾸기' : '템플릿 파일 올리기', '여기를 눌러 고르거나 파일을 끌어다 놓으세요 (.xlsx)', false)}
        ${rep ? `
          <div class="report-box ${rep.errors.length ? 'bad' : 'good'}">
            <b>${esc(rep.fileName)}</b> — ${rep.errors.length ? `오류 ${rep.errors.length}건이 있어 적용하지 않았습니다. 고친 뒤 다시 올려 주세요.` : '적용했습니다.'}
            ${messageList(rep.errors, 'error')}
            ${rep.warnings.length ? `<div class="muted small-head">확인 필요 ${rep.warnings.length}건</div>${messageList(rep.warnings, 'warn')}` : ''}
          </div>` : ''}
      </div>

      ${state.template ? `
      <div class="card">
        <div class="card-head"><h2>적용된 규칙</h2><p>${esc(state.template.fileName)} · 과목 ${index.size}개</p></div>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>학년</th><th>나이스 과목명</th><th>MYP 과목군</th><th>근거 합치기 ${tip('같은 Criterion을 여러 영역에서 평가했을 때 계산값을 내는 방식입니다. IB는 학기 말 수준을 교사가 근거의 흐름(향상 추세)과 일관성을 보고 판단하도록 하며, 단순 평균은 부적절한 방식으로 봅니다. 계산값은 제안값이니 3단계에서 확인하세요.')}</th><th>나이스 영역 → Criterion</th><th>평가 횟수 ${tip('이번 학기 템플릿에서 Criterion마다 평가한 영역 수입니다. IB는 과목마다 모든 Criterion의 모든 세부 요소(strand)를 1년에 2번 이상 평가하도록 요구합니다.')}</th></tr></thead>
          <tbody>${subjectRows}</tbody>
        </table></div>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><h2>변환 설정</h2></div>
        <div class="rubric-grid">
          <div>
            <h3>수준이 범위일 때 ${tip('템플릿의 수준이 "7~8"처럼 범위로 적혀 있을 때 어느 값을 쓸지 정합니다. 검토 단계에서 학생별로 고칠 수 있습니다.')}</h3>
            <select data-bind="levelPick">${Object.entries(LEVEL_PICKS).map(([k, label]) => `<option value="${k}" ${state.levelPick === k ? 'selected' : ''}>${label} (7~8 → ${k === 'high' ? 8 : 7})</option>`).join('')}</select>
            <p class="hint">한꺼번에 처리하는 편의 기능입니다. 학생별로 다르게 판단한 경우에는 3단계 검토에서 수준을 고치면 됩니다.</p>
            <h3 class="mt">기준을 모두 평가하지 않은 과목 ${tip('IB는 등급을 그 과목의 모든 Criterion 수준으로 정해야 한다고 규정합니다. 그래서 기본값은 Criterion 수준만 보고하고 등급은 주지 않는 것입니다.')}</h3>
            <label class="check"><input type="checkbox" data-bind="allowPartial" data-rerender="1" ${state.allowPartial ? 'checked' : ''}> 평가한 기준의 합을 32점으로 환산해 등급 산출 (학교 방침, IB 규정과 다름)</label>
          </div>
          <div>
            <h3>최종 등급 경계 (총점 32점) ${tip('기준별 수준의 합(총점)이 어느 구간에 속하는지로 1~7 등급을 정합니다.')}</h3>
            <div class="table-wrap"><table class="grid compact mini">
              <thead><tr><th>등급</th>${boundaryRanges().map((r) => `<th>${r.grade}</th>`).join('')}</tr></thead>
              <tbody>
                <tr><th>최소 총점</th>${state.boundaries.map((v, i) => `<td><input type="number" class="num" min="0" max="32" data-bound="${i}" value="${esc(v)}" aria-label="${i + 1}등급 최소 총점"></td>`).join('')}</tr>
                <tr><th>구간</th>${boundaryRanges().map((r) => `<td class="range" data-range="${r.grade}">${r.min}–${r.max}</td>`).join('')}</tr>
              </tbody>
            </table></div>
            <p class="hint ${boundsOk ? '' : 'warn'}" id="boundHint">${boundsOk ? 'IB MYP 일반 등급 경계가 기본값입니다.' : '⚠ 최소 총점은 등급이 올라갈수록 커지고 32 이하여야 합니다.'}</p>
          </div>
        </div>
      </div>

      <div class="step-nav"><span></span><button type="button" class="btn primary" data-goto="2" ${state.template ? '' : 'disabled'}>다음: 나이스 성적 파일 →</button></div>`;
  }

  // ---------------------------------------------------------------- step 2: NEIS files

  function renderNeisStep() {
    const uploads = [...state.uploads].sort((a, b) => Number(a.grade) - Number(b.grade) || a.subject.localeCompare(b.subject, 'ko') || Number(a.room) - Number(b.room));
    const rows = uploads.map((u) => {
      const warnings = uploadWarnings(u);
      const subj = templateIndex().get(u.key);
      return `<tr>
        <td>${esc(u.grade)}학년</td>
        <td><b>${esc(u.subject)}</b></td>
        <td>${esc(u.room || '–')}${u.teacher ? `<small class="muted block">${esc(u.teacher)}</small>` : ''}</td>
        <td>${u.areas.map((a) => `<div class="area-line">${subj?.areas.some((t) => t.key === a.key) ? '<span class="ok-mark">✓</span>' : '<span class="warn-mark">!</span>'} ${esc(a.name)} <span class="muted">(${fmtNum(a.max)}점)</span></div>`).join('')}</td>
        <td>${u.count}명</td>
        <td class="file-name">${esc(u.fileName)}${messageList(warnings, 'warn')}</td>
        <td><button type="button" class="icon-btn" data-act="remove-upload" data-id="${u.id}" aria-label="파일 삭제" title="이 파일의 점수 삭제">×</button></td>
      </tr>`;
    }).join('');

    $('#step2').innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>나이스 성적 파일</h2>
          <p>나이스 <b>수행평가 강의실별 일람표</b>를 <b>XLS data</b>로 받은 파일을 올립니다. 과목·반마다 파일이 하나씩이므로 여러 파일을 한 번에 골라도 됩니다. 같은 과목·강의실·영역 파일을 다시 올리면 새 파일로 바뀝니다.</p>
        </div>
        ${state.template ? '' : '<div class="alert">먼저 1단계에서 기준 템플릿을 올려야 영역이 규칙과 맞는지 확인할 수 있습니다.</div>'}
        ${dropzone('neis', '나이스 파일 올리기', '여기를 눌러 고르거나 파일을 끌어다 놓으세요 (여러 개 가능)', true)}
        ${ui.neisErrors.length ? `<div class="report-box bad"><b>읽지 못한 파일</b>${messageList(ui.neisErrors, 'error')}</div>` : ''}
      </div>

      <div class="card">
        <div class="card-head row">
          <div><h2>올린 파일</h2><p>파일 ${state.uploads.length}개 · 학생 ${Object.keys(state.students).length}명</p></div>
        </div>
        ${rows ? `<div class="table-wrap"><table class="grid">
          <thead><tr><th>학년</th><th>과목</th><th>강의실 · 교사</th><th>평가 영역 ${tip('✓ 템플릿 규칙과 맞음 / ! 템플릿에 없는 영역')}</th><th>학생</th><th>파일 · 확인할 점</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : '<div class="empty">아직 올린 파일이 없습니다.</div>'}
      </div>

      <div class="step-nav">
        <button type="button" class="btn" data-goto="1">← 이전: 기준 템플릿</button>
        <button type="button" class="btn primary" data-goto="3" ${state.uploads.length ? '' : 'disabled'}>다음: 검토 →</button>
      </div>`;
  }

  async function handleNeisFiles(files) {
    if (!files.length || !requireXlsx()) return;
    ui.neisErrors = [];
    let ok = 0;
    let replaced = 0;
    for (const file of files) {
      try {
        const wb = await readWorkbook(file);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
        if (ingestNeis(parseNeisRows(rows, file.name))) replaced++;
        ok++;
      } catch (err) {
        ui.neisErrors.push(`${file.name}: ${err.message}`);
      }
    }
    renderNeisStep();
    if (ok) toast(`파일 ${ok}개를 읽었습니다.${replaced ? ` (${replaced}개는 기존 파일을 바꿈)` : ''}`);
  }

  async function handleTemplateFile(file) {
    if (!file || !requireXlsx()) return;
    try {
      const wb = await readWorkbook(file);
      const rows = (name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }) : null);
      const applied = applyTemplate(parseTemplateRows(rows('과목'), rows('규칙')), file.name);
      if (applied) toast('템플릿을 적용했습니다.');
    } catch (err) {
      ui.templateReport = { fileName: file.name, errors: [`파일을 읽지 못했습니다: ${err.message}`], warnings: [] };
    }
    renderTemplateStep();
  }

  // ---------------------------------------------------------------- step 3: review

  function ensureGroup(groups) {
    if (!groups.has(ui.group)) ui.group = groups.keys().next().value ?? null;
  }

  // 학생 점수 문제로 등급이 안 나온 경우 (기준 미평가로 등급을 주지 않은 경우는 제외)
  function needsCheck(r) {
    return r.issues.length > 0 || r.missing.length > 0;
  }

  function gradeChip(r) {
    if (r.grade == null && r.partial && !r.missing.length) {
      return `<span class="chip neutral" title="평가하지 않은 Criterion이 있어 등급을 주지 않았습니다">수준만</span>`;
    }
    if (r.grade == null) {
      const reason = r.missing.length ? `Criterion ${r.missing.join(', ')} 수준 없음` : '점수 없음';
      return `<span class="chip pending" title="${esc(reason)}">미산출</span>`;
    }
    return `<span class="chip g${r.grade}">${r.grade}</span>`;
  }

  function flags(r) {
    return `${r.issues.length ? `<span class="flag bad" title="${esc(r.issues.join('\n'))}">확인 ${r.issues.length}</span>` : ''}${r.estimated ? '<span class="flag est" title="영역 합계를 기준별 점수로 나눈 추정값이 있습니다">추정</span>' : ''}`;
  }

  function renderReviewStep() {
    const groups = classGroups();
    ensureGroup(groups);
    if (!state.template || !groups.size) {
      $('#step3').innerHTML = `<div class="card"><div class="empty">${state.template ? '2단계에서 나이스 파일을 올리세요.' : '1단계에서 기준 템플릿을 올리세요.'}</div></div>
        <div class="step-nav"><button type="button" class="btn" data-goto="2">← 이전: 나이스 성적 파일</button><span></span></div>`;
      return;
    }
    const students = groups.get(ui.group);
    const subjects = [...templateIndex().values()].filter((s) => students.some((st) => state.scores[st.id]?.[s.key]));
    const extras = extraViews(students[0]?.grade);
    if (ui.subject !== 'all' && !subjects.some((s) => s.key === ui.subject) && !extras.some(([k]) => k === ui.subject)) ui.subject = 'all';

    let issueCount = 0;
    let estimateCount = 0;
    students.forEach((st) => subjects.forEach((s) => {
      if (!state.scores[st.id]?.[s.key]) return;
      const r = computeSubject(st.id, s.key);
      if (needsCheck(r)) issueCount++;
      if (r.estimated) estimateCount++;
    }));

    $('#step3').innerHTML = `
      <div class="card">
        <div class="card-head row">
          <div><h2>검토 · 수정</h2><p>변환 결과를 확인하고, 필요하면 과목 화면에서 Criterion 수준을 직접 고칩니다.</p></div>
          <div class="filters">
            <label class="field"><span>반</span><select data-ui="group">${[...groups.keys()].map((k) => `<option value="${k}" ${k === ui.group ? 'selected' : ''}>${groupLabel(k)} (${groups.get(k).length}명)</option>`).join('')}</select></label>
            <label class="field"><span>보기</span><select data-ui="subject">
              <option value="all" ${ui.subject === 'all' ? 'selected' : ''}>전체 과목 요약</option>
              <optgroup label="과목">${subjects.map((s) => `<option value="${esc(s.key)}" ${ui.subject === s.key ? 'selected' : ''}>${esc(s.display)}</option>`).join('')}</optgroup>
              ${extras.length ? `<optgroup label="추가 기록">${extras.map(([k, label]) => `<option value="${k}" ${ui.subject === k ? 'selected' : ''}>${label}</option>`).join('')}</optgroup>` : ''}
            </select></label>
          </div>
        </div>
        <div class="stat-row">
          <span>과목 <b>${subjects.length}</b></span>
          <span class="${issueCount ? 'bad' : ''}">확인 필요 <b>${issueCount}</b>건 ${tip('점수가 없거나, 숫자가 아니거나, 배점 조합이 맞지 않거나, 등급이 나오지 않은 학생×과목 수입니다.')}</span>
          <span>추정 포함 <b>${estimateCount}</b>건 ${tip('영역 하나를 여러 기준으로 채점했는데 나이스에 합계만 있을 때, 기준별 점수 차가 가장 작은 조합으로 나눈 경우입니다.')}</span>
        </div>
        <div class="extras">
          <b>추가 기록</b> ${tip('켜면 "보기" 목록에 입력 화면이 생기고, 성적표에도 출력됩니다. 4단계에서도 켜고 끌 수 있습니다.')}
          <label class="check inline"><input type="checkbox" data-bind="report.showAtl" data-rerender="1" ${state.report.showAtl ? 'checked' : ''}> ATL 기능</label>
          <label class="check inline"><input type="checkbox" data-bind="report.showLearnerProfile" data-rerender="1" ${state.report.showLearnerProfile ? 'checked' : ''}> 학습자상</label>
          <label class="check inline"><input type="checkbox" data-bind="report.showCommunityProject" data-rerender="1" ${state.report.showCommunityProject ? 'checked' : ''}> 공동체 프로젝트 <small class="muted">(3학년)</small></label>
        </div>
        <div id="reviewArea">${reviewContent(students, subjects)}</div>
      </div>
      <div class="step-nav">
        <button type="button" class="btn" data-goto="2">← 이전: 나이스 성적 파일</button>
        <button type="button" class="btn primary" data-goto="4">다음: 성적표 출력 →</button>
      </div>`;
  }

  function extraViews(grade) {
    const o = state.report;
    return [
      o.showAtl && ['@atl', 'ATL 기능'],
      o.showLearnerProfile && ['@lp', '학습자상'],
      o.showCommunityProject && grade === '3' && ['@cp', '공동체 프로젝트'],
    ].filter(Boolean);
  }

  function reviewContent(students, subjects) {
    if (ui.subject === '@atl') return atlTable(students);
    if (ui.subject === '@lp') return lpTable(students);
    if (ui.subject === '@cp') return cpTable(students);
    if (ui.subject === 'all') return overviewTable(students, subjects);
    return subjectTable(students, templateIndex().get(ui.subject));
  }

  function atlTable(students) {
    const units = atlUnits();
    const stages = MYP.atl.stages;
    const rows = students.map((st, r) => `<tr>
      <td class="no">${esc(st.no)}</td><td class="name">${esc(st.name)}</td>
      ${units.map((u, c) => `<td class="center"><input class="gridcell stage" data-atl="${esc(st.id)}" data-unit="${u.key}" data-row="${r}" data-col="${c}"
        value="${esc(state.atl[st.id]?.[u.key])}" maxlength="3" autocomplete="off" aria-label="${esc(st.name)} ${esc(u.ko)}"></td>`).join('')}
    </tr>`).join('');
    return `
      <div class="extra-head">
        <p class="hint">IB는 ATL 기능을 점수로 평가하지 않고, 기능이 어느 단계까지 발달했는지 피드백합니다. 칸에 <b>N · L · P · E</b>(또는 1~4)를 입력하세요. 열 머리글의 <b>일괄</b>로 반 전체를 한 번에 채운 뒤 다른 학생만 고치면 편합니다. 엑셀에서 여러 칸을 복사해 첫 칸에 붙여넣을 수도 있습니다.</p>
        <label class="field compact"><span>입력 단위</span><select data-bind="atlUnit" data-rerender="1">
          <option value="category" ${state.atlUnit === 'category' ? 'selected' : ''}>5개 기능 범주</option>
          <option value="cluster" ${state.atlUnit === 'cluster' ? 'selected' : ''}>10개 기능 군집 (자세히)</option>
        </select></label>
      </div>
      <div class="stage-legend">${stages.map((s) => `<span><b>${s.key}</b> ${s.ko} <small>${esc(s.desc)}</small></span>`).join('')}</div>
      <div class="table-wrap"><table class="grid scores">
        <thead><tr><th>번호</th><th>이름</th>${units.map((u) => `<th class="center">${u.group ? `<small>${esc(u.group)}</small>` : ''}${esc(u.ko)}
          <select class="bulk" data-atl-bulk="${u.key}" aria-label="${esc(u.ko)} 반 전체 입력"><option value="">일괄</option>${stages.map((s) => `<option value="${s.key}">${s.key} ${s.ko}</option>`).join('')}<option value="-">비우기</option></select></th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function lpTable(students) {
    const attrs = MYP.learnerProfile;
    const rows = students.map((st) => {
      const entry = state.learnerProfile[st.id] || {};
      return `<tr>
        <td class="no">${esc(st.no)}</td><td class="name">${esc(st.name)}</td>
        ${attrs.map((a) => `<td class="center"><input type="checkbox" data-lp="${esc(st.id)}" data-attr="${a.key}" ${(entry.attrs || []).includes(a.key) ? 'checked' : ''} aria-label="${esc(st.name)} ${esc(a.ko)}"></td>`).join('')}
        <td><textarea class="subj-comment-input" rows="2" data-lpnote="${esc(st.id)}" placeholder="학습자상이 드러난 장면 (선택)" aria-label="${esc(st.name)} 학습자상 메모">${esc(entry.note)}</textarea></td>
      </tr>`;
    }).join('');
    return `
      <p class="hint">IB 학습자상은 점수로 평가하지 않습니다. 이번 학기에 학생이 <b>두드러지게 보여 준 특성</b>을 2~3개 고르고, 필요하면 그 장면을 짧게 적으세요. 성적표에는 10가지 특성 중 고른 것이 강조되어 나옵니다.</p>
      <div class="table-wrap"><table class="grid scores lp-table">
        <thead><tr><th>번호</th><th>이름</th>${attrs.map((a) => `<th class="center">${esc(a.short)} ${tip(`${a.ko} (${a.en}): ${a.desc}`)}</th>`).join('')}<th>메모</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function cpRowCells(r) {
    return {
      total: r.total != null ? `<b>${r.total}</b><small> / ${r.max}</small>` : '<span class="muted">–</span>',
      grade: r.grade != null ? `<span class="chip g${r.grade}">${r.grade}</span>` : '<span class="muted">–</span>',
    };
  }

  function cpTable(students) {
    const scheme = cpScheme();
    const crits = Object.keys(scheme.criteria);
    const list = students.filter((st) => st.grade === '3');
    const rows = list.map((st, r) => {
      const res = cpResult(st.id);
      const cells = cpRowCells(res);
      const input = (field, col, cls, label, extra = '') => `<input class="gridcell ${cls}" data-cp="${esc(st.id)}" data-field="${field}" data-row="${r}" data-col="${col}"
        value="${esc(res.entry[field])}" autocomplete="off" aria-label="${esc(st.name)} ${label}" ${extra}>`;
      return `<tr data-sid="${esc(st.id)}">
        <td class="no">${esc(st.no)}</td><td class="name">${esc(st.name)}</td>
        <td>${input('title', 0, 'cp-title', '프로젝트 제목', 'placeholder="프로젝트 제목"')}</td>
        <td>${input('supervisor', 1, 'cp-sup', '지도 교사', 'placeholder="지도 교사"')}</td>
        ${crits.map((c, i) => `<td class="center">${input(c, i + 2, `score ${parseOverride(res.entry[c]).error ? 'invalid' : ''}`, `${c} 수준`, 'inputmode="numeric" placeholder="0~8"')}</td>`).join('')}
        <td class="total" data-cptotal>${cells.total}</td>
        ${state.cp.showGrade ? `<td data-cpgrade>${cells.grade}</td>` : ''}
      </tr>`;
    }).join('');
    const bounds = state.cp.boundaries[state.cp.scheme];
    return `
      <p class="hint">공동체 프로젝트는 MYP 3년차(중3) 학생이 공동체의 필요를 탐구하고 봉사로 실천하는 프로젝트입니다. 최대 3명이 함께 할 수 있으니, 같은 제목·지도 교사를 엑셀에서 복사해 여러 칸에 붙여넣으세요. 각 기준은 0~8 수준입니다.</p>
      <div class="extra-head">
        <label class="field"><span>평가 기준 체계 ${tip('IB 프로젝트 가이드 판에 따라 공동체 프로젝트의 평가 기준 수가 다릅니다. 학교에서 쓰는 가이드에 맞게 고르세요. 바꿔도 입력한 A~D 값은 남아 있습니다.')}</span>
          <select data-bind="cp.scheme" data-rerender="1">${Object.entries(MYP.communityProject).map(([k, s]) => `<option value="${k}" ${state.cp.scheme === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
        <label class="check inline"><input type="checkbox" data-bind="cp.showGrade" data-rerender="1" ${state.cp.showGrade ? 'checked' : ''}> 1~7 등급도 산출</label>
      </div>
      ${state.cp.showGrade ? `
      <div class="table-wrap"><table class="grid compact mini">
        <thead><tr><th>등급</th>${bounds.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
        <tbody><tr><th>최소 총점</th>${bounds.map((v, i) => `<td><input type="number" class="num" min="0" max="${crits.length * 8}" data-cpbound="${i}" value="${esc(v)}" aria-label="${i + 1}등급 최소 총점"></td>`).join('')}</tr></tbody>
      </table></div>
      <p class="hint">등급 경계는 참고값입니다. 학교에서 정한 값이 있으면 고치세요. (총점 ${crits.length * 8}점 만점)</p>` : ''}
      ${list.length ? `<div class="table-wrap"><table class="grid scores">
        <thead><tr><th>번호</th><th>이름</th><th>프로젝트 제목</th><th>지도 교사</th>
          ${crits.map((c) => `<th class="center"><span class="crit-badge">${c}</span> ${esc(scheme.criteria[c].ko)}</th>`).join('')}
          <th>총점</th>${state.cp.showGrade ? '<th>등급</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">이 반에는 3학년 학생이 없습니다.</div>'}`;
  }

  function refreshCpRow(sid, input) {
    const row = input.closest('tr');
    const res = cpResult(sid);
    const cells = cpRowCells(res);
    input.classList.toggle('invalid', Boolean(parseOverride(input.value).error));
    row.querySelector('[data-cptotal]').innerHTML = cells.total;
    const grade = row.querySelector('[data-cpgrade]');
    if (grade) grade.innerHTML = cells.grade;
  }

  function overviewTable(students, subjects) {
    const rows = students.map((st) => `<tr>
      <td class="no">${esc(st.no)}</td><td class="name">${esc(st.name)}</td>
      ${subjects.map((s) => {
        if (!state.scores[st.id]?.[s.key]) return '<td class="center muted">–</td>';
        const r = computeSubject(st.id, s.key);
        return `<td class="center"><button type="button" class="cell-link" data-act="open-subject" data-key="${esc(s.key)}" title="${esc(s.display)} 자세히">${gradeChip(r)}${flags(r)}</button></td>`;
      }).join('')}
    </tr>`).join('');
    return `<p class="hint">등급을 누르면 해당 과목의 영역 점수와 Criterion 수준을 볼 수 있습니다.</p>
      <div class="table-wrap"><table class="grid scores">
        <thead><tr><th>번호</th><th>이름</th>${subjects.map((s) => `<th class="center">${esc(s.display)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function areaCell(row) {
    if (row.raw == null || text(row.raw) === '') return '<span class="muted">–</span>';
    const raw = `<b>${esc(typeof row.raw === 'number' ? fmtNum(row.raw) : row.raw)}</b>`;
    if (!row.points) return `${raw} <span class="warn-mark">!</span>`;
    const parts = row.area.crits.map((c) => `${c.crit} ${fmtNum(row.points[c.crit])}→${row.levels[c.crit]}`).join(' · ');
    return `${raw}<small class="split ${row.estimated ? 'est' : ''}">${parts}${row.estimated ? ' (추정)' : ''}</small>`;
  }

  function subjectTable(students, subj) {
    const list = students.filter((st) => state.scores[st.id]?.[subj.key]);
    const rows = list.map((st, rowIdx) => {
      const r = computeSubject(st.id, subj.key);
      return `<tr data-sid="${esc(st.id)}">
        <td class="no">${esc(st.no)}</td><td class="name">${esc(st.name)}</td>
        ${r.areas.map((a) => `<td>${areaCell(a)}</td>`).join('')}
        ${subj.crits.map((c, col) => {
          const f = r.finals[c];
          return `<td><div class="cell final-cell">
            <span class="auto" data-auto="${c}" title="영역 점수로 계산한 값">${f.auto ?? '–'}</span>
            <input class="score override ${f.error ? 'invalid' : ''}" data-ov="${c}" data-sid="${esc(st.id)}" data-key="${esc(subj.key)}" data-row="${rowIdx}" data-col="${col}"
              value="${esc(state.overrides[st.id]?.[subj.key]?.[c])}" placeholder="수정" inputmode="numeric" autocomplete="off" aria-label="${esc(st.name)} Criterion ${c} 수준 수정">
          </div></td>`;
        }).join('')}
        <td class="total" data-total>${totalText(r)}</td>
        <td data-grade>${gradeChip(r)}</td>
        <td class="issues" data-issues>${issueText(r)}</td>
        ${state.report.showSubjectComment ? `<td><textarea class="subj-comment-input" rows="2" data-scomment="${esc(st.id)}" data-key="${esc(subj.key)}" placeholder="이 과목의 강점과 다음 단계" aria-label="${esc(st.name)} ${esc(subj.display)} 과목 의견">${esc(state.subjectComments[st.id]?.[subj.key])}</textarea></td>` : ''}
      </tr>`;
    }).join('');

    const g = MYP.subjects[subj.groupKey];
    return `<p class="hint">${esc(subj.neis)} · ${esc(g.ko)} · 근거 합치기: ${AGGREGATES[subj.aggregate]}. 계산값은 <b>제안값</b>입니다. 학기 동안의 근거(향상 추세·일관성)를 보고 교사 판단이 다르면 <b>수정</b> 칸에 0~8을 입력하세요. Enter로 아래 칸으로 이동합니다.</p>
      <label class="check inline"><input type="checkbox" data-bind="report.showSubjectComment" data-rerender="1" ${state.report.showSubjectComment ? 'checked' : ''}> 과목별 의견 작성 · 성적표에 출력</label>
      <div class="table-wrap"><table class="grid scores">
        <thead><tr><th>번호</th><th>이름</th>
          ${subj.areas.map((a) => `<th>${esc(a.name)}<small>${fmtNum(a.max)}점 → ${a.crits.map((c) => c.crit).join('+')}</small></th>`).join('')}
          ${subj.crits.map((c) => `<th class="crit-col"><span class="crit-badge">${c}</span> ${esc(g.criteria[c].ko)}<small>계산 / 수정</small></th>`).join('')}
          <th>총점</th><th>등급</th><th>확인할 점</th>${state.report.showSubjectComment ? '<th>과목 의견</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function totalText(r) {
    if (r.total == null) return '<span class="muted">–</span>';
    return r.scaled ? `${r.total}<small> 환산 (${r.sum}/${r.subj.crits.length * 8})</small>` : `${r.total}`;
  }

  function issueText(r) {
    const list = [...r.issues];
    if (r.grade == null && r.missing.length) list.push(`Criterion ${r.missing.join(', ')} 수준 없음`);
    return list.length ? `<ul class="msg-list error">${list.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<span class="ok-mark">✓</span>';
  }

  function refreshReviewRow(sid, key) {
    const row = $(`#reviewArea tr[data-sid="${CSS.escape(sid)}"]`);
    if (!row) return;
    const r = computeSubject(sid, key);
    r.subj.crits.forEach((c) => {
      row.querySelector(`[data-auto="${c}"]`).textContent = r.finals[c].auto ?? '–';
      row.querySelector(`[data-ov="${c}"]`).classList.toggle('invalid', Boolean(r.finals[c].error));
    });
    row.querySelector('[data-total]').innerHTML = totalText(r);
    row.querySelector('[data-grade]').innerHTML = gradeChip(r);
    row.querySelector('[data-issues]').innerHTML = issueText(r);
  }

  function onReviewKeydown(e) {
    const t = e.target;
    if (!t.matches?.('#reviewArea input[data-row][data-col]')) return;
    let dRow = 0;
    if (e.key === 'Enter' || e.key === 'ArrowDown') dRow = e.shiftKey && e.key === 'Enter' ? -1 : 1;
    else if (e.key === 'ArrowUp') dRow = -1;
    else return;
    e.preventDefault();
    const target = $(`#reviewArea input[data-row="${Number(t.dataset.row) + dRow}"][data-col="${t.dataset.col}"]`);
    if (target) {
      target.focus();
      target.select();
    }
  }

  // 엑셀에서 여러 칸을 복사해 붙여넣으면 오른쪽·아래 칸까지 채운다.
  function onReviewPaste(e) {
    const t = e.target;
    if (!t.matches?.('#reviewArea input[data-row][data-col]')) return;
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (!/[\t\n]/.test(pasted.trim())) return;
    e.preventDefault();
    let filled = 0;
    pasted.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, dr) => {
      line.split('\t').forEach((value, dc) => {
        const target = $(`#reviewArea input[data-row="${Number(t.dataset.row) + dr}"][data-col="${Number(t.dataset.col) + dc}"]`);
        if (!target) return;
        target.value = value.trim();
        target.dispatchEvent(new Event('input', { bubbles: true }));
        filled++;
      });
    });
    toast(`${filled}칸에 붙여넣었습니다.`);
  }

  // ---------------------------------------------------------------- step 4: report

  function renderReportStep() {
    const groups = classGroups();
    ensureGroup(groups);
    if (!state.template || !groups.size) {
      $('#reportOptions').innerHTML = `<div class="card"><div class="empty">성적표를 만들 학생이 없습니다. 1~2단계를 먼저 진행하세요.</div></div>`;
      $('#reportPreview').innerHTML = '';
      return;
    }
    const students = groups.get(ui.group);
    const selected = students.filter((s) => !ui.excluded.has(s.id));
    const pending = students.filter((st) => studentSubjects(st.id).some((s) => needsCheck(computeSubject(st.id, s.key))));
    const o = state.report;

    const checks = [
      ['showMypYear', 'MYP 연차 표시 (중3 → Year 3)'],
      ['showTeacher', '과목 담당 교사 표시'],
      ['showSubjectComment', '과목별 의견 출력 (3단계에서 작성)'],
      ['showDescriptor', '등급 설명 표시'],
      ['showAtl', 'ATL 기능 출력 (3단계에서 입력)'],
      ['showLearnerProfile', '학습자상 출력 (3단계에서 입력)'],
      ['showCommunityProject', '공동체 프로젝트 출력 (3학년, 3단계에서 입력)'],
      ['showCritNames', '과목군별 Criterion 이름 표시'],
      ['showBoundaries', '등급 경계표 표시'],
      ['showComment', '종합 의견 작성 · 출력'],
      ['showSignature', '서명란 표시'],
    ].map(([key, label]) => `<label class="check"><input type="checkbox" data-bind="report.${key}" ${o[key] ? 'checked' : ''}> ${label}</label>`).join('');

    $('#reportOptions').innerHTML = `
      <div class="card">
        <div class="card-head row">
          <div><h2>성적표 출력</h2><p>학생 1명당 전 과목 1부입니다. 인쇄 창에서 대상을 <b>PDF로 저장</b>으로 바꾸면 PDF가 됩니다. (A4, 배경 그래픽 켜기 권장)</p></div>
          <div class="btn-row">
            <button type="button" class="btn" data-act="export-csv">결과 CSV 내보내기</button>
            <button type="button" class="btn primary" data-act="print" ${selected.length ? '' : 'disabled'}>인쇄 / PDF 저장 (${selected.length}명)</button>
          </div>
        </div>
        <div id="pageInfo"></div>
        ${pending.length ? `<div class="alert">등급이 나오지 않은 과목이 있는 학생이 <b>${pending.length}명</b> 있습니다: ${pending.slice(0, 8).map((s) => esc(s.name)).join(', ')}${pending.length > 8 ? ' 외' : ''}. 3단계 검토에서 확인하세요.</div>` : ''}
        <div class="report-options">
          <div>
            <div class="form-grid tight">
              <label class="field"><span>반</span><select data-ui="group">${[...groups.keys()].map((k) => `<option value="${k}" ${k === ui.group ? 'selected' : ''}>${groupLabel(k)}</option>`).join('')}</select></label>
              ${field('학교명', 'info.school', { placeholder: '예: ○○중학교' })}
              ${field('성적표 제목', 'info.title')}
              ${field('학년도', 'info.year', { placeholder: '2026' })}
              ${field('학기', 'info.semester', { placeholder: '2' })}
              ${field('발급일', 'info.reportDate', { type: 'date' })}
              ${field('서명란 1', 'report.sign1')}
              ${field('서명란 2', 'report.sign2')}
            </div>
            <div class="checks">${checks}</div>
          </div>
          <div>
            <div class="student-pick-head"><h3>출력할 학생</h3>
              <button type="button" class="btn small" data-act="select-all">전체 선택</button>
              <button type="button" class="btn small" data-act="select-none">전체 해제</button></div>
            <div class="student-pick">${students.map((s) => `<label class="check student-check"><input type="checkbox" data-print="${esc(s.id)}" ${ui.excluded.has(s.id) ? '' : 'checked'}>
              <span>${esc(s.no)} ${esc(s.name)}</span></label>`).join('')}</div>
          </div>
        </div>
      </div>
      ${o.showComment ? commentEditor(students) : ''}
      <div class="step-nav"><button type="button" class="btn" data-goto="3">← 이전: 검토</button><span class="muted">아래는 인쇄 미리보기입니다.</span></div>`;
    renderPreview();
  }

  function commentEditor(students) {
    return `
      <div class="card">
        <div class="card-head"><h2>종합 의견</h2><p>학생마다 성적표 아래쪽에 들어갈 담임·코디네이터 의견을 적습니다. 비워 두면 빈 칸으로 인쇄됩니다. 과목별 의견은 3단계 과목 화면에서 적습니다.</p></div>
        <div class="comment-list">${students.map((s) => {
          const value = state.comments[s.id] || '';
          return `<label class="comment-row">
            <span class="comment-who"><b>${esc(s.no)}</b> ${esc(s.name)}<small data-count="${esc(s.id)}">${value.length}자</small></span>
            <textarea rows="2" data-comment="${esc(s.id)}" placeholder="의견을 입력하세요" aria-label="${esc(s.name)} 종합 의견">${esc(value)}</textarea>
          </label>`;
        }).join('')}</div>
      </div>`;
  }

  function renderPreview() {
    const students = (classGroups().get(ui.group) || []).filter((s) => !ui.excluded.has(s.id));
    $('#reportPreview').innerHTML = students.length ? students.map(reportSheet).join('') : '<div class="empty no-print">출력할 학생이 없습니다.</div>';
    estimatePages();
  }

  function commentHtml(sid) {
    return esc(state.comments[sid] || '').replace(/\n/g, '<br>') || '&nbsp;';
  }

  // 인쇄 쪽수를 어림한다. (A4에서 위 12mm·아래 14mm 여백을 뺀 높이 기준)
  function estimatePages() {
    const pageHeight = (271 * 96) / 25.4;
    let multi = 0;
    $$('#reportPreview .sheet').forEach((sheet) => {
      const pages = Math.max(1, Math.ceil((sheet.querySelector('.sheet-frame').offsetHeight - 2) / pageHeight));
      if (pages > 1) multi++;
      sheet.querySelector('[data-pages]').textContent = `약 ${pages}쪽`;
    });
    const box = $('#pageInfo');
    if (box) {
      box.innerHTML = multi
        ? `<div class="alert info">성적표가 2쪽 이상인 학생이 <b>${multi}명</b>입니다. 학생마다 새 쪽에서 시작하고, <b>쪽마다 위쪽에 학생 이름·학년·반·번호</b>가 반복 인쇄되며, 마지막 쪽에 "성적표 끝" 표시가 들어갑니다.</div>`
        : '';
    }
  }

  function formatDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : esc(value);
  }

  function reportSheet(st) {
    const i = state.info;
    const o = state.report;
    const results = studentSubjects(st.id).map((s) => computeSubject(st.id, s.key));
    const anyScaled = results.some((r) => r.scaled);
    const anyPartialNoGrade = results.some((r) => r.partial && r.grade == null && !r.missing.length);

    const rows = results.map((r) => {
      const s = r.subj;
      const teacher = o.showTeacher ? subjectTeachers(st.id, s.key) : '';
      const subjComment = o.showSubjectComment ? text(state.subjectComments[st.id]?.[s.key]) : '';
      return `<tbody class="subj-block"><tr>
        <td class="sname">${esc(s.display)}<small>${esc(MYP.subjects[s.groupKey].ko)}</small>${teacher ? `<span class="teacher">${esc(teacher)}</span>` : ''}</td>
        ${CRITS.map((c) => (s.crits.includes(c) ? `<td class="lv">${r.finals[c].level ?? '<span class="na">·</span>'}</td>` : '<td class="na">–</td>')).join('')}
        <td class="final">${r.total != null ? `<b>${r.total}</b>${r.scaled ? '<sup>*</sup>' : ''}` : '<span class="na">–</span>'}</td>
        <td class="grade">${r.grade != null ? `<b>${r.grade}</b>` : `<span class="na">${r.partial && !r.missing.length ? '수준만 보고' : '미산출'}</span>`}</td>
      </tr>${subjComment ? `<tr class="subj-comment"><td colspan="7">${esc(subjComment).replace(/\n/g, '<br>')}</td></tr>` : ''}</tbody>`;
    }).join('');

    const groupKeys = [...new Set(results.map((r) => r.subj.groupKey))];
    const critNames = o.showCritNames && groupKeys.length ? `
      <h2>평가 기준 <small>MYP Criteria</small></h2>
      <table class="sheet-legend">${groupKeys.map((k) => {
        const g = MYP.subjects[k];
        const subjectsInGroup = results.filter((r) => r.subj.groupKey === k).map((r) => r.subj.display).join(', ');
        return `<tr><th>${esc(g.ko)}<small>${esc(subjectsInGroup)}</small></th><td>${CRITS.map((c) => `<span><b>${c}</b> ${esc(g.criteria[c].ko)}</span>`).join('')}</td></tr>`;
      }).join('')}</table>` : '';

    const byGrade = new Map();
    results.filter((r) => r.grade != null).forEach((r) => {
      if (!byGrade.has(r.grade)) byGrade.set(r.grade, []);
      byGrade.get(r.grade).push(r.subj.display);
    });
    const descriptors = o.showDescriptor && byGrade.size ? `
      <h2>등급 설명 <small>Grade Descriptors</small></h2>
      <table class="sheet-desc">${[...byGrade.entries()].sort((a, b) => b[0] - a[0]).map(([grade, names]) => `
        <tr><th><b>${grade}</b>등급<small>총점 ${boundaryRanges()[grade - 1].min}–${boundaryRanges()[grade - 1].max}</small></th>
          <td><div class="desc-subj">${esc(names.join(', '))}</div>${esc(MYP.gradeDescriptors[grade].ko)}</td></tr>`).join('')}
      </table>` : '';

    const boundaries = o.showBoundaries ? `
      <h2>등급 경계 <small>Grade Boundaries</small></h2>
      <table class="sheet-bounds">
        <tr><th>등급</th>${boundaryRanges().map((b) => `<td>${b.grade}</td>`).join('')}</tr>
        <tr><th>총점 (32점)</th>${boundaryRanges().map((b) => `<td>${b.min}–${b.max}</td>`).join('')}</tr>
      </table>` : '';

    return `
    <article class="sheet" data-sid="${esc(st.id)}">
      <span class="page-badge no-print" data-pages></span>
      <table class="sheet-frame">
      <thead><tr><td>
        <div class="run-head">
          <span>${esc([i.school, i.title].filter((v) => text(v)).join(' · '))}</span>
          <span><b>${esc(st.name)}</b> · ${esc(st.grade)}학년 ${esc(st.cls)}반 ${esc(st.no)}번${st.hakbun ? ` · 학번 ${esc(st.hakbun)}` : ''}</span>
        </div>
      </td></tr></thead>
      <tbody><tr><td>
      <header class="sheet-head">
        <div>
          <div class="sheet-school">${esc(i.school) || '&nbsp;'}</div>
          <h1>${esc(i.title)}</h1>
          <div class="sheet-sub">IB Middle Years Programme${o.showMypYear ? ` · MYP Year ${esc(st.grade)}` : ''}${i.year ? ` · ${esc(i.year)}학년도` : ''}${i.semester ? ` ${esc(i.semester)}학기` : ''}</div>
        </div>
      </header>

      <table class="sheet-info">
        <tr><th>이름</th><td>${esc(st.name)}</td><th>학년 · 반 · 번호</th><td>${esc(st.grade)}학년 ${esc(st.cls)}반 ${esc(st.no)}번</td></tr>
      </table>

      <h2>과목별 성취 <small>Subject Achievement</small></h2>
      <table class="sheet-subj">
        <thead><tr><th>과목</th>${CRITS.map((c) => `<th class="lv">${c}</th>`).join('')}<th>총점<small>/ 32</small></th><th>최종 등급<small>/ 7</small></th></tr></thead>
        ${rows || `<tbody><tr><td colspan="7" class="na">성적이 없습니다.</td></tr></tbody>`}
      </table>
      <p class="sheet-note">각 Criterion은 0~8 수준입니다. "–"는 이번 학기에 평가하지 않은 기준입니다.${anyPartialNoGrade ? ' 평가하지 않은 기준이 있는 과목은 등급을 주지 않고 수준만 표시합니다.' : ''}${anyScaled ? ' <b>*</b> 평가한 기준의 합을 32점 만점으로 환산한 학교 자체 등급입니다.' : ''}</p>

      ${descriptors}
      ${o.showAtl ? atlSection(st) : ''}
      ${o.showLearnerProfile ? lpSection(st) : ''}
      ${o.showCommunityProject ? cpSection(st) : ''}
      ${critNames}
      ${boundaries}

      ${o.showComment ? `
      <h2>종합 의견 <small>General Comment</small></h2>
      <div class="sheet-comment">${commentHtml(st.id)}</div>` : ''}

      <footer class="sheet-foot">
        <span>발급일: ${formatDate(i.reportDate)}</span>
        ${o.showSignature ? `<span class="signs">${[o.sign1, o.sign2].filter((v) => text(v)).map((v) => `<span>${esc(v)} <span class="sign">(인)</span></span>`).join('')}</span>` : ''}
      </footer>
      <div class="sheet-end">${esc(st.name)} 학생 성적표 끝</div>
      </td></tr></tbody>
      </table>
    </article>`;
  }

  function atlSection(st) {
    const values = state.atl[st.id] || {};
    const units = atlUnits().filter((u) => values[u.key]);
    if (!units.length) return '';
    const stages = MYP.atl.stages;
    return `
      <h2>학습 접근 방법(ATL) 기능 <small>Approaches to Learning</small></h2>
      <table class="sheet-atl">
        <thead><tr><th>기능</th>${stages.map((s) => `<th>${s.ko}<small>${s.en}</small></th>`).join('')}</tr></thead>
        <tbody>${units.map((u) => `<tr><td class="unit">${u.group ? `<small>${esc(u.group)}</small>` : ''}${esc(u.ko)}<small class="en">${esc(u.en)}</small></td>
          ${stages.map((s) => `<td>${values[u.key] === s.key ? '<span class="dot">●</span>' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="sheet-note">ATL 기능은 점수로 평가하지 않고 발달 단계로 나타냅니다. ${stages.map((s) => `<b>${s.ko}</b>: ${s.short}`).join(' · ')}</p>`;
  }

  function lpSection(st) {
    const entry = state.learnerProfile[st.id] || {};
    const attrs = entry.attrs || [];
    const note = text(entry.note);
    if (!attrs.length && !note) return '';
    return `
      <h2>IB 학습자상 <small>IB Learner Profile</small></h2>
      <div class="sheet-lp">${MYP.learnerProfile.map((a) => `<span class="lp ${attrs.includes(a.key) ? 'on' : ''}">${attrs.includes(a.key) ? '✓ ' : ''}${esc(a.ko)}<small>${esc(a.en)}</small></span>`).join('')}</div>
      ${note ? `<div class="sheet-lp-note">${esc(note).replace(/\n/g, '<br>')}</div>` : ''}
      <p class="sheet-note">이번 학기에 두드러지게 보여 준 학습자상에 ✓ 표시했습니다. 학습자상은 점수로 평가하지 않습니다.</p>`;
  }

  function cpSection(st) {
    if (st.grade !== '3') return '';
    const r = cpResult(st.id);
    if (!r.hasData) return '';
    const scheme = cpScheme();
    const span = r.crits.length + 1 + (state.cp.showGrade ? 1 : 0);
    return `
      <h2>공동체 프로젝트 <small>Community Project</small></h2>
      <table class="sheet-cp">
        <tr><th>프로젝트 제목</th><td colspan="${span}" class="title">${esc(r.entry.title) || '–'}</td></tr>
        ${text(r.entry.supervisor) ? `<tr><th>지도 교사</th><td colspan="${span}" class="title">${esc(r.entry.supervisor)}</td></tr>` : ''}
        <tr><th>평가 기준</th>${r.crits.map((c) => `<td class="head"><b>${c}</b> ${esc(scheme.criteria[c].ko)}<small>${esc(scheme.criteria[c].en)}</small></td>`).join('')}<td class="head">총점</td>${state.cp.showGrade ? '<td class="head">등급</td>' : ''}</tr>
        <tr><th>성취 수준</th>${r.crits.map((c) => `<td class="lv">${r.levels[c] ?? '<span class="na">·</span>'}<small> / 8</small></td>`).join('')}
          <td class="lv"><b>${r.total ?? '–'}</b><small> / ${r.max}</small></td>${state.cp.showGrade ? `<td class="lv"><b>${r.grade ?? '–'}</b><small> / 7</small></td>` : ''}</tr>
      </table>`;
  }

  function exportCsv() {
    const header = ['학년', '반', '번호', '학번', '이름', '나이스 과목명', '성적표 과목명', ...CRITS.map((c) => `Criterion ${c}`), '총점', '최종 등급', '비고', '담당 교사', '과목 의견', '종합 의견'];
    const rows = [];
    sortedStudents().forEach((st) => {
      studentSubjects(st.id).forEach((s) => {
        const r = computeSubject(st.id, s.key);
        const note = [r.partial && !r.scaled && '기준 미평가(등급 없음)', r.scaled && '환산', r.estimated && '추정 포함', ...r.issues].filter(Boolean).join('; ');
        rows.push([st.grade, st.cls, st.no, st.hakbun, st.name, s.neis, s.display, ...CRITS.map((c) => (s.crits.includes(c) ? r.finals[c].level ?? '' : '')), r.total ?? '', r.grade ?? '', note, subjectTeachers(st.id, s.key), state.subjectComments[st.id]?.[s.key] || '', state.comments[st.id] || '']);
      });
    });
    const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`﻿${csv}`, `${fileBase()}_MYP_결과.csv`, 'text/csv;charset=utf-8');
  }

  // ---------------------------------------------------------------- files

  function fileBase() {
    const i = state.info;
    return [i.year && `${i.year}학년도`, i.semester && `${i.semester}학기`].filter(Boolean).join('_') || 'MYP';
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveFile() {
    const payload = { app: FILE_APP_ID, version: FILE_VERSION, savedAt: new Date().toISOString(), state };
    download(JSON.stringify(payload, null, 2), `${fileBase()}_MYP_작업.json`, 'application/json');
    dirty = false;
    toast('작업 파일을 저장했습니다.');
  }

  function normalizeState(raw) {
    const base = defaultState();
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const next = {
      ...base,
      demo: raw.demo === true,
      info: { ...base.info, ...obj(raw.info) },
      report: { ...base.report, ...obj(raw.report) },
      levelPick: LEVEL_PICKS[raw.levelPick] ? raw.levelPick : base.levelPick,
      boundaries: Array.isArray(raw.boundaries) && raw.boundaries.length === 7 ? raw.boundaries : base.boundaries,
      template: raw.template && Array.isArray(raw.template.subjects) && Array.isArray(raw.template.rules) ? raw.template : null,
      uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
      students: obj(raw.students),
      scores: obj(raw.scores),
      overrides: obj(raw.overrides),
      comments: obj(raw.comments),
      subjectComments: obj(raw.subjectComments),
      allowPartial: raw.allowPartial === true,
      atlUnit: raw.atlUnit === 'cluster' ? 'cluster' : 'category',
      cp: {
        ...base.cp,
        ...obj(raw.cp),
        scheme: MYP.communityProject[raw.cp?.scheme] ? raw.cp.scheme : base.cp.scheme,
        boundaries: { ...base.cp.boundaries, ...obj(raw.cp?.boundaries) },
      },
      atl: obj(raw.atl),
      learnerProfile: obj(raw.learnerProfile),
      communityProject: obj(raw.communityProject),
    };
    return next;
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== FILE_APP_ID || !data.state) throw new Error('이 앱에서 저장한 파일이 아닙니다.');
        if (data.version !== FILE_VERSION) throw new Error('이전 버전(교과별 직접 입력)에서 저장한 파일은 이 버전에서 열 수 없습니다.');
        replaceState(normalizeState(data.state));
        goStep(Object.keys(state.students).length ? 3 : 1);
        toast(`불러왔습니다: 파일 ${state.uploads.length}개, 학생 ${Object.keys(state.students).length}명`);
      } catch (err) {
        alert(`파일을 불러오지 못했습니다.\n${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function replaceState(next) {
    state = next;
    ui.group = null;
    ui.subject = 'all';
    ui.excluded.clear();
    ui.templateReport = null;
    ui.neisErrors = [];
    dirty = false;
  }

  // 완성본 예시: 3학년 11과목, 2개 반의 가상 데이터 (js/demo-data.js)
  function loadDemo() {
    const next = defaultState();
    next.demo = true;
    Object.assign(next.info, { school: '예시중학교', year: '2026', semester: '2' });
    next.report.showComment = true;
    next.report.showSubjectComment = true;
    Object.assign(next.report, { showAtl: true, showLearnerProfile: true, showCommunityProject: true });
    replaceState(next);

    const demo = MYP_DEMO.build(SUBJECT_COLS, RULE_COLS);
    const result = parseTemplateRows(demo.subjectRows, demo.ruleRows);
    if (!applyTemplate(result, '완성본 예시_기준템플릿.xlsx')) throw new Error(result.errors.join('\n'));
    demo.files.forEach(ingestNeis);
    Object.values(state.students).forEach((st) => {
      const grades = studentSubjects(st.id).map((s) => ({ subject: s.display, grade: computeSubject(st.id, s.key).grade }));
      state.comments[st.id] = MYP_DEMO.comment(grades);
      const valid = grades.filter((g) => g.grade != null);
      const avg = valid.length ? valid.reduce((sum, g) => sum + g.grade, 0) / valid.length : 4;
      const extra = MYP_DEMO.extras(st, avg);
      state.atl[st.id] = extra.atl;
      state.learnerProfile[st.id] = extra.learnerProfile;
      state.communityProject[st.id] = extra.communityProject;
      studentSubjects(st.id).forEach((s) => {
        const r = computeSubject(st.id, s.key);
        const names = MYP.subjects[s.groupKey].criteria;
        const ranked = s.crits.map((c) => ({ c, level: r.finals[c].level ?? 0 })).sort((a, b) => b.level - a.level);
        (state.subjectComments[st.id] ||= {})[s.key] = MYP_DEMO.subjectComment(r.grade, names[ranked[0].c].ko, names[ranked[ranked.length - 1].c].ko);
      });
    });
    dirty = false;
  }

  // 실제 파일을 올리기 전에 완성본 예시를 비운다.
  function leaveDemo() {
    if (!state.demo) return true;
    if (!confirm('완성본 예시를 지우고 실제 작업을 시작할까요?')) return false;
    replaceState(defaultState());
    return true;
  }

  // ---------------------------------------------------------------- guide & tooltip

  function renderGuide() {
    $('#guideBands').innerHTML = `
      <table class="grid compact"><tbody>${MYP.levelBands.map((b) => `<tr><th>${b.min === b.max ? b.min : `${b.min}–${b.max}`}</th><td>${b.ko} <small class="muted">${b.en}</small></td><td>${b.desc}</td></tr>`).join('')}</tbody></table>`;
    $('#guideGrades').innerHTML = `
      <table class="grid compact"><thead><tr><th>등급</th><th>총점</th><th>설명</th></tr></thead>
      <tbody>${boundaryRanges().map((b) => `<tr><th>${b.grade}</th><td class="nowrap">${b.min}–${b.max}</td><td>${esc(MYP.gradeDescriptors[b.grade].ko)}</td></tr>`).join('')}</tbody></table>`;
  }

  function showTip(el) {
    const tipEl = $('#tooltip');
    tipEl.textContent = el.dataset.tip;
    tipEl.hidden = false;
    const rect = el.getBoundingClientRect();
    const box = tipEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    let top = rect.bottom + 8;
    if (top + box.height > window.innerHeight - 8) top = rect.top - box.height - 8;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  function hideTip() {
    $('#tooltip').hidden = true;
  }

  // ---------------------------------------------------------------- actions

  function hasWork() {
    return dirty || (!state.demo && (state.template != null || state.uploads.length > 0));
  }

  const actions = {
    guide() {
      renderGuide();
      $('#guide').showModal();
    },
    'close-guide'() {
      $('#guide').close();
    },
    save: saveFile,
    demo() {
      if (hasWork() && !confirm('현재 작업을 지우고 완성본 예시를 불러올까요?')) return;
      loadDemo();
      goStep(4);
      toast('완성본 예시를 불러왔습니다. (가상 데이터)');
    },
    reset() {
      if (hasWork() && !confirm('템플릿과 올린 파일을 모두 지우고 새로 시작할까요?')) return;
      replaceState(defaultState());
      goStep(1);
    },
    'download-template': downloadTemplate,
    'remove-upload'(btn) {
      const u = state.uploads.find((x) => x.id === btn.dataset.id);
      if (!u || !confirm(`${u.grade}학년 ${u.subject} (${u.fileName}) 파일의 점수를 삭제할까요?`)) return;
      removeUpload(u.id);
      touch();
      renderNeisStep();
    },
    'open-subject'(btn) {
      ui.subject = btn.dataset.key;
      renderReviewStep();
    },
    'select-all'() {
      ui.excluded.clear();
      renderReportStep();
    },
    'select-none'() {
      (classGroups().get(ui.group) || []).forEach((s) => ui.excluded.add(s.id));
      renderReportStep();
    },
    print() {
      renderPreview();
      window.print();
    },
    'export-csv': exportCsv,
  };

  function onFieldEvent(e) {
    const t = e.target;
    const d = t.dataset;
    if (t.type === 'file' || !wantsEvent(e)) return;
    const value = t.type === 'checkbox' ? t.checked : t.value;

    if (d.bind) {
      setPath(d.bind, value);
      touch();
      const views = { 'report.showAtl': '@atl', 'report.showLearnerProfile': '@lp', 'report.showCommunityProject': '@cp' };
      if (views[d.bind] && value && ui.step === 3) ui.subject = views[d.bind]; // 켜면 바로 입력 화면으로
      if (d.bind === 'report.showComment' || d.rerender) renderStep();
      else if (ui.step === 4) renderPreview();
    } else if (d.atlBulk != null) {
      if (!value) return;
      (classGroups().get(ui.group) || []).forEach((st) => {
        const bucket = (state.atl[st.id] ||= {});
        if (value === '-') delete bucket[d.atlBulk];
        else bucket[d.atlBulk] = value;
      });
      touch();
      renderReviewStep();
    } else if (d.atl) {
      const stage = parseStage(value);
      t.classList.toggle('invalid', stage === null);
      t.title = stage === null ? 'N, L, P, E 또는 1~4로 입력하세요' : '';
      if (stage === null) return;
      const bucket = (state.atl[d.atl] ||= {});
      if (stage) bucket[d.unit] = stage;
      else delete bucket[d.unit];
      touch();
    } else if (d.lp) {
      const entry = (state.learnerProfile[d.lp] ||= { attrs: [], note: '' });
      const attrs = new Set(entry.attrs || []);
      if (t.checked) attrs.add(d.attr);
      else attrs.delete(d.attr);
      entry.attrs = MYP.learnerProfile.map((a) => a.key).filter((k) => attrs.has(k));
      touch();
    } else if (d.lpnote) {
      (state.learnerProfile[d.lpnote] ||= { attrs: [], note: '' }).note = value;
      touch();
    } else if (d.cp) {
      (state.communityProject[d.cp] ||= {})[d.field] = value;
      touch();
      if (CRITS.includes(d.field)) refreshCpRow(d.cp, t);
    } else if (d.cpbound != null) {
      state.cp.boundaries[state.cp.scheme][Number(d.cpbound)] = value === '' ? '' : Number(value);
      touch();
    } else if (d.scomment) {
      const bucket = (state.subjectComments[d.scomment] ||= {});
      if (text(value) === '') delete bucket[d.key];
      else bucket[d.key] = value;
      touch();
    } else if (d.comment) {
      state.comments[d.comment] = value;
      touch();
      const count = $(`[data-count="${CSS.escape(d.comment)}"]`);
      if (count) count.textContent = `${value.length}자`;
      const target = $(`#reportPreview .sheet[data-sid="${CSS.escape(d.comment)}"] .sheet-comment`);
      if (target) {
        target.innerHTML = commentHtml(d.comment);
        estimatePages();
      }
    } else if (d.bound != null) {
      state.boundaries[Number(d.bound)] = value === '' ? '' : Number(value);
      touch();
      boundaryRanges().forEach((r) => {
        const cell = $(`[data-range="${r.grade}"]`);
        if (cell) cell.textContent = `${r.min}–${r.max}`;
      });
      const ok = isAscending(state.boundaries) && Number(state.boundaries[6]) <= 32;
      const hint = $('#boundHint');
      hint.classList.toggle('warn', !ok);
      hint.textContent = ok ? '등급 경계를 수정했습니다.' : '⚠ 최소 총점은 등급이 올라갈수록 커지고 32 이하여야 합니다.';
    } else if (d.ui) {
      ui[d.ui] = value;
      if (d.ui === 'group') ui.subject = ui.step === 3 ? ui.subject : 'all';
      renderStep();
    } else if (d.ov) {
      const bucket = ((state.overrides[d.sid] ||= {})[d.key] ||= {});
      if (text(value) === '') delete bucket[d.ov];
      else bucket[d.ov] = value;
      touch();
      refreshReviewRow(d.sid, d.key);
    } else if (d.print) {
      if (t.checked) ui.excluded.delete(d.print);
      else ui.excluded.add(d.print);
      renderReportStep();
    }
  }

  function handleFiles(kind, files) {
    if (!files.length || !leaveDemo()) return;
    if (kind === 'template') handleTemplateFile(files[0]);
    else if (kind === 'neis') handleNeisFiles(files);
  }

  // ---------------------------------------------------------------- wiring

  document.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn && actions[actBtn.dataset.act] && !actBtn.disabled) {
      actions[actBtn.dataset.act](actBtn);
      return;
    }
    const stepBtn = e.target.closest('[data-step], [data-goto]');
    if (stepBtn && !stepBtn.disabled) goStep(Number(stepBtn.dataset.step || stepBtn.dataset.goto));
  });

  const main = $('.app-main');
  ['input', 'change'].forEach((type) => main.addEventListener(type, onFieldEvent));
  main.addEventListener('keydown', onReviewKeydown);
  main.addEventListener('paste', onReviewPaste);
  main.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t.dataset?.atl) return;
    const stage = parseStage(t.value);
    if (stage !== null) t.value = stage; // 1~4, 초/학/실/전 입력을 N/L/P/E로 바꿔 보여 준다
  });

  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type !== 'file' || !t.dataset.file) return;
    const files = [...t.files];
    t.value = '';
    handleFiles(t.dataset.file, files);
  });

  main.addEventListener('dragover', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('over');
  });
  main.addEventListener('dragleave', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('over');
  });
  main.addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('over');
    handleFiles(zone.dataset.drop, [...e.dataTransfer.files]);
  });

  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (hasWork() && !confirm('현재 작업을 지우고 파일을 불러올까요?')) return;
    loadFile(file);
  });

  $('#guide').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close(); // 바깥 클릭 시 닫기
  });

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) showTip(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-tip]')) showTip(e.target);
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  window.addEventListener('beforeunload', (e) => {
    if (!hasWork()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.addEventListener('beforeprint', () => {
    if (ui.step !== 4) goStep(4);
  });

  if (location.hash === '#demo') {
    loadDemo();
    goStep(4);
  } else {
    goStep(1);
  }
})();
