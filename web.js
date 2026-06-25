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
  }

  if (typeof window.renderQuotes === 'function') {
    var _rq = window.renderQuotes;
    window.renderQuotes = function () { _rq.apply(this, arguments); try { applyQuoteCarousel(); } catch (e) {} };
  }

  document.addEventListener('DOMContentLoaded', function () { setActive('books'); });
})();
