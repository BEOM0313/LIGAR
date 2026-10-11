'use strict';
// 공공데이터포털 응답 XML을 위한 최소 파서. 응답 구조는 <response><header/><body><items><item>…</item></items></body></response>로 평평하다.
// 키는 소문자로 정규화한다 (명세서와 실제 응답이 MKioskTy1 / mkioskty1처럼 대소문자가 섞여 있음).

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
}
function text(xml, tag) {
  var m = new RegExp('<' + tag + '\\s*>([\\s\\S]*?)</' + tag + '\\s*>', 'i').exec(xml);
  return m ? decodeEntities(m[1].trim()) : null;
}
function parseItems(xml) {
  var items = [], re = /<item\s*>([\s\S]*?)<\/item\s*>/gi, m;
  while ((m = re.exec(xml))) {
    var obj = {}, fre = /<([A-Za-z_][\w]*)\s*>([\s\S]*?)<\/\1\s*>/g, f;
    while ((f = fre.exec(m[1]))) obj[f[1].toLowerCase()] = decodeEntities(f[2].trim());
    items.push(obj);
  }
  return items;
}
// 정상 응답과 게이트웨이 오류 응답(OpenAPI_ServiceResponse) 모두 처리
function parseResponse(xml) {
  if (/<OpenAPI_ServiceResponse/i.test(xml)) {
    return { ok: false, code: text(xml, 'returnReasonCode') || 'ERR', message: text(xml, 'returnAuthMsg') || text(xml, 'errMsg') || '공공데이터포털 오류' };
  }
  var code = text(xml, 'resultCode');
  if (code == null) return { ok: false, code: 'PARSE', message: 'XML 응답을 해석할 수 없습니다' };
  if (code !== '00') return { ok: false, code: code, message: text(xml, 'resultMsg') || '오류' };
  return { ok: true, items: parseItems(xml), totalCount: +(text(xml, 'totalCount') || 0) };
}
module.exports = { parseResponse: parseResponse, parseItems: parseItems };
