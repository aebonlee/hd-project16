/**
 * Invoice 읽기 검사
 *
 * 무엇을 검사하나
 *   ① 숫자를 제대로 읽는가 — 특히 **유럽식 소수점**(1.234,56 = 1234.56)
 *   ② 열 순서가 달라도 수량·단가·금액을 찾는가
 *   ③ 계산이 안 맞는 줄을 **맞는 척하지 않고** 표시하는가
 *   ④ 합계 줄을 부품으로 세지 않는가
 *   ⑤ 못 읽은 줄을 **조용히 버리지 않는가**
 *   ⑥ 애매한 날짜(03/04/2026)를 단정하지 않는가
 *
 * 실행:  node test/logic.test.js
 */
'use strict';
const I = require('../js/invoice.js');

let pass = 0;
const fails = [];
function eq(a, b, what) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) { pass++; return; }
  fails.push(`${what}\n      기대: ${y}\n      실제: ${x}`);
}
function ok(c, what) { eq(!!c, true, what); }

/* ── ① 숫자 읽기 ───────────────────────────────────────────────── */

eq(I.readNumber('1,234.56'), [1234.56], '미국식 — 쉼표 천단위, 점 소수');
eq(I.readNumber('1.234,56'), [1234.56], '유럽식 — 점 천단위, 쉼표 소수 (둘 다 있으면 확실하다)');
eq(I.readNumber('$1,234.56'), [1234.56], '통화기호를 걷어낸다');
eq(I.readNumber('€ 1.234,56'), [1234.56], '유로 기호도');
eq(I.readNumber('(1,234.00)'), [-1234], '괄호는 음수 표기');
eq(I.readNumber('12'), [12], '정수');
eq(I.readNumber(''), [], '빈 값');
eq(I.readNumber('N/A'), [], '숫자가 아닌 글자');
eq(I.readNumber('PART-1234'), [], '품번은 숫자가 아니다');

/* 애매한 것은 **둘 다** 낸다 — 고르는 것은 계산이 한다 */
ok(I.readNumber('1,234').includes(1234), '1,234 → 1234 (천단위)');
ok(I.readNumber('12,50').includes(12.5), '12,50 → 12.5 도 후보 (유럽식 소수)');
ok(I.readNumber('1.234').includes(1234), '1.234 → 1234 도 후보 (유럽식 천단위)');
ok(I.readNumber('1.234').includes(1.234), '1.234 → 1.234 도 후보 (미국식 소수)');

/* ── ② 줄 맞히기 — 열 순서가 달라도 ─────────────────────────────── */

let f = I.fitLine(['5', '12.50', '62.50']);
eq([f.qty, f.unit, f.amount], [5, 12.5, 62.5], '수량·단가·금액 순서');

f = I.fitLine(['12.50', '5', '62.50']);
eq([f.qty, f.unit, f.amount], [5, 12.5, 62.5], '단가·수량·금액 순서여도 찾는다');

f = I.fitLine(['1', '10', '250', '25', '250']);
ok(f && f.amount === 250, '숫자가 더 많아도 맞는 조합을 고른다');

/* 유럽식이 섞여 있어도 계산으로 가려낸다 */
f = I.fitLine(['10', '1.234,56', '12.345,60']);
eq([f.qty, f.unit, f.amount], [10, 1234.56, 12345.6], '유럽식 — 계산이 맞는 해석을 고른다');

f = I.fitLine(['4', '12,50', '50,00']);
eq([f.qty, f.unit, f.amount], [4, 12.5, 50], '쉼표 소수점 — 4 × 12.50 = 50.00');

/* 반올림 차이는 봐 준다 — 두 가지 허용치를 **따로** 검사한다.
   큰 금액은 비율로, 작은 금액은 절대값으로 봐 줘야 한다.
   처음에는 큰 금액 예제만 두었더니 절대 허용치를 0 으로 바꿔도 통과했다
   — 비율 쪽으로만 통과하고 있어서 검사가 헛돌고 있었다. */
