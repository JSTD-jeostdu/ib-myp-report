// IB MYP 기준 데이터 (과목군별 평가 기준, 수준 구간, 등급 설명)
// 설명 문구는 교사 안내용으로 요약·재작성한 것이며, 공식 문서는 각 과목 가이드를 참고하세요.
window.MYP = {
  subjects: {
    langlit: {
      ko: '언어와 문학', en: 'Language and literature',
      criteria: {
        A: { en: 'Analysing', ko: '분석하기', desc: '텍스트의 내용·맥락·구조·표현 기법을 분석하고, 텍스트 사이의 관계를 설명하는 능력' },
        B: { en: 'Organizing', ko: '구성하기', desc: '목적에 맞는 구성 방식을 쓰고, 생각을 일관성 있게 조직하며, 인용·참고 형식을 지키는 능력' },
        C: { en: 'Producing text', ko: '텍스트 생산하기', desc: '창의적인 과정을 거쳐 자신의 생각과 관점을 담은 텍스트를 만드는 능력' },
        D: { en: 'Using language', ko: '언어 사용하기', desc: '적절하고 다양한 어휘·문장·문체를 쓰고 문법과 맞춤법을 정확히 지키는 능력' },
      },
    },
    langacq: {
      ko: '언어 습득', en: 'Language acquisition',
      criteria: {
        A: { en: 'Listening', ko: '듣기', desc: '말과 시각 자료로 된 텍스트에서 정보·생각·의도를 파악하는 능력' },
        B: { en: 'Reading', ko: '읽기', desc: '글과 시각 자료로 된 텍스트에서 정보·생각·의도를 파악하는 능력' },
        C: { en: 'Speaking', ko: '말하기', desc: '상황과 목적에 맞게 말로 소통하고 정확한 발음·어휘·문법을 사용하는 능력' },
        D: { en: 'Writing', ko: '쓰기', desc: '목적과 독자에 맞게 글로 생각을 전달하고 정확한 언어를 사용하는 능력' },
      },
    },
    indsoc: {
      ko: '개인과 사회', en: 'Individuals and societies',
      criteria: {
        A: { en: 'Knowing and understanding', ko: '지식과 이해', desc: '교과 용어와 개념을 사용하고, 사실과 사례로 내용을 설명하는 능력' },
        B: { en: 'Investigating', ko: '탐구하기', desc: '탐구 질문을 세우고 계획에 따라 자료를 수집·정리하며 과정을 성찰하는 능력' },
        C: { en: 'Communicating', ko: '의사소통', desc: '목적에 맞는 형식으로 정보를 전달하고 출처를 바르게 밝히는 능력' },
        D: { en: 'Thinking critically', ko: '비판적 사고', desc: '자료를 분석·평가하고 여러 관점을 비교하여 근거 있는 주장을 펼치는 능력' },
      },
    },
    sciences: {
      ko: '과학', en: 'Sciences',
      criteria: {
        A: { en: 'Knowing and understanding', ko: '지식과 이해', desc: '과학 지식을 설명하고 익숙하거나 낯선 상황의 문제 해결에 적용하는 능력' },
        B: { en: 'Inquiring and designing', ko: '탐구와 설계', desc: '탐구 문제와 가설을 세우고 변인을 통제한 실험을 설계하는 능력' },
        C: { en: 'Processing and evaluating', ko: '처리와 평가', desc: '데이터를 정리·해석하고, 결과와 실험 방법의 타당성을 평가하는 능력' },
        D: { en: 'Reflecting on the impacts of science', ko: '과학의 영향 성찰', desc: '과학의 활용이 사회·윤리·환경에 미치는 영향을 설명하고 판단하는 능력' },
      },
    },
    math: {
      ko: '수학', en: 'Mathematics',
      criteria: {
        A: { en: 'Knowing and understanding', ko: '지식과 이해', desc: '알맞은 풀이 전략을 골라 적용하고 정확하게 계산하는 능력' },
        B: { en: 'Investigating patterns', ko: '패턴 탐구', desc: '패턴을 탐구해 일반 규칙을 찾고, 그 규칙을 설명·검증하는 능력' },
        C: { en: 'Communicating', ko: '의사소통', desc: '수학적 기호·표현·그래프로 풀이 과정을 논리적으로 전달하는 능력' },
        D: { en: 'Applying mathematics in real-life contexts', ko: '실생활 맥락에서 수학 적용', desc: '실생활 상황을 수학적으로 표현해 해결하고, 해답이 타당한지 검토하는 능력' },
      },
    },
    arts: {
      ko: '예술', en: 'Arts',
      criteria: {
        A: { en: 'Investigating', ko: '탐구하기', desc: '예술 작품·양식·맥락을 조사하고 분석하는 능력' },
        B: { en: 'Developing', ko: '발전시키기', desc: '기능과 아이디어를 실험하며 작품의 의도를 구체화하는 능력' },
        C: { en: 'Creating or performing', ko: '창작 또는 공연', desc: '의도를 담은 작품을 완성하거나 공연하는 능력' },
        D: { en: 'Evaluating', ko: '평가하기', desc: '자신과 다른 사람의 작품과 과정을 평가하고 성찰하는 능력' },
      },
    },
    phe: {
      ko: '체육과 보건', en: 'Physical and health education',
      criteria: {
        A: { en: 'Knowing and understanding', ko: '지식과 이해', desc: '체육·보건 지식을 설명하고 상황에 적용하는 능력' },
        B: { en: 'Planning for performance', ko: '수행 계획', desc: '수행을 향상하기 위한 계획을 세우고 그 효과를 분석하는 능력' },
        C: { en: 'Applying and performing', ko: '적용과 수행', desc: '기술·전략·움직임을 상황에 맞게 효과적으로 수행하는 능력' },
        D: { en: 'Reflecting and improving performance', ko: '성찰과 수행 향상', desc: '자신의 수행을 분석·성찰하고 개선 목표를 세우는 능력' },
      },
    },
    design: {
      ko: '디자인', en: 'Design',
      criteria: {
        A: { en: 'Inquiring and analysing', ko: '탐구와 분석', desc: '해결할 문제의 필요성을 분석하고 조사하여 디자인 명세를 작성하는 능력' },
        B: { en: 'Developing ideas', ko: '아이디어 개발', desc: '여러 아이디어를 개발해 최종안을 고르고 설계도를 만드는 능력' },
        C: { en: 'Creating the solution', ko: '해결책 제작', desc: '계획에 따라 기술을 활용해 해결책을 만들고, 필요 시 계획을 조정하는 능력' },
        D: { en: 'Evaluating', ko: '평가', desc: '테스트로 해결책을 평가하고 개선 방안과 영향을 설명하는 능력' },
      },
    },
    custom: {
      ko: '기타 (직접 입력)', en: 'Other',
      criteria: {
        A: { en: 'Criterion A', ko: '평가 기준 A', desc: '과목 가이드의 Criterion A 내용을 확인하세요.' },
        B: { en: 'Criterion B', ko: '평가 기준 B', desc: '과목 가이드의 Criterion B 내용을 확인하세요.' },
        C: { en: 'Criterion C', ko: '평가 기준 C', desc: '과목 가이드의 Criterion C 내용을 확인하세요.' },
        D: { en: 'Criterion D', ko: '평가 기준 D', desc: '과목 가이드의 Criterion D 내용을 확인하세요.' },
      },
    },
  },

  // 기준별 성취 수준(0~8) 구간 설명
  levelBands: [
    { min: 0, max: 0, ko: '기준 미도달', en: 'Not achieved', desc: '어떤 수준 설명에도 도달하지 못함' },
    { min: 1, max: 2, ko: '제한적', en: 'Limited', desc: '기본 요소를 부분적으로만 보여 줌' },
    { min: 3, max: 4, ko: '적절함', en: 'Adequate', desc: '요구되는 요소를 대체로 보여 줌' },
    { min: 5, max: 6, ko: '상당함', en: 'Substantial', desc: '요구되는 요소를 안정적이고 충실하게 보여 줌' },
    { min: 7, max: 8, ko: '탁월함', en: 'Excellent', desc: '요구되는 요소를 깊이 있고 일관되게 보여 줌' },
  ],

  // 1~7 등급 경계(총점 32점 기준): 각 등급의 최소 총점
  defaultBoundaries: [1, 6, 10, 15, 19, 24, 28],

  // 일반 등급 설명 (교사·학부모 안내용 요약)
  gradeDescriptors: {
    1: { en: 'Very limited', ko: '매우 제한적인 수준의 결과물을 보입니다. 핵심 개념과 내용에 대한 이해에 많은 오개념과 큰 격차가 있으며, 비판적·창의적 사고를 거의 보여 주지 못합니다.' },
    2: { en: 'Limited', ko: '제한적인 수준의 결과물을 보입니다. 이해에 오개념이나 격차가 자주 나타나고, 익숙한 상황에서도 지식과 기능을 적용하는 데 어려움이 있습니다.' },
    3: { en: 'Basic', ko: '기본적인 수준의 결과물을 보입니다. 기본 이해는 갖추었으나 일부 오개념과 격차가 있으며, 익숙한 상황에서 도움을 받아 지식과 기능을 적용합니다.' },
    4: { en: 'Satisfactory', ko: '만족할 만한 수준의 결과물을 보입니다. 대체로 안정적으로 이해하고 있으며, 익숙한 상황에서 지식과 기능을 적용하고 기본적인 분석과 사고를 보여 줍니다.' },
    5: { en: 'Good', ko: '좋은 수준의 결과물을 보입니다. 개념과 내용을 탄탄하게 이해하고, 익숙한 상황과 일부 새로운 상황에서 지식과 기능을 적용하며 때때로 통찰력 있는 사고를 보여 줍니다.' },
    6: { en: 'Very good', ko: '매우 좋은 수준의 결과물을 보입니다. 폭넓고 정확하게 이해하고, 다양한 상황에서 지식과 기능을 적용하며, 대체로 독립적으로 비판적·창의적 사고를 보여 줍니다.' },
    7: { en: 'Excellent', ko: '탁월한 수준의 결과물을 보입니다. 깊이 있고 정교하게 이해하며, 새롭고 복잡한 상황에서도 지식과 기능을 일관되게 적용하고, 독립적이고 통찰력 있는 사고를 보여 줍니다.' },
  },
};
