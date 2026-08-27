/* 브라우저에 실제로 띄워 화면이 그려지는지 본다.
 *
 *   node test/smoke.browser.js
 *
 * 규칙 테스트(test/logic.test.js)가 91개 전부 통과해도 app.js 의 오타 하나면
 * 페이지가 빈 화면이 된다. 규칙은 맞는데 아무도 그것을 볼 수 없는 상태다.
 * 파일을 읽어서는 안 잡힌다 — 실제로 띄워 봐야 잡힌다.
 *
 * 「예시로 해 보기」 한 번이 세 문서를 지나간다 —
 * 미국식 숫자 · 유럽식 숫자(열 순서도 다름) · 오인식이 든 스캔본.
 * 그래서 그것을 누르는 것이 이 앱에서 가장 넓게 훑는 길이다.
 *
 * playwright 가 없으면 조용히 건너뛴다. 이것 하나 때문에 다른 테스트가
 * 막히면 아무도 안 돌리게 된다. CI 에서는 설치하고 돌린다.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다 (CI 에서는 설치 후 돌립니다).');
  process.exit(0);
}

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
function group(t) { console.log('\n' + t); }
function ok(c, label, detail) {
  if (c) passed++; else { failed++; console.log('  X ' + label); if (detail) console.log('      ' + detail); }
}
function eq(g, w, label) { ok(String(g) === String(w), label, '기대: ' + w + '  실제: ' + g); }

/* 정적 서버가 내주는 MIME.
 *
 * ⚠ **.mjs 를 빠뜨리면 안 된다.** 브라우저는 모듈 스크립트의 MIME 을 엄격히
 * 검사해서 octet-stream 으로 오면 실행을 거부한다. 이 앱은 PDF 를
 * lib/pdf.min.mjs 로 읽으므로 빠뜨리면 통째로 멈춘다.
 */
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',            /* 문자인식 엔진 */
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',   /* 한글 CMap — PDF 한글이 빈 문자열이 되지 않게 */
  '.traineddata': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* 서버가 못 내준 것을 모아 둔다. 테스트가 못 서는 이유가 앱이 아니라
 * 이 서버일 수 있고, 그때 시간 초과만 나면 원인을 못 찾는다. */
var missed = [];

function serve(port) {
  return http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    var file = path.join(ROOT, rel);
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      missed.push(rel);
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}

/* 표의 한 줄을 칸 글자로 읽는다. 열 순서는 app.js 의 renderRows 를 따른다. */
function readRows(page) {
  return page.$$eval('#rows tbody tr', function (trs) {
    return trs.map(function (tr) {
      var td = tr.querySelectorAll('td');
      return {
        partNo: (td[6] || {}).textContent ? td[6].textContent.trim() : '',
        qty:    (td[8] || {}).textContent ? td[8].textContent.trim() : '',
        price:  (td[9] || {}).textContent ? td[9].textContent.trim() : '',
        amount: (td[10] || {}).textContent ? td[10].textContent.trim() : '',
        chk:    (td[11] || {}).textContent ? td[11].textContent.trim() : '',
        bad:    tr.classList.contains('bad')
      };
    });
  });
}
function find(rows, partNo) {
  for (var i = 0; i < rows.length; i++) if (rows[i].partNo === partNo) return rows[i];
  return null;
}