f = I.fitLine(['7', '14.29', '100.00']);
ok(f, '큰 금액 — 비율 허용 (7 × 14.29 = 100.03 ≈ 100.00)');
f = I.fitLine(['3', '0.33', '1.00']);
ok(f, '작은 금액 — 절대 허용 (3 × 0.33 = 0.99 ≈ 1.00, 비율로는 0.0005 라 못 봐 준다)');
eq(I.fitLine(['3', '0.33', '1.20']), null, '  그렇다고 아무 차이나 봐 주지는 않는다');

/* 못 맞히면 null — 억지로 맞히지 않는다 */
eq(I.fitLine(['5', '12.50', '99.99']), null, '계산이 안 맞으면 null');
eq(I.fitLine(['5', '12.50']), null, '숫자가 셋 미만이면 null');

/* ── ③ 검산 ────────────────────────────────────────────────────── */

eq(I.checkRow({ qty: 5, unitPrice: 12.5, amount: 62.5 }).ok, true, '맞으면 OK');
let c = I.checkRow({ qty: 5, unitPrice: 12.5, amount: 60 });
eq(c.ok, false, '안 맞으면 실패');
eq(c.expected, 62.5, '  기대값을 알려 준다');
ok(/62\.5/.test(c.why), '  왜 틀렸는지 적는다');
eq(I.checkRow({ qty: 'abc', unitPrice: 1, amount: 1 }).ok, false, '숫자가 아니면 실패');

/* ── ④ 날짜 ────────────────────────────────────────────────────── */

eq(I.readDate('2026-03-04').text, '2026-03-04', 'ISO');
eq(I.readDate('2026-03-04').ambiguous, false, '  네 자리가 앞이면 확실');
eq(I.readDate('04-Mar-2026').text, '2026-03-04', '달 이름이 있으면 확실');
eq(I.readDate('Mar 4, 2026').text, '2026-03-04', 'Mar 4, 2026');
eq(I.readDate('13/04/2026').text, '2026-04-13', '13 은 달이 될 수 없다 → 일');
eq(I.readDate('13/04/2026').ambiguous, false, '  그래서 확실하다');

let d = I.readDate('03/04/2026');
eq(d.text, '2026-03-04', '03/04/2026 — 미국식을 먼저 낸다');
eq(d.ambiguous, true, '  ⚠ 하지만 애매하다고 표시한다 (3월 4일인지 4월 3일인지 모른다)');
eq(d.alt, '2026-04-03', '  다른 해석도 함께 준다');

eq(I.readDate('2026-02-30'), null, '2월 30일은 없다');
eq(I.readDate('없음'), null, '날짜가 아닌 글자');

/* ── ⑤ 헤더 ────────────────────────────────────────────────────── */

const SAMPLE = `
HANWA STEEL CO., LTD.
1-2-3 Marunouchi, Chiyoda-ku, Tokyo

COMMERCIAL INVOICE

Invoice No : HS-2026-0417
Invoice Date : 04-Mar-2026
P/O No : PO-77120
Currency : USD

Item   Part No        Description              Qty    Unit Price     Amount
1      HD-4412-A      HYDRAULIC SEAL KIT        20        45.50       910.00
2      HD-7781-B      BEARING ASSY              12       128.75     1,545.00
3      MT-0093        O-RING SET               100         3.20       320.00

                                              Sub Total              2,775.00
                                              Freight                  120.00
                                              TOTAL                  2,895.00
`;

let h = I.parseHeader(SAMPLE);
eq(h.invoiceNo, 'HS-2026-0417', 'Invoice No');
eq(h.date, '2026-03-04', '날짜');
eq(h.dateAmbiguous, false, '  달 이름이 있어 확실');
eq(h.currency, 'USD', '통화');
eq(h.poNo, 'PO-77120', 'P/O No');
ok(/HANWA/.test(h.supplier), '공급사 — 라벨이 없어 맨 위 회사명 (' + h.supplier + ')');
ok(h.notes.some(n => /공급사/.test(n)), '  추정했다고 남긴다');

/* ── ⑥ 부품 명세 ───────────────────────────────────────────────── */

