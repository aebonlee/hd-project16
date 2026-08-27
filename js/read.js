/**
 * read.js — PDF 에서 글자를 꺼낸다 (이중 엔진)
 *
 * Invoice 는 두 종류로 온다.
 *   ① 전자 PDF — 글자가 파일 안에 그대로 들어 있다. 빠르고 정확하다.
 *   ② 스캔본   — 종이를 찍은 그림이다. 글자가 없어 **읽을 것이 없다.**
 *
 * 그래서 먼저 ①로 시도하고, 나온 글자가 없으면 ②(문자인식)로 넘어간다.
 *
 * ⚠ **어느 엔진으로 읽었는지 반드시 남긴다.**
 *   문자인식으로 읽은 값은 전자 PDF 보다 훨씬 잘 틀린다. 8 을 3 으로, 0 을 O 로 읽는다.
 *   그런데 화면에 나온 모양은 똑같다. 어느 쪽인지 모르면 사람이 어디를 더 봐야 할지 알 수 없다.
 */
(function (root) {
  'use strict';

  function libUrl(name) { return new URL('lib/' + name, document.baseURI).href; }

  /** 한 페이지의 글자 조각을 줄로 묶는다 */
  function itemsToLines(items) {
    // y 좌표가 비슷한 것끼리 한 줄. 안 묶으면 낱말이 다 흩어져 표를 못 읽는다.
    var lines = {};
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5]);
      // 1~2px 차이는 같은 줄로 본다 (같은 줄인데 미세하게 어긋나는 일이 흔하다)
      var key = Object.keys(lines).find(function (k) { return Math.abs(k - y) <= 2; });
      (lines[key === undefined ? y : key] = lines[key === undefined ? y : key] || [])
        .push({ x: it.transform[4], s: it.str });
    });
    return Object.keys(lines).sort(function (a, b) { return b - a; })
      .map(function (y) {
        var row = lines[y].sort(function (a, b) { return a.x - b.x; });
        // 가로로 많이 떨어져 있으면 칸이 나뉜 것 — 공백을 넉넉히 넣어 열을 살린다
        var out = '', prevEnd = null;
        row.forEach(function (o) {
          if (prevEnd !== null && o.x - prevEnd > 6) out += '   ';
          else if (out && !/\s$/.test(out)) out += ' ';
          out += o.s;
          prevEnd = o.x + o.s.length * 4.6;   // 글자폭 어림 — 칸 구분에만 쓴다
        });
        return out;
      }).join('\n');
  }

  /** 전자 PDF 에서 글자 꺼내기 */
  function digital(file) {
    return file.arrayBuffer().then(function (buf) {
      return import(libUrl('pdf.min.mjs')).then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = libUrl('pdf.worker.min.mjs');
        return pdfjs.getDocument({
          data: buf,
          // 글꼴이 문서에 안 박혀 있으면 cMap 없이는 **빈 글자**가 나온다.
          // 이걸 모르면 "전자 PDF 인데 안 읽힌다" 로 오해해 엉뚱한 곳을 고치게 된다.
          cMapUrl: libUrl('cmaps/'), cMapPacked: true
        }).promise;
      }).then(function (doc) {
        var jobs = [];
        for (var i = 1; i <= doc.numPages; i++) {
          jobs.push(doc.getPage(i).then(function (p) {
            return p.getTextContent().then(function (tc) { return itemsToLines(tc.items); });
          }));
        }
        return Promise.all(jobs).then(function (pages) {
          return { text: pages.join('\n'), pages: doc.numPages, doc: doc, pdfjs: null };
        });
      });
    });
  }

  /** PDF 페이지를 그림으로 그려 문자인식에 넘긴다 */
  function renderPages(file, scale, onPage) {
    return file.arrayBuffer().then(function (buf) {
      return import(libUrl('pdf.min.mjs')).then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = libUrl('pdf.worker.min.mjs');
        return pdfjs.getDocument({ data: buf, cMapUrl: libUrl('cmaps/'), cMapPacked: true }).promise;
      }).then(function (doc) {
        var chain = Promise.resolve();
        for (var i = 1; i <= doc.numPages; i++) {
          (function (n) {
            chain = chain.then(function () {
              return doc.getPage(n).then(function (page) {
                // 문자인식은 해상도가 낮으면 확 나빠진다. 2배로 그린다.
                var vp = page.getViewport({ scale: scale || 2 });
                var cv = document.createElement('canvas');
                cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
                return page.render({ canvasContext: cv.getContext('2d'), viewport: vp })
                  .promise.then(function () { return onPage(cv, n, doc.numPages); });
              });
            });
          })(i);
        }
        return chain;
      });
    });
  }

  var worker = null;

  /** 문자인식 — 무거우므로 한 번 만들어 두고 다시 쓴다 */
  function ocrWorker(onProgress) {
    if (worker) return Promise.resolve(worker);
    return Tesseract.createWorker('eng', 1, {
      workerPath: libUrl('worker.min.js'),
      corePath: libUrl('core'),
      langPath: libUrl('tessdata'),
      logger: function (m) {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      }
    }).then(function (w) {
      return w.setParameters({
        // Invoice 는 표라서 줄 구조를 살리는 편이 낫다
        tessedit_pageseg_mode: '6'
      }).then(function () { worker = w; return w; });
    });
  }

  function ocr(file, onProgress) {
    return ocrWorker(onProgress).then(function (w) {
      var texts = [];
      return renderPages(file, 2, function (canvas, n, total) {
        if (onProgress) onProgress(0, n, total);
        return w.recognize(canvas).then(function (r) { texts.push(r.data.text); });
      }).then(function () { return { text: texts.join('\n'), pages: texts.length }; });
    });
  }

  /**
   * 읽는다. 전자 PDF 를 먼저 시도하고, 글자가 없으면 문자인식으로 넘어간다.
   *
   * "글자가 없다"의 기준을 페이지당 글자 수로 잡는다.
   * 스캔본에도 머리말 몇 글자가 박혀 있는 경우가 있어서 0 으로 잡으면 안 걸린다.
   */
  function readPdf(file, opts) {
    var o = opts || {};
    return digital(file).then(function (d) {
      var perPage = d.text.replace(/\s/g, '').length / Math.max(d.pages, 1);
      if (perPage >= 60 && !o.forceOcr) {
        return { text: d.text, engine: '전자 PDF', pages: d.pages };
      }
      if (o.onNeedOcr) o.onNeedOcr(perPage);
      return ocr(file, o.onProgress).then(function (r) {
        return { text: r.text, engine: '문자인식(OCR)', pages: r.pages,
                 note: o.forceOcr ? '' : '글자가 거의 없어 스캔본으로 보고 문자인식으로 읽었습니다.' };
      });
    });
  }

  /** CSV·엑셀도 받는다 — 공급사가 표로 보내오는 경우가 있다 */
  function readSheet(file) {
    return file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      return {
        text: wb.SheetNames.map(function (n) {
          return XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: '   ' });
        }).join('\n'),
        engine: '엑셀/CSV', pages: wb.SheetNames.length
      };
    });
  }

  function readAny(file, opts) {
    if (/\.pdf$/i.test(file.name)) return readPdf(file, opts);
    if (/\.(csv|xlsx|xls)$/i.test(file.name)) return readSheet(file);
    if (/\.(png|jpe?g|tiff?|bmp|webp)$/i.test(file.name)) {
      return ocrWorker(opts && opts.onProgress).then(function (w) {
        return w.recognize(file).then(function (r) {
          return { text: r.data.text, engine: '문자인식(OCR)', pages: 1 };
        });
      });
    }
    return Promise.reject(new Error('읽을 수 없는 형식입니다: ' + file.name));
  }

  root.Read = { readAny: readAny, readPdf: readPdf, readSheet: readSheet,
                itemsToLines: itemsToLines };
})(typeof self !== 'undefined' ? self : this);
