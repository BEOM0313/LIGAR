# 메디패스 응급실 연결

환자 상태(일반인 상황 선택 또는 119 구급대 평가)와 국립중앙의료원 **실시간 응급실 정보**를 연결해, 치료가 가능한 응급실을 골라 줍니다.
“가까운 응급실에 갔는데 CT가 없거나 소아 진료가 안 돼 다시 전원되는” 상황을 줄이는 것이 목표입니다.

> **참고용 시범 소프트웨어입니다.** 실제 이송 병원 결정은 119 구급대·구급상황관리센터와 의료진이 합니다. 화면의 ‘참고 등급’은 KTAS·Pre-KTAS 공식 판정이 아닙니다.

## 실행

Node.js 18 이상만 있으면 됩니다 (외부 패키지 없음).

```bash
cd medipath-er
cp .env.example .env        # .env에 공공데이터포털 인증키 입력
npm start                   # http://localhost:8080
npm run demo                # 키 없이 가상 데이터로 실행
npm test                    # 테스트
```

- 인증키는 **서버의 `.env`에만** 둡니다. 브라우저로 내려가지 않고, `.gitignore`로 Git에서 제외됩니다.
- Encoding 키(`%2B…`)와 Decoding 키(`+ / =`) 모두 넣을 수 있습니다.
- 키가 없거나 `DEMO=1`이면 `fixtures/`의 **가상 병원 데이터**(실존 병원 아님)로 동작합니다.

### 단일 HTML 파일 (`dist/medipath-er.html`)
서버 없이 파일 하나로 실행합니다. 브라우저에서 열고 위쪽 **데이터 연결**에서 고릅니다.

| 방식 | 설명 |
|---|---|
| 가상 데이터 | 실존하지 않는 병원 6곳으로 체험 |
| 공공데이터포털 직접 연결 | 인증키를 입력하면 브라우저가 `apis.data.go.kr`을 직접 호출. 키는 파일에 없고, ‘기억’을 켤 때만 그 브라우저(localStorage)에 저장 |
| 메디패스 서버 경유 | `npm start`로 띄운 서버 주소를 입력. 키는 서버에만 있음 |

- 브라우저가 직접 호출을 막으면(CORS) 화면에 안내가 나옵니다. 그때는 ‘서버 경유’를 쓰세요.
- 직접 연결은 개인 기기에서 쓰는 용도입니다. 여러 사람에게 공개할 때는 키가 브라우저에 드러나지 않도록 서버 경유로 배포하세요.
- 기관 목록·진료과목은 하루 동안 브라우저에 저장해 호출 수를 줄입니다. 호출 수도 브라우저별로 셉니다.
- 코드를 고친 뒤 `npm run build`로 다시 만듭니다.

