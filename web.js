/* =========================================================
   북로그 — 웹 리디자인 동작 (데스크톱 에디토리얼)
   기존 sw() 패널 전환 재사용 + 사이드바 + 홈 히어로/오늘의 문장.
   ========================================================= */
(function () {
  function topTab(name) { return document.querySelector('.tab[onclick*="\'' + name + '\'"]'); }
  function setActive(p) { document.querySelectorAll('.ws-i').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); }); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  window.webNav = function (p) {
    var t = topTab(p);
    if (t && typeof sw === 'function') sw(p, t);
    setActive(p);
  };

  // 설정 톱니바퀴 메뉴
  window.toggleWebSettings = function (e) { if (e) e.stopPropagation(); var m = document.getElementById('ws-settings-menu'); if (m) m.classList.toggle('on'); };
  window.closeWebSettings = function () { var m = document.getElementById('ws-settings-menu'); if (m) m.classList.remove('on'); };
  document.addEventListener('click', function (e) {
    var m = document.getElementById('ws-settings-menu'), g = document.getElementById('ws-gear');
    if (m && m.classList.contains('on') && !m.contains(e.target) && g && !g.contains(e.target)) m.classList.remove('on');
  });

  function webStreak() {
    var days = new Set();
    (window.allBooks || []).forEach(function (b) {
      var log = b.reading_time_log;
      if (log && typeof log === 'object') Object.keys(log).forEach(function (d) { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (log[d] || 0) > 0) days.add(d); });
      if (b.status === '완독' && /^\d{4}-\d{2}-\d{2}$/.test(b.date_finish || '')) days.add(b.date_finish);
    });
    if (!days.size) return 0;
    var arr = [...days].sort(); var max = 1, cur = 1;
    for (var i = 1; i < arr.length; i++) { var diff = Math.round((new Date(arr[i] + 'T00:00:00') - new Date(arr[i - 1] + 'T00:00:00')) / 86400000); cur = diff === 1 ? cur + 1 : 1; if (cur > max) max = cur; }
    return max;
  }

  function renderWebHome() {
    var panel = document.getElementById('p-books');
    if (!panel) return;
    var hero = document.getElementById('web-hero');
    var quote = document.getElementById('web-quote');
    if (window.innerWidth < 880) { if (hero) hero.remove(); if (quote) quote.remove(); return; }

    // 이어 읽기 히어로
    var reading = (window.allBooks || []).filter(function (b) { return b.status === '읽는중'; });
    reading.sort(function (a, b) { return new Date(b.last_read || b.date_start || b.created_at || 0) - new Date(a.last_read || a.date_start || a.created_at || 0); });
    var b = reading[0];
    if (b) {
      var pct = (b.current_page && b.pages) ? Math.min(100, Math.round(b.current_page / b.pages * 100)) : 0;
      if (!hero) {
        hero = document.createElement('div'); hero.id = 'web-hero';
        var tb = panel.querySelector('.books-toolbar');
        if (tb && tb.nextSibling) panel.insertBefore(hero, tb.nextSibling); else panel.insertBefore(hero, panel.firstChild);
      }
      var cover = b.cover ? '<img src="' + b.cover + '" alt="">' : '<span>' + esc(b.title) + '</span>';
      hero.innerHTML = '<div class="wh-cover" data-go>' + cover + '</div><div class="wh-info">' +
        '<span class="wh-pill">이어 읽기</span><div class="wh-title" data-go>' + esc(b.title) + '</div>' +
        '<div class="wh-by">' + esc((b.author || '').split(/[,·]/)[0]) + (b.publisher ? ' · ' + esc(b.publisher) : '') + '</div>' +
        '<div class="wh-prog"><div class="wh-bar"><i style="width:' + pct + '%"></i></div><div class="wh-donut" style="--p:' + pct + '"><b>' + pct + '</b></div></div>' +
        '<button class="wh-btn" data-go><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> 이어서 기록</button></div>';
      hero.querySelectorAll('[data-go]').forEach(function (el) { el.onclick = function () { if (window.openDetail) openDetail(b.id); }; });
    } else if (hero) { hero.remove(); }

    // 오늘의 문장 (내가 저장한 문장 중 랜덤)
    var qs = (window.allQuotes || []);
    if (qs.length) {
      var qt = qs[Math.floor(Math.random() * qs.length)];
      var bk = (window.allBooks || []).find(function (x) { return x.id === qt.book_id; });
      var txt = (qt.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (txt.length > 160) txt = txt.slice(0, 160) + '…';
      if (!quote) { quote = document.createElement('div'); quote.id = 'web-quote'; panel.appendChild(quote); }
      var src = bk ? ('— ' + esc((bk.author || '').split(/[,·]/)[0]) + (bk.title ? ', 『' + esc(bk.title) + '』' : '')) : '';
      if (qt.page && String(qt.page) !== 'null') src += ' · p.' + esc(qt.page);
      quote.innerHTML = '<div class="wq-mark">&ldquo;</div><div><div class="wq-text">' + esc(txt) + '</div><div class="wq-src">' + src + '</div></div>';
    } else if (quote) { quote.remove(); }

    // 사이드바 통계
    var cy = String(new Date().getFullYear());
    var doneY = (window.allBooks || []).filter(function (b) { return b.status === '완독' && (b.date_finish || '').startsWith(cy); }).length;
    var d = document.getElementById('ws-stat-done'); if (d) d.textContent = doneY;
    var st = document.getElementById('ws-stat-streak'); if (st) st.textContent = webStreak();
  }

  if (typeof window.buildBooks === 'function') {
    var _bb = window.buildBooks;
    window.buildBooks = function () { _bb.apply(this, arguments); try { renderWebHome(); } catch (e) {} };
  }

  // ── 문장 수첩 캐러셀 (데스크톱 전용) ──
  var wqPage = 0;
  var WQ_CARD_W = 216; // px — web.css .qcard width와 동일하게
  var WQ_GAP = 14;
  var WQ_VISIBLE = 3;

  function wqStep() { return WQ_VISIBLE * (WQ_CARD_W + WQ_GAP); }

  function wqUpdateNav(total) {
    var maxPage = Math.max(0, Math.ceil(total / WQ_VISIBLE) - 1);
    var prev = document.getElementById('wq-prev');
    var next = document.getElementById('wq-next');
    if (prev) prev.disabled = wqPage <= 0;
    if (next) next.disabled = wqPage >= maxPage;
  }

  function wqScroll(dir) {
    var track = document.getElementById('wq-track');
    if (!track) return;
    var total = track.querySelectorAll('.qcard').length;
    var maxPage = Math.max(0, Math.ceil(total / WQ_VISIBLE) - 1);
    wqPage = Math.max(0, Math.min(wqPage + dir, maxPage));
    track.style.transform = 'translateX(-' + (wqPage * wqStep()) + 'px)';
    wqUpdateNav(total);
  }

  function applyQuoteCarousel() {
    if (window.innerWidth < 880) return;
    var feed = document.getElementById('q-feed');
    if (!feed) return;
    // 빈 상태(empty-state)면 캐러셀 적용 안 함
    var cards = Array.from(feed.querySelectorAll(':scope > .qcard'));
    if (!cards.length) return;

    wqPage = 0;
    feed.innerHTML = ''; // 기존 카드 보관 후 재삽입

    var carousel = document.createElement('div');
    carousel.className = 'wq-carousel';

    var prev = document.createElement('button');
    prev.className = 'wq-nav'; prev.id = 'wq-prev';
    prev.innerHTML = '&#8249;'; prev.title = '이전';
    prev.onclick = function () { wqScroll(-1); };

    var trackWrap = document.createElement('div');
    trackWrap.className = 'wq-track-wrap';

    var track = document.createElement('div');
    track.className = 'wq-track'; track.id = 'wq-track';
    cards.forEach(function (c) { track.appendChild(c); });

    var next = document.createElement('button');
    next.className = 'wq-nav'; next.id = 'wq-next';
    next.innerHTML = '&#8250;'; next.title = '다음';
    next.onclick = function () { wqScroll(1); };

    trackWrap.appendChild(track);
    carousel.appendChild(prev);
    carousel.appendChild(trackWrap);
    carousel.appendChild(next);
    feed.appendChild(carousel);

    wqUpdateNav(cards.length);
    try { restructureWebQuoteCards(); } catch(e) {}
  }

  // 문장 카드 DOM 재구성: 책표지+제목+저자 → 상단 / 텍스트 중간 / 페이지+태그 → 하단
  function restructureWebQuoteCards() {
    var track = document.getElementById('wq-track');
    if (!track) return;
    track.querySelectorAll('.qcard').forEach(function(card) {
      if (card.dataset.wstyled) return;
      card.dataset.wstyled = '1';
      var inner = card.querySelector('.qcard-inner');
      if (!inner) return;

      // qcard-inner의 직접 자식 div들: [0] 인용문 섹션, [1] 출처 섹션
      var innerDivs = Array.from(inner.querySelectorAll(':scope > div'));
      var sourceDiv = innerDivs[1];
      if (!sourceDiv) return;

      // 출처 섹션에서 데이터 추출
      var coverImg = sourceDiv.querySelector('img');
      var titleEl = sourceDiv.querySelector('.qcard-book');
      var authorEl = sourceDiv.querySelector('.qcard-author');
      var pageChipEl = sourceDiv.querySelector('.qcard-chip:not(.qcard-tag)');
      var tagChipEl = sourceDiv.querySelector('.qcard-tag');

      var titleText = titleEl ? titleEl.textContent : '';
      var authorText = (authorEl ? authorEl.textContent : '').replace(/^\s*[—\-]\s*/, '');
      var pageText = pageChipEl ? pageChipEl.textContent : '';
      var tagText = tagChipEl ? tagChipEl.textContent : '';

      // 북 헤더 생성
      var header = document.createElement('div');
      header.className = 'wq-bh';

      if (coverImg) {
        var cw = document.createElement('div');
        cw.className = 'wq-bc';
        var ci = document.createElement('img');
        ci.src = coverImg.src; ci.alt = '';
        cw.appendChild(ci);
        header.appendChild(cw);
      }

      var meta = document.createElement('div');
      meta.className = 'wq-bm';
      if (titleText) {
        var bt = document.createElement('div');
        bt.className = 'wq-bt';
        bt.textContent = titleText;
        meta.appendChild(bt);
      }
      if (authorText) {
        var ba = document.createElement('div');
        ba.className = 'wq-ba';
        ba.textContent = authorText;
        meta.appendChild(ba);
      }
      header.appendChild(meta);

      // 출처 섹션 제거 후 헤더 삽입 (인용문 섹션 앞에)
      inner.removeChild(sourceDiv);
      var quoteSection = inner.querySelector(':scope > div');
      inner.insertBefore(header, quoteSection);

      // 푸터 생성 (페이지 + 태그)
      if (pageText || tagText) {
        var footer = document.createElement('div');
        footer.className = 'wq-bf';
        if (pageText) {
          var pc = document.createElement('span');
          pc.className = 'qcard-chip';
          pc.textContent = pageText;
          footer.appendChild(pc);
        }
        if (tagText) {
          var tc = document.createElement('span');
          tc.className = 'qcard-chip qcard-tag';
          tc.textContent = tagText;
          footer.appendChild(tc);
        }
        inner.appendChild(footer);
      }
    });
  }

  if (typeof window.renderQuotes === 'function') {
    var _rq = window.renderQuotes;
    window.renderQuotes = function () { _rq.apply(this, arguments); try { applyQuoteCarousel(); } catch (e) {} };
  }

  /* ════════ 통계·기록 에디토리얼 (도넛 게이지 + 컬러 카드 + 둥근 막대) ════════ */
  // allBooks/allQuotes/goals는 let 전역 → window.가 아니라 bare로 접근
  function isWeb() { return window.innerWidth >= 880; }
  function B() { try { return (typeof allBooks !== 'undefined' && allBooks) || []; } catch (e) { return []; } }
  function Q() { try { return (typeof allQuotes !== 'undefined' && allQuotes) || []; } catch (e) { return []; } }
  function G() { try { return (typeof goals !== 'undefined' && goals) || {}; } catch (e) { return {}; } }
  function streakFromBooks() {
    var days = new Set();
    B().forEach(function (b) {
      var log = b.reading_time_log;
      if (log && typeof log === 'object') Object.keys(log).forEach(function (d) { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (log[d] || 0) > 0) days.add(d); });
      if (b.status === '완독' && /^\d{4}-\d{2}-\d{2}$/.test(b.date_finish || '')) days.add(b.date_finish);
    });
    if (!days.size) return 0;
    var arr = [...days].sort(); var max = 1, cur = 1;
    for (var i = 1; i < arr.length; i++) { var diff = Math.round((new Date(arr[i] + 'T00:00:00') - new Date(arr[i - 1] + 'T00:00:00')) / 86400000); cur = diff === 1 ? cur + 1 : 1; if (cur > max) max = cur; }
    return max;
  }

  function renderWebStats() {
    var panel = document.getElementById('p-graph');
    if (!panel) return;
    var host = document.getElementById('web-stats');
    if (!isWeb()) { if (host) host.remove(); return; }

    var books = B(), quotes = Q(), g = G();
    var cy = new Date().getFullYear(), cyS = String(cy);
    var done = books.filter(function (b) { return b.status === '완독'; });
    var doneY = done.filter(function (b) { return (b.date_finish || '').startsWith(cyS); });

    var minsY = books.reduce(function (s, b) {
      var log = b.reading_time_log;
      if (log && typeof log === 'object') {
        var ls = Object.keys(log).filter(function (d) { return d.indexOf(cyS) === 0; }).reduce(function (a, d) { return a + (log[d] || 0); }, 0);
        if (ls > 0) return s + ls;
      }
      var yv = b.reading_time_year && (b.reading_time_year[cyS] || b.reading_time_year[cy]);
      if (yv > 0) return s + yv;
      return s;
    }, 0);
    var pagesY = books.reduce(function (a, b) {
      if (b.status === '완독' && (b.date_finish || '').startsWith(cyS)) return a + (b.pages || 0);
      if (b.status === '읽는중') return a + (b.current_page || 0);
      return a;
    }, 0);
    var quotesY = quotes.filter(function (q) { return (q.created_at || '').startsWith(cyS); }).length;
    var avg = done.length ? done.reduce(function (a, b) { return a + (b.rating || 0); }, 0) / done.length : 0;
    var streak = streakFromBooks();

    var goalBooks = g.books || 0, goalMin = g.minutes || 0;
    var ringPct;
    if (goalBooks > 0) {
      ringPct = Math.min(100, Math.round(doneY.length / goalBooks * 100));
    } else {
      var byYear = {}; done.forEach(function (b) { var y = (b.date_finish || '').slice(0, 4); if (y) byYear[y] = (byYear[y] || 0) + 1; });
      var mx = Math.max.apply(null, [1].concat(Object.keys(byYear).map(function (k) { return byYear[k]; })));
      ringPct = Math.min(100, Math.round(doneY.length / mx * 100));
    }

    var minVal = minsY >= 60 ? Math.floor(minsY / 60) : minsY;
    var minSuf = minsY >= 60 ? '시간' : (minsY > 0 ? '분' : '');
    var cards = [
      { cls: 'c-sage', n: doneY.length, suf: '권', l: '올해 완독', p: ringPct },
      { cls: 'c-clay', n: minVal, suf: minSuf, l: '올해 독서시간', p: goalMin ? Math.min(100, Math.round(minsY / goalMin * 100)) : Math.min(100, Math.round(minsY / 3000 * 100)) },
      { cls: 'c-gold', n: avg ? avg.toFixed(1) : '—', suf: '', l: '평점 평균', p: Math.round(avg / 5 * 100) },
      { cls: 'c-mauve', n: streak || '—', suf: streak ? '일' : '', l: '최장 연속', p: Math.min(100, Math.round((streak || 0) / 30 * 100)) }
    ];

    var subText = goalBooks
      ? ('올해 목표 ' + goalBooks + '권 중 ' + ringPct + '% 달성 · 누적 ' + done.length + '권')
      : ('누적 ' + done.length + '권 · 올해 ' + pagesY.toLocaleString() + 'p · 문장 ' + quotesY + '개');

    var html = '<div class="wst-hero">' +
      '<div class="wst-ring" style="--p:' + ringPct + '"><b>' + doneY.length + '</b><i>완독</i></div>' +
      '<div class="wst-hbody">' +
        '<div class="wst-eyebrow">' + cy + ' 독서 현황</div>' +
        '<div class="wst-headline">올해 <b>' + doneY.length + '</b>권을 읽었어요</div>' +
        '<div class="wst-sub">' + subText + '</div>' +
        '<button class="wst-goal-btn" onclick="window.openGoalModal&&openGoalModal()">목표 ' + (goalBooks ? '편집' : '설정') + '</button>' +
      '</div></div>' +
      '<div class="wst-cards">' + cards.map(function (c) {
        return '<div class="wst-card ' + c.cls + '">' +
          '<div class="wst-cn">' + c.n + (c.suf ? '<span>' + c.suf + '</span>' : '') + '</div>' +
          '<div class="wst-cl">' + c.l + '</div></div>';
      }).join('') + '</div>';

    if (!host) {
      host = document.createElement('div'); host.id = 'web-stats';
      var hdr = panel.firstElementChild;
      if (hdr && hdr.nextSibling) panel.insertBefore(host, hdr.nextSibling); else panel.insertBefore(host, panel.firstChild);
    }
    host.innerHTML = html;
  }

  // 요일별 뚜렷한 색 (일~토) — 가시성 확보
  var WEEK_COLORS = ['#c4704a', '#56788a', '#6f8f56', '#c79a3e', '#8a6890', '#4f9e93', '#b5481f'];

  function renderWebRecord() {
    var panel = document.getElementById('p-record');
    if (!panel) return;
    if (!isWeb()) { var h0 = document.getElementById('web-week'); if (h0) h0.remove(); return; }

    var books = B();
    var DOW = ['일', '월', '화', '수', '목', '금', '토'];
    var today = new Date();
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      days.push({ key: key, dow: DOW[dt.getDay()], gd: dt.getDay(), mins: 0, today: i === 0 });
    }
    books.forEach(function (b) {
      var log = b.reading_time_log;
      if (log && typeof log === 'object') days.forEach(function (d) { d.mins += (log[d.key] || 0); });
    });
    var total = days.reduce(function (a, d) { return a + d.mins; }, 0);
    var max = Math.max.apply(null, [1].concat(days.map(function (d) { return d.mins; })));
    var avg = total / 7;

    var bars = days.map(function (d) {
      var h = d.mins > 0 ? Math.max(6, Math.round(d.mins / max * 100)) : 0;
      var lbl = d.mins > 0 ? (d.mins >= 60 ? Math.floor(d.mins / 60) + 'h' + (d.mins % 60 || '') : d.mins + '분') : '';
      var bar = d.mins > 0
        ? '<div class="ww-bar" style="height:' + h + '%;background:' + WEEK_COLORS[d.gd] + '"></div>'
        : '<div class="ww-bar ww-empty"></div>';
      return '<div class="ww-col' + (d.today ? ' ww-today' : '') + '"><div class="ww-val">' + lbl + '</div>' +
        '<div class="ww-bar-wrap">' + bar + '</div>' +
        '<div class="ww-dow">' + d.dow + '</div></div>';
    }).join('');
    var avgPct = Math.min(92, Math.round(avg / max * 100));
    var sum = total >= 60 ? Math.floor(total / 60) + '시간 ' + (total % 60) + '분' : total + '분';

    var html = '<div class="ww-head"><span class="ww-title">이번 주 독서</span>' +
      '<span class="ww-sum">' + sum + ' · 일평균 ' + Math.round(avg) + '분</span></div>' +
      '<div class="ww-chart">' + (total > 0 ? '<div class="ww-avg" style="bottom:' + avgPct + '%"></div>' : '') + bars + '</div>';

    // 타이머 카드 바로 아래로 배치 (기존 '이 주의 통계' 자리 대체)
    var host = document.getElementById('web-week');
    if (!host) {
      host = document.createElement('div'); host.id = 'web-week';
      var timer = panel.querySelector('.record-timer-card');
      if (timer && timer.parentNode) {
        if (timer.nextSibling) timer.parentNode.insertBefore(host, timer.nextSibling);
        else timer.parentNode.appendChild(host);
      } else {
        var rt = panel.querySelector('.record-top'); if (rt) panel.insertBefore(host, rt); else panel.appendChild(host);
      }
    }
    host.innerHTML = html;

    // 트래커 헤더 오른쪽에 '자세히' 버튼 주입 (1회) — 누르면 책등 스택 모달
    var grid = document.getElementById('timer-tracker-grid');
    if (grid) {
      var card = grid.closest('.card');
      var seg = card && card.querySelector('.tracker-period-btn');
      var segRow = seg && seg.parentNode;
      if (segRow && !segRow.querySelector('.wt-more')) {
        var btn = document.createElement('button');
        btn.className = 'wt-more';
        btn.innerHTML = '📚 자세히';
        btn.onclick = openWebTrackerModal;
        segRow.appendChild(btn);
      }
    }
  }

  /* 트래커 '자세히' — 해당 기간(주/월/연)에 읽은 책을 '책등(spine) 스택'으로 */
  function openWebTrackerModal() {
    function pad(n) { return String(n).padStart(2, '0'); }
    function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    var P = (typeof timerPeriod !== 'undefined' && timerPeriod) || 'month';
    var TY = (typeof timerTrackY !== 'undefined') ? timerTrackY : new Date().getFullYear();
    var TM = (typeof timerTrackM !== 'undefined') ? timerTrackM : new Date().getMonth();
    var today = new Date();

    var from, to, label;
    if (P === 'week') {
      var off = window._timerWeekOffset || 0;
      var sun = new Date(today); sun.setDate(today.getDate() - today.getDay() + off * 7);
      var sat = new Date(sun); sat.setDate(sun.getDate() + 6);
      from = keyOf(sun); to = keyOf(sat);
      label = (sun.getMonth() + 1) + '월 ' + Math.ceil(sun.getDate() / 7) + '주 · 이번 주';
    } else if (P === 'year') {
      from = TY + '-01-01'; to = TY + '-12-31'; label = TY + '년';
    } else {
      var last = new Date(TY, TM + 1, 0).getDate();
      from = TY + '-' + pad(TM + 1) + '-01'; to = TY + '-' + pad(TM + 1) + '-' + pad(last);
      label = TY + '년 ' + (TM + 1) + '월';
    }

    function minsInRange(b) {
      var l = b.reading_time_log, s = 0;
      if (l && typeof l === 'object') Object.keys(l).forEach(function (d) { if (d >= from && d <= to && (l[d] || 0) > 0) s += l[d]; });
      return s;
    }
    // '그날(기간) 실제로 읽은 책' = 그 기간 reading_time_log에 시간이 잡힌 책 우선
    var rows = [];
    B().forEach(function (b) {
      var m = minsInRange(b);
      var finishedIn = (b.date_finish || '') >= from && (b.date_finish || '') <= to && (b.date_finish || '') !== '';
      if (m <= 0 && !finishedIn) return;
      rows.push({ title: b.title || '(제목 없음)', author: (b.author || '').split(/[,·]/)[0], pages: b.pages || 0, status: b.status, mins: m, finished: finishedIn });
    });
    // 많이 읽은(시간) 책이 위로
    rows.sort(function (a, b) { return (b.mins - a.mins) || (b.pages - a.pages); });

    var PALETTE = ['#b5481f', '#6f8f56', '#56788a', '#c79a3e', '#8a6890', '#4f9e93', '#a85a86', '#7a8b3a'];
    var maxMins = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.mins; })));
    // 두께(높이)·길이(너비) 모두 '읽은 시간'에 비례
    function spineH(mins) { return Math.round(28 + (mins / maxMins) * 32); }      // 28~60px
    function spineW(mins) { return Math.round(70 + (mins / maxMins) * 30); }      // 70~100%

    var totalMins = rows.reduce(function (a, r) { return a + r.mins; }, 0);
    var body;
    if (!rows.length) {
      body = '<div class="wt-empty">이 기간에 읽은 책이 없어요.<br>타이머로 기록하면 읽은 만큼 책등이 두꺼워져요.</div>';
    } else {
      var stack = rows.map(function (r, i) {
        var col = PALETTE[i % PALETTE.length];
        var meta = r.mins > 0 ? (r.mins >= 60 ? Math.floor(r.mins / 60) + 'h ' + (r.mins % 60) + 'm' : r.mins + 'm') : (r.finished ? '완독' : '');
        return '<div class="bs-spine" style="height:' + spineH(r.mins) + 'px;width:' + spineW(r.mins) + '%;background:' + col + '" title="' + esc(r.title) + (r.author ? ' · ' + esc(r.author) : '') + '">' +
          '<span class="bs-cap"></span>' +
          '<span class="bs-title">' + esc(r.title) + '</span>' +
          '<span class="bs-meta">' + meta + '</span></div>';
      }).join('');
      body = '<div class="bs-stack">' + stack + '</div>';
    }

    var sub = rows.length
      ? (rows.length + '권 · ' + (totalMins >= 60 ? Math.floor(totalMins / 60) + '시간 ' + (totalMins % 60) + '분' : totalMins + '분'))
      : '읽은 책 없음';

    var ov = document.getElementById('web-tracker-modal');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'web-tracker-modal'; ov.className = 'wt-overlay';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('on'); });
    }
    ov.innerHTML = '<div class="wt-drawer">' +
      '<div class="wt-mhead"><div><div class="wt-mtitle">' + label + '에 읽은 책</div>' +
      '<div class="wt-msub">' + sub + '</div></div>' +
      '<button class="wt-close" aria-label="닫기">✕</button></div>' +
      '<div class="wt-body">' + body + '</div></div>';
    ov.querySelector('.wt-close').onclick = function () { ov.classList.remove('on'); };
    // 다음 프레임에 .on 부여 → 오른쪽에서 스르륵 슬라이드 인
    requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('on'); }); });
  }

  if (typeof window.buildStats === 'function') {
    var _bs = window.buildStats;
    window.buildStats = function () { var r = _bs.apply(this, arguments); try { renderWebStats(); } catch (e) {} return r; };
  }
  if (typeof window.renderCal === 'function') {
    var _rc = window.renderCal;
    window.renderCal = function () { var r = _rc.apply(this, arguments); try { renderWebRecord(); } catch (e) {} return r; };
  }

  document.addEventListener('DOMContentLoaded', function () { setActive('books'); });
})();