let r = I.parseLines(SAMPLE);
eq(r.items.length, 3, '부품 3건');
eq(r.items.map(x => x.partNo), ['HD-4412-A', 'HD-7781-B', 'MT-0093'], '품번');
eq(r.items.map(x => x.qty), [20, 12, 100], '수량');
eq(r.items.map(x => x.unitPrice), [45.5, 128.75, 3.2], '단가');
eq(r.items.map(x => x.amount), [910, 1545, 320], '금액');
ok(/SEAL KIT/.test(r.items[0].desc), '품명 (' + r.items[0].desc + ')');
ok(r.skippedTotals >= 2, '합계·운임 줄은 부품으로 세지 않는다 (' + r.skippedTotals + '줄 건너뜀)');

/* 합계가 부품으로 섞이지 않았는지 — 2,895 는 어디에도 없어야 한다 */
ok(!r.items.some(x => x.amount === 2895), 'TOTAL 이 부품으로 들어가지 않았다');
ok(!r.items.some(x => x.amount === 120), 'Freight 도 마찬가지');

eq(I.docTotal(r.items).total, 2775, '부품 합계 = Sub Total 과 같다');

/* ── ⑦ 계산이 안 맞는 줄을 **버리지 않는다** ───────────────────────
   문자인식이 8 을 3 으로 읽은 줄이 바로 이 경우다.
   버리면 그 부품이 통째로 빠진 채 엑셀이 만들어지고 아무도 모른다.
   손으로 치면 한 건 빠진 게 눈에 띄지만 자동으로 뽑으면 안 띈다.
   그래서 **자리로 짐작해 넣되 짐작했다고 표시**하고, 화면에서 고치게 한다. */

const BROKEN = `
Invoice No : X-1
1   ABC-100   WIDGET      10    5.00    50.00
2   ABC-200   GADGET       7    9.00    62.00
`;
r = I.parseLines(BROKEN);
eq(r.items.length, 2, '두 줄 다 부품으로 들어온다 (빠뜨리지 않는다)');
eq(r.items[0].guessed, false, '  계산이 맞는 줄은 확신한 것');
eq(r.items[1].guessed, true, '  안 맞는 줄은 **짐작**했다고 표시');
eq([r.items[1].qty, r.items[1].unitPrice, r.items[1].amount], [7, 9, 62],
   '  자리 순서(수량·단가·금액)로 넣는다');
eq(I.checkRow({ qty: 7, unitPrice: 9, amount: 62 }).ok, false, '  검산은 실패로 뜬다');
eq(r.unmatched.length, 1, '  왜 그랬는지도 따로 남긴다');
ok(/맞지 않/.test(r.unmatched[0].reason), '  이유 (' + r.unmatched[0].reason + ')');

/* 하지만 부품이 아닌 줄을 부품으로 만들어 내지는 않는다 */
r = I.parseLines('1-2-3 Marunouchi, Chiyoda-ku, Tokyo 100-0005');
eq(r.items.length, 0, '주소 줄은 부품이 아니다 (숫자가 붙어 있고 앞에 글자가 없다)');

r = I.parseLines('Tel: 03-1234-5678   Fax: 03-1234-5679');
eq(r.items.length, 0, '전화번호도 아니다');

r = I.parseLines('BEARING ASSY   12   128.75   1,545.00');
eq(r.items.length, 1, '앞에 품명이 있고 숫자가 갈라져 있으면 부품이다');

/* ── ⑧ 열 순서가 다른 공급사 ───────────────────────────────────── */

const OTHER = `
RECHNUNG
Lieferant: MUELLER GMBH
Invoice No: R-99120
Date: 15/02/2026
Currency: EUR

Pos  Artikel      Bezeichnung      Preis      Menge     Betrag
1    DIN-912-M8   Zylinderschraube  1.234,56    10    12.345,60
2    DIN-125-A8   Scheibe               0,85   500       425,00
`;
h = I.parseHeader(OTHER);
eq(h.currency, 'EUR', '다른 양식 — 통화');
eq(h.invoiceNo, 'R-99120', '다른 양식 — Invoice No');
eq(h.date, '2026-02-15', '15/02 — 15 는 달이 될 수 없어 확실');
eq(h.dateAmbiguous, false, '  그래서 애매하지 않다');

