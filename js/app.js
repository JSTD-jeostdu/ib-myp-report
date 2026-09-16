(() => {
  'use strict';

  const CRITS = ['A', 'B', 'C', 'D'];
  const METHODS = {
    direct: { label: '직접 입력 (0~8)', short: '0~8 입력' },
    percent: { label: '원점수 → 백분율 환산', short: '원점수' },
    achievement: { label: '성취도 A~E → 수준', short: 'A~E 입력' },
  };
  const AGGREGATES = {
    average: '유닛 평균 (반올림)',
    latest: '가장 최근 유닛',
    highest: '가장 높은 수준',
  };
  const FILE_APP_ID = 'myp-report';
  const FILE_VERSION = 1;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let seq = 0;
  const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- state

  function subjectCriteria(key) {
    const subject = MYP.subjects[key] || MYP.subjects.custom;
    return Object.fromEntries(CRITS.map((c) => [c, { en: subject.criteria[c].en, ko: subject.criteria[c].ko }]));
  }

  function makeUnit(name) {
    return {
      id: newId('u'),
      name,
      criteria: Object.fromEntries(CRITS.map((c) => [c, { on: true, method: 'direct', max: 100 }])),
    };
  }

  function makeStudent(no, name) {
    return { id: newId('s'), no: String(no ?? ''), name: name ?? '', scores: {}, override: {}, comment: '' };
  }

  function defaultState() {
    const now = new Date();
    return {
      info: {
        school: '',
        year: String(now.getFullYear()),
        semester: now.getMonth() >= 7 ? '2' : '1',
        grade: '',
        className: '',
        subjectKey: 'langlit',
        subjectName: '',
        teacher: '',
        reportDate: todayStr(),
      },
      criteria: subjectCriteria('langlit'),
      units: [makeUnit('Unit 1'), makeUnit('Unit 2')],
      conversion: {
        // 레벨 1~8에 도달하기 위한 최소 백분율
        percentMins: [1, 30, 40, 50, 60, 70, 80, 90],
        achievement: { A: 8, B: 6, C: 4, D: 2, E: 1 },
      },
      aggregate: 'average',
      allowPartial: false,
      boundaries: [...MYP.defaultBoundaries],
      students: [],
      report: {
        title: 'IB MYP 성적표',
        showUnits: true,
        showDescriptor: true,
        showBoundaries: true,
        showComment: true,
        showSignature: true,
      },
    };
  }

  let state = defaultState();
  const ui = { step: 1, tab: null, excluded: new Set() };
  let dirty = false;

  function touch() {
    dirty = true;
  }

  // ---------------------------------------------------------------- calculation

  function toLevel(raw, cfg) {
    const value = String(raw ?? '').trim();
    if (value === '') return { level: null };

    if (cfg.method === 'achievement') {
      const key = value.toUpperCase();
      if (!(key in state.conversion.achievement)) return { level: null, error: 'A~E 중 하나를 입력하세요' };
      return { level: Number(state.conversion.achievement[key]) };
    }

    const n = Number(value);
    if (!Number.isFinite(n)) return { level: null, error: '숫자를 입력하세요' };

    if (cfg.method === 'direct') {
      if (!Number.isInteger(n) || n < 0 || n > 8) return { level: null, error: '0~8 사이의 정수를 입력하세요' };
      return { level: n };
    }

    const max = Number(cfg.max);
    if (!(max > 0)) return { level: null, error: '유닛 설정에서 만점을 확인하세요' };
    if (n < 0 || n > max) return { level: null, error: `0~${max} 사이의 점수를 입력하세요` };
    const pct = (n / max) * 100;
    let level = 0;
    state.conversion.percentMins.forEach((min, i) => {
      if (pct >= Number(min)) level = i + 1;
    });
    return { level, pct };
  }

  function unitLevel(student, unit, crit) {
    return toLevel(student.scores[unit.id]?.[crit], unit.criteria[crit]);
  }

  function collectLevels(student, crit) {
    const levels = [];
    for (const unit of state.units) {
      if (!unit.criteria[crit].on) continue;
      const { level } = unitLevel(student, unit, crit);
      if (level != null) levels.push(level);
    }
    return levels;
  }

  function aggregate(levels) {
    if (!levels.length) return null;
    if (state.aggregate === 'latest') return levels[levels.length - 1];
    if (state.aggregate === 'highest') return Math.max(...levels);
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  }

  function parseOverride(raw) {
    const value = String(raw ?? '').trim();
    if (value === '') return { level: null };
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 8) return { level: null, error: '0~8 사이의 정수' };
    return { level: n };
  }

  function finalLevel(student, crit) {
    const auto = aggregate(collectLevels(student, crit));
    const override = parseOverride(student.override[crit]);
    if (override.level != null) return { level: override.level, auto, source: 'override' };
    return { level: auto, auto, source: auto == null ? 'none' : 'auto', error: override.error };
  }

  function gradeFromTotal(total) {
    let grade = null;
    state.boundaries.forEach((min, i) => {
      if (total >= Number(min)) grade = i + 1;
    });
    return grade;
  }

  function computeStudent(student) {
    const finals = {};
    const missing = [];
    let sum = 0;
    let count = 0;
    for (const c of CRITS) {
      finals[c] = finalLevel(student, c);
      if (finals[c].level == null) missing.push(c);
      else {
        sum += finals[c].level;
        count++;
      }
    }
    let total = null;
    let scaled = false;
    if (count === 4) total = sum;
    else if (count > 0 && state.allowPartial) {
      total = Math.round((sum * 4) / count);
      scaled = true;
    }
    const grade = total == null ? null : gradeFromTotal(total);
    return { finals, missing, sum, count, total, scaled, grade };
  }

  function bandOf(level) {
    if (level == null) return null;
    return MYP.levelBands.find((b) => level >= b.min && level <= b.max) || null;
  }

  function boundaryRanges() {
    const b = state.boundaries.map(Number);
    return b.map((min, i) => ({ grade: i + 1, min, max: i < 6 ? b[i + 1] - 1 : 32 }));
  }

  function isAscending(list) {
    return list.every((v, i) => i === 0 || Number(v) > Number(list[i - 1]));
  }

  function subjectLabel() {
    const s = MYP.subjects[state.info.subjectKey] || MYP.subjects.custom;
    return state.info.subjectName.trim() || s.ko;
  }

  function critDesc(c) {
    const s = MYP.subjects[state.info.subjectKey] || MYP.subjects.custom;
    return s.criteria[c].desc;
  }

  // ---------------------------------------------------------------- common UI

  function tip(text) {
    return `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="도움말: ${esc(text)}">?</button>`;
  }

  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  function goStep(step) {
    ui.step = step;
    $$('.step').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.step) === step));
    [1, 2, 3].forEach((n) => ($(`#step${n}`).hidden = n !== step));
    if (step === 1) renderSetup();
    if (step === 2) renderScores();
    if (step === 3) renderReportStep();
    window.scrollTo({ top: 0 });
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

  // ---------------------------------------------------------------- step 1: setup

  function field(label, path, opts = {}) {
    const value = getPath(path);
    const type = opts.type || 'text';
    return `<label class="field ${opts.wide ? 'wide' : ''}"><span>${label}${opts.tip ? tip(opts.tip) : ''}</span>
      <input type="${type}" data-bind="${path}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}"></label>`;
  }

  function renderSetup() {
    const i = state.info;
    const subjectOptions = Object.entries(MYP.subjects)
      .map(([key, s]) => `<option value="${key}" ${key === i.subjectKey ? 'selected' : ''}>${esc(s.ko)} · ${esc(s.en)}</option>`)
      .join('');

    const criteriaRows = CRITS.map((c) => `
      <tr>
        <th><span class="crit-badge">${c}</span></th>
        <td><input data-critname="${c}" data-lang="ko" value="${esc(state.criteria[c].ko)}" aria-label="Criterion ${c} 한글 이름"></td>
        <td><input data-critname="${c}" data-lang="en" value="${esc(state.criteria[c].en)}" aria-label="Criterion ${c} 영문 이름"></td>
        <td class="desc">${esc(critDesc(c))}</td>
      </tr>`).join('');

    const units = state.units.map((u, idx) => `
      <div class="unit-card">
        <div class="unit-head">
          <span class="unit-no">유닛 ${idx + 1}</span>
          <input class="unit-name" data-unit="${u.id}" data-field="name" value="${esc(u.name)}" aria-label="유닛 이름" placeholder="유닛 이름">
          <button type="button" class="btn small danger-ghost" data-act="remove-unit" data-unit="${u.id}" ${state.units.length === 1 ? 'disabled' : ''}>삭제</button>
        </div>
        <div class="table-wrap">
          <table class="grid compact">
            <thead><tr><th>기준</th><th>평가함 ${tip('이 유닛에서 평가한 기준만 체크하세요. 체크하지 않은 기준은 점수 입력 칸이 만들어지지 않습니다.')}</th><th>입력 방식 ${tip('직접 입력: 루브릭으로 매긴 0~8 수준을 그대로 입력\n원점수: 지필·수행평가 점수를 만점 대비 백분율로 바꿔 수준으로 변환\n성취도: A~E 성취도를 수준으로 변환')}</th><th>만점</th></tr></thead>
            <tbody>
              ${CRITS.map((c) => {
                const cfg = u.criteria[c];
                return `<tr class="${cfg.on ? '' : 'off'}">
                  <th><span class="crit-badge">${c}</span> <span class="muted">${esc(state.criteria[c].ko)}</span></th>
                  <td><input type="checkbox" data-unit="${u.id}" data-crit="${c}" data-field="on" ${cfg.on ? 'checked' : ''} aria-label="Criterion ${c} 평가 여부"></td>
                  <td><select data-unit="${u.id}" data-crit="${c}" data-field="method" ${cfg.on ? '' : 'disabled'}>
                    ${Object.entries(METHODS).map(([k, m]) => `<option value="${k}" ${k === cfg.method ? 'selected' : ''}>${m.label}</option>`).join('')}
                  </select></td>
                  <td>${cfg.method === 'percent'
                    ? `<input type="number" min="1" class="num" data-unit="${u.id}" data-crit="${c}" data-field="max" value="${esc(cfg.max)}" ${cfg.on ? '' : 'disabled'} aria-label="만점">`
                    : '<span class="muted">—</span>'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('');

    const pm = state.conversion.percentMins;
    const percentOk = isAscending(pm);
    const percentTable = `
      <table class="grid compact mini">
        <thead><tr><th>수준</th>${pm.map((_, idx) => `<th>${idx + 1}</th>`).join('')}</tr></thead>
        <tbody><tr><th>최소 %</th>${pm.map((v, idx) => `<td><input type="number" class="num" min="0" max="100" data-pmin="${idx}" value="${esc(v)}" aria-label="수준 ${idx + 1} 최소 백분율"></td>`).join('')}</tr></tbody>
      </table>
      <p class="hint ${percentOk ? '' : 'warn'}">${percentOk ? `예: 100점 만점에 75점(75%) → 수준 ${toLevel(75, { method: 'percent', max: 100 }).level}. 가장 낮은 기준 미만은 0입니다.` : '⚠ 최소 백분율은 수준이 올라갈수록 커져야 합니다.'}</p>`;

    const achTable = `
      <table class="grid compact mini">
        <thead><tr><th>성취도</th>${Object.keys(state.conversion.achievement).map((k) => `<th>${k}</th>`).join('')}</tr></thead>
        <tbody><tr><th>수준</th>${Object.entries(state.conversion.achievement).map(([k, v]) => `<td><input type="number" class="num" min="0" max="8" data-ach="${k}" value="${esc(v)}" aria-label="성취도 ${k} 수준"></td>`).join('')}</tr></tbody>
      </table>`;

    const boundsOk = isAscending(state.boundaries) && Number(state.boundaries[6]) <= 32;
    const boundaryTable = `
      <table class="grid compact mini">
        <thead><tr><th>등급</th>${boundaryRanges().map((r) => `<th>${r.grade}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th>최소 총점</th>${state.boundaries.map((v, idx) => `<td><input type="number" class="num" min="0" max="32" data-bound="${idx}" value="${esc(v)}" aria-label="${idx + 1}등급 최소 총점"></td>`).join('')}</tr>
          <tr><th>구간</th>${boundaryRanges().map((r) => `<td class="range" data-range="${r.grade}">${r.min}–${r.max}</td>`).join('')}</tr>
        </tbody>
      </table>
      <p class="hint ${boundsOk ? '' : 'warn'}" id="boundHint">${boundsOk ? 'IB MYP 일반 등급 경계가 기본값입니다. 학교 방침이 다르면 수정하세요.' : '⚠ 최소 총점은 등급이 올라갈수록 커지고 32 이하여야 합니다.'}</p>`;

    $('#step1').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>기본 정보</h2><p>성적표 머리글에 들어갈 정보입니다.</p></div>
        <div class="form-grid">
          ${field('학교명', 'info.school', { placeholder: '예: ○○중학교' })}
          ${field('학년도', 'info.year', { placeholder: '2026' })}
          <label class="field"><span>학기</span>
            <select data-bind="info.semester">
              ${['1', '2'].map((s) => `<option value="${s}" ${i.semester === s ? 'selected' : ''}>${s}학기</option>`).join('')}
            </select></label>
          ${field('학년', 'info.grade', { placeholder: '예: 2' })}
          ${field('반', 'info.className', { placeholder: '예: 3' })}
          <label class="field wide"><span>MYP 과목군 ${tip('과목군을 고르면 해당 과목의 Criterion A~D 이름이 자동으로 채워집니다.')}</span>
            <select data-bind="info.subjectKey">${subjectOptions}</select></label>
          ${field('성적표 표시 과목명', 'info.subjectName', { placeholder: `비우면 "${(MYP.subjects[i.subjectKey] || MYP.subjects.custom).ko}"`, tip: '국가교육과정 과목명(예: 국어, 영어)으로 표시하고 싶을 때 입력하세요.' })}
          ${field('담당 교사', 'info.teacher', { placeholder: '성명' })}
          ${field('발급일', 'info.reportDate', { type: 'date' })}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>평가 기준 (Criterion A~D)</h2><p>과목군에 맞춰 자동으로 채워지며, 필요하면 이름을 고칠 수 있습니다.</p></div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th></th><th>한글 이름</th><th>영문 이름</th><th>무엇을 평가하나요?</th></tr></thead>
            <tbody>${criteriaRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head row">
          <div><h2>유닛 (Unit Plan)</h2><p>한 학기에 운영한 유닛과, 유닛마다 평가한 기준·입력 방식을 정합니다.</p></div>
          <button type="button" class="btn" data-act="add-unit">+ 유닛 추가</button>
        </div>
        <div class="unit-list">${units}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>변환 루브릭</h2><p>원점수와 성취도를 0~8 수준으로 바꾸는 기준입니다.</p></div>
        <div class="rubric-grid">
          <div>
            <h3>원점수 → 수준 ${tip('점수를 만점 대비 백분율로 바꾼 뒤, 아래 최소 백분율 이상인 가장 높은 수준을 부여합니다.')}</h3>
            <div class="table-wrap">${percentTable}</div>
          </div>
          <div>
            <h3>성취도 → 수준 ${tip('국가교육과정 성취도(A~E)를 MYP 수준(0~8)으로 옮기는 값입니다.')}</h3>
            <div class="table-wrap">${achTable}</div>
          </div>
        </div>
        <div class="rubric-grid">
          <div>
            <h3>최종 수준 자동 계산 ${tip('여러 유닛의 수준을 하나로 합치는 방법입니다. 자동값은 제안값이며, 점수 입력 > 종합 탭에서 교사가 조정할 수 있습니다.')}</h3>
            <select data-bind="aggregate">
              ${Object.entries(AGGREGATES).map(([k, label]) => `<option value="${k}" ${state.aggregate === k ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <label class="check"><input type="checkbox" data-bind="allowPartial" ${state.allowPartial ? 'checked' : ''}>
              평가하지 않은 기준이 있어도 등급 산출 ${tip('켜면 평가한 기준의 합을 32점 만점으로 환산해 등급을 냅니다. 성적표에 환산 사실이 표시됩니다. 끄면 A~D가 모두 있어야 등급이 나옵니다.')}</label>
          </div>
          <div>
            <h3>최종 등급 경계 (총점 32점) ${tip('네 기준 최종 수준의 합(총점)이 어느 구간에 속하는지로 1~7 등급을 정합니다.')}</h3>
            <div class="table-wrap">${boundaryTable}</div>
          </div>
        </div>
      </div>

      <div class="step-nav"><span></span><button type="button" class="btn primary" data-goto="2">다음: 점수 입력 →</button></div>`;
  }

  function onSetupEvent(e) {
    const t = e.target;
    const d = t.dataset;
    if (!wantsEvent(e)) return;
    const value = t.type === 'checkbox' ? t.checked : t.value;

    if (d.bind) {
      setPath(d.bind, value);
      if (d.bind === 'info.subjectKey') {
        state.criteria = subjectCriteria(value);
        renderSetup();
      }
    } else if (d.critname) {
      state.criteria[d.critname][d.lang] = value;
    } else if (d.unit && d.field) {
      const unit = state.units.find((u) => u.id === d.unit);
      if (!unit) return;
      if (d.crit) {
        unit.criteria[d.crit][d.field] = value;
        if (d.field !== 'max') renderSetup();
      } else {
        unit[d.field] = value;
      }
    } else if (d.pmin != null) {
      state.conversion.percentMins[Number(d.pmin)] = value === '' ? '' : Number(value);
      refreshHint(t, isAscending(state.conversion.percentMins), '⚠ 최소 백분율은 수준이 올라갈수록 커져야 합니다.');
    } else if (d.ach) {
      state.conversion.achievement[d.ach] = value === '' ? 0 : Math.max(0, Math.min(8, Math.round(Number(value))));
    } else if (d.bound != null) {
      state.boundaries[Number(d.bound)] = value === '' ? '' : Number(value);
      boundaryRanges().forEach((r) => {
        const cell = $(`[data-range="${r.grade}"]`);
        if (cell) cell.textContent = `${r.min}–${r.max}`;
      });
      const ok = isAscending(state.boundaries) && Number(state.boundaries[6]) <= 32;
      const hint = $('#boundHint');
      hint.classList.toggle('warn', !ok);
      hint.textContent = ok ? '등급 경계를 수정했습니다.' : '⚠ 최소 총점은 등급이 올라갈수록 커지고 32 이하여야 합니다.';
    } else {
      return;
    }
    touch();
  }

  function refreshHint(input, ok, warnText) {
    const hint = input.closest('.table-wrap')?.nextElementSibling;
    if (!hint || !hint.classList.contains('hint')) return;
    hint.classList.toggle('warn', !ok);
    hint.textContent = ok ? '변환 기준을 수정했습니다.' : warnText;
  }

  // ---------------------------------------------------------------- step 2: scores

  function parseRoster(text) {
    const result = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) continue;
      if (parts.some((p) => /^(이름|성명|name)$/i.test(p))) continue; // 머리글 행
      if (parts.length >= 2 && /^\d+$/.test(parts[0])) result.push({ no: parts[0], name: parts.slice(1).join(' ') });
      else {
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (m) result.push({ no: m[1], name: m[2].trim() });
        else result.push({ no: '', name: parts.join(' ') });
      }
    }
    return result;
  }

  function renderScores() {
    if (ui.tab !== 'summary' && !state.units.some((u) => u.id === ui.tab)) ui.tab = state.units[0]?.id || 'summary';

    const tabs = state.units
      .map((u, idx) => `<button type="button" class="tab ${ui.tab === u.id ? 'active' : ''}" data-tab="${u.id}">유닛 ${idx + 1}. ${esc(u.name || '이름 없음')}</button>`)
      .join('');

    $('#step2').innerHTML = `
      <div class="card">
        <div class="card-head"><h2>학생 명단</h2><p>엑셀에서 <b>번호·이름</b> 두 열을 복사해 붙여넣고 <b>명단 추가</b>를 누르세요. 이름만 붙여넣어도 됩니다.</p></div>
        <div class="roster">
          <textarea id="rosterText" rows="4" placeholder="1&#9;김하늘&#10;2&#9;이바다&#10;3&#9;박솔"></textarea>
          <div class="roster-actions">
            <button type="button" class="btn primary" data-act="add-roster">명단 추가</button>
            <button type="button" class="btn" data-act="add-student">학생 1명 추가</button>
            <button type="button" class="btn danger-ghost" data-act="clear-students" ${state.students.length ? '' : 'disabled'}>명단 전체 삭제</button>
            <span class="muted">현재 <b>${state.students.length}</b>명</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="tabs" role="tablist">
          ${tabs}
          <button type="button" class="tab summary ${ui.tab === 'summary' ? 'active' : ''}" data-tab="summary">종합 · 최종 등급</button>
        </div>
        <div id="scoreArea"></div>
      </div>

      <div class="step-nav">
        <button type="button" class="btn" data-goto="1">← 이전: 과목·유닛 설정</button>
        <button type="button" class="btn primary" data-goto="3">다음: 성적표 출력 →</button>
      </div>`;
    renderScoreArea();
  }

  function renderScoreArea() {
    const area = $('#scoreArea');
    if (!state.students.length) {
      area.innerHTML = '<div class="empty">먼저 위에서 학생 명단을 추가하세요.</div>';
      return;
    }
    if (ui.tab === 'summary') area.innerHTML = summaryTable();
    else area.innerHTML = unitTable(state.units.find((u) => u.id === ui.tab));
  }

  function levelBadge(result, method) {
    if (result.error) return `<span class="lv err" title="${esc(result.error)}">!</span>`;
    if (result.level == null) return '<span class="lv empty">·</span>';
    if (method === 'direct') return '';
    return `<span class="lv">→ ${result.level}</span>`;
  }

  function unitTable(unit) {
    const crits = CRITS.filter((c) => unit.criteria[c].on);
    if (!crits.length) {
      return '<div class="empty">이 유닛에서 평가하는 기준이 없습니다. 1단계에서 기준을 체크하세요.</div>';
    }
    const head = crits.map((c) => {
      const cfg = unit.criteria[c];
      const methodText = cfg.method === 'percent' ? `원점수 / ${esc(cfg.max)}점` : METHODS[cfg.method].short;
      return `<th class="crit-col"><span class="crit-badge">${c}</span> ${esc(state.criteria[c].ko)} ${tip(`${state.criteria[c].en}: ${critDesc(c)}`)}<small>${methodText}</small></th>`;
    }).join('');

    const rows = state.students.map((s, r) => `
      <tr data-sid="${s.id}">
        <td class="no">${esc(s.no)}</td>
        <td class="name">${esc(s.name)}</td>
        ${crits.map((c, col) => {
          const cfg = unit.criteria[c];
          const result = unitLevel(s, unit, c);
          return `<td><div class="cell">
            <input class="score ${result.error ? 'invalid' : ''}" data-score="1" data-sid="${s.id}" data-unit="${unit.id}" data-crit="${c}"
              data-row="${r}" data-col="${col}" value="${esc(s.scores[unit.id]?.[c])}"
              inputmode="${cfg.method === 'achievement' ? 'text' : 'decimal'}" autocomplete="off"
              aria-label="${esc(s.name)} Criterion ${c}" title="${esc(result.error || '')}">
            <span class="lv-slot">${levelBadge(result, cfg.method)}</span>
          </div></td>`;
        }).join('')}
      </tr>`).join('');

    return `
      <p class="hint">Enter/↓ 키로 아래 칸으로 이동합니다. 엑셀에서 여러 칸을 복사해 첫 칸에 붙여넣으면 한 번에 채워집니다.</p>
      <div class="table-wrap"><table class="grid scores">
        <thead><tr><th>번호</th><th>이름</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function summaryTable() {
    const head = CRITS.map((c) => `<th class="crit-col"><span class="crit-badge">${c}</span> ${esc(state.criteria[c].ko)}<small>자동 / 조정</small></th>`).join('');
    const rows = state.students.map((s, r) => {
      const result = computeStudent(s);
      return `
      <tr data-sid="${s.id}">
        <td class="no"><input class="tiny" data-student="${s.id}" data-field="no" value="${esc(s.no)}" aria-label="번호"></td>
        <td class="name"><input data-student="${s.id}" data-field="name" value="${esc(s.name)}" aria-label="이름"></td>
        ${CRITS.map((c, col) => {
          const f = result.finals[c];
          return `<td><div class="cell final-cell">
            <span class="auto" data-auto="${c}" title="유닛 점수로 계산한 자동값">${f.auto ?? '–'}</span>
            <input class="score override ${f.error ? 'invalid' : ''}" data-override="${c}" data-sid="${s.id}" data-row="${r}" data-col="${col}"
              value="${esc(s.override[c])}" placeholder="조정" inputmode="numeric" autocomplete="off" aria-label="${esc(s.name)} Criterion ${c} 최종 수준 조정">
          </div></td>`;
        }).join('')}
        <td class="total" data-total>${totalText(result)}</td>
        <td class="grade" data-grade>${gradeChip(result)}</td>
        <td><textarea class="comment" rows="1" data-student="${s.id}" data-field="comment" placeholder="성적표에 들어갈 의견" aria-label="${esc(s.name)} 교사 의견">${esc(s.comment)}</textarea></td>
        <td><button type="button" class="icon-btn" data-act="remove-student" data-sid="${s.id}" aria-label="${esc(s.name)} 삭제" title="학생 삭제">×</button></td>
      </tr>`;
    }).join('');

    return `
      <p class="hint">자동값은 <b>${AGGREGATES[state.aggregate]}</b> 방식으로 계산했습니다. 교사 판단으로 바꾸려면 <b>조정</b> 칸에 0~8을 입력하세요 ${tip('IB는 학기 말 학생의 성취를 가장 잘 나타내는 수준(best-fit)을 교사가 판단하도록 권장합니다. 조정 칸을 비우면 자동값을 사용합니다.')}</p>
      <div class="table-wrap"><table class="grid scores summary-table">
        <thead><tr><th>번호</th><th>이름</th>${head}<th>총점</th><th>등급</th><th>교사 의견</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function totalText(result) {
    if (result.total == null) return result.count ? `<span class="muted">${result.sum} (미완료)</span>` : '<span class="muted">–</span>';
    return result.scaled ? `${result.total}<small> 환산</small>` : `${result.total}`;
  }

  function gradeChip(result) {
    if (result.grade == null) {
      const reason = result.count === 0 ? '점수 없음' : `${result.missing.join(', ')} 없음`;
      return `<span class="chip pending" title="${esc(reason)}">미산출</span>`;
    }
    return `<span class="chip g${result.grade}">${result.grade}</span>`;
  }

  function refreshSummaryRow(sid) {
    const row = $(`#scoreArea tr[data-sid="${sid}"]`);
    const student = state.students.find((s) => s.id === sid);
    if (!row || !student) return;
    const result = computeStudent(student);
    CRITS.forEach((c) => {
      const auto = row.querySelector(`[data-auto="${c}"]`);
      if (auto) auto.textContent = result.finals[c].auto ?? '–';
      const input = row.querySelector(`[data-override="${c}"]`);
      if (input) input.classList.toggle('invalid', Boolean(result.finals[c].error));
    });
    row.querySelector('[data-total]').innerHTML = totalText(result);
    row.querySelector('[data-grade]').innerHTML = gradeChip(result);
  }

  function onScoreInput(e) {
    const t = e.target;
    const d = t.dataset;
    if (e.type !== 'input') return;

    if (d.score && d.unit) {
      const student = state.students.find((s) => s.id === d.sid);
      const unit = state.units.find((u) => u.id === d.unit);
      if (!student || !unit) return;
      (student.scores[unit.id] ||= {})[d.crit] = t.value;
      const result = unitLevel(student, unit, d.crit);
      t.classList.toggle('invalid', Boolean(result.error));
      t.title = result.error || '';
      t.closest('.cell').querySelector('.lv-slot').innerHTML = levelBadge(result, unit.criteria[d.crit].method);
      touch();
    } else if (d.override) {
      const student = state.students.find((s) => s.id === d.sid);
      if (!student) return;
      student.override[d.override] = t.value;
      refreshSummaryRow(student.id);
      touch();
    } else if (d.student) {
      const student = state.students.find((s) => s.id === d.student);
      if (!student) return;
      student[d.field] = t.value;
      touch();
    }
  }

  function moveFocus(input, dRow, dCol = 0) {
    const row = Number(input.dataset.row) + dRow;
    const col = Number(input.dataset.col) + dCol;
    const target = $(`#scoreArea input.score[data-row="${row}"][data-col="${col}"]`);
    if (target) {
      target.focus();
      target.select();
    }
  }

  function onScoreKeydown(e) {
    const t = e.target;
    if (!t.classList?.contains('score')) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(t, e.shiftKey && e.key === 'Enter' ? -1 : 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(t, -1);
    }
  }

  function onScorePaste(e) {
    const t = e.target;
    if (!t.classList?.contains('score')) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/[\t\n]/.test(text.trim())) return; // 한 칸짜리는 기본 동작
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const startRow = Number(t.dataset.row);
    const startCol = Number(t.dataset.col);
    let filled = 0;
    lines.forEach((line, dr) => {
      line.split('\t').forEach((value, dc) => {
        const target = $(`#scoreArea input.score[data-row="${startRow + dr}"][data-col="${startCol + dc}"]`);
        if (!target) return;
        target.value = value.trim();
        target.dispatchEvent(new Event('input', { bubbles: true }));
        filled++;
      });
    });
    toast(`${filled}칸에 붙여넣었습니다.`);
  }

  // ---------------------------------------------------------------- step 3: report

  function renderReportStep() {
    const o = state.report;
    const results = state.students.map((s) => ({ s, r: computeStudent(s) }));
    const pending = results.filter(({ r }) => r.grade == null);
    const selectedCount = state.students.filter((s) => !ui.excluded.has(s.id)).length;

    const checks = [
      ['showUnits', '유닛별 수준 표시'],
      ['showDescriptor', '등급 설명 표시'],
      ['showBoundaries', '등급 경계표 표시'],
      ['showComment', '교사 의견 표시'],
      ['showSignature', '서명란 표시'],
    ].map(([key, label]) => `<label class="check"><input type="checkbox" data-report="${key}" ${o[key] ? 'checked' : ''}> ${label}</label>`).join('');

    const studentChecks = state.students.map((s) => {
      const r = computeStudent(s);
      return `<label class="check student-check"><input type="checkbox" data-print="${s.id}" ${ui.excluded.has(s.id) ? '' : 'checked'}>
        <span>${esc(s.no)} ${esc(s.name)}</span> ${gradeChip(r)}</label>`;
    }).join('');

    $('#reportOptions').innerHTML = `
      <div class="card">
        <div class="card-head row">
          <div><h2>성적표 출력</h2><p>인쇄 창에서 대상을 <b>PDF로 저장</b>으로 바꾸면 PDF 파일이 됩니다. (A4, 배경 그래픽 켜기 권장)</p></div>
          <div class="btn-row">
            <button type="button" class="btn" data-act="export-csv" ${state.students.length ? '' : 'disabled'}>결과 CSV 내보내기</button>
            <button type="button" class="btn primary" data-act="print" ${selectedCount ? '' : 'disabled'}>인쇄 / PDF 저장 (${selectedCount}명)</button>
          </div>
        </div>
        ${pending.length ? `<div class="alert">등급이 산출되지 않은 학생이 <b>${pending.length}명</b> 있습니다: ${pending.slice(0, 8).map(({ s }) => esc(s.name)).join(', ')}${pending.length > 8 ? ' 외' : ''}. 점수 입력 단계를 확인하세요.</div>` : ''}
        <div class="report-options">
          <div>
            <label class="field"><span>성적표 제목</span><input data-report="title" value="${esc(o.title)}"></label>
            <div class="checks">${checks}</div>
          </div>
          <div>
            <div class="student-pick-head"><h3>출력할 학생</h3>
              <button type="button" class="btn small" data-act="select-all">전체 선택</button>
              <button type="button" class="btn small" data-act="select-none">전체 해제</button></div>
            <div class="student-pick">${studentChecks || '<span class="muted">학생이 없습니다.</span>'}</div>
          </div>
        </div>
      </div>
      <div class="step-nav"><button type="button" class="btn" data-goto="2">← 이전: 점수 입력</button><span class="muted">아래는 인쇄 미리보기입니다.</span></div>`;
    renderPreview();
  }

  function renderPreview() {
    const list = state.students.filter((s) => !ui.excluded.has(s.id));
    $('#reportPreview').innerHTML = list.length
      ? list.map(reportSheet).join('')
      : '<div class="empty no-print">출력할 학생이 없습니다.</div>';
  }

  function formatDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : esc(value);
  }

  function reportSheet(s) {
    const i = state.info;
    const o = state.report;
    const r = computeStudent(s);
    const units = o.showUnits ? state.units : [];
    const classText = [i.grade && `${esc(i.grade)}학년`, i.className && `${esc(i.className)}반`, s.no && `${esc(s.no)}번`].filter(Boolean).join(' ') || '–';

    const critRows = CRITS.map((c) => {
      const f = r.finals[c];
      const band = bandOf(f.level);
      const unitCells = units.map((u) => {
        if (!u.criteria[c].on) return '<td class="na">–</td>';
        const lv = unitLevel(s, u, c).level;
        return `<td>${lv ?? '<span class="na">·</span>'}</td>`;
      }).join('');
      return `<tr>
        <th class="letter">${c}</th>
        <td class="cname">${esc(state.criteria[c].ko)}<small>${esc(state.criteria[c].en)}</small></td>
        ${unitCells}
        <td class="final"><b>${f.level ?? '–'}</b><small> / 8</small></td>
        <td class="band">${band ? `${band.ko}<small>${band.en}</small>` : '<span class="na">평가 없음</span>'}</td>
      </tr>`;
    }).join('');

    const descriptor = r.grade ? MYP.gradeDescriptors[r.grade] : null;
    const gradeNote = r.grade == null
      ? `등급 미산출 — ${r.count === 0 ? '입력된 점수가 없습니다.' : `Criterion ${r.missing.join(', ')}의 수준이 없습니다.`}`
      : r.scaled ? `※ 평가한 ${r.count}개 기준의 합(${r.sum}점)을 32점 만점으로 환산했습니다.` : '';

    const boundaries = o.showBoundaries ? `
      <table class="sheet-bounds">
        <tr><th>등급</th>${boundaryRanges().map((b) => `<td class="${b.grade === r.grade ? 'hit' : ''}">${b.grade}</td>`).join('')}</tr>
        <tr><th>총점</th>${boundaryRanges().map((b) => `<td class="${b.grade === r.grade ? 'hit' : ''}">${b.min}–${b.max}</td>`).join('')}</tr>
      </table>` : '';

    return `
    <article class="sheet">
      <header class="sheet-head">
        <div>
          <div class="sheet-school">${esc(i.school) || '&nbsp;'}</div>
          <h1>${esc(o.title)}</h1>
          <div class="sheet-sub">IB Middle Years Programme · ${esc(i.year)}학년도 ${esc(i.semester)}학기</div>
        </div>
        <div class="grade-seal ${r.grade ? '' : 'pending'}">
          <span>최종 등급</span>
          <strong>${r.grade ?? '–'}</strong>
          <small>/ 7</small>
        </div>
      </header>

      <table class="sheet-info">
        <tr><th>이름</th><td>${esc(s.name) || '–'}</td><th>학년 · 반 · 번호</th><td>${classText}</td></tr>
        <tr><th>과목</th><td>${esc(subjectLabel())}<small> (${esc((MYP.subjects[i.subjectKey] || MYP.subjects.custom).en)})</small></td><th>담당 교사</th><td>${esc(i.teacher) || '–'}</td></tr>
      </table>

      <h2>평가 기준별 성취 수준 <small>Criterion Levels</small></h2>
      <table class="sheet-crit">
        <thead><tr>
          <th colspan="2">평가 기준</th>
          ${units.map((u, idx) => `<th class="unit-th">${esc(u.name || `유닛 ${idx + 1}`)}</th>`).join('')}
          <th>최종 수준</th><th>성취 수준</th>
        </tr></thead>
        <tbody>${critRows}</tbody>
        <tfoot><tr>
          <th colspan="${2 + units.length}">총점</th>
          <td class="final"><b>${r.total ?? '–'}</b><small> / 32</small></td>
          <td>${r.grade ? `최종 등급 <b>${r.grade}</b>` : '<span class="na">미산출</span>'}</td>
        </tr></tfoot>
      </table>
      ${gradeNote ? `<p class="sheet-note">${esc(gradeNote)}</p>` : ''}

      ${o.showDescriptor ? `
      <h2>등급 설명 <small>Grade Descriptor</small></h2>
      <div class="sheet-desc">
        ${descriptor ? `<p><b>${r.grade}등급 · ${descriptor.en}</b> ${esc(descriptor.ko)}</p>` : '<p class="na">등급이 산출되면 해당 등급의 설명이 표시됩니다.</p>'}
        <p class="small">MYP 최종 등급은 과목의 네 가지 평가 기준(각 0~8)에서 받은 최종 수준의 합(32점 만점)을 등급 경계에 맞춰 1~7로 나타낸 것입니다. 각 기준의 수준은 한 학기 동안 여러 유닛에서 보여 준 성취를 종합해 교사가 판단합니다.</p>
        ${boundaries}
      </div>` : boundaries}

      ${o.showComment ? `
      <h2>교사 의견 <small>Teacher Comment</small></h2>
      <div class="sheet-comment">${esc(s.comment).replace(/\n/g, '<br>') || '&nbsp;'}</div>` : ''}

      <footer class="sheet-foot">
        <span>발급일: ${formatDate(i.reportDate)}</span>
        ${o.showSignature ? `<span>담당 교사: ${esc(i.teacher) || '&emsp;&emsp;&emsp;'} <span class="sign">(서명)</span></span>` : ''}
      </footer>
    </article>`;
  }

  function onReportEvent(e) {
    const t = e.target;
    if (!wantsEvent(e)) return;
    if (t.dataset.report) {
      state.report[t.dataset.report] = t.type === 'checkbox' ? t.checked : t.value;
      touch();
      renderPreview();
    } else if (t.dataset.print) {
      if (t.checked) ui.excluded.delete(t.dataset.print);
      else ui.excluded.add(t.dataset.print);
      renderReportStep();
    }
  }

  function exportCsv() {
    const header = ['번호', '이름', ...CRITS.map((c) => `Criterion ${c}`), '총점', '최종 등급', '비고', '교사 의견'];
    const rows = state.students.map((s) => {
      const r = computeStudent(s);
      const note = r.grade == null ? `미산출(${r.missing.join('/')})` : r.scaled ? '환산' : '';
      return [s.no, s.name, ...CRITS.map((c) => r.finals[c].level ?? ''), r.total ?? '', r.grade ?? '', note, s.comment];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    download(`﻿${csv}`, `${fileBase()}_결과.csv`, 'text/csv;charset=utf-8');
  }

  // ---------------------------------------------------------------- files

  function fileBase() {
    const i = state.info;
    return [i.year, `${i.semester}학기`, subjectLabel(), i.grade && `${i.grade}학년`, i.className && `${i.className}반`]
      .filter(Boolean)
      .join('_')
      .replace(/[\\/:*?"<>|\s]+/g, '_');
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
    download(JSON.stringify(payload, null, 2), `${fileBase()}_MYP.json`, 'application/json');
    dirty = false;
    toast('작업 파일을 저장했습니다.');
  }

  function normalizeState(raw) {
    const base = defaultState();
    const next = {
      ...base,
      ...raw,
      info: { ...base.info, ...raw.info },
      conversion: { ...base.conversion, ...raw.conversion },
      report: { ...base.report, ...raw.report },
    };
    next.criteria = Object.fromEntries(CRITS.map((c) => [c, { ...base.criteria[c], ...(raw.criteria?.[c] || subjectCriteria(next.info.subjectKey)[c]) }]));
    next.units = (Array.isArray(raw.units) && raw.units.length ? raw.units : base.units).map((u) => ({
      id: String(u.id || newId('u')),
      name: String(u.name ?? ''),
      criteria: Object.fromEntries(CRITS.map((c) => [c, { on: true, method: 'direct', max: 100, ...(u.criteria?.[c] || {}) }])),
    }));
    next.students = (Array.isArray(raw.students) ? raw.students : []).map((s) => ({
      id: String(s.id || newId('s')),
      no: String(s.no ?? ''),
      name: String(s.name ?? ''),
      scores: s.scores && typeof s.scores === 'object' ? s.scores : {},
      override: s.override && typeof s.override === 'object' ? s.override : {},
      comment: String(s.comment ?? ''),
    }));
    if (!Array.isArray(next.boundaries) || next.boundaries.length !== 7) next.boundaries = base.boundaries;
    if (!Array.isArray(next.conversion.percentMins) || next.conversion.percentMins.length !== 8) next.conversion.percentMins = base.conversion.percentMins;
    if (!AGGREGATES[next.aggregate]) next.aggregate = base.aggregate;
    return next;
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.app !== FILE_APP_ID || !data.state) throw new Error('이 앱에서 저장한 파일이 아닙니다.');
        state = normalizeState(data.state);
        ui.excluded.clear();
        ui.tab = null;
        dirty = false;
        goStep(state.students.length ? 2 : 1);
        toast(`불러왔습니다: 학생 ${state.students.length}명, 유닛 ${state.units.length}개`);
      } catch (err) {
        alert(`파일을 불러오지 못했습니다.\n${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function loadSample() {
    const s = defaultState();
    s.info = { ...s.info, school: '예시중학교', grade: '2', className: '3', subjectKey: 'sciences', subjectName: '과학', teacher: '홍길동' };
    s.criteria = subjectCriteria('sciences');
    const u1 = makeUnit('물질의 구성');
    const u2 = makeUnit('전기와 자기');
    u1.criteria.A.method = 'percent';
    u1.criteria.A.max = 50;
    u1.criteria.B.method = 'direct';
    u1.criteria.C.method = 'direct';
    u1.criteria.D.on = false;
    u2.criteria.A.method = 'achievement';
    u2.criteria.B.on = false;
    u2.criteria.C.method = 'direct';
    u2.criteria.D.method = 'direct';
    s.units = [u1, u2];
    const names = ['김하늘', '이바다', '박솔', '최가람', '정나래', '강도윤', '윤서진', '한지우'];
    const data = [
      [46, 7, 6, 'A', 7, 8],
      [38, 5, 6, 'B', 5, 6],
      [31, 4, 5, 'B', 5, 4],
      [44, 6, 7, 'A', 8, 7],
      [22, 3, 3, 'C', 4, 3],
      [15, 2, 2, 'D', 2, 3],
      [40, 6, 5, 'B', 6, 5],
      [35, 5, '', 'C', 4, ''],
    ];
    s.students = names.map((name, idx) => {
      const st = makeStudent(idx + 1, name);
      const [a1, b1, c1, a2, c2, d2] = data[idx];
      st.scores[u1.id] = { A: String(a1), B: String(b1), C: String(c1) };
      st.scores[u2.id] = { A: a2, C: String(c2), D: String(d2) };
      return st;
    });
    s.students[0].comment = '실험 설계 과정에서 변인을 명확히 통제하고, 결과를 논리적으로 해석하는 능력이 뛰어납니다.';
    return s;
  }

  // ---------------------------------------------------------------- guide & tooltip

  function renderGuide() {
    $('#guideCriteria').innerHTML = `
      <table class="grid compact"><thead><tr><th></th><th>${esc(subjectLabel())} 평가 기준</th><th>무엇을 평가하나요?</th></tr></thead>
      <tbody>${CRITS.map((c) => `<tr><th><span class="crit-badge">${c}</span></th><td>${esc(state.criteria[c].ko)}<br><small class="muted">${esc(state.criteria[c].en)}</small></td><td>${esc(critDesc(c))}</td></tr>`).join('')}</tbody></table>`;
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

  const actions = {
    guide() {
      renderGuide();
      $('#guide').showModal();
    },
    'close-guide'() {
      $('#guide').close();
    },
    save: saveFile,
    sample() {
      if (hasWork() && !confirm('현재 입력한 내용을 지우고 예시 데이터를 불러올까요?')) return;
      state = loadSample();
      ui.excluded.clear();
      ui.tab = null;
      dirty = false;
      goStep(2);
      toast('예시 데이터를 불러왔습니다.');
    },
    reset() {
      if (hasWork() && !confirm('입력한 내용을 모두 지우고 새로 시작할까요?')) return;
      state = defaultState();
      ui.excluded.clear();
      ui.tab = null;
      dirty = false;
      goStep(1);
    },
    'add-unit'() {
      state.units.push(makeUnit(`Unit ${state.units.length + 1}`));
      touch();
      renderSetup();
    },
    'remove-unit'(btn) {
      const unit = state.units.find((u) => u.id === btn.dataset.unit);
      if (!unit || state.units.length === 1) return;
      const hasScores = state.students.some((s) => s.scores[unit.id] && Object.values(s.scores[unit.id]).some((v) => String(v).trim() !== ''));
      if (hasScores && !confirm(`"${unit.name}" 유닛에 입력된 점수도 함께 삭제됩니다. 계속할까요?`)) return;
      state.units = state.units.filter((u) => u.id !== unit.id);
      state.students.forEach((s) => delete s.scores[unit.id]);
      touch();
      renderSetup();
    },
    'add-roster'() {
      const parsed = parseRoster($('#rosterText').value);
      if (!parsed.length) {
        toast('붙여넣은 명단이 없습니다.');
        return;
      }
      let nextNo = state.students.reduce((max, s) => Math.max(max, Number(s.no) || 0), 0);
      parsed.forEach((p) => {
        if (p.no) nextNo = Math.max(nextNo, Number(p.no));
        state.students.push(makeStudent(p.no || String(++nextNo), p.name));
      });
      touch();
      renderScores();
      toast(`${parsed.length}명을 추가했습니다.`);
    },
    'add-student'() {
      const nextNo = state.students.reduce((max, s) => Math.max(max, Number(s.no) || 0), 0) + 1;
      state.students.push(makeStudent(nextNo, ''));
      ui.tab = 'summary';
      touch();
      renderScores();
      const inputs = $$('#scoreArea input[data-field="name"]');
      inputs[inputs.length - 1]?.focus();
    },
    'clear-students'() {
      if (!confirm(`학생 ${state.students.length}명과 입력한 점수를 모두 삭제할까요?`)) return;
      state.students = [];
      ui.excluded.clear();
      touch();
      renderScores();
    },
    'remove-student'(btn) {
      const student = state.students.find((s) => s.id === btn.dataset.sid);
      if (!student || !confirm(`${student.name || '이름 없는 학생'}을(를) 삭제할까요?`)) return;
      state.students = state.students.filter((s) => s.id !== student.id);
      ui.excluded.delete(student.id);
      touch();
      renderScores();
    },
    'select-all'() {
      ui.excluded.clear();
      renderReportStep();
    },
    'select-none'() {
      state.students.forEach((s) => ui.excluded.add(s.id));
      renderReportStep();
    },
    print() {
      renderPreview();
      window.print();
    },
    'export-csv': exportCsv,
  };

  function hasWork() {
    return dirty || state.students.length > 0;
  }

  // ---------------------------------------------------------------- wiring

  document.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn && actions[actBtn.dataset.act] && !actBtn.disabled) {
      actions[actBtn.dataset.act](actBtn);
      return;
    }
    const stepBtn = e.target.closest('[data-step], [data-goto]');
    if (stepBtn) {
      goStep(Number(stepBtn.dataset.step || stepBtn.dataset.goto));
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      ui.tab = tab.dataset.tab;
      $$('#step2 .tab').forEach((b) => b.classList.toggle('active', b === tab));
      renderScoreArea();
    }
  });

  ['input', 'change'].forEach((type) => {
    $('#step1').addEventListener(type, onSetupEvent);
    $('#step3').addEventListener(type, onReportEvent);
  });
  $('#step2').addEventListener('input', onScoreInput);
  $('#step2').addEventListener('keydown', onScoreKeydown);
  $('#step2').addEventListener('paste', onScorePaste);

  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (hasWork() && !confirm('현재 입력한 내용을 지우고 파일을 불러올까요?')) return;
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
    if (ui.step !== 3) goStep(3);
  });

  goStep(1);
})();