### Claude Code 클라우드 환경에서 실행할 때
기본 네트워크 정책이 `apis.data.go.kr`을 막습니다. 환경 설정 → Network access → Allowed domains에 `apis.data.go.kr`을 추가하세요.
([설정 방법](https://code.claude.com/docs/en/cloud-environments#network-access))

## 구조

```
server.js            HTTP 서버 (정적 파일 + /api/*), .env 로딩
lib/core.js          공공데이터포털 호출 · 캐시 · 기능별 일일 한도 · 장애 시 이전 자료 반환 (서버·HTML 공용)
lib/api.js           Node용 연결 (fetch, fixtures 파일)
lib/service.js       지역·위치 단위로 여러 오퍼레이션을 묶어 병원 목록 생성 (서버·HTML 공용)
lib/xml.js           응답 XML 파서 (게이트웨이 오류 응답 포함)
lib/normalize.js     여러 오퍼레이션 응답을 기관ID(hpid)로 합쳐 병원 모델 생성
public/logic.js      판단 로직 (일반인 응급처치, 현장 외상 분류, RACE, 참고 등급, 필요 자원, 매칭, 사전연락 문구)
public/app.js        화면
public/standalone.js 단일 HTML의 데이터 연결 설정
tools/build-html.js  dist/medipath-er.html 생성
dist/medipath-er.html 단일 HTML 결과물
fixtures/*.xml       명세서 형식의 가상 응답
test/test.js         node --test
```

### 서버 API
| 경로 | 설명 | 사용하는 공공데이터 오퍼레이션 |
|---|---|---|
| `/api/region?sido=&sigungu=` | 시군구 단위 병원 목록 + 실시간 정보 | 목록 · 가용병상 · 중증질환 수용가능 · 메시지 · 외상센터 목록 · 기본정보(진료과목) |
| `/api/nearby?lat=&lon=` | 현재 위치 주변 (최대 4개 시군구) | 위치기반 조회 후 위와 동일 |
| `/api/basic?hpid=` | 기관 기본정보 | 기본정보 |
| `/api/status` | 오늘 호출 수 | - |

캐시: 가용병상·메시지 2분, 중증질환 5분, 기관 정보 24시간. 공공데이터포털 개발계정은 **기능별 하루 1,000건**이므로 실서비스 전 운영계정 신청이 필요합니다.

### 공공데이터 필드 → 매칭 자원
| 자원 | 필드 |
|---|---|
| 응급실 · 소아 · 음압격리 병상 | `hvec`/`hvs01`, `hv28`/`hvs02`, `hv29`/`hvs03` |
| 수술실 · 중환자실 · 소아중환자 · 신생아중환자 | `hvoc`, `hvicc`, `hv32`·`hv33`, `hvncc` |
| CT · MRI · 혈관촬영 · 인공호흡기 · ECMO · 저체온치료 | `hvctayn`, `hvmriayn`, `hvangioayn`, `hvventiayn`, `hvecmoayn`, `hvhypoayn` |
| 중증질환 27종 + 응급실 | `MKioskTy1`~`MKioskTy28` (Y / N / 불가능 / 정보미제공) |
| 병원 메시지 | `symBlkMsg`, `symTypCodMag` (관련 질환이면 감점·표시) |
| 소아청소년과 등 진료과목 | 기본정보 `dgidIdName` |

## 판단 근거

| 기능 | 근거 |
|---|---|
| 심정지: 119 스피커폰 · 상황요원 안내 가슴압박 · AED | [2020 한국심폐소생술 가이드라인](https://pmc.ncbi.nlm.nih.gov/articles/PMC8171172/), [상황요원 안내 CPR 연구](https://doi.org/10.15441/ceem.23.102) |
| 뇌졸중: 일반인 FAST, 구급대 RACE ≥5 → 혈전제거술 가능 병원 | [Practical Neurology](https://practicalneurology.com/diseases-diagnoses/stroke/triage-for-higher-level-of-care/30140/), [LVO 척도 비교 (medRxiv)](https://www.medrxiv.org/content/10.1101/2023.04.19.23288844v1.full.pdf) |
| STEMI → PCI 가능 병원 직행 | [Ottawa 연구 요약 (Healio)](https://www.healio.com/news/cardiology/20121003/emergency-transport-directly-to-a-pci-center-significantly-reduced-mortality), [ACC](https://www.acc.org/Latest-in-Cardiology/Journal-Scans/2013/06/24/17/12/Emergency-Department-Bypass-for-STEMI-Patients) |
| 외상: 2021 현장 분류 Red → 최상위 외상센터, Yellow → 외상센터 | [ACS 2021 Field Triage](https://www.facs.org/media/fy3ojkqq/national-guideline-for-field-triage-handout.pdf) |
| 소아: 소아 진료 가능 응급실 우선 | [Ames 2019, Pediatrics](https://www.handtevy.com/wp-content/uploads/2024/03/Pediatrics-2019-Readiness-Mortality-AMES.pdf), [다주 연구](https://scholarworks.indianapolis.iu.edu/items/8e74d242-d821-4d2d-8268-4cfa2e6edcc1/full) |
| 전원 지연 비교 (가까운 병원 경유 vs 직행) | [국내 응급실 간 전원 연구](https://pmc.ncbi.nlm.nih.gov/articles/PMC9913013/) |
| 출혈 직접 압박 · 지혈대 · 화상 냉각 · 회복 자세 | [ILCOR 지혈대](https://costr.ilcor.org/document/control-of-severe-life-threatening-external-bleeding-in-the-out-of-hospital-setting-tourniquets-ksu-tf-systematic-review), [ILCOR 회복자세](https://costr.ilcor.org/document/fa-517-recovery-position), [2020 AHA 응급처치](https://cpr.heart.org/-/media/CPR-Files/CPR-Guidelines-Files/Hghlghts_2020FAFcsdUpdts.pdf) |
| KTAS · Pre-KTAS 일치도 (참고 등급 설계 배경) | [KTAS 타당도](https://pmc.ncbi.nlm.nih.gov/articles/PMC6730846/), [평가자 간 일치도](https://synapse.koreamed.org/articles/1129555), [Pre-KTAS](https://www.jksem.org/journal/view.php?number=838) |

## 한계 (실제 운영 전 반드시 확인)

1. **당직 전문의 정보가 API에 없습니다.** 진료과목·중증질환 수용 가능 여부·병원 메시지로 대신하므로 사전 전화 확인이 필요합니다.
2. **KTAS·Pre-KTAS 공식 판정표는 사용 허가가 필요합니다.** 이 프로그램의 ‘참고 등급’은 공개 연구의 생리학적 기준을 단순화한 것입니다. 실제 적용하려면 응급의료 관계 기관과 협의해야 합니다.
3. **병원 입력 정보는 늦을 수 있습니다.** 30분 넘은 정보는 표시하고 감점합니다.
4. **도착 시간은 직선거리 기반 추정치**입니다. 실서비스에는 경로 API 연동이 필요합니다.
5. **의료기기 소프트웨어(SaMD) 해당 여부**를 식품의약품안전처에 확인해야 합니다.
6. 일반인 화면은 119 신고를 대신하지 않습니다. 생명이 위급한 상황은 항상 119 연결을 먼저 안내합니다.