r = I.parseLines(OTHER);
eq(r.items.length, 2, '단가·수량 순서가 반대여도 2건');
eq(r.items[0].qty, 10, '  수량 (열 순서와 무관)');
eq(r.items[0].unitPrice, 1234.56, '  단가 — 유럽식 1.234,56');
eq(r.items[0].amount, 12345.6, '  금액');
eq(r.items[1].qty, 500, '  둘째 줄 수량');
eq(r.items[1].unitPrice, 0.85, '  둘째 줄 단가 0,85');
ok(!/^\d/.test(r.items[0].desc), '항번(1. 2.)이 품명에 섞이지 않는다 (' + r.items[0].desc + ')');

/* ⚠ 곱셈은 자리를 바꿔도 성립한다 — 검산으로 못 가리는 경우
   `2.480,00 × 2 = 4.960,00` 은 수량 2·단가 2480 으로도, 수량 2480·단가 2 로도 맞는다.
   실제로 여기서 수량과 단가가 뒤바뀌었다.
   같은 표의 다른 줄이 자리를 알려 준다 — 표는 열이 일정하기 때문이다. */
const SWAP = `
Pos  Artikel      Bezeichnung      Preis      Menge     Betrag
1    DIN-912-M8   Zylinderschraube  1.234,56    10    12.345,60
2    DIN-125-A8   Scheibe               0,85   500       425,00
3    HYD-4471     Hydraulikpumpe    2.480,00      2     4.960,00
`;
r = I.parseLines(SWAP);
eq(r.items.length, 3, '세 줄');
eq(r.items[2].qty, 2, '세째 줄 수량 2 (2480 이 아니다 — 곱셈만으로는 못 가린다)');
eq(r.items[2].unitPrice, 2480, '세째 줄 단가 2480');
eq(r.items.map(x => x.guessed), [false, false, false], '  셋 다 확신한 줄');

/* 줄이 하나뿐이면 다수결이 없다 — 그때는 지어내지 말고 줄 하나로만 판단한다 */
r = I.parseLines('HYD-4471  Hydraulikpumpe  2.480,00  2  4.960,00');
eq(r.items.length, 1, '한 줄짜리도 읽기는 한다');
ok(r.items[0].amount === 4960, '  금액은 맞힌다 (수량·단가는 뒤바뀔 수 있다)');

/* ── ⑨ 평평한 표 ───────────────────────────────────────────────── */

const docs = [{ fileName: 'a.pdf', header: I.parseHeader(SAMPLE), items: I.parseLines(SAMPLE).items },
              { fileName: 'b.pdf', header: I.parseHeader(OTHER),  items: I.parseLines(OTHER).items }];
let flat = I.flatten(docs);
eq(flat.length, 5, '두 Invoice 를 합쳐 5줄');
eq(flat[0].InvoiceNo, 'HS-2026-0417', '부품 줄마다 헤더가 붙는다');
eq(flat[4].InvoiceNo, 'R-99120', '  다른 Invoice 줄에는 그쪽 헤더가');
eq(flat[4].통화, 'EUR', '  통화도 줄마다');
ok(flat.every(x => x.검산 === 'OK'), '전부 검산 통과');
ok(flat.every(x => x.읽은줄), '원문을 남긴다 — 틀렸을 때 어디서 왔는지 봐야 한다');

/* 검산 실패가 표에 드러나는가 */
flat = I.flatten([{ fileName: 'c.pdf', header: I.parseHeader(SAMPLE),
                    items: [{ partNo: 'X', desc: 'Y', qty: 5, unitPrice: 10, amount: 999 }] }]);
eq(flat[0].검산, '확인필요', '틀린 줄은 표에 표시된다');
ok(/50/.test(flat[0].비고), '  기대값을 적는다');

/* ── 결과 ──────────────────────────────────────────────────────── */
console.log('─'.repeat(62));
if (fails.length) {
  fails.forEach(x => console.log('  ❌ ' + x));
  console.log('─'.repeat(62));
  console.log(`  통과 ${pass} · 실패 ${fails.length}`);
  process.exit(1);
}
console.log(`  ✅ ${pass}개 모두 통과`);
process.exit(0);
