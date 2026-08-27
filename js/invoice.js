/**
 * invoice.js — Invoice 글에서 헤더와 부품 명세를 뽑는다 (순수 함수)
 *
 * ═══════════════════════════════════════════════════════════════════
 * 이 파일의 핵심 생각: **계산이 맞는지로 읽은 것이 맞는지 판단한다.**
 * ═══════════════════════════════════════════════════════════════════
 *
 * 공급사마다 Invoice 양식이 다르다. 열 순서도 다르고 이름도 다르다.
 *   A사: Part No | Description | Qty | Unit Price | Amount
 *   B사: Item | Desc | Unit Price | Qty | Total
 *   C사: 번호 | 품명 | 수량 | 단가 | 금액   (열 이름이 아예 없기도 하다)
 *
 * 열 이름을 보고 맞히려 들면 못 보던 양식에서 통째로 틀린다.
 * 그런데 **Invoice 에는 반드시 성립하는 식이 하나 있다.**
 *
 *     수량 × 단가 = 금액
 *
 * 그래서 한 줄에서 숫자를 전부 뽑아 **어느 조합이 이 식을 만족하는지** 찾는다.
 * 맞아떨어지면 그 조합이 수량·단가·금액이다. 열 순서를 몰라도 된다.
 * 안 맞으면 **맞는 척하지 않고 표시**한다 — 사람이 봐야 할 줄이다.
 *
 * 이 방식은 두 가지를 덤으로 해결한다.
 *
 * ① **유럽식 소수점.** `1.234,56` 은 독일에서 1234.56 이다.
 *    미국식으로 읽으면 1.234 가 되어 **천 배가 틀린다.** 그런데 화면에는
 *    그냥 숫자로 보여서 알아채기 어렵다.
 *    두 방식으로 다 읽어 보고 **계산이 맞는 쪽**을 고른다.
 *
 * ② **OCR 오인식.** 스캔본에서 8 을 3 으로 읽는 일이 흔하다.
 *    계산이 어긋나면 그 줄이 바로 드러난다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Invoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════ 숫자 */

  /**
   * 숫자 글자를 두 방식으로 읽는다.
   *   미국식 1,234.56  → 1234.56
   *   유럽식 1.234,56  → 1234.56
   * 어느 쪽인지 확실할 때는 하나만, 애매하면 둘 다 돌려준다.
   * 고르는 것은 fitLine 이 한다 — 계산이 맞는 쪽이 이긴다.
   */
  function readNumber(tok) {
    var s = String(tok == null ? '' : tok).trim();
    // 통화기호·공백·괄호를 걷어낸다. 괄호는 음수 표기다: (1,234.00)
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '')
         .replace(/[$€£¥₩]|USD|EUR|JPY|KRW|CNY|GBP/gi, '')
         .replace(/\s/g, '').trim();
    if (s === '' || !/\d/.test(s)) return [];
    if (!/^-?[\d.,]+$/.test(s)) return [];

    var out = [];
    var hasDot = s.indexOf('.') >= 0, hasCom = s.indexOf(',') >= 0;

    function push(v) {
      if (Number.isFinite(v) && out.indexOf(neg ? -v : v) < 0) out.push(neg ? -v : v);
    }

    /**
     * ⚠ 여기가 이 파일에서 가장 조용히 틀리는 곳이다.
     *
     * 처음에는 점·쉼표가 하나만 있으면 "천단위인지 소수점인지 모른다"며
     * 두 해석을 다 냈다. 그랬더니 `5 × 12.50 = 62.50` 이
     * `5 × 1250 = 6250` 으로도 성립해 **계산 검산이 통째로 무력해졌다.**
     * 두 해석이 모두 자기들끼리 아귀가 맞아서 검산으로 가려낼 수가 없다.
     *
     * 자릿수를 보면 대부분 갈린다.
     *   천단위 구분은 **반드시 세 자리씩** 끊는다 — `1.234` · `1,234,567`
     *   소수는 보통 한두 자리다 — `12.50` · `0,85`
     * 그래서 **뒤가 정확히 세 자리일 때만** 애매한 것으로 본다.
     */
    var tail = /[.,](\d+)$/.exec(s);
    var tailLen = tail ? tail[1].length : 0;

    if (hasDot && hasCom) {
      // 둘 다 있으면 **뒤에 오는 것이 소수점**이다 — 이건 확실하다
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) push(Number(s.replace(/,/g, '')));
      else push(Number(s.replace(/\./g, '').replace(',', '.')));
    } else if (hasCom || hasDot) {
      var sep = hasCom ? ',' : '.';
      var groups = s.split(sep);
      var manySeps = groups.length > 2;
      // 세 자리씩 여러 번 끊겼으면 천단위가 확실하다: 1,234,567
      var looksThousand = manySeps && groups.slice(1).every(function (g) { return /^\d{3}$/.test(g); });

      if (looksThousand) {
        push(Number(s.split(sep).join('')));
      } else if (tailLen === 3) {
        // 정확히 세 자리 — 둘 다 가능하다. 1.234 는 1234 일 수도 1.234 일 수도 있다.
        push(Number(s.split(sep).join('')));                       // 천단위로
        push(Number(s.replace(sep, '.')));                         // 소수로
      } else {
        // 한두 자리(12.50 · 0,85)나 네 자리 이상 — 소수점이다. 천단위가 될 수 없다.
        push(Number(s.replace(sep, '.')));
      }
    } else {
      push(Number(s));
    }
    return out;
  }

  /**
   * 한 줄에서 숫자로 보이는 토막을 **위치와 함께** 뽑는다.
   * 위치가 필요한 이유: 품명은 "숫자가 시작되기 전"이 아니라
   * "수량·단가·금액 중 가장 앞엣것 앞"이다. 줄 맨 앞의 항번(1. 2. 3.)은 품명 쪽이다.
   */
  function numberTokens(line) {
    var s = String(line || '');
    var re = /\(?-?[\d][\d.,]*\)?/g, m, out = [];
    while ((m = re.exec(s))) {
      if (/\d/.test(m[0])) out.push({ tok: m[0], at: m.index });
    }
    return out;
  }

  /** 예전 형태(글자 배열)로 쓰는 곳을 위해 */
  function tokenStrings(line) {
    return numberTokens(line).map(function (t) { return t.tok; });
  }

  /* ═════════════════════════════════════════════════ 줄 하나 맞히기 */

  var EPS = 0.02;   // 반올림 차이는 봐 준다 (단가를 소수 둘째 자리로 반올림해 적는 일이 흔하다)

  function close(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    var d = Math.abs(a - b);
    return d <= EPS || d <= Math.abs(b) * 0.0005;
  }

  /**
   * 숫자 토막들에서 (수량, 단가, 금액) 을 찾는다.
   *
   * 규칙
   *   · 금액은 보통 **맨 뒤**에 온다 → 뒤에서부터 본다
   *   · 수량은 단가보다 **앞**에 오는 일이 많지만 반대도 있다 → 둘 다 본다
   *   · 수량은 대개 정수다 → 정수인 쪽에 가산점
   *   · 여러 조합이 맞으면 **금액이 가장 뒤에 있는 것**을 고른다
   *
   * 못 찾으면 null. 억지로 맞히지 않는다.
   */
  function fitLine(tokens) {
    // 글자 배열로도, {tok, at} 배열로도 받는다
    var cands = (tokens || []).map(function (t, i) {
      var tok = typeof t === 'string' ? t : t.tok;
      var at = typeof t === 'string' ? i : t.at;
      return { i: i, at: at, tok: tok, vals: readNumber(tok) };
    }).filter(function (c) { return c.vals.length; });
    if (cands.length < 3) return null;

    var best = null;
    for (var a = 0; a < cands.length; a++) {
      for (var b = 0; b < cands.length; b++) {
        if (b === a) continue;
        for (var c = 0; c < cands.length; c++) {
          if (c === a || c === b) continue;
          cands[a].vals.forEach(function (q) {
            cands[b].vals.forEach(function (u) {
              cands[c].vals.forEach(function (amt) {
                if (q <= 0 || u < 0) return;
                if (!close(q * u, amt)) return;
                // 1×1=1 같은 것은 아무 숫자나 맞는다 — 뜻 없는 일치를 걸러 낸다
                if (q === 1 && u === amt && cands.length > 3 && amt <= 1) return;
                var score = cands[c].i * 100                    // 금액이 뒤일수록 좋다
                          + (Number.isInteger(q) ? 40 : 0)      // 수량은 대개 정수
                          + (cands[a].i < cands[b].i ? 10 : 0)  // 수량이 단가보다 앞
                          + (u >= q ? 5 : 0);                   // 단가가 수량보다 큰 편
                if (!best || score > best.score) {
                  best = { qty: q, unit: u, amount: amt, score: score,
                           idx: { qty: cands[a].i, unit: cands[b].i, amount: cands[c].i },
                           at: Math.min(cands[a].at, cands[b].at, cands[c].at) };
                }
              });
            });
          });
        }
      }
    }
    if (!best) return null;
    return { qty: best.qty, unit: best.unit, amount: best.amount,
             idx: best.idx, at: best.at };
  }

  /* ═══════════════════════════════════════════════════════ 헤더 */

  var MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /**
   * 날짜를 읽는다.
   *
   * ⚠ `03/04/2026` 은 **어느 나라 양식인지 모르면 3월 4일인지 4월 3일인지 알 수 없다.**
   *    미국식으로 단정하면 절반이 틀린다. 그래서 **모르면 모른다고 한다**(ambiguous).
   *    사람이 화면에서 고르게 한다 — 지어내는 것보다 낫다.
   */
  function readDate(s) {
    var t = String(s || '').trim();
    var m;

    // 2026-03-04 · 2026/03/04 — 앞이 네 자리면 순서가 확실하다
    m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
    if (m) return mk(+m[1], +m[2], +m[3], false);

    // 04-Mar-2026 · 4 March 2026 — 달 이름이 있으면 확실하다
    m = /(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{4})/.exec(t);
    if (m && MONTH[m[2].slice(0, 3).toLowerCase()]) {
      return mk(+m[3], MONTH[m[2].slice(0, 3).toLowerCase()], +m[1], false);
    }
    // Mar 4, 2026
    m = /([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})/.exec(t);
    if (m && MONTH[m[1].slice(0, 3).toLowerCase()]) {
      return mk(+m[3], MONTH[m[1].slice(0, 3).toLowerCase()], +m[2], false);
    }

    // 03/04/2026 — 여기가 문제다
    m = /(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/.exec(t);
    if (m) {
      var p = +m[1], q = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      if (p > 12 && q <= 12) return mk(y, q, p, false);   // 13/04 → 4월 13일, 확실
      if (q > 12 && p <= 12) return mk(y, p, q, false);   // 03/25 → 3월 25일, 확실
      if (p <= 12 && q <= 12) {
        // 둘 다 12 이하 — 알 수 없다. 미국식을 먼저 내되 **애매하다고 표시**한다.
        var r = mk(y, p, q, true);
        if (r) r.alt = fmt(y, q, p);
        return r;
      }
    }
    return null;
  }

  function mk(y, mo, d, ambiguous) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (y < 1990 || y > 2100) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;   // 2/30 같은 것
    return { text: fmt(y, mo, d), ambiguous: !!ambiguous, alt: null };
  }
  function fmt(y, mo, d) {
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  var CURRENCIES = ['USD', 'EUR', 'JPY', 'KRW', 'CNY', 'GBP', 'CHF', 'SGD', 'HKD', 'TWD', 'INR', 'AUD', 'CAD'];
  var SYMBOL = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW' };

  var LABELS = {
    invoiceNo: ['invoice no', 'invoice number', 'invoice #', 'inv no', 'inv.no', 'invoice',
                'commercial invoice no', '인보이스', '송장번호', '문서번호'],
    date:      ['invoice date', 'issue date', 'issued on', 'date of issue', 'date',
                '발행일', '작성일', '일자'],
    supplier:  ['supplier', 'seller', 'shipper', 'vendor', 'from', 'exporter', 'messrs',
                '공급자', '공급사', '수출자'],
    currency:  ['currency', 'curr', 'ccy', '통화'],
    poNo:      ['p/o no', 'po no', 'p.o. no', 'purchase order', 'order no', 'your order',
                '발주번호', '주문번호']
  };

  /**
   * `라벨 : 값` 을 찾는다. 같은 줄에 없으면 다음 줄도 본다(표 형태).
   *
   * ⚠ **라벨을 바깥 고리로 돈다.** 줄을 바깥으로 돌면 안 된다.
   *   라벨 목록은 구체적인 것부터 적혀 있는데(`invoice no` → `invoice`),
   *   줄을 먼저 돌면 위쪽의 `COMMERCIAL INVOICE` 제목이 느슨한 `invoice` 에 먼저 걸린다.
   *   그러면 값이 비어 다음 줄을 집어 오고, 실제 `Invoice No : HS-2026-0417` 줄에서
   *   번호가 아니라 **"Invoice" 라는 글자를 번호로 뽑는다.**
   *   실제로 그렇게 나왔다.
   */
  function findLabelled(lines, labels) {
    for (var k = 0; k < labels.length; k++) {
      var lab = labels[k];
      for (var i = 0; i < lines.length; i++) {
        var low = lines[i].toLowerCase();
        var at = low.indexOf(lab);
        if (at < 0) continue;
        // 라벨이 더 긴 낱말의 일부이면 안 된다 (`date` 가 `update` 에 걸리는 것)
        var before = at > 0 ? lines[i][at - 1] : ' ';
        var afterCh = lines[i][at + lab.length] || ' ';
        if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(afterCh)) continue;

        var after = lines[i].slice(at + lab.length).replace(/^[\s:：#.\-]+/, '').trim();
        if (after) return { value: after, line: i, label: lab };
        if (i + 1 < lines.length && lines[i + 1].trim()) {
          return { value: lines[i + 1].trim(), line: i + 1, label: lab };
        }
      }
    }
    return null;
  }

  function parseHeader(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (s) {
      return s.replace(/[ \t]+/g, ' ').trim();
    }).filter(function (s) { return s; });

    var h = { invoiceNo: '', date: '', dateAmbiguous: false, dateAlt: '',
              supplier: '', currency: '', poNo: '', notes: [] };

    var f = findLabelled(lines, LABELS.invoiceNo);
    if (f) {
      // 값에서 번호처럼 보이는 토막만 취한다 — 뒤에 다른 라벨이 붙어 오는 일이 흔하다
      var mm = /([A-Za-z0-9][A-Za-z0-9\-_/]{2,})/.exec(f.value);
      h.invoiceNo = mm ? mm[1] : f.value.split(/\s{2,}/)[0];
    }

    f = findLabelled(lines, LABELS.date);
    if (f) {
      var d = readDate(f.value);
      if (d) { h.date = d.text; h.dateAmbiguous = d.ambiguous; h.dateAlt = d.alt || ''; }
    }
    if (!h.date) {
      // 라벨이 없으면 글 전체에서 첫 날짜를 찾는다 — 다만 **추정임을 남긴다**
      for (var i = 0; i < lines.length && !h.date; i++) {
        var dd = readDate(lines[i]);
        if (dd) {
          h.date = dd.text; h.dateAmbiguous = dd.ambiguous; h.dateAlt = dd.alt || '';
          h.notes.push('날짜 라벨을 찾지 못해 본문에서 처음 나온 날짜를 썼습니다 — 확인하세요');
        }
      }
    }

    f = findLabelled(lines, LABELS.supplier);
    if (f) h.supplier = f.value.split(/\s{2,}/)[0];
    if (!h.supplier) {
      // 공급사 라벨이 없는 양식이 많다. 맨 위에서 회사처럼 생긴 줄을 찾는다.
      for (var j = 0; j < Math.min(lines.length, 8); j++) {
        var L = lines[j];
        if (/(co\.?,?\s*ltd|corp|corporation|inc\.?|gmbh|s\.?a\.?|b\.?v\.?|limited|company|株式会社|유한|주식회사)/i.test(L)) {
          h.supplier = L; h.notes.push('공급사 라벨이 없어 맨 위 회사명을 썼습니다 — 확인하세요');
          break;
        }
      }
    }

    f = findLabelled(lines, LABELS.currency);
    if (f) {
      var cm = new RegExp('\\b(' + CURRENCIES.join('|') + ')\\b', 'i').exec(f.value);
      if (cm) h.currency = cm[1].toUpperCase();
    }
    if (!h.currency) {
      var all = lines.join(' ');
      var cm2 = new RegExp('\\b(' + CURRENCIES.join('|') + ')\\b').exec(all.toUpperCase());
      if (cm2) h.currency = cm2[1];
      else {
        for (var sym in SYMBOL) { if (all.indexOf(sym) >= 0) { h.currency = SYMBOL[sym]; break; } }
      }
    }

    f = findLabelled(lines, LABELS.poNo);
    if (f) {
      var pm = /([A-Za-z0-9][A-Za-z0-9\-_/]{2,})/.exec(f.value);
      h.poNo = pm ? pm[1] : '';
    }

    return h;
  }

  /* ═══════════════════════════════════════════════════ 부품 명세 */

  // 합계·소계 줄은 부품이 아니다. 이걸 안 거르면 합계가 부품 하나로 들어간다.
  var TOTAL_WORDS = /(sub[\s-]*total|total|amount due|grand total|합계|소계|총액|freight|shipping|insurance|discount|vat|tax|handling)/i;
  // 품번처럼 생긴 것 — 영문/숫자와 하이픈이 섞인 3자 이상
  var PARTNO = /\b([A-Z0-9][A-Z0-9\-._/]{2,}[A-Z0-9])\b/;
  // 헤더 줄 — 부품이 아닌 게 확실하므로 "못 넣었다"고 알리지 않는다
  var HEADER_LINE = /(invoice\s*(no|date|#)|inv\.?\s*no|^\s*date\b|p\/?o\s*no|purchase order|currency|tel|fax|phone|e-?mail|address|발행일|송장|주문번호)/i;

  /**
   * 부품 줄을 찾는다.
   *
   * "수량 × 단가 = 금액" 이 성립하는 줄만 부품으로 본다.
   * 성립하지 않는데 숫자가 여럿인 줄은 **버리지 않고** 따로 모아 돌려준다
   * (`unmatched`). 사람이 화면에서 보고 고칠 수 있어야 한다.
   * 조용히 버리면 부품이 빠진 채로 엑셀이 만들어지고 아무도 모른다.
   */
  /**
   * 표는 **열이 일정하다** — 이것이 한 줄만 보는 것보다 훨씬 센 단서다.
   *
   * 곱셈은 자리를 바꿔도 성립한다. `2.480,00 × 2 = 4.960,00` 은
   * 수량 2 · 단가 2480 으로도, 수량 2480 · 단가 2 로도 아귀가 맞는다.
   * 검산으로는 절대 못 가린다. 실제로 이 줄에서 수량과 단가가 뒤바뀌었다.
   *
   * 그런데 같은 표의 다른 줄은 `1.234,56 × 10 = 12.345,60` 이라
   * 수량이 정수여야 한다는 조건에서 자리가 확정된다.
   * **그 자리를 표 전체에 적용**하면 애매한 줄도 풀린다.
   *
   * 자리는 **뒤에서부터** 센다. 품번에 숫자가 섞여 있어(DIN-912-M8)
   * 앞에서 세면 줄마다 개수가 달라진다. 금액은 언제나 맨 뒤다.
   */
  function majorityPattern(fits, counts) {
    var tally = {};
    fits.forEach(function (f, i) {
      if (!f) return;
      var n = counts[i];
      var key = (f.idx.qty - n) + ',' + (f.idx.unit - n) + ',' + (f.idx.amount - n);
      tally[key] = (tally[key] || 0) + 1;
    });
    var best = null;
    Object.keys(tally).forEach(function (k) {
      if (!best || tally[k] > tally[best]) best = k;
    });
    // 한 줄짜리 표에서는 다수결이 뜻이 없다
    if (!best || tally[best] < 2) return null;
    var p = best.split(',').map(Number);
    return { qty: p[0], unit: p[1], amount: p[2], votes: tally[best] };
  }

  /** 그 줄을 주어진 자리(뒤에서부터)로 읽어 본다. 계산이 맞아야 인정한다. */
  function fitAtPattern(toks, pat) {
    var n = toks.length;
    var gi = n + pat.qty, ui = n + pat.unit, ai = n + pat.amount;
    if (gi < 0 || ui < 0 || ai < 0 || gi >= n || ui >= n || ai >= n) return null;
    var qs = readNumber(toks[gi].tok), us = readNumber(toks[ui].tok), as = readNumber(toks[ai].tok);
    for (var a = 0; a < qs.length; a++) {
      for (var b = 0; b < us.length; b++) {
        for (var c = 0; c < as.length; c++) {
          if (qs[a] > 0 && us[b] >= 0 && close(qs[a] * us[b], as[c])) {
            return { qty: qs[a], unit: us[b], amount: as[c],
                     idx: { qty: gi, unit: ui, amount: ai },
                     at: Math.min(toks[gi].at, toks[ui].at, toks[ai].at) };
          }
        }
      }
    }
    return null;
  }

  function parseLines(text) {
    var raw = String(text || '').split(/\r?\n/);
    var items = [], unmatched = [], skippedTotals = 0;

    // ── 1차: 줄마다 따로 맞혀 본다. 어느 자리가 흔한지 보려는 것이다.
    var firstPass = [], firstCounts = [];
    raw.forEach(function (line0) {
      var line = line0.replace(/[ \t]+/g, ' ').trim();
      if (!line || TOTAL_WORDS.test(line)) return;
      var tk = numberTokens(line);
      if (tk.length < 3) return;
      firstPass.push(fitLine(tk));
      firstCounts.push(tk.length);
    });
    var pattern = majorityPattern(firstPass, firstCounts);

    raw.forEach(function (line0, no) {
      var line = line0.replace(/[ \t]+/g, ' ').trim();
      if (!line) return;
      var toks = numberTokens(line);
      if (!toks.length) return;

      // ⚠ 합계 검사를 **숫자 개수 검사보다 먼저** 한다.
      //   `Sub Total   2,775.00` 은 숫자가 하나라 개수 검사에서 먼저 걸러지는데,
      //   그러면 몇 줄을 건너뛰었는지 세지 못해 화면에 알릴 수가 없다.
      if (TOTAL_WORDS.test(line)) { skippedTotals++; return; }
      if (toks.length < 3) return;

      // ── 2차: **표 전체에서 흔한 자리**를 먼저 시도한다.
      //   곱셈만으로는 수량과 단가를 못 가리는 줄이 있는데, 같은 표의 다른 줄이
      //   자리를 알려 준다. 그 자리로 읽히지 않을 때만 줄 하나로 맞혀 본다.
      var fit = (pattern && fitAtPattern(toks, pattern)) || fitLine(toks);
      var guessed = false;

      if (!fit) {
        /**
         * 계산이 안 맞는다고 **버리면 안 된다.**
         * 문자인식이 8 을 3 으로 읽은 줄이 바로 이 경우인데, 버리면 그 부품이
         * 통째로 빠진 채 엑셀이 만들어지고 아무도 모른다.
         * 손으로 칠 때는 한 건 빠지면 눈에 띄지만, 자동으로 뽑으면 안 띈다.
         *
         * 그래서 **부품 줄처럼 생겼으면** 자리로 짐작해 넣되 `guessed` 로 표시한다.
         * 화면에서 붉게 뜨고 사람이 고칠 수 있다.
         *   맨 뒤 = 금액 · 그 앞 = 단가 · 그 앞 = 수량  (가장 흔한 순서)
         */
        var tail = toks.slice(-3);
        var bail = null;

        // ⚠ 짐작 경로는 **좁게** 열어야 한다. 넓히면 주소·전화번호가 부품이 된다.
        //   실제로 `1-2-3 Marunouchi, Chiyoda-ku, Tokyo` 가 수량 1 · 단가 -2 · 금액 -3
        //   짜리 부품으로 들어왔다. 검산이 안 맞는 줄은 원래 붉게 뜨므로
        //   눈에는 띄지만, 있지도 않은 부품을 만들어 내는 것은 다른 문제다.

        // ① 숫자 앞에 글자가 있어야 한다 — 품번이든 품명이든
        if (!/[A-Za-z가-힣]{3,}/.test(line.slice(0, tail[0].at))) bail = '부품 줄로 보이지 않습니다';

        // ② 세 숫자가 공백으로 갈라져 있어야 한다 — `1-2-3` 은 한 덩어리다
        if (!bail) {
          var span = line.slice(tail[0].at, tail[2].at + tail[2].tok.length);
          if (!/\d[\s|]+[-(]?\d/.test(span)) bail = '숫자가 붙어 있어 열로 볼 수 없습니다';
        }

        if (!bail) {
          fit = {
            qty:    readNumber(tail[0].tok)[0],
            unit:   readNumber(tail[1].tok)[0],
            amount: readNumber(tail[2].tok)[0],
            at: tail[0].at
          };
          // ③ 셋 다 양수여야 한다. 음수 금액은 반품 전표에나 나오는데,
          //    그런 줄은 사람이 직접 넣는 편이 낫다.
          if (![fit.qty, fit.unit, fit.amount].every(function (v) {
                return Number.isFinite(v) && v > 0; })) {
            bail = '수량·단가·금액을 양수로 읽지 못했습니다';
          }
        }

        if (bail) {
          // 헤더 줄(Date · Invoice No …)은 애초에 부품이 아니다.
          // "부품으로 보지 않았다"고 알릴 필요가 없다 — 알리면 진짜 놓친 줄이 묻힌다.
          if (!HEADER_LINE.test(line)) {
            unmatched.push({ lineNo: no + 1, text: line, reason: bail,
                             numbers: toks.map(function (t) { return t.tok; }) });
          }
          return;
        }
        guessed = true;
        unmatched.push({ lineNo: no + 1, text: line,
                         reason: '수량 × 단가 = 금액이 맞지 않습니다 — 자리로 짐작해 넣었습니다',
                         numbers: toks.map(function (t) { return t.tok; }) });
      }
      // 품명은 "숫자가 시작되기 전"이 아니라 **수량·단가·금액 중 가장 앞엣것 앞**이다.
      // 줄 맨 앞의 항번(1. 2. 3.)도 숫자라, 그것을 기준으로 자르면 품명이 통째로 사라진다.
      var head = line.slice(0, fit.at).trim();
      // 맨 앞의 항번(1. 2. 3.)은 품번도 품명도 아니다. 먼저 떼어 낸다.
      // 안 떼면 품명이 "2 GASKET, EXHAUST" 처럼 나와 엑셀에 그대로 실린다.
      var body = head.replace(/^\d{1,3}\s*[.)\]]?\s+/, '').trim();
      var pm = PARTNO.exec(body) || PARTNO.exec(line);
      var partNo = pm ? pm[1] : '';
      if (/^\d{1,3}$/.test(partNo)) partNo = '';          // 숫자만인 것은 품번이 아니다
      var desc = (partNo ? body.replace(partNo, '') : body)
                   .replace(/^[\s|.\-:]+|[\s|.\-:]+$/g, '').trim();

      items.push({
        lineNo: no + 1,
        partNo: partNo,
        desc: desc || body,
        qty: fit.qty, unitPrice: fit.unit, amount: fit.amount,
        // 계산이 맞아 확신하는 줄인지, 자리로 짐작한 줄인지 구분한다.
        // 화면에서 신뢰도를 다르게 보여 줘야 사람이 어디를 볼지 안다.
        guessed: guessed,
        source: line
      });
    });

    return { items: items, unmatched: unmatched, skippedTotals: skippedTotals };
  }

  /* ═══════════════════════════════════════════════ 검산·평탄화 */

  /** 수량 × 단가 = 금액 인가 */
  function checkRow(r) {
    var q = Number(r.qty), u = Number(r.unitPrice), a = Number(r.amount);
    if (!Number.isFinite(q) || !Number.isFinite(u) || !Number.isFinite(a)) {
      return { ok: false, why: '수량·단가·금액 중 숫자가 아닌 것이 있습니다' };
    }
    if (close(q * u, a)) return { ok: true, why: '' };
    return { ok: false, expected: Math.round(q * u * 100) / 100,
             why: '수량 × 단가 = ' + (Math.round(q * u * 100) / 100).toLocaleString('en-US')
                + ' 인데 금액은 ' + a.toLocaleString('en-US') + ' 입니다' };
  }

  /**
   * 엑셀에 넣을 평평한 표를 만든다.
   * **부품 한 줄마다 헤더를 통째로 붙인다.** 그래야 ERP 업로드와 피벗이 된다.
   * 헤더를 위쪽에 한 번만 두면 여러 Invoice 를 합쳤을 때 어느 줄이 어느 것인지 알 수 없다.
   */
  function flatten(docs) {
    var rows = [];
    (docs || []).forEach(function (d) {
      (d.items || []).forEach(function (it) {
        var chk = checkRow(it);
        rows.push({
          파일명: d.fileName || '',
          InvoiceNo: d.header.invoiceNo || '',
          날짜: d.header.date || '',
          Supplier: d.header.supplier || '',
          통화: d.header.currency || '',
          PONo: d.header.poNo || '',
          PartNo: it.partNo || '',
          Description: it.desc || '',
          Qty: it.qty,
          UnitPrice: it.unitPrice,
          Amount: it.amount,
          검산: chk.ok ? 'OK' : '확인필요',
          비고: chk.ok ? '' : chk.why,
          읽은줄: it.source || ''
        });
      });
    });
    return rows;
  }

  /** 문서 하나의 합계 — 화면에서 원본 Invoice 합계와 대조하는 데 쓴다 */
  function docTotal(items) {
    var sum = 0, bad = 0;
    (items || []).forEach(function (it) {
      var a = Number(it.amount);
      if (Number.isFinite(a)) sum += a; else bad++;
    });
    return { total: Math.round(sum * 100) / 100, bad: bad };
  }

  return {
    readNumber: readNumber, numberTokens: tokenStrings, fitLine: fitLine,
    numberTokensAt: numberTokens,
    readDate: readDate, parseHeader: parseHeader, parseLines: parseLines,
    checkRow: checkRow, flatten: flatten, docTotal: docTotal,
    CURRENCIES: CURRENCIES
  };
});