(async function main() {
  var PORT = 8816;
  var server = serve(PORT);
  var browser = await chromium.launch();
  var errors = [];

  try {
    var page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle' });

    group('1. 첫 화면');
    /* <input type=file> 은 css 로 감춰 두고 .drop 라벨이 그 자리를 대신한다.
     * 눌리는 것은 라벨이므로 사람이 보는 것도 라벨이다. */
    ok(await page.isVisible('#drop'), '파일을 끌어다 놓는 자리가 보인다');
    ok(await page.locator('#file').count() === 1, '파일 입력이 붙어 있다');
    ok(await page.isVisible('#demo'), '예시 단추가 보인다');
    ok(await page.isVisible('#force-ocr'), '스캔본 강제 스위치가 있다');

    group('2. 예시 한 번으로 세 문서를 지나간다');
    await page.click('#demo');
    try {
      await page.waitForSelector('#rows tbody tr td', { timeout: 30000 });
    } catch (e) {
      /* 시간 초과만 던지면 원인을 알 수 없다. 화면과 서버 상태를 함께 적는다. */
      var dump = (await page.textContent('#out')).replace(/\s+/g, ' ').slice(0, 160);
      ok(false, '예시를 눌러 표가 그려진다',
         '#out: ' + (dump || '(비어 있음)') +
         ' | 못 내준 파일: ' + (missed.length ? missed.join(', ') : '없음') +
         ' | 오류: ' + (errors.slice(0, 2).join(' | ') || '없음'));
      throw e;
    }
    eq((await page.textContent('#doc-count')).trim(), '3건', '문서 세 건을 읽었다');
    var rows = await readRows(page);
    ok(rows.length >= 9, '부품 줄이 모두 나온다 (' + rows.length + '줄)');

    group('3. 유럽식 숫자 — 천 배 틀리지 않는다');
    /* 1.234,56 은 독일에서 1234.56 이다. 미국식으로 읽으면 1.234 —
     * 화면에는 그냥 숫자로 보여 알아채기 어렵다. */
    var de = find(rows, 'DIN-912-M8');
    ok(de, 'B사(독일) 줄을 찾았다', JSON.stringify(rows.map(function (r) { return r.partNo; })));
    if (de) {
      eq(de.qty, '10', '수량을 10 으로 읽는다');
      ok(/1[.,]?234[.,]56/.test(de.price), '단가를 1234.56 으로 읽는다', de.price);
      ok(de.chk.indexOf('OK') === 0, '검산이 맞는다', de.chk.slice(0, 40));
    }

    group('4. 곱셈만으로 못 가리는 줄 — 표 전체의 자리로 푼다');
    /* 2.480,00 × 2 = 4.960,00 은 수량 2·단가 2480 으로도,
     * 수량 2480·단가 2 로도 아귀가 맞는다. 개발 중 실제로 뒤바뀌었다. */
    var amb = find(rows, 'HYD-4471');
    ok(amb, '애매한 줄을 찾았다');
    if (amb) {
      eq(amb.qty, '2', '수량이 2 다 (2480 이 아니다)');
      ok(/2[.,]?480/.test(amb.price), '단가가 2480 이다', amb.price);
    }

    group('5. 계산이 안 맞는 줄을 버리지 않고 알린다');
    /* 예시 C 의 15 × 88.00 은 1320 인데 1,020.00 으로 적혀 있다 (오인식). */
    var ocr = find(rows, 'AP-2240');
    ok(ocr, '오인식이 든 줄이 표에 남아 있다 (버리지 않았다)');
    if (ocr) {
      ok(ocr.bad, '그 줄이 「확인필요」로 표시된다', ocr.chk.slice(0, 60));
      ok(ocr.chk.indexOf('확인필요') >= 0, '확인이 필요하다고 적는다', ocr.chk.slice(0, 60));
    }
    ok(!(await page.locator('#out-warn').isHidden()), '확인이 필요하다는 안내가 뜬다');

    group('6. 어느 엔진으로 읽었는지 남긴다');
    /* 문자인식으로 읽은 값은 신뢰도가 다른데, 안 적으면 어디를 더 봐야 할지 모른다. */
    var cards = (await page.textContent('#doc-cards')).replace(/\s+/g, ' ');
    ok(cards.indexOf('문자인식') >= 0, '스캔본을 문자인식으로 읽었다고 밝힌다', cards.slice(0, 140));
    ok(cards.indexOf('전자 PDF') >= 0, '전자 PDF 도 밝힌다');

    group('7. 검증·수정 — 수량을 고치면 금액이 다시 계산된다');
    /* 예시 C 의 AP-1120 은 30 × 12.40 = 372.00 이다.
     * 수량을 31 로 고치면 금액이 384.4 가 되어야 한다. */
    var before = find(await readRows(page), 'AP-1120');
    ok(before && /372/.test(before.amount), '고치기 전 금액이 372 다',
       before ? before.amount : '(줄 없음)');

    /* 고칠 칸을 실제로 찾았는지 먼저 센다. 못 찾고도 통과하면 빈 검사다 —
     * 처음에 data-k 로 찾다가 아무 일도 일어나지 않은 채 통과했다. */
    var edited = await page.evaluate(function () {
      var tds = document.querySelectorAll('#rows tbody tr td[contenteditable][data-f="Qty"]');
      for (var i = 0; i < tds.length; i++) {
        var tr = tds[i].closest('tr');
        var partNo = tr.querySelectorAll('td')[6].textContent.trim();
        if (partNo === 'AP-1120') {
          tds[i].textContent = '31';
          tds[i].dispatchEvent(new Event('blur'));
          return true;
        }
      }
      return false;
    });
    ok(edited, '수량 칸을 찾아 고쳤다');
    await page.waitForTimeout(250);

    var after = find(await readRows(page), 'AP-1120');
    ok(after && /384[.,]40?$/.test(after.amount),
       '금액이 384.4 로 다시 계산된다', after ? after.amount : '(줄 없음)');
    ok((await readRows(page)).length === rows.length, '고쳐도 줄이 사라지지 않는다');

    group('8. 내보내기 단추가 살아 있다');
    ok(await page.isVisible('#xlsx'), '엑셀로 내보낼 수 있다');
    ok(await page.isVisible('#csv'), 'CSV 로도 내보낼 수 있다');

    group('9. 좁은 화면에서 가로로 넘치지 않는다');
    await page.setViewportSize({ width: 380, height: 780 });
    await page.waitForTimeout(150);
    var over = await page.evaluate(function () {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    ok(over <= 1, '가로 스크롤이 생기지 않는다 (넘침 ' + over + 'px)');
    ok(await page.isVisible('#drop'), '좁은 화면에서도 파일 자리가 보인다');

    group('10. 콘솔에 오류가 없다');
    ok(errors.length === 0, '자바스크립트 오류 없음', errors.slice(0, 3).join(' | '));
    /* 이 서버가 못 내준 파일이 있으면 앱이 아니라 테스트가 틀린 것이다 */
    ok(missed.length === 0, '테스트 서버가 필요한 파일을 다 내줬다', missed.join(', '));

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + (failed ? 'X' : 'O') + ' ' + passed + ' 통과 / ' + failed + ' 실패');
  process.exit(failed ? 1 : 0);
}());
