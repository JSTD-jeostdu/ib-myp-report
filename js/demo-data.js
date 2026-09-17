// 완성본 예시용 가상 데이터 (실제 학교·학생·교사·평가계획이 아님)
window.MYP_DEMO = (() => {
  // 배점 → 수준. d: 한 점수씩(한 영역을 여러 기준으로 나눌 때), r: 구간(영역 = 기준 1개)
  const BANDS = {
    d: {
      10: [[10, '7~8'], [8, '5~6'], [6, '3~4'], [4, '1~2'], [2, 0]],
      15: [[15, '7~8'], [13, '5~6'], [11, '3~4'], [9, '1~2'], [7, 0]],
    },
    r: {
      10: [['9~10', '7~8'], ['7~8', '5~6'], ['5~6', '3~4'], ['3~4', '1~2'], ['0~2', 0]],
      15: [['13~15', '7~8'], ['10~12', '5~6'], ['7~9', '3~4'], ['4~6', '1~2'], ['0~3', 0]],
      20: [['18~20', '7~8'], ['14~17', '5~6'], ['10~13', '3~4'], ['6~9', '1~2'], ['0~5', 0]],
      30: [['27~30', '7~8'], ['21~26', '5~6'], ['15~20', '3~4'], ['9~14', '1~2'], ['0~8', 0]],
    },
  };

  // 나이스 과목 → MYP 과목군
  const SUBJECTS = [
    { neis: '국어', group: '언어와 문학', areas: [
      ['소설 비평문 쓰기(논술형)', [['A', 15, 'd'], ['B', 15, 'd']]],
      ['매체 자료 발표(구술)', [['C', 10, 'd'], ['D', 10, 'd']]],
    ] },
    { neis: '도덕', group: '개인과 사회', areas: [
      ['과학윤리 글쓰기(논술형)', [['B', 10, 'd'], ['D', 15, 'd']]],
      ['자연관 글쓰기(논술형)', [['A', 10, 'd'], ['C', 15, 'd']]],
    ] },
    { neis: '역사', group: '개인과 사회', areas: [
      ['역사 탐구 보고서', [['B', 15, 'd'], ['C', 15, 'd']]],
      ['사료 분석 글쓰기(논술형)', [['A', 10, 'd'], ['D', 10, 'd']]],
    ] },
    { neis: '수학', group: '수학', areas: [
      ['수학 개념 설명하기(서술형)', [['A', 20, 'r']]],
      ['패턴 탐구 과제', [['B', 10, 'd'], ['C', 10, 'd']]],
      ['실생활 모델링 프로젝트', [['C', 15, 'd'], ['D', 15, 'd']]],
    ] },
    { neis: '과학', group: '과학', areas: [
      ['실험 설계 보고서', [['B', 15, 'd'], ['C', 15, 'd']]],
      ['과학 쟁점 글쓰기(논술형)', [['A', 10, 'd'], ['D', 10, 'd']]],
    ] },
    { neis: '영어', group: '언어 습득', areas: [
      ['영어 듣기 평가', [['A', 10, 'r']]],
      ['영어 읽기 평가', [['B', 10, 'r']]],
      ['영어 말하기(발표)', [['C', 15, 'r']]],
      ['영어 쓰기(에세이)', [['D', 15, 'r']]],
    ] },
    { neis: '중국어', group: '언어 습득', areas: [
      ['중국어 듣기·읽기', [['A', 10, 'd'], ['B', 10, 'd']]],
      ['중국어 말하기(역할극)', [['C', 20, 'r']]],
      ['중국어 쓰기(자기소개 글)', [['D', 10, 'r']]],
    ] },
    { neis: '기술·가정', group: '디자인', areas: [
      ['생활 속 문제 탐구 보고서', [['A', 10, 'd'], ['B', 10, 'd']]],
      ['시제품 제작(실기)', [['C', 20, 'r']]],
      ['시제품 평가와 개선안', [['D', 10, 'r']]],
    ] },
    { neis: '체육', group: '체육과 보건', areas: [
      ['체력 향상 계획서', [['A', 10, 'd'], ['B', 10, 'd']]],
      ['경기 기능 수행(실기)', [['C', 30, 'r']]],
      ['수행 성찰 일지', [['D', 10, 'r']]],
    ] },
    { neis: '음악', group: '예술', areas: [
      ['음악 작품 탐구', [['A', 15, 'r']]],
      ['합주 준비 과정 기록', [['B', 15, 'r']]],
      ['합주 발표(실기)', [['C', 20, 'r']]],
      ['감상·성찰 보고서', [['D', 10, 'r']]],
    ] },
    { neis: '미술', group: '예술', areas: [
      ['작가 탐구 포트폴리오', [['A', 10, 'd'], ['B', 10, 'd']]],
      ['작품 제작(실기)', [['C', 20, 'r']]],
      ['작품 설명 및 비평', [['D', 10, 'r']]],
    ] },
  ];

  const TEACHERS = {
    국어: '가은솔', 도덕: '나윤호', 역사: '다하린', 수학: '라준서', 과학: '마서연',
    영어: '바지훈', 중국어: '사예린', '기술·가정': '아도현', 체육: '자민규', 음악: '차수빈', 미술: '카은채',
  };

  const CLASSES = {
    1: ['김하늘', '이바다', '박솔', '최가람', '정나래', '강도윤', '윤서진', '한지우', '조은별', '임하람', '서다온', '오시우'],
    2: ['신유나', '권태오', '황보람', '안채원', '송민재', '류하은', '전우진', '홍서아', '문지호', '배수아', '남궁현', '백이안'],
  };

  // 새로 불러와도 같은 결과가 나오도록 고정된 난수
  function random(seed) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const bandsOf = ([, max, kind]) => BANDS[kind][max];
  const parse = (v) => String(v).split('~').map(Number);

  function pickPoints(part, ability, rnd) {
    const f = Math.min(1, Math.max(0, ability + (rnd() - 0.5) * 0.3));
    const idx = f >= 0.85 ? 0 : f >= 0.68 ? 1 : f >= 0.5 ? 2 : f >= 0.3 ? 3 : 4;
    const [lo, hi = lo] = parse(bandsOf(part)[idx][0]);
    return lo + Math.floor(rnd() * (hi - lo + 1));
  }

  function build(subjectCols, ruleCols) {
    const subjectRows = [subjectCols, ...SUBJECTS.map((s) => [3, s.neis, s.group, s.neis, '일관된 수준'])];
    const ruleRows = [ruleCols, ...SUBJECTS.flatMap((s) => s.areas.flatMap(([area, parts]) =>
      parts.flatMap((part) => bandsOf(part).map(([points, level]) => [3, s.neis, area, part[0], points, level]))))];

    const rnd = random(20260917);
    const files = [];
    Object.entries(CLASSES).forEach(([cls, names]) => {
      const students = names.map((name, i) => ({ name, no: String(i + 1), base: 0.35 + rnd() * 0.6, hakbun: `2024${cls}${String(i + 1).padStart(4, '0')}` }));
      SUBJECTS.forEach((s) => {
        files.push({
          fileName: `3학년_${s.neis}_${cls}강의실(XLS data).xlsx`,
          grade: '3', subject: s.neis, year: '2026', semester: '2', room: cls, teacher: TEACHERS[s.neis],
          areas: s.areas.map(([name, parts]) => ({ name, max: parts.reduce((sum, p) => sum + p[1], 0) })),
          students: students.map((st) => {
            const ability = st.base + (rnd() - 0.5) * 0.3; // 학생마다 과목별 강약
            return {
              hakbun: st.hakbun, cls, no: st.no, name: st.name,
              scores: s.areas.map(([, parts]) => parts.reduce((sum, part) => sum + pickPoints(part, ability, rnd), 0)),
            };
          }),
        });
      });
    });
    return { subjectRows, ruleRows, files };
  }

  // grades: [{ subject, grade }]
  function comment(grades) {
    const valid = grades.filter((g) => g.grade != null).sort((a, b) => b.grade - a.grade);
    if (!valid.length) return '';
    const top = valid.filter((g) => g.grade === valid[0].grade).slice(0, 2).map((g) => g.subject).join('·');
    const low = valid[valid.length - 1].subject;
    const avg = valid.reduce((sum, g) => sum + g.grade, 0) / valid.length;
    if (avg >= 5.5) {
      return `${top} 과목을 비롯해 대부분의 과목에서 매우 높은 성취를 보였습니다. 스스로 탐구 질문을 세우고 근거를 들어 생각을 표현하는 힘이 뛰어나며, 모둠 활동에서도 친구들의 의견을 조율하며 주도적으로 참여합니다.`;
    }
    if (avg >= 4) {
      return `${top} 과목에서 특히 좋은 성취를 보였습니다. ${low} 과목에서는 배운 개념을 새로운 상황에 적용하는 연습이 조금 더 필요하지만, 과제에 성실하게 참여하고 피드백을 반영하려는 태도가 돋보여 꾸준한 성장이 기대됩니다.`;
    }
    return `${top} 과목에서 자신의 강점을 보여 주었습니다. ${low} 과목 등 일부 과목에서는 기초 개념을 다지는 것이 필요하며, 학습 계획을 세워 꾸준히 실천한다면 한 단계 더 성장할 수 있습니다.`;
  }

  function subjectComment(grade, strong, weak) {
    if (grade == null) return '';
    if (grade >= 7) return `모든 평가 기준에서 고르게 뛰어난 성취를 보였습니다. 특히 ${strong} 영역에서 깊이 있는 이해가 돋보입니다.`;
    if (strong === weak) return `네 가지 평가 기준에서 고른 성취를 보였습니다. 다음 단계로 과제마다 자신의 생각을 뒷받침하는 근거를 더 구체적으로 제시해 보기를 권합니다.`;
    if (grade >= 5) return `${strong} 영역에서 강점을 보였습니다. 다음 단계로 ${weak} 영역에서 근거를 더 구체적으로 제시하는 연습을 권합니다.`;
    return `${strong} 영역에서 성장이 보입니다. ${weak} 영역은 피드백을 바탕으로 과제 요구 사항을 하나씩 점검하며 보완하면 좋겠습니다.`;
  }

  const CP_TITLES = ['우리 동네 분리배출 개선 캠페인', '어르신 스마트폰 사용 도우미 교실', '학교 주변 안전 지도 만들기', '유기 동물 보호소 홍보 영상 제작'];

  // ATL·학습자상·공동체 프로젝트 예시. 공동체 프로젝트는 번호 순으로 3명씩 한 모둠.
  function extras(student, avgGrade) {
    const rnd = random(Number(student.cls) * 1000 + Number(student.no));
    const f = () => avgGrade / 7 + (rnd() - 0.5) * 0.35;
    const stage = (v) => (v >= 0.9 ? 'E' : v >= 0.62 ? 'P' : v >= 0.42 ? 'L' : 'N');
    const atl = Object.fromEntries(window.MYP.atl.categories.map((c) => [`c:${c.key}`, stage(f())]));

    const profile = window.MYP.learnerProfile;
    const picks = new Set();
    const pickCount = 2 + Math.floor(rnd() * 2);
    while (picks.size < pickCount) picks.add(profile[Math.floor(rnd() * profile.length)].key);
    const attrs = profile.filter((a) => picks.has(a.key));
    const note = `모둠 활동과 프로젝트에서 ${attrs.map((a) => a.ko).join('·')}의 모습을 꾸준히 보여 주었습니다.`;

    const team = Math.floor((Number(student.no) - 1) / 3);
    const teachers = Object.values(TEACHERS);
    const level = () => Math.max(1, Math.min(8, Math.round((avgGrade / 7) * 8 + (rnd() - 0.5) * 3)));
    return {
      atl,
      learnerProfile: { attrs: attrs.map((a) => a.key), note },
      communityProject: {
        title: CP_TITLES[(team + Number(student.cls)) % CP_TITLES.length],
        supervisor: teachers[(team * 3 + Number(student.cls)) % teachers.length],
        A: String(level()), B: String(level()), C: String(level()),
      },
    };
  }

  return { build, comment, subjectComment, extras };
})();
