/* 메디패스 응급실 연결 · 판단 로직 (브라우저/Node 공용)
 * - 공개 근거(2020 한국 심폐소생술 지침, ILCOR/AHA 응급처치, 2021 ACS 현장 중증도 분류, RACE 척도, PCI 직행 이송 연구 등)를 바탕으로 한 참고용 규칙.
 * - KTAS/Pre-KTAS 공식 판정표가 아니다. '참고 등급'은 화면에서 반드시 비공식으로 표시한다.
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MPLogic = factory(); })(this, function () {
  'use strict';

  /* ───────── 1. 일반인: 상황별 판단과 응급처치 ───────── */
  // call: 'now' = 즉시 119 (직접 이송 금지), 'er' = 응급실 방문 권고, 'check' = 경고 증상 확인 후 결정
  var PUBLIC = {
    arrest: {
      title: '쓰러졌고 반응이 없어요', call: 'now', condition: 'arrest',
      redflags: [], ask: [],
      steps: [
        '어깨를 두드리며 큰 소리로 불러 반응을 확인합니다.',
        '반응이 없고 숨을 쉬지 않거나 헐떡이면 바로 119에 전화하고 스피커폰으로 바꿉니다. 상황요원이 압박 방법을 알려줍니다.',
        '주변 사람에게 자동심장충격기(AED)를 가져오라고 정확히 지목해 부탁합니다.',
        '단단한 바닥에 눕히고 가슴 중앙(가슴뼈 아래쪽 절반)을 분당 100~120회, 약 5cm 깊이로 강하게 누릅니다. 누른 뒤에는 가슴이 완전히 올라오게 합니다.',
        '인공호흡이 자신 없으면 가슴압박만 계속합니다. 구급대가 올 때까지 멈추지 않습니다.',
        'AED가 도착하면 전원을 켜고 음성 안내를 따릅니다. 분석·충격 때는 환자에게서 떨어집니다.'
      ],
      dont: ['맥박 확인에 10초 이상 쓰지 않기', '119 상황요원과의 통화를 먼저 끊지 않기'],
      refs: ['kcpr2020', 'dacpr']
    },
    stroke: {
      title: '얼굴·팔 마비, 말이 어눌해요', call: 'now', condition: 'stroke',
      ask: [], redflags: [],
      steps: [
        'FAST로 확인합니다: 얼굴(Face) 한쪽이 처지나요? 팔(Arm) 한쪽이 힘없이 떨어지나요? 말(Speech)이 어눌한가요? 하나라도 있으면 시간(Time)이 중요합니다.',
        '즉시 119에 전화합니다. 뇌경색 재관류 치료는 시간이 지날수록 효과가 줄어 직접 운전해 가지 않습니다.',
        '증상이 시작된 시각 또는 마지막으로 정상이었던 시각을 꼭 기억해 구급대에 알립니다.',
        '복용 중인 약(특히 항응고제)을 챙깁니다.',
        '의식이 떨어지거나 토하면 옆으로 눕혀(회복 자세) 기도를 지킵니다.'
      ],
      dont: ['물·음식·약을 먹이지 않기 (삼킴 장애로 흡인 위험)', '증상이 좋아지는지 지켜보며 기다리지 않기'],
      refs: ['fast', 'race']
    },
    chest: {
      title: '가슴이 조이듯 아파요', call: 'now', condition: 'chest',
      ask: [], redflags: [],
      steps: [
        '즉시 119에 전화합니다. 심근경색은 재관류 치료가 가능한 병원(심혈관중재술)으로 바로 가는 것이 중요합니다.',
        '움직이지 않게 하고 편한 자세로 앉혀 쉬게 합니다.',
        '아스피린은 알레르기·출혈 위험이 없고 119 상황요원이나 의사가 안내할 때만 씹어 먹게 합니다.',
        '의식을 잃고 숨을 정상적으로 쉬지 않으면 바로 가슴압박을 시작합니다.'
      ],
      dont: ['스스로 운전해서 가지 않기', '참아보다가 늦게 신고하지 않기'],
      refs: ['aha_fa', 'stemi_direct', 'stemi_acc']
    },
    bleeding: {
      title: '피가 많이 나요', call: 'check', condition: 'bleeding',
      redflags: ['피가 뿜어져 나오거나 눌러도 멈추지 않음', '팔·다리가 절단됨', '몸통·목·머리에 깊은 상처', '창백하고 식은땀, 어지러움'],
      steps: [
        '장갑이나 비닐로 손을 보호하고, 깨끗한 천(지혈 거즈가 있으면 사용)으로 상처를 세게 직접 누릅니다.',
        '피가 배어 나와도 천을 떼지 말고 위에 덧대어 계속 누릅니다.',
        '팔·다리의 생명을 위협하는 출혈이 직접 압박으로 멈추지 않으면 상처보다 5~7cm 위(몸 쪽)에 지혈대를 단단히 감고 감은 시각을 적습니다.',
        '잘린 부위는 깨끗한 천에 싸서 비닐에 넣고, 얼음물에 담긴 다른 봉지 위에 올려 함께 가져갑니다 (얼음에 직접 닿지 않게).'
      ],
      dont: ['상처에 박힌 물체를 뽑지 않기', '지혈대를 한 번 감은 뒤 임의로 풀지 않기'],
      refs: ['ilcor_fa', 'aha_fa', 'field2021']
    },
    burn: {
      title: '화상을 입었어요', call: 'check', condition: 'burn',
      redflags: ['얼굴·손·발·생식기·관절 부위 화상', '손바닥 여러 개 넓이 이상', '전기·화학 화상', '연기를 마셨거나 목소리가 쉼', '어린이·노인'],
      steps: [
        '즉시 흐르는 시원한 수돗물로 최소 10~20분 식힙니다.',
        '반지·시계 등 조이는 것은 붓기 전에 뺍니다. 피부에 달라붙은 옷은 떼지 않습니다.',
        '식힌 뒤 깨끗한 랩이나 천으로 느슨하게 덮습니다.',
        '넓은 화상은 저체온에 주의해 화상 부위 외에는 따뜻하게 합니다.'
      ],
      dont: ['얼음·얼음물 대지 않기', '된장·치약·기름 등 바르지 않기', '물집 터뜨리지 않기'],
      refs: ['ilcor_fa', 'aha_fa']
    },
    child_abd: {
      title: '아이가 배가 많이 아파요', call: 'check', condition: 'peds_abd',
      redflags: ['오른쪽 아랫배 통증이 계속되거나 걸을 때 심해짐', '배가 딱딱하고 만지면 매우 아파함', '초록색(담즙) 구토 또는 피 섞인 변·젤리 같은 변', '열이 나고 처지며 잘 못 움직임', '영유아가 주기적으로 심하게 보채며 다리를 배로 당김'],
      steps: [
        '수술 가능성이 있으므로 물·음식을 먹이지 않습니다.',
        '진통제·해열제를 임의로 먹이지 않습니다 (통증 양상을 가려 진단이 늦어질 수 있음).',
        '통증 시작 시각, 아픈 위치, 구토·변·열 여부를 기록합니다.',
        '경고 증상이 있으면 소아 진료가 가능하고 CT와 복부 응급수술이 되는 응급실로 갑니다. 상태가 나쁘면 119에 신고합니다.'
      ],
      dont: ['관장하지 않기', '배를 문지르거나 뜨거운 찜질하지 않기'],
      refs: ['peds_ready', 'peds_ready2', 'iht_kr']
    },
    seizure: {
      title: '경련(발작)을 해요', call: 'check', condition: 'seizure',
      redflags: ['5분 넘게 계속됨', '깨어나지 않고 또 경련', '처음 있는 경련', '물속에서 발생·머리를 다침·임신 중', '숨쉬기 힘들어함'],
      steps: [
        '주변의 위험한 물건을 치우고 머리 밑에 부드러운 것을 받칩니다.',
        '시작 시각을 확인합니다.',
        '경련이 멈추면 옆으로 눕혀(회복 자세) 숨길을 확보합니다.'
      ],
      dont: ['입에 손가락·수건·숟가락을 넣지 않기', '몸을 억지로 붙잡지 않기'],
      refs: ['aha_fa', 'recovery']
    },
    choking: {
      title: '목에 무엇이 걸렸어요', call: 'check', condition: 'choking',
      redflags: ['기침·말·숨을 못 함', '얼굴이 파래짐', '의식을 잃음'],
      steps: [
        '기침을 할 수 있으면 계속 기침하게 합니다.',
        '말·기침을 못 하면 등 두드리기 5회와 복부 밀어내기(하임리히법) 5회를 번갈아 합니다.',
        '1세 미만 영아는 얼굴을 아래로 해 등 두드리기 5회, 뒤집어 가슴 누르기 5회를 반복합니다 (복부 밀어내기 금지).',
        '의식을 잃으면 119에 신고하고 가슴압박을 시작합니다.'
      ],
      dont: ['보이지 않는 이물질을 손가락으로 훑어내지 않기'],
      refs: ['kcpr2020', 'aha_fa']
    },
    allergy: {
      title: '심한 알레르기 반응', call: 'now', condition: 'anaphylaxis',
      redflags: [],
      steps: [
        '처방받은 에피네프린 자가주사기가 있으면 허벅지 바깥쪽에 바로 주사합니다.',
        '119에 신고합니다. 5~15분 지나도 나아지지 않으면 두 번째 주사를 고려합니다.',
        '숨쉬기 힘들면 앉게 하고, 어지러우면 다리를 올려 눕힙니다.'
      ],
      dont: ['증상이 좋아졌다고 병원에 가지 않는 일이 없게 하기 (재발 가능)'],
      refs: ['aha_fa']
    },
    trauma: {
      title: '사고로 크게 다쳤어요', call: 'now', condition: 'trauma',
      redflags: [],
      steps: [
        '2차 사고를 막을 수 있게 주변이 안전한지 먼저 확인합니다.',
        '119에 신고합니다. 높은 곳 추락, 차량 밖으로 튕겨 나감, 보행자 사고 등은 겉으로 멀쩡해 보여도 중증일 수 있습니다.',
        '목·허리를 다쳤을 수 있으면 움직이지 않게 합니다 (위험한 장소가 아니라면).',
        '출혈은 직접 압박으로 멈춥니다.'
      ],
      dont: ['헬멧을 억지로 벗기지 않기', '의식이 없는 환자에게 물을 먹이지 않기'],
      refs: ['field2021', 'ilcor_fa']
    }
  };

  /* ───────── 2. 119 구급대: 현장 중증도 판단 ───────── */
  // 2021 ACS National Guideline for the Field Triage of Injured Patients (Red / Yellow)
  function fieldTriage(p) {
    var red = [], yellow = [], age = num(p.age);
    var sbp = num(p.sbp), hr = num(p.hr), rr = num(p.rr), spo2 = num(p.spo2), gcsM = num(p.gcsMotor);
    var inj = p.injury || {}, mech = p.mechanism || {};
    if (inj.penetrating) red.push('머리·목·몸통·팔다리 근위부 관통상');
    if (inj.skull) red.push('두개골 변형·함몰 의심');
    if (inj.chestWall) red.push('흉벽 불안정·변형 (동요가슴 등)');
    if (inj.longBones) red.push('근위부 긴뼈 2곳 이상 골절 의심');
    if (inj.crush) red.push('으깨짐·벗겨짐·절단 손상 또는 맥박 없는 사지');
    if (inj.amputation) red.push('손목·발목 근위부 절단');
    if (inj.pelvis) red.push('골반 골절 의심');
    if (inj.paralysis) red.push('척수 손상 의심 (새로운 마비)');
    if (inj.tourniquet) red.push('지혈대가 필요한 활동성 출혈');
    if (gcsM != null && gcsM < 6) red.push('GCS 운동반응 6 미만');
    if (rr != null && (rr < 10 || rr > 29)) red.push('호흡수 10 미만 또는 29 초과');
    if (age != null && age < 1 && rr != null && rr < 20) red.push('영아 호흡수 20 미만');
    if (p.respDistress) red.push('호흡곤란·환기 보조 필요');
    if (spo2 != null && spo2 < 90) red.push('산소포화도 90% 미만');
    if (sbp != null) {
      if (age != null && age < 10 && sbp < 70 + 2 * age) red.push('수축기혈압 < 70+2×나이 (소아)');
      else if (age != null && age >= 65 && sbp < 110) red.push('65세 이상 수축기혈압 110 미만');
      else if ((age == null || (age >= 10 && age < 65)) && sbp < 90) red.push('수축기혈압 90 미만');
      if (hr != null && hr > sbp && (age == null || age >= 10)) red.push('맥박 > 수축기혈압 (쇼크지수 >1)');
    }
    if (mech.ejection) yellow.push('차량 밖으로 튕겨 나감');
    if (mech.deathSame) yellow.push('같은 차량 탑승자 사망');
    if (mech.fall) yellow.push('3m(10ft) 이상 추락');
    if (mech.intrusion) yellow.push('차체 함몰 (탑승석 30cm·전체 45cm 이상)');
    if (mech.extrication) yellow.push('20분 이상 구조 지연');
    if (mech.pedestrian) yellow.push('보행자·자전거가 차에 치이거나 깔림');
    if (mech.motorcycle) yellow.push('시속 30km 이상 이륜차 사고');
    if (mech.childUnrestrained) yellow.push('보호장구 없는 9세 이하 아동');
    if (p.anticoag && p.headInjury) yellow.push('항응고제 복용 중 머리 손상');
    if (p.pregnant20) yellow.push('임신 20주 이상');
    if (age != null && age >= 65 && p.headInjury) yellow.push('65세 이상 머리 손상');
    if (p.burns) yellow.push('외상을 동반한 화상');
    return { red: red, yellow: yellow, level: red.length ? 'red' : yellow.length ? 'yellow' : 'none' };
  }

  // RACE (Rapid Arterial oCclusion Evaluation): 0~9점, 5점 이상이면 대혈관폐색(LVO) 의심
  function race(s) {
    s = s || {};
    var total = ['face', 'arm', 'leg', 'gaze', 'cortical'].reduce(function (a, k) { return a + (num(s[k]) || 0); }, 0);
    return { total: total, lvo: total >= 5 };
  }

  // 참고 등급 (비공식): 공개 연구에 쓰인 생리학적 기준을 단순화. KTAS/Pre-KTAS 공식 판정 아님.
  function refGrade(p) {
    var why = [];
    var sbp = num(p.sbp), spo2 = num(p.spo2), gcs = num(p.gcs), rr = num(p.rr), hr = num(p.hr), age = num(p.age);
    if (p.condition === 'arrest' || p.noPulse) return { grade: 1, why: ['심정지 또는 무호흡'] };
    if (gcs != null && gcs <= 8) why.push('GCS 8 이하');
    if (sbp != null && sbp < (age != null && age < 10 ? 60 : 70)) why.push('심한 저혈압');
    if (spo2 != null && spo2 < 80) why.push('산소포화도 80% 미만');
    if (rr != null && (rr < 6 || rr > 40)) why.push('호흡수 극단');
    if (why.length) return { grade: 1, why: why };
    var ft = fieldTriage(p);
    if (ft.red.length) why = why.concat(ft.red);
    if (p.condition === 'stroke' && p.raceTotal >= 5) why.push('RACE ≥5 (대혈관폐색 의심)');
    if (p.condition === 'stroke' && p.lkwMin != null && p.lkwMin <= 1440) why.push('뇌졸중 의심 · 발병 24시간 이내');
    if (p.condition === 'chest' && p.stemi) why.push('12유도 심전도 STEMI');
    if (gcs != null && gcs <= 13) why.push('의식 저하 (GCS 9~13)');
    if (spo2 != null && spo2 < 90) why.push('산소포화도 90% 미만');
    if (hr != null && (hr > 150 || hr < 40)) why.push('심한 빈맥·서맥');
    if (why.length) return { grade: 2, why: dedupe(why) };
    if (ft.yellow.length) why = why.concat(ft.yellow);
    if (['chest', 'stroke', 'peds_abd', 'bleeding', 'burn', 'anaphylaxis', 'obstetric', 'aortic', 'gi_bleed', 'trauma'].indexOf(p.condition) >= 0) why.push('잠재적 중증 질환군');
    if (num(p.pain) >= 7) why.push('심한 통증 (NRS 7 이상)');
    if (num(p.temp) >= 39 && age != null && age < 3) why.push('3세 미만 고열');
    if (why.length) return { grade: 3, why: dedupe(why) };
    if (num(p.pain) >= 4) return { grade: 4, why: ['중등도 통증'] };
    return { grade: p.condition ? 4 : 5, why: ['생리학적 위험 소견 없음'] };
  }

  /* ───────── 3. 환자 상태 → 필요한 병원 자원 (API 필드에 대응) ───────── */
  // test(h): true 가능 / false 불가 / null 확인 안 됨
  function sev(k) { return function (h) { var v = h.severe && h.severe.flags ? h.severe.flags[k] : null; return v == null ? null : v; }; }
  function eq(k) { return function (h) { return h.equip && h.equip[k] != null ? h.equip[k] : null; }; }
  function bedAvail(k) { return function (h) { var b = h.beds && h.beds[k]; if (!b || b.avail == null) return null; return b.avail > 0; }; }
  function dept(re) { return function (h) { if (!h.depts || !h.depts.length) return null; return h.depts.some(function (d) { return re.test(d); }); }; }
  function any() { var fs = [].slice.call(arguments); return function (h) { var r = fs.map(function (f) { return f(h); }); if (r.indexOf(true) >= 0) return true; if (r.indexOf(null) >= 0) return null; return false; }; }

  var R = {
    erBed: { label: '응급실 병상', test: bedAvail('er'), msg: /응급실|병상|만실|포화/ },
    pedsBed: { label: '소아 응급병상', test: bedAvail('peds'), msg: /소아/ },
    pedsDept: { label: '소아청소년과 진료과 (진료과목 기준)', test: dept(/소아/), msg: /소아/ },
    ct: { label: 'CT', test: eq('ct'), msg: /CT|씨티/i },
    mri: { label: 'MRI', test: eq('mri'), msg: /MRI/i },
    angio: { label: '혈관촬영기', test: eq('angio'), msg: /혈관|조영/ },
    venti: { label: '인공호흡기', test: eq('venti'), msg: /인공호흡/ },
    ecmo: { label: 'ECMO', test: eq('ecmo'), msg: /ECMO|에크모/i },
    hypothermia: { label: '중심체온조절 (저체온치료)', test: eq('hypothermia'), msg: /체온/ },
    incubator: { label: '인큐베이터', test: eq('incubator'), msg: /인큐베이터/ },
    isoNeg: { label: '음압격리 병상', test: bedAvail('isoNeg'), msg: /격리/ },
    isoAny: { label: '격리 병상', test: any(bedAvail('isoNeg'), bedAvail('isoGen')), msg: /격리/ },
    or: { label: '수술실', test: bedAvail('or'), msg: /수술/ },
    icu: { label: '중환자실', test: bedAvail('icuGeneral'), msg: /중환자/ },
    icuCardio: { label: '심장내과 중환자실', test: bedAvail('icuCardio'), msg: /중환자/ },
    icuNeuro: { label: '신경과 중환자실', test: bedAvail('icuNeuro'), msg: /중환자/ },
    picu: { label: '소아 중환자실', test: any(bedAvail('picu'), bedAvail('picuEr')), msg: /소아.*중환자|PICU/i },
    nicu: { label: '신생아 중환자실', test: bedAvail('nicu'), msg: /신생아/ },
    traumaCenter: { label: '권역외상센터', test: function (h) { return h.trauma ? true : (h.hasBeds ? false : null); }, msg: /외상/ },
    traumaResus: { label: '외상소생실', test: bedAvail('traumaResus'), msg: /외상/ },
    delivery: { label: '분만실', test: bedAvail('delivery'), msg: /분만|산과/ },
    burnRoom: { label: '화상처치실', test: bedAvail('burnRoom'), msg: /화상/ },
    s1: { label: '심근경색 재관류중재술', test: sev(1), msg: /심근|심장|PCI|중재/ },
    s2: { label: '뇌경색 재관류중재술', test: sev(2), msg: /뇌경색|뇌졸중|혈전/ },
    s3: { label: '뇌출혈 수술 (거미막하)', test: sev(3), msg: /뇌출혈|신경외과/ },
    s4: { label: '뇌출혈 수술 (거미막하 외)', test: sev(4), msg: /뇌출혈|신경외과/ },
    s5: { label: '흉부 대동맥 응급', test: sev(5), msg: /대동맥|흉부외과/ },
    s6: { label: '복부 대동맥 응급', test: sev(6), msg: /대동맥/ },
    s9: { label: '복부 응급수술 (비외상)', test: sev(9), msg: /복부|외과|수술/ },
    s10: { label: '영유아 장중첩·장폐색', test: sev(10), msg: /장중첩|소아|영유아/ },
    s11: { label: '성인 응급 위장관 내시경', test: sev(11), msg: /내시경|소화기/ },
    s12: { label: '영유아 응급 위장관 내시경', test: sev(12), msg: /내시경|소아/ },
    s15: { label: '저체중 출생아 집중치료', test: sev(15), msg: /신생아|저체중/ },
    s16: { label: '분만', test: sev(16), msg: /분만|산과|산부인과/ },
    s17: { label: '산과 수술', test: sev(17), msg: /산과|산부인과/ },
    s19: { label: '중증화상 전문치료', test: sev(19), msg: /화상/ },
    s20: { label: '수족지 접합', test: sev(20), msg: /접합|수지|정형/ },
    s22: { label: '응급 투석 (HD)', test: sev(22), msg: /투석/ },
    s24: { label: '정신과 폐쇄병동', test: sev(24), msg: /정신/ },
    s25: { label: '안과 응급수술', test: sev(25), msg: /안과/ },
    s26: { label: '성인 혈관중재 (영상의학)', test: sev(26), msg: /혈관중재|색전/ },
    s27: { label: '영유아 혈관중재 (영상의학)', test: sev(27), msg: /혈관중재|소아/ }
  };

  // 상태별 필요 자원. must = 없으면 제외 / pref = 있으면 가산
  function needsFor(p) {
    var age = num(p.age), child = age != null && age < 15, infant = age != null && age < 6;
    var N = [];
    function add(k, level, why) { if (!N.some(function (n) { return n.key === k; })) N.push({ key: k, level: level, why: why || '' }); }
    var ft = p.fieldTriage || fieldTriage(p);
    switch (p.condition) {
      case 'arrest':
        add('erBed', 'pref', '자발순환 회복 후 소생 처치'); add('venti', 'pref'); add('hypothermia', 'pref', '소생 후 목표체온유지'); add('ecmo', 'pref'); add('s1', 'pref', '심인성 심정지 시 관상동맥 중재');
        if (child) add('picu', 'pref');
        break;
      case 'chest':
        if (p.stemi) { add('s1', 'must', 'STEMI는 PCI 가능 병원 직행이 사망 감소와 연관'); add('icuCardio', 'pref'); }
        else { add('s1', 'pref', '급성관상동맥증후군 가능성'); add('ct', 'pref', '대동맥박리 감별'); }
        if (p.tearing) { add('s5', 'must', '찢어지는 흉통·등 통증 → 대동맥 응급'); add('ct', 'must'); }
        break;
      case 'stroke':
        add('ct', 'must', '출혈/경색 감별 영상');
        add('s2', p.lkwMin == null || p.lkwMin <= 1440 ? 'must' : 'pref', '뇌경색 재관류 (혈전제거술은 발병 24시간 이내 선별 환자)');
        if (p.raceTotal >= 5) { add('angio', 'must', 'RACE ≥5: 대혈관폐색 의심 → 혈전제거술 가능 병원'); add('icuNeuro', 'pref'); }
        add('mri', 'pref'); add('s3', 'pref', '출혈성 뇌졸중 가능성'); add('s4', 'pref');
        break;
      case 'trauma':
        if (ft.level === 'red') { add('traumaCenter', 'must', '2021 현장 분류 Red → 최상위 외상센터'); add('ct', 'must'); add('traumaResus', 'pref'); add('or', 'pref'); add('icu', 'pref'); }
        else if (ft.level === 'yellow') { add('ct', 'must', '2021 현장 분류 Yellow → 외상센터 권고'); add('traumaCenter', 'pref'); add('or', 'pref'); }
        else { add('erBed', 'pref'); add('ct', 'pref'); }
        if (p.headInjury) { add('s4', 'pref', '외상성 뇌출혈 대비'); }
        if (child) { add('pedsBed', 'pref'); add('picu', 'pref'); }
        break;
      case 'bleeding':
        if (ft.level === 'red' || p.amputation) add('traumaCenter', 'pref');
        if (p.amputation) add('s20', 'must', '절단 → 수족지 접합 가능 병원');
        add('ct', 'pref'); add('or', 'pref');
        break;
      case 'burn':
        if (p.severeBurn) { add('s19', 'must', '중증화상 전문치료'); add('burnRoom', 'pref'); } else add('burnRoom', 'pref');
        if (p.inhalation) add('venti', 'pref', '흡입화상 시 기도 확보');
        break;
      case 'peds_abd':
        add('ct', 'must', '충수염·장중첩 진단 (소아 CT 또는 초음파)');
        add(infant ? 's10' : 's9', 'must', infant ? '영유아 장중첩·장폐색 처치' : '복부 응급수술 (충수 절제 등)');
        add('pedsDept', 'must', '소아 진료 가능 (소아 응급 준비도가 높은 응급실은 사망률이 낮음)'); add('pedsBed', 'pref'); add('picu', 'pref'); add('or', 'pref');
        break;
      case 'abd':
        add('ct', 'must'); add('s9', 'pref'); add('or', 'pref');
        break;
      case 'gi_bleed':
        add(child ? 's12' : 's11', 'must', '응급 위장관 내시경'); add('icu', 'pref');
        break;
      case 'aortic':
        add('ct', 'must'); add(p.abdominal ? 's6' : 's5', 'must', '대동맥 응급수술'); add('icu', 'pref');
        break;
      case 'obstetric':
        add('s16', 'must', '분만'); add('s17', 'pref', '산과 수술'); add('delivery', 'pref'); add('nicu', 'pref');
        if (p.preterm) add('s15', 'pref');
        break;
      case 'respiratory':
        add('venti', 'pref'); add('isoAny', p.infectious ? 'must' : 'pref', '감염 의심 시 격리 병상'); add('icu', 'pref');
        break;
      case 'anaphylaxis': add('erBed', 'pref'); add('venti', 'pref'); break;
      case 'seizure': add('ct', 'pref'); if (child) add('pedsBed', 'pref'); break;
      case 'psych': add('s24', 'pref', '정신과 폐쇄병동'); break;
      case 'eye': add('s25', 'must'); break;
      case 'renal': add('s22', 'must', '응급 투석'); break;
      default: add('erBed', 'pref'); add('ct', 'pref');
    }
    if (child && p.condition !== 'peds_abd') { add('pedsDept', 'pref'); add('pedsBed', 'pref'); }
    return N;
  }

  /* ───────── 4. 병원 매칭 ───────── */
  function haversine(a, b) {
    var R0 = 6371, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R0 * Math.asin(Math.sqrt(x));
  }
  // 도로 우회 계수 1.3, 구급차 평균 시속 40km (도심 기준 추정치) + 출발 2분
  function etaMin(km, opts) { var f = (opts && opts.detour) || 1.3, v = (opts && opts.kmh) || 40; return Math.round(2 + (km * f / v) * 60); }

  function parseTime(s) { if (!s || String(s).length < 12) return null; s = String(s); return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +(s.slice(12, 14) || 0)).getTime(); }

  function msgRelevant(h, needs, now) {
    var out = [];
    (h.messages || []).forEach(function (m) {
      var end = parseTime(m.end); if (end && now && end < now) return;
      // 메시지에 질환 분류(symTypCodMag)가 있으면 그 분류로만 관련성을 본다 ('[응급내시경] 영유아 위장관'이 소아 충수염과 무관하듯).
      // 분류가 없거나 '응급실' 일반 메시지면 본문으로 판단한다.
      var hay = m.disease && !/^응급실/.test(m.disease) ? m.disease : (m.text || '') + ' ' + (m.disease || '');
      var rel = needs.filter(function (n) { var r = R[n.key]; return r && r.msg && r.msg.test(hay); }).map(function (n) { return n.key; });
      out.push({ text: m.text, disease: m.disease, kind: m.kind, relevantTo: rel });
    });
    return out;
  }

  // hospitals: normalize.merge() 결과, origin: {lat, lon} 또는 null
  function match(hospitals, needs, origin, opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), staleMin = opts.staleMin || 30, timeCritical = !!opts.timeCritical;
    var rows = hospitals.map(function (h) {
      // 길찾기(OSRM) 결과가 있으면 실제 도로 기준 시간, 없으면 직선거리 추정
      var rt = opts.routes || {}, rc = rt.car && rt.car[h.hpid], rf = rt.foot && rt.foot[h.hpid];
      var km = rc && rc.km != null ? rc.km : origin && h.lat != null ? haversine(origin, h) : null;
      var eta = rc ? rc.min : km != null ? etaMin(km, opts) : null;
      var foot = rf ? { min: rf.min, km: rf.km } : null;
      var walkOk = !!(foot && eta != null && foot.min <= 20 && foot.min <= eta + 3);
      var cells = needs.map(function (n) { var r = R[n.key], v = r ? r.test(h) : null; return { key: n.key, label: r ? r.label : n.key, level: n.level, why: n.why, ok: v }; });
      var missing = cells.filter(function (c) { return c.level === 'must' && c.ok === false; });
      var unknown = cells.filter(function (c) { return c.level === 'must' && c.ok === null; });
      var prefs = cells.filter(function (c) { return c.level === 'pref' && c.ok === true; }).length;
      var msgs = msgRelevant(h, needs, now);
      var blocking = msgs.filter(function (m) { return m.relevantTo.length; });
      var er = h.beds && h.beds.er ? h.beds.er : {};
      var crowd = er.avail == null ? 'unknown' : er.avail <= 0 ? 'full' : (er.total && er.avail / er.total < 0.2) || er.avail <= 2 ? 'busy' : 'ok';
      var upd = parseTime(h.updated), ageMin = upd ? Math.round((now - upd) / 60000) : null;
      var stale = ageMin == null || ageMin > staleMin;
      var pen = 0, notes = [];
      if (crowd === 'full') { pen += 12; notes.push('응급실 병상 포화 (가용 ' + er.avail + ')'); }
      else if (crowd === 'busy') { pen += 4; notes.push('응급실 혼잡'); }
      else if (crowd === 'unknown') { pen += 3; notes.push('응급실 병상 정보 없음'); }
      pen += unknown.length * 6; if (unknown.length) notes.push('필수 항목 미확인: ' + unknown.map(function (c) { return c.label; }).join(', '));
      pen += blocking.length * 10; blocking.forEach(function (m) { notes.push('병원 메시지: ' + m.text); });
      if (stale) { pen += 2; notes.push(ageMin == null ? '갱신 시각 없음' : ageMin + '분 전 정보'); }
      var w = timeCritical ? 2 : 1;
      var score = (eta != null ? eta * w : 30) + pen - prefs * 4;
      return { h: h, km: km, eta: eta, etaSrc: rc ? 'route' : 'estimate', foot: foot, walkOk: walkOk, cells: cells, eligible: missing.length === 0, missing: missing, unknown: unknown, prefs: prefs, crowd: crowd, ageMin: ageMin, stale: stale, messages: msgs, blocking: blocking, notes: notes, score: score };
    });
    // 필수 자원이 확인된 병원을 미확인 병원보다 항상 앞에 둔다
    var ok = rows.filter(function (r) { return r.eligible; }).sort(function (a, b) { return (a.unknown.length > 0) - (b.unknown.length > 0) || a.score - b.score; });
    var excluded = rows.filter(function (r) { return !r.eligible; }).sort(function (a, b) { return (a.eta == null ? 999 : a.eta) - (b.eta == null ? 999 : b.eta); });
    var byDist = rows.filter(function (r) { return r.eta != null; }).sort(function (a, b) { return a.eta - b.eta; });
    var nearest = byDist[0] || null, best = ok[0] || null, compare = null;
    if (nearest && best && nearest !== best && !nearest.eligible) {
      // 가까운 병원에 갔다가 전원되는 경우 (도착 + 평가 30분 + 전원 준비 10분 + 이동)
      var tr = nearest.km != null && best.h.lat != null ? etaMin(haversine(nearest.h, best.h), opts) : null;
      compare = { nearest: nearest, transferTotal: tr != null ? nearest.eta + 30 + 10 + tr : null, direct: best.eta, reasons: nearest.missing.map(function (c) { return c.label; }) };
    }
    return { ranked: ok, excluded: excluded, nearest: nearest, compare: compare };
  }

  /* ───────── 5. 사전 연락(Pre-notification) 문구 ───────── */
  function preNotify(p, row, grade) {
    var parts = [];
    parts.push('[메디패스 사전연락] ' + (row ? row.h.name : '') + ' 응급실');
    parts.push('환자: ' + ((p.age != null && p.age !== '' ? p.age + '세 ' : '') + (p.sex || '')).trim() + ' / ' + (p.ccText || conditionLabel(p.condition)));
    if (grade) parts.push('참고등급(비공식): ' + grade.grade + ' - ' + grade.why.slice(0, 3).join(', '));
    var v = [];
    if (p.sbp) v.push('BP ' + p.sbp + (p.dbp ? '/' + p.dbp : '')); if (p.hr) v.push('HR ' + p.hr); if (p.rr) v.push('RR ' + p.rr); if (p.spo2) v.push('SpO2 ' + p.spo2 + '%'); if (p.gcs) v.push('GCS ' + p.gcs); if (p.temp) v.push('BT ' + p.temp);
    if (v.length) parts.push('활력징후: ' + v.join(', '));
    if (p.condition === 'stroke') parts.push('뇌졸중: RACE ' + (p.raceTotal || 0) + '점' + (p.lkwText ? ', 최종정상 ' + p.lkwText : ''));
    if (p.stemi) parts.push('12유도 심전도 STEMI');
    if (p.fieldTriage && p.fieldTriage.level !== 'none') parts.push('외상 분류: ' + (p.fieldTriage.level === 'red' ? 'Red' : 'Yellow') + ' (' + p.fieldTriage.red.concat(p.fieldTriage.yellow).slice(0, 3).join(', ') + ')');
    if (row) { parts.push('필요 자원: ' + row.cells.filter(function (c) { return c.level === 'must'; }).map(function (c) { return c.label; }).join(', ')); if (row.eta != null) parts.push('도착 예상: 약 ' + row.eta + '분'); }
    return parts.join('\n');
  }

  var CONDITIONS = {
    arrest: '심정지', chest: '흉통 (급성관상동맥증후군 의심)', stroke: '뇌졸중 의심', trauma: '외상', bleeding: '출혈', burn: '화상',
    peds_abd: '소아 복통 (충수염·장중첩 의심)', abd: '성인 복통', gi_bleed: '위장관 출혈', aortic: '대동맥 응급 의심', obstetric: '산과 응급',
    respiratory: '호흡곤란', anaphylaxis: '아나필락시스', seizure: '경련', psych: '정신과적 응급', eye: '안과 응급', renal: '신장 (투석 필요)', other: '기타'
  };
  function conditionLabel(c) { return CONDITIONS[c] || '기타'; }

  /* ───────── 6. 근거 자료 ───────── */
  var REFS = {
    kcpr2020: { t: '2020 한국심폐소생술 가이드라인: 일반인 기본소생술 (대한심폐소생협회·질병관리청)', u: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8171172/' },
    dacpr: { t: '상황요원 안내 심폐소생술(Dispatcher-assisted CPR) 관련 국내 연구 (Clin Exp Emerg Med)', u: 'https://doi.org/10.15441/ceem.23.102' },
    ktas: { t: 'KTAS 신뢰도·타당도: 가중 카파 0.77, 민감도 0.92 (J Korean Med Sci 2019)', u: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6730846/' },
    ktas2: { t: 'KTAS 평가자 간 일치도: 간호사·응급구조사 비교', u: 'https://synapse.koreamed.org/articles/1129555' },
    preKtas: { t: 'Pre-KTAS와 병원 KTAS 일치도 (대한응급의학회지)', u: 'https://www.jksem.org/journal/view.php?number=838' },
    preKtas2: { t: 'Pre-KTAS 시범사업 분석 (계명대 동산병원 연구)', u: 'https://scholarworks.bwise.kr/kmu/handle/2023.sw.kmu/25898' },
    field2021: { t: '2021 National Guideline for the Field Triage of Injured Patients (ACS COT)', u: 'https://www.facs.org/media/fy3ojkqq/national-guideline-for-field-triage-handout.pdf' },
    fast: { t: 'FAST·BE-FAST 일반인 뇌졸중 인지 연구 (Practical Neurology)', u: 'https://practicalneurology.com/diseases-diagnoses/stroke/triage-for-higher-level-of-care/30140/' },
    race: { t: '병원 전 대혈관폐색(LVO) 척도 비교: RACE AUROC 0.81 (medRxiv)', u: 'https://www.medrxiv.org/content/10.1101/2023.04.19.23288844v1.full.pdf' },
    stemi_direct: { t: 'STEMI 환자 PCI 병원 직행 이송과 사망률 (Ottawa 연구, Healio 요약)', u: 'https://www.healio.com/news/cardiology/20121003/emergency-transport-directly-to-a-pci-center-significantly-reduced-mortality' },
    peds_ready: { t: '응급실 소아 준비도와 사망률: aOR 0.25 (Ames et al., Pediatrics 2019)', u: 'https://www.handtevy.com/wp-content/uploads/2024/03/Pediatrics-2019-Readiness-Mortality-AMES.pdf' },
    iht_kr: { t: '국내 응급실 간 전원과 이중 전원 실태 (PMC9913013)', u: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9913013/' },
    ilcor_fa: { t: 'ILCOR CoSTR: 생명을 위협하는 외부 출혈 조절 (지혈대)', u: 'https://costr.ilcor.org/document/control-of-severe-life-threatening-external-bleeding-in-the-out-of-hospital-setting-tourniquets-ksu-tf-systematic-review' },
    aha_fa: { t: '2020 AHA·미국적십자 응급처치 지침 요약 (Highlights)', u: 'https://cpr.heart.org/-/media/CPR-Files/CPR-Guidelines-Files/Hghlghts_2020FAFcsdUpdts.pdf' },
    recovery: { t: 'ILCOR CoSTR: 회복 자세', u: 'https://costr.ilcor.org/document/fa-517-recovery-position' },
    stemi_acc: { t: 'STEMI 환자 응급실 우회 직행 (ACC Journal Scan)', u: 'https://www.acc.org/Latest-in-Cardiology/Journal-Scans/2013/06/24/17/12/Emergency-Department-Bypass-for-STEMI-Patients' },
    peds_ready2: { t: '다주(州) 연구: 소아 준비도 높은 응급실의 사망 감소 (IU ScholarWorks)', u: 'https://scholarworks.indianapolis.iu.edu/items/8e74d242-d821-4d2d-8268-4cfa2e6edcc1/full' },
    api: { t: '국립중앙의료원 전국 응급의료기관 정보 조회 서비스 (공공데이터포털)', u: 'https://www.data.go.kr/data/15000563/openapi.do' }
  };

  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function dedupe(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  return { PUBLIC: PUBLIC, CONDITIONS: CONDITIONS, REFS: REFS, RES: R, fieldTriage: fieldTriage, race: race, refGrade: refGrade, needsFor: needsFor, match: match, preNotify: preNotify, haversine: haversine, etaMin: etaMin, parseTime: parseTime, conditionLabel: conditionLabel };
});
