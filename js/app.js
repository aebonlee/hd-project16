/**
 * app.js — 화면
 *
 * 흐름은 넷이다.
 *   ① 파일을 받는다        → read.js (전자 PDF / 문자인식 / 엑셀)
 *   ② 글에서 뽑는다        → invoice.js (헤더 + 부품 명세)
 *   ③ **사람이 본다**      → 여기. 검산이 안 맞는 줄을 붉게 칠하고 바로 고치게 한다
 *   ④ 엑셀로 내보낸다      → 평평한 표
 *
 * ③이 이 도구의 핵심이다.
 * 자동으로 읽은 값을 사람이 안 보고 그대로 ERP 에 올리면,
 * 손으로 칠 때보다 **더 크게** 틀린다 — 손으로 치면 한 건 틀리지만
 * 잘못 읽은 규칙은 백 줄을 한꺼번에 틀리게 만든다.
 */
(function () {
  'use strict';

  var I = window.Invoice, R = window.Read;
  var docs = [];        // [{ id, fileName, engine, header, items, unmatched, ... }]
  var rows = [];        // 화면에 보이는 평평한 표 (고칠 수 있다)

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n2(v) {
    var x = Number(v);
    return Number.isFinite(x) ? (Math.round(x * 100) / 100).toLocaleString('en-US',
      { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v == null ? '' : v);
  }

  /* ═══════════════════════════════════════════════════ 파일 받기 */

  function init() {
    var drop = $('#drop'), input = $('#file');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { intake(e.dataTransfer.files); });
    input.addEventListener('change', function () { intake(input.files); input.value = ''; });

    $('#demo').addEventListener('click', runDemo);
    $('#paste-toggle').addEventListener('click', function () {
      var ta = $('#paste');
      ta.hidden = !ta.hidden;
      $('#paste-row').hidden = ta.hidden;
      if (!ta.hidden) ta.focus();
    });
    $('#paste-run').addEventListener('click', function () {
      var t = $('#paste').value;
      if (!t.trim()) { alert('붙여넣은 내용이 없습니다.'); return; }
      addDoc('(붙여넣은 글)', '직접 입력', t);
    });
    $('#clear-all').addEventListener('click', function () {
      if (!docs.length) return;
      if (!confirm('읽은 문서 ' + docs.length + '건을 모두 지웁니다. 계속할까요?')) return;
      docs = []; rows = []; $('#files').innerHTML = ''; render();
    });
    $('#only-bad').addEventListener('change', renderRows);
    $('#show-header-cols').addEventListener('change', renderRows);
    $('#fix-all').addEventListener('click', fixAll);
    $('#xlsx').addEventListener('click', function () { exportSheet('xlsx'); });
    $('#csv').addEventListener('click', function () { exportSheet('csv'); });

    render();
  }

  function intake(files) {
    Array.prototype.slice.call(files || []).forEach(function (f) {
      var li = document.createElement('li');
      li.innerHTML = '<span>' + esc(f.name) + '</span><span class="sub st">읽는 중…</span>'
                   + '<div class="prog" hidden><i></i></div>';
      $('#files').appendChild(li);
      var st = $('.st', li), bar = $('.prog', li), fill = $('.prog i', li);

      R.readAny(f, {
        forceOcr: $('#force-ocr').checked,
        onNeedOcr: function () { st.textContent = '스캔본으로 보입니다 — 문자인식 중…'; bar.hidden = false; },
        onProgress: function (p, pageNo, total) {
          bar.hidden = false;
          if (pageNo) st.textContent = '문자인식 ' + pageNo + '/' + total + '쪽…';
          if (typeof p === 'number') fill.style.width = Math.round(p * 100) + '%';
        }
      }).then(function (r) {
        var d = addDoc(f.name, r.engine, r.text, r.note);
        bar.hidden = true;
        st.textContent = d.items.length + '건 · ' + r.engine
          + (d.unmatched.length ? ' · 확인 ' + d.unmatched.length + '줄' : '');
      }).catch(function (e) {
        bar.hidden = true;
        st.textContent = '오류: ' + (e && e.message || e);
        st.style.color = 'var(--danger)';
      });
    });
  }

  function addDoc(fileName, engine, text, note) {
    var header = I.parseHeader(text);
    var parsed = I.parseLines(text);
    var d = {
      id: 'd' + Date.now() + Math.floor(Math.random() * 1000),
      fileName: fileName, engine: engine, note: note || '',
      header: header, items: parsed.items,
      unmatched: parsed.unmatched, skippedTotals: parsed.skippedTotals,
      rawText: text
    };
    docs.push(d);
    rebuildRows();
    render();
    return d;
  }

  /** 문서 → 평평한 표. 사람이 고친 값은 **덮어쓰지 않는다.** */
  function rebuildRows() {
    var edited = {};
    rows.forEach(function (r) { if (r._edited) edited[r._key] = r; });
    rows = [];
    docs.forEach(function (d) {
      d.items.forEach(function (it, i) {
        var key = d.id + ':' + i;
        if (edited[key]) { rows.push(edited[key]); return; }
        rows.push({
          _key: key, _docId: d.id, _edited: false,
          파일명: d.fileName, engine: d.engine,
          InvoiceNo: d.header.invoiceNo, 날짜: d.header.date,
          dateAmbiguous: d.header.dateAmbiguous, dateAlt: d.header.dateAlt,
          Supplier: d.header.supplier, 통화: d.header.currency, PONo: d.header.poNo,
          PartNo: it.partNo, Description: it.desc,
          Qty: it.qty, UnitPrice: it.unitPrice, Amount: it.amount,
          // 계산이 맞아 확신한 줄인지, 자리로 짐작한 줄인지.
          // 짐작한 줄은 원본과 대조해야 한다 — 그 사실이 엑셀까지 따라가야 한다.
          guessed: it.guessed,
          읽은줄: it.source
        });
      });
    });
  }

  /* ═══════════════════════════════════════════════════ 그리기 */

  function render() { renderDocs(); renderRows(); }

  function renderDocs() {
    $('#doc-count').textContent = docs.length ? docs.length + '건' : '';
    var box = $('#doc-cards');
    if (!docs.length) {
      box.innerHTML = '<p class="sub">아직 읽은 문서가 없습니다. 위에 파일을 넣거나 '
        + '<b>예시로 해 보기</b>를 눌러 보세요.</p>';
      return;
    }
    box.innerHTML = '<div class="doccards">' + docs.map(function (d) {
      var t = I.docTotal(d.items);
      var isOcr = /OCR/.test(d.engine);
      var warn = [];
      if (d.note) warn.push(d.note);
      (d.header.notes || []).forEach(function (x) { warn.push(x); });
      if (d.header.dateAmbiguous) {
        warn.push('날짜가 ' + d.header.date + ' 인지 ' + d.header.dateAlt
          + ' 인지 알 수 없습니다 (03/04 형식) — 표에서 고치세요');
      }
      if (isOcr) warn.push('문자인식으로 읽었습니다. 숫자가 틀릴 수 있으니 검산 결과를 꼭 보세요.');
      return '<div class="doc">'
        + '<h3>' + esc(d.fileName)
        + '<span class="eng ' + (isOcr ? 'ocr' : 'pdf') + '">' + esc(d.engine) + '</span></h3>'
        + '<dl>'
        + row('Invoice No', d.header.invoiceNo)
        + row('날짜', d.header.date + (d.header.dateAmbiguous ? ' ⚠' : ''))
        + row('Supplier', d.header.supplier)
        + row('통화', d.header.currency)
        + (d.header.poNo ? row('P/O No', d.header.poNo) : '')
        + row('부품', d.items.length + '건 · 합계 ' + n2(t.total)
              + (d.header.currency ? ' ' + d.header.currency : ''))
        + (d.skippedTotals ? row('건너뜀', d.skippedTotals + '줄 (합계·운임 등)') : '')
        + '</dl>'
        + (function () {
            // 짐작해서 넣은 줄과 아예 못 넣은 줄은 뜻이 다르다. 갈라서 보여 준다.
            var g = d.items.filter(function (x) { return x.guessed; });
            var dropped = d.unmatched.filter(function (u) { return !/맞지 않/.test(u.reason || ''); });
            var out = '';
            if (g.length) {
              out += '<div class="badline">계산(수량 × 단가 = 금액)이 맞지 않는 줄 ' + g.length
                + '개를 <b>자리 순서로 짐작해</b> 넣었습니다. 아래 표에서 원본과 대조하세요:<br>'
                + g.slice(0, 3).map(function (x) { return '· ' + esc(x.source.slice(0, 70)); }).join('<br>')
                + (g.length > 3 ? '<br>… 외 ' + (g.length - 3) + '줄' : '') + '</div>';
            }
            if (dropped.length) {
              out += '<div class="warnline">부품 줄로 보이지 않아 넣지 않은 줄 ' + dropped.length + '개:<br>'
                + dropped.slice(0, 2).map(function (u) {
                    return '· ' + esc(u.text.slice(0, 60)) + ' <i>(' + esc(u.reason) + ')</i>';
                  }).join('<br>')
                + (dropped.length > 2 ? '<br>… 외 ' + (dropped.length - 2) + '줄' : '') + '</div>';
            }
            return out;
          })()
        + (warn.length ? '<div class="warnline">' + warn.map(esc).join('<br>') + '</div>' : '')
        + '</div>';
    }).join('') + '</div>';

    function row(k, v) {
      if (!v && v !== 0) v = '<span class="sub">—</span>';
      return '<dt>' + esc(k) + '</dt><dd>' + (typeof v === 'string' && v.indexOf('<') === 0 ? v : esc(v)) + '</dd>';
    }
  }

  function renderRows() {
    var onlyBad = $('#only-bad').checked;
    var showHead = $('#show-header-cols').checked;
    // 표 머리도 함께 접어야 열이 어긋나지 않는다
    $$('#rows thead th').forEach(function (th, i) {
      if (i >= 1 && i <= 5) th.hidden = !showHead;
    });
    var checked = rows.map(function (r) { return I.checkRow({ qty: r.Qty, unitPrice: r.UnitPrice, amount: r.Amount }); });
    var bad = checked.filter(function (c) { return !c.ok; }).length;

    $('#row-count').textContent = rows.length ? rows.length + '줄' : '';
    $('#stats').innerHTML = rows.length
      ? '<div class="stat">부품<b>' + rows.length + '줄</b></div>'
        + '<div class="stat">문서<b>' + docs.length + '건</b></div>'
        + '<div class="stat">확인 필요<b' + (bad ? ' style="color:var(--danger)"' : '') + '>' + bad + '줄</b></div>'
        + '<div class="stat">문자인식으로 읽은 줄<b>'
          + rows.filter(function (r) { return /OCR/.test(r.engine); }).length + '줄</b></div>'
      : '';

    $('#xlsx').disabled = $('#csv').disabled = !rows.length;
    var w = $('#out-warn');
    if (bad) {
      w.hidden = false;
      w.innerHTML = '<b>확인이 필요한 줄이 ' + bad + '개 있습니다.</b> '
        + '그대로 내보내도 되지만 엑셀의 <b>검산</b> 열에 “확인필요”로 남습니다. '
        + 'ERP 에 올리기 전에 반드시 보세요.';
    } else { w.hidden = true; }

    var body = $('#rows tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="13" class="sub">읽은 부품이 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r, i) {
      var c = checked[i];
      if (onlyBad && c.ok) return '';
      return '<tr data-i="' + i + '" class="' + (c.ok ? '' : 'bad ') + (r._edited ? 'edited' : '') + '">'
        + '<td><button class="btn" data-del="' + i + '" style="min-height:24px;padding:0 7px;font-size:11.5px">삭제</button></td>'
        + '<td class="sub"' + (showHead ? '' : ' hidden') + '>' + esc(r.파일명) + '</td>'
        + cell(i, 'InvoiceNo', r.InvoiceNo, '', !showHead)
        + cell(i, '날짜', r.날짜 + (r.dateAmbiguous ? ' ⚠' : ''), '', !showHead)
        + cell(i, 'Supplier', r.Supplier, '', !showHead)
        + cell(i, '통화', r.통화, '', !showHead)
        + cell(i, 'PartNo', r.PartNo, 'mono')
        + cell(i, 'Description', r.Description, 'desc')
        + cell(i, 'Qty', r.Qty, 'num')
        + cell(i, 'UnitPrice', n2(r.UnitPrice), 'num')
        + cell(i, 'Amount', n2(r.Amount), 'num')
        + '<td class="chk">' + (c.ok
            ? '<b style="color:var(--ok)">OK</b>'
            : '<b style="color:var(--danger)">확인필요</b>'
              + '<div class="sub" style="white-space:normal">' + esc(c.why) + '</div>')
          + (r.guessed && !r._edited
              ? '<div class="sub" style="white-space:normal;color:var(--warn)">'
                + '자리 순서로 짐작한 값입니다 — 원본과 대조하세요</div>' : '') + '</td>'
        + '<td class="src">' + esc(r.읽은줄 || '') + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="13" class="sub">확인이 필요한 줄이 없습니다.</td></tr>';

    $$('#rows td[contenteditable]').forEach(function (td) {
      td.addEventListener('blur', onEdit);
      td.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
      });
    });
    $$('#rows [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-del'));
        var r = rows[i];
        // 표에서만 지우는 게 아니라 문서에서도 지워야 다시 그릴 때 되살아나지 않는다
        var d = docs.find(function (x) { return x.id === r._docId; });
        if (d) {
          var idx = Number(r._key.split(':')[1]);
          d.items.splice(idx, 1);
        }
        rebuildRows(); render();
      });
    });
  }

  function cell(i, field, val, cls, hidden) {
    return '<td contenteditable="true" data-i="' + i + '" data-f="' + field + '"'
      + (cls ? ' class="' + cls + '"' : '') + (hidden ? ' hidden' : '') + '>'
      + esc(val == null ? '' : val) + '</td>';
  }

  /**
   * 칸을 고쳤을 때.
   *
   * 수량이나 단가를 고치면 **금액을 다시 계산**한다 (기획서 4번).
   * 금액을 직접 고치면 그대로 두고 검산 결과만 바뀐다 —
   * 원본 Invoice 의 금액이 맞고 단가 표기가 반올림된 경우가 있어
   * 사람이 금액을 정답으로 삼을 수 있어야 한다.
   */
  function onEdit(e) {
    var td = e.target;
    var i = Number(td.getAttribute('data-i'));
    var f = td.getAttribute('data-f');
    var r = rows[i];
    if (!r) return;
    var text = td.textContent.trim();

    if (f === 'Qty' || f === 'UnitPrice' || f === 'Amount') {
      var vals = I.readNumber(text);
      if (!vals.length) {
        alert('숫자로 읽을 수 없습니다: ' + text);
        renderRows();
        return;
      }
      r[f] = vals[0];
      if (f === 'Qty' || f === 'UnitPrice') {
        r.Amount = Math.round(Number(r.Qty) * Number(r.UnitPrice) * 100) / 100;
      }
    } else if (f === '날짜') {
      var d = I.readDate(text);
      if (text && !d) { alert('날짜로 읽을 수 없습니다: ' + text); renderRows(); return; }
      r.날짜 = d ? d.text : '';
      r.dateAmbiguous = false;      // 사람이 정했으므로 더는 애매하지 않다
    } else {
      r[f] = text;
    }
    r._edited = true;
    renderRows();
  }

  /** 금액을 수량×단가로 일괄 정정 — 되돌릴 수 없으니 먼저 몇 줄인지 알린다 */
  function fixAll() {
    var targets = rows.filter(function (r) {
      return !I.checkRow({ qty: r.Qty, unitPrice: r.UnitPrice, amount: r.Amount }).ok
          && Number.isFinite(Number(r.Qty)) && Number.isFinite(Number(r.UnitPrice));
    });
    if (!targets.length) { alert('정정할 줄이 없습니다.'); return; }
    if (!confirm(targets.length + '줄의 금액을 수량 × 단가 값으로 바꿉니다.\n\n'
      + '⚠ 원본 Invoice 의 금액이 맞고 수량·단가를 잘못 읽은 경우라면\n'
      + '   오히려 틀린 값이 됩니다. 몇 줄이라도 원본과 대조한 뒤 쓰세요.\n\n계속할까요?')) return;
    targets.forEach(function (r) {
      r.Amount = Math.round(Number(r.Qty) * Number(r.UnitPrice) * 100) / 100;
      r._edited = true;
    });
    renderRows();
  }

  /* ═══════════════════════════════════════════════ 내보내기 */

  function outRows() {
    return rows.map(function (r) {
      var c = I.checkRow({ qty: r.Qty, unitPrice: r.UnitPrice, amount: r.Amount });
      return {
        파일명: r.파일명,
        읽은방식: r.engine,
        InvoiceNo: r.InvoiceNo,
        날짜: r.날짜,
        Supplier: r.Supplier,
        통화: r.통화,
        PONo: r.PONo || '',
        PartNo: r.PartNo,
        Description: r.Description,
        Qty: r.Qty,
        UnitPrice: r.UnitPrice,
        Amount: r.Amount,
        검산: c.ok ? 'OK' : '확인필요',
        비고: c.ok ? '' : c.why,
        짐작: (r.guessed && !r._edited) ? 'Y' : '',
        수정됨: r._edited ? 'Y' : '',
        읽은줄: r.읽은줄 || ''
      };
    });
  }

  function exportSheet(kind) {
    var data = outRows();
    if (!data.length) { alert('내보낼 줄이 없습니다.'); return; }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data);
    // 열 폭 — 안 주면 Description 이 잘려 보여 확인이 어렵다
    ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 22 }, { wch: 6 },
                   { wch: 12 }, { wch: 14 }, { wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 12 },
                   { wch: 9 }, { wch: 34 }, { wch: 6 }, { wch: 7 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Foreign_Parts_DB');
    var name = 'Foreign_Parts_DB-' + new Date().toISOString().slice(0, 10)
             + (kind === 'csv' ? '.csv' : '.xlsx');
    XLSX.writeFile(wb, name, kind === 'csv' ? { bookType: 'csv' } : undefined);
  }

  /* ═══════════════════════════════════════════════════ 예시 */

  var DEMO_A = [
    'HANWA STEEL CO., LTD.',
    '1-2-3 Marunouchi, Chiyoda-ku, Tokyo, Japan',
    '',
    'COMMERCIAL INVOICE',
    '',
    'Invoice No : HS-2026-0417',
    'Invoice Date : 04-Mar-2026',
    'P/O No : PO-77120',
    'Currency : USD',
    '',
    'Item   Part No        Description                   Qty    Unit Price      Amount',
    '1      HD-4412-A      HYDRAULIC SEAL KIT             20        45.50       910.00',
    '2      HD-7781-B      BEARING ASSY, MAIN SHAFT       12       128.75     1,545.00',
    '3      MT-0093        O-RING SET (NBR 70)           100         3.20       320.00',
    '4      HD-5520-C      PIN, TRACK LINK                48        27.35     1,312.80',
    '',
    '                                                   Sub Total              4,087.80',
    '                                                   Freight                  120.00',
    '                                                   TOTAL                  4,207.80'
  ].join('\n');

  var DEMO_B = [
    'MUELLER MASCHINENBAU GMBH',
    'Industriestrasse 14, 70565 Stuttgart',
    '',
    'RECHNUNG / INVOICE',
    'Invoice No: R-99120',
    'Date: 15/02/2026',
    'Currency: EUR',
    '',
    'Pos   Artikel        Bezeichnung           Preis       Menge        Betrag',
    '1     DIN-912-M8     Zylinderschraube    1.234,56        10     12.345,60',
    '2     DIN-125-A8     Scheibe A8              0,85       500        425,00',
    '3     HYD-4471       Hydraulikpumpe      2.480,00         2      4.960,00',
    '',
    '                                          Gesamt                17.730,60'
  ].join('\n');

  // 일부러 계산이 어긋난 줄을 넣는다 — 문자인식이 8 을 3 으로 읽은 상황을 흉내 낸다
  var DEMO_C = [
    'ASIA PARTS TRADING INC.',
    'INVOICE',
    'Invoice No. AP-26-0088',
    'Date 2026/01/22',
    'Currency USD',
    '',
    'No  Part Number   Desc                Qty   Unit Price   Amount',
    '1   AP-1120       FILTER ELEMENT       30        12.40    372.00',
    '2   AP-2240       GASKET, EXHAUST      15        88.00   1,020.00',
    '3   AP-3310       SENSOR, TEMP          6       145.00    870.00'
  ].join('\n');

  function runDemo() {
    addDoc('예시 A — 일본 공급사 (전자 PDF).pdf', '전자 PDF', DEMO_A);
    addDoc('예시 B — 독일 공급사 (유럽식 숫자).pdf', '전자 PDF', DEMO_B);
    addDoc('예시 C — 스캔본 (오인식 포함).pdf', '문자인식(OCR)', DEMO_C);
    var el = document.getElementById('docs');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
