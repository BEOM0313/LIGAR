'use strict';
// 여러 오퍼레이션 응답을 기관ID(hpid) 기준으로 합쳐 화면에서 쓰는 병원 모델로 만든다.

function num(v) { if (v == null || v === '' || v === 'NULL') return null; var n = Number(String(v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : null; }
function yn(v) { if (v == null || v === '') return null; v = String(v).trim(); if (/^Y/i.test(v)) return true; if (/^N/i.test(v) || /불가/.test(v)) return false; return null; } // '정보미제공' 등은 null(미확인)
function bed(avail, total) { return { avail: num(avail), total: num(total) }; }

// 중증질환 수용가능 항목 (getSrsillDissAceptncPosblInfoInqire mkioskty1~28)
var SEVERE = {
  1: '[재관류중재술] 심근경색', 2: '[재관류중재술] 뇌경색', 3: '[뇌출혈수술] 거미막하출혈', 4: '[뇌출혈수술] 거미막하출혈 외',
  5: '[대동맥응급] 흉부', 6: '[대동맥응급] 복부', 7: '[담낭담관질환] 담낭질환', 8: '[담낭담관질환] 담도포함질환',
  9: '[복부응급수술] 비외상', 10: '[장중첩/폐색] 영유아', 11: '[응급내시경] 성인 위장관', 12: '[응급내시경] 영유아 위장관',
  13: '[응급내시경] 성인 기관지', 14: '[응급내시경] 영유아 기관지', 15: '[저체중출생아] 집중치료', 16: '[산부인과응급] 분만',
  17: '[산부인과응급] 산과수술', 18: '[산부인과응급] 부인과수술', 19: '[중증화상] 전문치료', 20: '[사지접합] 수족지접합',
  21: '[사지접합] 수족지접합 외', 22: '[응급투석] HD', 23: '[응급투석] CRRT', 24: '[정신과적응급] 폐쇄병동입원',
  25: '[안과적수술] 응급', 26: '[영상의학혈관중재] 성인', 27: '[영상의학혈관중재] 영유아', 28: '응급실 (Emergency gate keeper)'
};
var SEVERE_AGE_MSG = { 10: 'mkioskty10msg', 12: 'mkioskty12msg', 14: 'mkioskty14msg', 15: 'mkioskty15msg', 27: 'mkioskty27msg' };

function hospitalFromBeds(b) {
  return {
    hpid: b.hpid, name: b.dutyname, erTel: b.dutytel3 || null, updated: b.hvidate || null,
    beds: {
      er: bed(b.hvec, b.hvs01), peds: bed(b.hv28, b.hvs02), isoNeg: bed(b.hv29, b.hvs03), isoGen: bed(b.hv30, b.hvs04),
      or: bed(b.hvoc, b.hvs22), traumaOr: bed(b.hv39, b.hvs23), icuGeneral: bed(b.hvicc, b.hvs17), icuMed: bed(b.hv2, b.hvs06), icuSurg: bed(b.hv3, b.hvs07),
      icuNeuro: bed(b.hvcc, b.hvs11), icuNs: bed(b.hv6, b.hvs12), icuCardio: bed(b.hv34, b.hvs15), icuChest: bed(b.hvccc, b.hvs16), icuTrauma: bed(b.hv9, b.hvs14), icuBurn: bed(b.hv8, b.hvs13),
      icuEr: bed(b.hv31, b.hvs05), nicu: bed(b.hvncc, b.hvs08), picu: bed(b.hv32, b.hvs09), picuEr: bed(b.hv33, b.hvs10),
      delivery: bed(b.hv42, b.hvs26), burnRoom: bed(b.hv43, b.hvs36), traumaResus: bed(b.hv60, b.hvs60), ward: bed(b.hvgc, b.hvs38)
    },
    equip: { ct: yn(b.hvctayn), mri: yn(b.hvmriayn), angio: yn(b.hvangioayn), venti: yn(b.hvventiayn), ventiPreterm: yn(b.hvventisoayn), incubator: yn(b.hvincuayn), crrt: yn(b.hvcrrtayn), ecmo: yn(b.hvecmoayn), hyperbaric: yn(b.hvoxyayn), hypothermia: yn(b.hvhypoayn), ambulance: yn(b.hvamyn) }
  };
}
function severeFrom(s) {
  var out = {}, ages = {};
  Object.keys(SEVERE).forEach(function (k) { out[k] = yn(s['mkioskty' + k]); var a = SEVERE_AGE_MSG[k] && s[SEVERE_AGE_MSG[k]]; if (a) ages[k] = a; });
  return { flags: out, ageNotes: ages };
}

// region: { beds:[], severe:[], list:[], messages:[], trauma:[] } → 병원 배열
function merge(region) {
  var byId = new Map();
  function get(id) { if (!byId.has(id)) byId.set(id, { hpid: id, beds: {}, equip: {}, severe: { flags: {}, ageNotes: {} }, messages: [], trauma: false }); return byId.get(id); }
  (region.list || []).forEach(function (l) {
    // 같은 병원이 지역 목록과 위치 기반 목록에 모두 나올 수 있으므로 비어 있는 값으로 덮어쓰지 않는다
    var h = get(l.hpid); h.name = h.name || l.dutyname; h.addr = l.dutyaddr || h.addr; h.type = l.dutyemclsname || h.type || null; h.typeCode = l.dutyemcls || h.typeCode || null;
    if (num(l.wgs84lat || l.latitude) != null) { h.lat = num(l.wgs84lat || l.latitude); h.lon = num(l.wgs84lon || l.longitude); } h.tel = l.dutytel1 || h.tel || null; h.erTel = h.erTel || l.dutytel3 || null;
  });
  (region.beds || []).forEach(function (b) { var h = get(b.hpid), n = hospitalFromBeds(b); Object.assign(h, { name: h.name || n.name, erTel: n.erTel || h.erTel, updated: n.updated, beds: n.beds, equip: n.equip, hasBeds: true }); });
  (region.severe || []).forEach(function (s) { var id = s.hpid || s.dutyname; if (!id) return; get(id).severe = severeFrom(s); get(id).hasSevere = true; });
  (region.messages || []).forEach(function (m) {
    var h = get(m.hpid || m.emcorgcod); if (!h) return;
    h.messages.push({ kind: m.symblkmsgtyp || null, disease: m.symtypcodmag || null, code: m.symtypcod || null, text: m.symblkmsg || '', start: m.symblksttdtm || null, end: m.symblkenddtm || null, shown: m.symoutdspyon || null });
  });
  (region.trauma || []).forEach(function (t) { var h = get(t.hpid); h.trauma = true; h.name = h.name || t.dutyname; if (h.lat == null) { h.lat = num(t.wgs84lat || t.latitude); h.lon = num(t.wgs84lon || t.longitude); } });
  (region.basic || []).forEach(function (b) { var h = get(b.hpid); h.depts = (b.dgididname || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); });
  return Array.from(byId.values()).filter(function (h) { return h.name && (h.hasBeds || h.lat != null); });
}

// 주소에서 시도 · 시군구 추출 ("서울특별시 강남구 …" → ["서울특별시","강남구"])
function regionOf(addr) { var p = String(addr || '').trim().split(/\s+/); return p.length >= 2 ? [p[0], p[1]] : null; }

module.exports = { merge: merge, regionOf: regionOf, SEVERE: SEVERE, yn: yn, num: num };
