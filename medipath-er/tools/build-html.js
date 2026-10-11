'use strict';
// 단일 HTML 만들기: node tools/build-html.js → dist/medipath-er.html
// lib/의 CommonJS 모듈을 작은 require 함수로 묶고, CSS·JS·가상 데이터를 한 파일에 넣는다. 인증키는 넣지 않는다.
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..'), rd = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var mods = ['xml', 'normalize', 'core', 'service'];
var bundle = 'var __mods = {}, __cache = {};\nfunction require(n) { n = n.replace(/^.*\\//, ""); if (!__cache[n]) { var m = { exports: {} }; __cache[n] = m; __mods[n](m, m.exports); } return __cache[n].exports; }\n' +
  mods.map(function (m) { return '__mods["' + m + '"] = function (module, exports) {\n' + rd('lib/' + m + '.js') + '\n};'; }).join('\n');
var fixtures = {};
fs.readdirSync(path.join(root, 'fixtures')).forEach(function (f) { if (/\.xml$/.test(f)) fixtures[f.replace(/\.xml$/, '')] = rd('fixtures/' + f); });
function inline(js) { return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>'; }
var html = rd('public/index.html');
function swap(a, b) { if (html.indexOf(a) < 0) throw new Error('missing ' + a); html = html.replace(a, function () { return b; }); }
swap('<link rel="stylesheet" href="style.css">', '<style>\n' + rd('public/style.css') + '</style>');
swap('<script src="logic.js"></script>', inline(bundle) + '\n' + inline('window.MP_FIXTURES = ' + JSON.stringify(fixtures) + ';') + '\n' + inline(rd('public/logic.js')) + '\n' + inline(rd('public/standalone.js')));
swap('<script src="route.js"></script>', inline(rd('public/route.js')));
swap('<script src="app.js"></script>', inline(rd('public/app.js')));
if (/DATA_GO_KR_KEY\s*=\s*[^\s여]/.test(html)) throw new Error('키로 보이는 값이 포함됨');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'medipath-er.html'), html);
console.log('dist/medipath-er.html', Math.round(html.length / 1024) + 'KB');
