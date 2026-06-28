/* =========================================================
   북로그 — 웹 리디자인 동작 (데스크톱 에디토리얼)
   기존 sw() 패널 전환 재사용 + 사이드바 + 홈 히어로/오늘의 문장.
   ========================================================= */
(function () {
  function topTab(name) { return document.querySelector('.tab[onclick*="\'' + name + '\'"]'); }
  function setActive(p) { document.querySelectorAll('.ws-i').forEach(function (b) { b.classList.toggle('on', b.dataset.p === p); }); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var _todayQuote = null; // 오늘의 문장 캐시 (세션 동안 고정)

  window.webNav = function (p) {
    var t = topTab(p);
    if (t && typeof sw === 'function') sw(p, t);
    setActive(p);
    closeWebSide(); // 모바일 드로어면 닫기
  };

  // 모바일 사이드바 드로어 토글
  function openWebSide() { var s = document.querySelector('.web-side'), b = document.getElementById('ws-backdrop'); if (s) s.classList.add('open'); if (b) b.classList.add('on'); }
  function closeWebSide() { var s = document.querySelector('.web-side'), b = document.getElementById('ws-backdrop'); if (s) s.classList.remove('open'); if (b) b.classList.remove('on'); }
  window.toggleWebSide = function () { var s = document.querySelector('.web-side'); if (s && s.classList.contains('open')) closeWebSide(); else openWebSide(); };
  window.closeWebSide = closeWebSide;

  // 설정 톱니바퀴 메뉴
  window.toggleWebSettings = function (e) { if (e) e.stopPropagation(); var m = document.getElementById('ws-settings-menu'); if (m) m.classList.toggle('on'); };
  window.closeWebSettings = function () { var m = document.getElementById('ws-settings-menu'); if (m) m.classList.remove('on'); };
  document.addEventListener('click', function (e) {
    var m = document.getElementById('ws-settings-menu'), g = document.getElementById('ws-gear');
    if (m && m.classList.contains('on') && !m.contains(e.target) && g && !g.contains(e.target)) m.classList.remove('on');
  });

  function webStreak() {
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

  function renderWebHome() {
    var panel = document.getElementById('p-books');
    if (!panel) return;
    var hero = document.getElementById('web-hero');
    var quote = document.getElementById('web-quote');
    if (window.innerWidth < 880) { if (hero) hero.remove(); if (quote) quote.remove(); return; }

    // 이어 읽기 히어로
    var reading = B().filter(function (b) { return b.status === '읽는중'; });
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

    // 오늘의 문장 — 한 번만 뽑아 고정(매 렌더 랜덤 → 깜빡임 방지). 빈 값이어도 캐시 유지
    var qs = Q();
    if (qs.length && !_todayQuote) _todayQuote = qs[Math.floor(Math.random() * qs.length)];
    if (_todayQuote) {
      var qt = _todayQuote;
      var bk = B().find(function (x) { return x.id === qt.book_id; });
      var txt = (qt.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (txt.length > 160) txt = txt.slice(0, 160) + '…';
      if (!quote) { quote = document.createElement('div'); quote.id = 'web-quote'; }
      var src = bk ? ('— ' + esc((bk.author || '').split(/[,·]/)[0]) + (bk.title ? ', 『' + esc(bk.title) + '』' : '')) : '';
      if (qt.page && String(qt.page) !== 'null') src += ' · p.' + esc(qt.page);
      quote.innerHTML = '<div class="wq-mark">&ldquo;</div><div><div class="wq-text">' + esc(txt) + '</div><div class="wq-src">' + src + '</div></div>';
      // 갤러리 위(이어읽기 다음)에 배치 — 갤러리는 #view-gallery 안에 있어 그 앞에 삽입
      var galWrap = document.getElementById('view-gallery');
      if (galWrap && galWrap.parentNode === panel) {
        if (quote.nextElementSibling !== galWrap) panel.insertBefore(quote, galWrap);
      } else if (quote.parentNode !== panel) {
        panel.appendChild(quote);
      }
    } else if (quote) { quote.remove(); }

    // 사이드바 통계
    var cy = String(new Date().getFullYear());
    var doneY = B().filter(function (b) { return b.status === '완독' && (b.date_finish || '').startsWith(cy); }).length;
    var d = document.getElementById('ws-stat-done'); if (d) d.textContent = doneY;
    var st = document.getElementById('ws-stat-streak'); if (st) st.textContent = webStreak();
  }

  // 사이드바 프로필 동그라미에 실제 아바타(사진/이니셜) 반영
  var _avLoaded = false;
  function renderSidebarAvatar() {
    try {
      if (_avLoaded) return;
      var av = document.getElementById('ws-avatar'); if (!av) return;
      if (typeof currentUser === 'undefined' || !currentUser || typeof sb === 'undefined') return;
      _avLoaded = true;
      sb.from('profiles').select('avatar_url,display_name,username').eq('id', currentUser.id).single().then(function (res) {
        var p = res && res.data;
        var name = (p && (p.display_name || p.username)) || ((currentUser.email || '').split('@')[0]) || '?';
        var url = p && p.avatar_url;
        if (url) av.innerHTML = '<img src="' + String(url).replace(/"/g, '%22') + '" alt="">';
        else av.innerHTML = '<span style="font-family:var(--fs);font-size:1rem;color:#5a4500;">' + esc(name.slice(0, 1).toUpperCase()) + '</span>';
      }).catch(function () { _avLoaded = false; });
    } catch (e) { _avLoaded = false; }
  }
  window.refreshSidebarAvatar = function () { _avLoaded = false; renderSidebarAvatar(); };

  if (typeof window.buildBooks === 'function') {
    var _bb = window.buildBooks;
    window.buildBooks = function () { _bb.apply(this, arguments); try { renderWebHome(); } catch (e) {} try { renderSidebarAvatar(); } catch (e) {} };
  }

  // ── 문장 수첩 캐러셀 (데스크톱 전용) ──
  var wqPage = 0;
  var WQ_CARD_W = 216; // px — web.css .qcard width와 동일하게
  var WQ_GAP = 14;
  var WQ_VISIBLE = 3;

  function wqVisible() { return window.innerWidth < 880 ? 1 : WQ_VISIBLE; } // 모바일은 1장씩
  function wqStep() {
    var track = document.getElementById('wq-track');
    var first = track && track.querySelector('.qcard');
    var cw = first ? first.offsetWidth : WQ_CARD_W;
    return wqVisible() * (cw + WQ_GAP);
  }

  function wqUpdateNav(total) {
    var maxPage = Math.max(0, Math.ceil(total / wqVisible()) - 1);
    var prev = document.getElementById('wq-prev');
    var next = document.getElementById('wq-next');
    if (prev) prev.disabled = wqPage <= 0;
    if (next) next.disabled = wqPage >= maxPage;
  }

  function wqScroll(dir) {
    var track = document.getElementById('wq-track');
    if (!track) return;
    var total = track.querySelectorAll('.qcard').length;
    var maxPage = Math.max(0, Math.ceil(total / wqVisible()) - 1);
    wqPage = Math.max(0, Math.min(wqPage + dir, maxPage));
    track.style.transform = 'translateX(-' + (wqPage * wqStep()) + 'px)';
    wqUpdateNav(total);
  }

  function applyQuoteCarousel() {
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
    // 완독은 위 링에 있으니 카드는 3개 (독서시간/평점/최장연속)
    var cards = [
      { cls: 'c-clay', n: minVal, suf: minSuf, l: '올해 독서시간' },
      { cls: 'c-gold', n: avg ? avg.toFixed(1) : '—', suf: '', l: '평점 평균' },
      { cls: 'c-mauve', n: streak || '—', suf: streak ? '일' : '', l: '최장 연속' }
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
      if (segRow && !segRow.querySelector('.wt-cap')) {
        var cap = document.createElement('button');
        cap.className = 'wt-cap';
        cap.innerHTML = '📸';
        cap.title = '트래커/책등 캡처';
        cap.onclick = openCaptureMenu;
        segRow.appendChild(cap);
      }
    }
  }

  /* 찰칵(캡처) — 선택 메뉴 + html2canvas 저장 */
  function openCaptureMenu(e) {
    if (e) e.stopPropagation();
    var old = document.getElementById('wt-cap-menu');
    if (old) { old.remove(); return; }
    var menu = document.createElement('div'); menu.id = 'wt-cap-menu'; menu.className = 'wt-cap-menu';
    menu.innerHTML = '<button data-m="both">📸 트래커+책등 같이</button><button data-m="tracker">📊 트래커만</button><button data-m="spines">📚 책등만</button>';
    document.body.appendChild(menu);
    var r = e.currentTarget.getBoundingClientRect();
    menu.style.top = (r.bottom + window.scrollY + 6) + 'px';
    menu.style.left = Math.max(8, r.right + window.scrollX - 168) + 'px';
    menu.querySelectorAll('button').forEach(function (b) { b.onclick = function () { var m = b.dataset.m; menu.remove(); captureTracker(m); }; });
    setTimeout(function () {
      document.addEventListener('click', function close(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } });
    }, 0);
  }
  async function captureTracker(mode) {
    var grid = document.getElementById('timer-tracker-grid');
    var card = grid && grid.closest('.card');
    if (!card) return;
    var det = card.querySelector('.wt-detail');
    if ((mode === 'spines' || mode === 'both') && !(det && det.classList.contains('on'))) {
      alert('먼저 "자세히"를 눌러 책등을 펼쳐주세요.'); return;
    }
    if (!window.html2canvas) {
      try { await new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
      catch (e) { alert('캡처 도구 로드 실패'); return; }
    }
    var hidden = [];
    function hide(el) { if (el) { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; } }
    var segRow = card.querySelector('.tracker-period-btn'); segRow = segRow && segRow.parentNode;
    hide(segRow);
    if (det) hide(det.querySelector('.wt-close'));
    // 책등이 많아도 전체가 담기게 — 스크롤 영역을 임시로 펼침
    var saved = [];
    function setS(el, prop, val) { if (!el) return; saved.push([el, prop, el.style[prop]]); el.style[prop] = val; }
    var dbody = det && det.querySelector('.wt-dbody');
    if (mode === 'spines' || mode === 'both') {
      setS(dbody, 'maxHeight', 'none'); setS(dbody, 'overflow', 'visible');
      setS(det, 'bottom', 'auto'); setS(det, 'height', 'auto');
    }
    var target, detHidden = false;
    if (mode === 'tracker') { if (det) { det.style.visibility = 'hidden'; detHidden = true; } target = card; }
    else if (mode === 'spines') { target = det; }
    else { target = card; }
    if (mode === 'both' && det) {
      // 히트맵·책등 중 더 긴 쪽에 맞춰 카드 높이 확보(강제 height X → 히트맵 잘림 방지)
      setS(card, 'overflow', 'visible');
      var needH = det.offsetTop + det.offsetHeight + 14; // 펼친 책등 전체 높이
      setS(card, 'minHeight', Math.max(card.offsetHeight, needH) + 'px');
    }
    // 캡처 직전 reflow된 실제 크기로 전체를 담기
    var capW = Math.ceil(target.scrollWidth), capH = Math.ceil(target.scrollHeight);
    try {
      var canvas = await window.html2canvas(target, { scale: 3, backgroundColor: mode === 'spines' ? null : '#f2ece0', useCORS: true, allowTaint: true, logging: false, width: capW, height: capH, windowWidth: Math.max(document.documentElement.clientWidth, capW + 100), scrollX: 0, scrollY: -window.scrollY });
      var a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'Booklog_tracker_' + mode + '.png'; a.click();
    } catch (err) { alert('캡처 실패: ' + (err && err.message || err)); }
    saved.forEach(function (p) { p[0].style[p[1]] = p[2]; });
    hidden.forEach(function (p) { p[0].style.visibility = p[1]; });
    if (detHidden && det) det.style.visibility = '';
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
    // 그 기간 '읽은 기록(시간)'이 있는 책만 (완독만 되고 읽은 시간 없는 책은 제외)
    var rows = [];
    B().forEach(function (b) {
      var m = minsInRange(b);
      if (m <= 0) return;
      rows.push({ title: b.title || '(제목 없음)', author: (b.author || '').split(/[,·]/)[0], pages: b.pages || 0, status: b.status, mins: m });
    });
    // 정렬 안 함 — 크기순 줄 세우지 않고 자연스럽게 뒤죽박죽 (책더미 느낌)

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

    // 트래커 히트맵 '오른쪽 빈 공간'으로 슬라이드 (둘 다 동시에 보이게, 토글)
    var grid = document.getElementById('timer-tracker-grid');
    var card = grid && grid.closest('.card');
    if (!card) return;
    function resetH() { if (card._mhTimer) clearTimeout(card._mhTimer); card._mhTimer = setTimeout(function () { card.style.minHeight = ''; }, 340); }
    var det = card.querySelector('.wt-detail');
    if (det && det.classList.contains('on')) { det.classList.remove('on'); resetH(); return; } // 다시 누르면 닫기
    if (!det) { det = document.createElement('div'); det.className = 'wt-detail'; card.appendChild(det); }
    det.innerHTML = '<div class="wt-dhead"><div><div class="wt-dtitle">' + label + '</div><div class="wt-dsub">' + sub + '</div></div>' +
      '<button class="wt-close" aria-label="닫기">✕</button></div>' +
      '<div class="wt-dbody">' + body + '</div>';
    det.querySelector('.wt-close').onclick = function () { det.classList.remove('on'); resetH(); };
    // 히트맵 오른쪽에 배치 + 카드 높이 확보
    det.style.top = grid.offsetTop + 'px';
    det.style.left = (grid.offsetLeft + grid.offsetWidth + 16) + 'px';
    det.style.right = '14px';
    det.style.bottom = '14px';
    card.style.minHeight = Math.max(card.offsetHeight, 244) + 'px';
    requestAnimationFrame(function () { requestAnimationFrame(function () { det.classList.add('on'); }); });
  }

  /* 월별 그래프 → 둥근 막대(완독 권수) + 도트·라인(읽은 페이지), 데스크톱 전용 */
  function renderWebMonthly() {
    if (!isWeb()) return;
    var viz = document.getElementById('monthly-viz');
    if (!viz) return;
    var done = B().filter(function (b) { return b.status === '완독' && b.date_finish; });
    var ym = (typeof curYM !== 'undefined') ? curYM : 'all';
    var PALETTE = ['#c4704a', '#56788a', '#6f8f56', '#c79a3e', '#8a6890', '#4f9e93', '#b5481f', '#a85a86', '#7a8b3a', '#5a8a8a', '#b07030', '#9d6a90'];
    var labels = [], vals = [], pages = [];
    if (ym === 'all') {
      var byYear = {}, pgYear = {};
      done.forEach(function (b) { var y = b.date_finish.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; pgYear[y] = (pgYear[y] || 0) + (b.pages || 0); });
      var ys = Object.keys(byYear).sort();
      vals = ys.map(function (y) { return byYear[y]; });
      pages = ys.map(function (y) { return pgYear[y]; });
      labels = ys.map(function (y) { return "'" + y.slice(2); });
    } else {
      var Y = parseInt(ym, 10);
      vals = Array(12).fill(0); pages = Array(12).fill(0);
      done.forEach(function (b) {
        if (parseInt(b.date_finish.slice(0, 4), 10) === Y) {
          var mi = parseInt(b.date_finish.slice(5, 7), 10) - 1;
          vals[mi]++; pages[mi] += (b.pages || 0);
        }
      });
      labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    }
    if (!vals.length) return;
    var n = vals.length;
    var max = Math.max.apply(null, [1].concat(vals));
    var maxPg = Math.max.apply(null, [1].concat(pages));
    var nz = vals.filter(function (v) { return v > 0; });
    var avg = nz.length ? nz.reduce(function (a, v) { return a + v; }, 0) / nz.length : 0;
    var avgPct = max ? Math.min(90, Math.round(avg / max * 100)) : 0;
    var bars = vals.map(function (v, i) {
      var h = v > 0 ? Math.max(8, Math.round(v / max * 100)) : 0;
      var bar = v > 0 ? '<div class="wm-bar" style="height:' + h + '%;background:' + PALETTE[i % PALETTE.length] + '"></div>' : '<div class="wm-bar wm-empty"></div>';
      return '<div class="wm-col"><div class="wm-val">' + (v > 0 ? v : '') + '</div><div class="wm-bw">' + bar + '</div><div class="wm-lbl">' + labels[i] + '</div></div>';
    }).join('');

    // 읽은 페이지 — 도트+라인 오버레이 (0인 달은 끊어서 세그먼트)
    var hasPg = pages.some(function (p) { return p > 0; });
    var svg = '';
    if (hasPg) {
      var pts = pages.map(function (p, i) { return { x: (i + 0.5) / n * 100, y: p > 0 ? (94 - p / maxPg * 86) : null, p: p }; });
      var segs = [], cur = [];
      pts.forEach(function (pt) { if (pt.y === null) { if (cur.length) { segs.push(cur); cur = []; } } else cur.push(pt); });
      if (cur.length) segs.push(cur);
      // 은은한 곡선 (Catmull-Rom, 낮은 텐션 — 흐물거리지 않게)
      function smoothD(s) {
        if (s.length < 2) return s.length ? 'M' + s[0].x.toFixed(2) + ',' + s[0].y.toFixed(2) : '';
        var t = 0.16, d = 'M' + s[0].x.toFixed(2) + ',' + s[0].y.toFixed(2);
        for (var i = 0; i < s.length - 1; i++) {
          var p0 = s[i - 1] || s[i], p1 = s[i], p2 = s[i + 1], p3 = s[i + 2] || p2;
          var c1x = p1.x + (p2.x - p0.x) * t, c1y = p1.y + (p2.y - p0.y) * t;
          var c2x = p2.x - (p3.x - p1.x) * t, c2y = p2.y - (p3.y - p1.y) * t;
          d += ' C' + c1x.toFixed(2) + ',' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ',' + c2y.toFixed(2) + ' ' + p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
        }
        return d;
      }
      var poly = segs.map(function (s) { return '<path d="' + smoothD(s) + '" fill="none" stroke="#a08c72" stroke-width="1.4" vector-effect="non-scaling-stroke"/>'; }).join('');
      // 점은 HTML(원형 유지) — SVG circle은 가로로 늘어나 타원 됨
      var dots = pts.filter(function (p) { return p.y !== null; }).map(function (p) { return '<div class="wm-dot" style="left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%"></div>'; }).join('');
      svg = '<svg class="wm-line" viewBox="0 0 100 100" preserveAspectRatio="none">' + poly + '</svg>' + dots;
    }

    viz.innerHTML = '<div class="wm-chart">' + (avg > 0 ? '<div class="wm-avg" style="bottom:' + avgPct + '%"></div>' : '') + svg + bars + '</div>' +
      (hasPg ? '<div class="wm-legend"><span class="wm-lg-bar"></span>완독 권수<span class="wm-lg-line"></span>읽은 페이지</div>' : '');
  }

  /* 평생 독서기록 → 목표 링 게이지 카드 (web.js가 #ms-grid 교체), 데스크톱 전용 */
  function renderWebLifetime() {
    if (!isWeb()) return;
    var g = document.getElementById('ms-grid');
    if (!g) return;
    var done = B().filter(function (b) { return b.status === '완독'; });
    var total = done.length;
    var years = {}; done.forEach(function (b) { var y = (b.date_finish || '').slice(0, 4); if (y) years[y] = 1; });
    var yrs = Object.keys(years).length || 1;
    var totalMins = B().reduce(function (a, b) { return a + (b.reading_time || 0); }, 0);
    var totalPages = done.reduce(function (a, b) { return a + (b.pages || 0); }, 0);
    var masters = done.filter(function (b) { return b.rating >= 5; }).length;
    var items = [
      { n: total, l: '총 완독', c: '#b5481f', bg: '#f7e7dd', prog: Math.min(total / 200, 1), t: '200권' },
      { n: yrs + '년', l: '독서 기간', c: '#6f8f56', bg: '#e8f0e0', prog: Math.min(yrs / 10, 1), t: '10년' },
      { n: Math.round(total / yrs * 10) / 10 + '권', l: '연평균', c: '#56788a', bg: '#e4edf2', prog: Math.min(total / yrs / 20, 1), t: '20권/년' },
      { n: Math.floor(totalMins / 60) + 'h', l: '독서 시간', c: '#8a6890', bg: '#efe5f1', prog: Math.min(totalMins / 60 / 500, 1), t: '500h' },
      { n: totalPages ? totalPages.toLocaleString() : '0', l: '누적 페이지', c: '#7a634a', bg: '#f3ece0', prog: Math.min(totalPages / 50000, 1), t: '50,000p' },
      { n: masters + '권', l: '명작 수집', c: '#c79a3e', bg: '#f7edd2', prog: Math.min(masters / 100, 1), t: '100권' }
    ];
    g.innerHTML = items.map(function (it) {
      var pct = Math.round(it.prog * 100);
      return '<div class="wl-card" style="background:' + it.bg + '">' +
        '<div class="wl-ring" style="--p:' + pct + ';--c:' + it.c + '"><span style="color:' + it.c + '">' + pct + '%</span></div>' +
        '<div class="wl-body"><div class="wl-n" style="color:' + it.c + '">' + it.n + '</div><div class="wl-l">' + it.l + '</div><div class="wl-t">목표 ' + it.t + '</div></div></div>';
    }).join('');
  }

  /* 달력: 읽은 시간(형광펜 바) 숨김 → 완독 표지 + 전리품 뱃지만, 데스크톱 전용 */
  function renderWebCalendar() {
    if (!isWeb()) return;
    var grid = document.getElementById('cal-grid');
    if (!grid) return;
    grid.querySelectorAll('.day').forEach(function (cell) {
      if (cell.classList.contains('hbook') || cell.classList.contains('other')) return;
      // 독서시간 형광펜 바(height:5px)만 숨김 — 전리품 뱃지(🦋 등)는 유지
      cell.querySelectorAll('div').forEach(function (d) { if (/height:\s*5px/.test(d.getAttribute('style') || '')) d.style.display = 'none'; });
      cell.style.removeProperty('background');
    });
  }

  /* 장르 분포 → 도넛 + 범례 (얇은 검정 테두리), 데스크톱 전용 */
  function renderWebGenre() {
    if (!isWeb()) return;
    var dl = document.getElementById('donut-layout');
    if (!dl) return;
    var done = B().filter(function (b) { return b.status === '완독'; });
    var gm = {};
    done.forEach(function (b) { var g = Array.isArray(b.genre) ? (b.genre[0] || '') : (b.genre || ''); if (g) gm[g] = (gm[g] || 0) + 1; });
    var sorted = Object.keys(gm).map(function (k) { return [k, gm[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!sorted.length) return;
    var total = sorted.reduce(function (a, e) { return a + e[1]; }, 0) || 1;
    var PAL = ['#c4704a', '#6f8f56', '#56788a', '#c79a3e', '#8a3a2a', '#8a6890', '#3f7a6a', '#d99a5e', '#b07030', '#5a8a8a'];
    var acc = 0;
    var stops = sorted.map(function (e, i) { var s = acc / total * 100; acc += e[1]; return PAL[i % PAL.length] + ' ' + s.toFixed(2) + '% ' + (acc / total * 100).toFixed(2) + '%'; }).join(',');
    var legend = sorted.map(function (e, i) { return '<div class="gd-leg"><span class="gd-sw" style="background:' + PAL[i % PAL.length] + '"></span><span class="gd-name">' + esc(e[0]) + '</span><b>' + e[1] + '</b></div>'; }).join('');
    dl.innerHTML = '<div class="gd-wrap">' +
      '<div class="gd-donut"><div class="gd-ring" style="background:conic-gradient(' + stops + ')"></div><div class="gd-outer"></div>' +
      '<div class="gd-hole"><div class="gd-total">' + total + '</div><div class="gd-sub">' + sorted.length + '장르</div></div></div>' +
      '<div class="gd-legend">' + legend + '</div></div>';
  }

  if (typeof window.buildMonthly === 'function') {
    var _bm = window.buildMonthly;
    window.buildMonthly = function () { var r = _bm.apply(this, arguments); try { renderWebMonthly(); } catch (e) {} return r; };
  }
  if (typeof window.buildGenre === 'function') {
    var _bg = window.buildGenre;
    window.buildGenre = function () { var r = _bg.apply(this, arguments); try { renderWebGenre(); } catch (e) {} return r; };
  }

  /* 평점·작가 탭 → 평점 둥근막대 + 작가/출판사 카드형(번호 모서리), 데스크톱 전용 */
  function renderWebRatingAuthor() {
    if (!isWeb()) return;
    var layout = document.getElementById('rating-layout');
    if (!layout) return;
    var done = B().filter(function (b) { return b.status === '완독'; });
    var yr = (typeof curYR !== 'undefined') ? curYR : 'all';
    var filtered = yr === 'all' ? done : done.filter(function (b) { return parseInt((b.date_finish || '').slice(0, 4), 10) === yr; });
    if (!filtered.length) return;

    var dist = [5, 4, 3, 2, 1].map(function (s) { return filtered.filter(function (b) { return b.rating === s; }).length; });
    var maxD = Math.max.apply(null, [1].concat(dist));
    var rated = dist.reduce(function (a, v) { return a + v; }, 0);
    var avg = rated > 0 ? (dist.reduce(function (a, v, i) { return a + v * (5 - i); }, 0) / rated).toFixed(1) : '—';
    var RCOL = ['#6f8f56', '#c79a3e', '#c4704a', '#b0703a', '#8a3a2a'];

    var aMap = {}, aRat = {}, aRC = {}, pMap = {};
    filtered.forEach(function (b) {
      if (b.author) b.author.split(/[,·;]/).map(function (n) { return n.replace(/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '').trim(); }).filter(function (n) { return n.length > 1; }).forEach(function (name) {
        aMap[name] = (aMap[name] || 0) + 1;
        if (b.rating >= 1 && b.rating <= 5) { aRat[name] = (aRat[name] || 0) + b.rating; aRC[name] = (aRC[name] || 0) + 1; }
      });
      if (b.publisher) pMap[b.publisher] = (pMap[b.publisher] || 0) + 1;
    });
    var aSort = Object.keys(aMap).map(function (k) { return { name: k, n: aMap[k], avg: aRC[k] ? aRat[k] / aRC[k] : 0 }; }).sort(function (x, y) { return y.n - x.n || y.avg - x.avg || x.name.localeCompare(y.name, 'ko'); });
    var pSort = Object.keys(pMap).map(function (k) { return { name: k, n: pMap[k] }; }).sort(function (x, y) { return y.n - x.n || x.name.localeCompare(y.name, 'ko'); });
    var PAL = ['#c4704a', '#6f8f56', '#56788a', '#c79a3e', '#8a6890', '#3f7a6a'];
    function starStr(v) { var r = Math.round(v); return '★'.repeat(r) + '☆'.repeat(5 - r); }
    function card(it, i, isA) {
      return '<div class="ra-card"><span class="ra-rank" style="background:' + PAL[i % PAL.length] + '">' + (i + 1) + '</span>' +
        '<div class="ra-name">' + esc(it.name) + '</div>' +
        (isA ? '<div class="ra-stars" style="color:' + PAL[i % PAL.length] + '">' + starStr(it.avg) + '</div>' : '<div class="ra-stars ra-mut">출판사</div>') +
        '<div class="ra-foot"><span class="ra-sub">' + (isA ? (it.avg ? '평균 ' + it.avg.toFixed(1) : '평점 없음') : '') + '</span><span class="ra-cnt">' + it.n + '<i>권</i></span></div></div>';
    }
    var TOPN = 6;
    var aCards = aSort.slice(0, TOPN).map(function (it, i) { return card(it, i, true); }).join('') +
      (aSort.length > TOPN ? '<div class="ra-more">+' + (aSort.length - TOPN) + '명 더</div>' : '');
    var pCards = pSort.slice(0, TOPN).map(function (it, i) { return card(it, i, false); }).join('') +
      (pSort.length > TOPN ? '<div class="ra-more">+' + (pSort.length - TOPN) + '곳 더</div>' : '');
    var rbars = [5, 4, 3, 2, 1].map(function (s, i) {
      var w = Math.round(dist[i] / maxD * 100), pct = rated > 0 ? Math.round(dist[i] / rated * 100) : 0;
      return '<div class="ra-rbar"><span class="ra-rstar">' + '★'.repeat(s) + '</span><div class="ra-rtrack"><div class="ra-rfill" style="width:' + w + '%;background:' + RCOL[i] + '"></div></div><span class="ra-rpct">' + pct + '%</span></div>';
    }).join('');

    layout.style.cssText = 'display:block;';
    layout.innerHTML = '<div class="ra-lbl">평점 분포 · 평균 ' + avg + '</div><div class="ra-rating">' + rbars + '</div>' +
      '<div class="ra-lbl">최애 작가</div><div class="ra-grid">' + aCards + '</div>' +
      '<div class="ra-lbl">최애 출판사</div><div class="ra-grid">' + pCards + '</div>';
  }
  if (typeof window.buildRatingAuthor === 'function') {
    var _bra = window.buildRatingAuthor;
    window.buildRatingAuthor = function () { var r = _bra.apply(this, arguments); try { renderWebRatingAuthor(); } catch (e) {} return r; };
  }
  /* 트래커 히트맵 색 → 슬레이트 블루 램프(브라운·연두 대신), 데스크톱 전용 */
  var SLATE7 = ['#e6edf0', '#c8d8e0', '#8fb1c2', '#6593a8', '#4a7589', '#385a6b', '#28414e'];
  var TRK_BROWN = ['#ede8df', '#e8d4b0', '#d4a870', '#c08840', '#a06820', '#7a4a10', '#4a2808'];
  // 셀은 cssText로 들어가 rgb()로 직렬화됨 → hex와 rgb 둘 다 매칭
  var TRK_MAP = {};
  TRK_BROWN.forEach(function (h, i) {
    var n = parseInt(h.slice(1), 16);
    TRK_MAP[h] = SLATE7[i];
    TRK_MAP['rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'] = SLATE7[i];
  });
  function renderWebTracker() {
    if (!isWeb()) return;
    var grid = document.getElementById('timer-tracker-grid');
    if (!grid) return;
    var card = grid.closest('.card') || grid;
    card.querySelectorAll('div').forEach(function (cell) {
      var bg = (cell.style.backgroundColor || '').toLowerCase();
      if (TRK_MAP[bg]) cell.style.setProperty('background', TRK_MAP[bg], 'important');
    });
    // 범례 스와치(7개)를 셀 색과 정확히 일치
    card.querySelectorAll('div[style*="width:7px"]').forEach(function (s, i) { if (SLATE7[i]) s.style.setProperty('background', SLATE7[i], 'important'); });
  }
  if (typeof window.buildTrackerGrid === 'function') {
    var _btg = window.buildTrackerGrid;
    window.buildTrackerGrid = function () { var r = _btg.apply(this, arguments); try { renderWebTracker(); } catch (e) {} return r; };
  }

  if (typeof window.buildMilestone === 'function') {
    var _bms = window.buildMilestone;
    window.buildMilestone = function () { var r = _bms.apply(this, arguments); try { renderWebLifetime(); } catch (e) {} return r; };
  }
  if (typeof window.buildStats === 'function') {
    var _bs = window.buildStats;
    window.buildStats = function () { var r = _bs.apply(this, arguments); try { renderWebStats(); } catch (e) {} return r; };
  }
  if (typeof window.renderCal === 'function') {
    var _rc = window.renderCal;
    window.renderCal = function () { var r = _rc.apply(this, arguments); try { renderWebRecord(); } catch (e) {} try { renderWebCalendar(); } catch (e) {} return r; };
  }

  /* 산책로 게시판 카테고리 칩에 또렷한 색 (자유=슬레이트·책이야기=세이지·감상공유=클레이) */
  function colorBoardCats() {
    if (!isWeb()) return;
    document.querySelectorAll('.board-cat').forEach(function (chip) {
      var t = chip.textContent || '', col = null;
      if (t.indexOf('자유') >= 0) col = '#56788a';
      else if (t.indexOf('책') >= 0) col = '#6f8f56';
      else if (t.indexOf('감상') >= 0) col = '#c4704a';
      if (col) {
        chip.style.setProperty('background', 'color-mix(in srgb, ' + col + ' 15%, #fff)', 'important');
        chip.style.setProperty('border', '1.5px solid ' + col, 'important');
        chip.style.setProperty('color', col, 'important');
      }
    });
  }
  if (typeof window.renderPostItems === 'function') {
    var _rpi = window.renderPostItems;
    window.renderPostItems = function () { var r = _rpi.apply(this, arguments); try { colorBoardCats(); } catch (e) {} return r; };
  }
  if (typeof window.openPostDetail === 'function') {
    var _opd = window.openPostDetail;
    window.openPostDetail = function () { var r = _opd.apply(this, arguments); setTimeout(function () { try { colorBoardCats(); } catch (e) {} }, 60); return r; };
  }

  document.addEventListener('DOMContentLoaded', function () { setActive('books'); });
})();
