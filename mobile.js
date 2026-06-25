/* =========================================================
   북로그 — 모바일 하단 탭바 연결 로직
   기존 sw() 패널 전환 로직을 재사용하고, 하단바 활성표시만 관리.
   ========================================================= */
(function () {
  var REAL = ['books', 'quotes', 'record', 'graph', 'board']; // 하단바 직행 패널

  // 앱 화면(로그인 후)에서만 하단바가 보이도록 body 클래스 토글
  if (typeof window.showScreen === 'function') {
    var _showScreen = window.showScreen;
    window.showScreen = function (name) {
      _showScreen(name);
      document.body.classList.toggle('app-on', name === 'app');
    };
  }

  function topTab(name) {
    return document.querySelector('.tab[onclick*="\'' + name + '\'"]');
  }
  function setActive(name) {
    document.querySelectorAll('.mnav-i').forEach(function (b) {
      b.classList.toggle('on', b.dataset.nav === name);
    });
  }
  function currentPanel() {
    var on = document.querySelector('.panel.on');
    return on ? on.id.replace('p-', '') : 'books';
  }

  // 하단바 탭 → 기존 sw() 호출 + 활성표시
  window.mnav = function (name) {
    var t = topTab(name);
    if (t && typeof sw === 'function') sw(name, t);
    setActive(name);
    closeMoreSheet(true);
  };

  // 더보기 시트
  window.openMoreSheet = function () {
    var o = document.getElementById('more-sheet');
    if (o) o.style.display = 'flex';
    setActive('more');
  };
  window.closeMoreSheet = function (keepActive) {
    var o = document.getElementById('more-sheet');
    if (o) o.style.display = 'none';
    if (!keepActive) {
      var cur = currentPanel();
      setActive(REAL.indexOf(cur) >= 0 ? cur : 'more');
    }
  };
  // 시트 항목 → 패널 이동 (문장 등)
  window.moreGo = function (name) {
    var t = topTab(name);
    if (t && typeof sw === 'function') sw(name, t);
    closeMoreSheet(true);
    setActive('more');
  };

  // ── 앱 모드 (커뮤니티/기록) — 모바일 앱 전용
  window.getAppMode = function () { return localStorage.getItem('bl_app_mode') || 'community'; };
  window.setAppMode = function (m) { localStorage.setItem('bl_app_mode', m); applyAppMode(); };
  function applyAppMode() {
    var m = window.getAppMode();
    document.body.classList.toggle('mode-record', m === 'record');
    // 기록 모드에서 숨겨진 탭(산책)에 있으면 서재로 이동
    if (m === 'record' && currentPanel() === 'board') { window.mnav('books'); }
    var cb = document.getElementById('mode-btn-community'), rb = document.getElementById('mode-btn-record');
    if (cb) cb.classList.toggle('on', m === 'community');
    if (rb) rb.classList.toggle('on', m === 'record');
  }

  // ── 앱 테마색 (커스텀 액센트) — 모바일 앱 전용
  var THEMES = ['default', 'sage', 'slate', 'mauve', 'clay'];
  window.getTheme = function () { return localStorage.getItem('bl_app_theme') || 'default'; };
  window.setTheme = function (t) { localStorage.setItem('bl_app_theme', t); applyTheme(); };
  function applyTheme() {
    var t = window.getTheme();
    THEMES.forEach(function (x) { document.body.classList.toggle('theme-' + x, x === t); });
    document.querySelectorAll('.theme-dot').forEach(function (d) { d.classList.toggle('on', d.dataset.theme === t); });
  }

  // 산책 새 글 알림 점: 기존 board-new-dot 과 동기화
  function syncBoardDot() {
    var src = document.getElementById('board-new-dot');
    var dst = document.getElementById('mnav-board-dot');
    if (src && dst) dst.style.display = (src.style.display !== 'none') ? 'block' : 'none';
  }

  // ── 서재 홈 "이어 읽기" 히어로 카드 (앱 전용)
  function renderHomeHero() {
    var panel = document.getElementById('p-books');
    if (!panel) return;
    var hero = document.getElementById('home-hero');
    var books = (window.allBooks || []).filter(function (b) { return b.status === '읽는중'; });
    books.sort(function (a, b) {
      return new Date(b.last_read || b.date_start || b.created_at || 0) - new Date(a.last_read || a.date_start || a.created_at || 0);
    });
    var b = books[0];
    if (!b) { if (hero) hero.remove(); return; }
    var pct = (b.current_page && b.pages) ? Math.min(100, Math.round(b.current_page / b.pages * 100)) : 0;
    if (!hero) { hero = document.createElement('div'); hero.id = 'home-hero'; panel.insertBefore(hero, panel.firstChild); }
    var cover = b.cover ? '<img src="' + b.cover + '" alt="">' : '<span>' + (b.title || '') + '</span>';
    hero.innerHTML =
      '<div class="hh-label">이어 읽기</div>' +
      '<div class="hh-body">' +
        '<div class="hh-cover" data-go>' + cover + '</div>' +
        '<div class="hh-info">' +
          '<div class="hh-title" data-go>' + (b.title || '') + '</div>' +
          '<div class="hh-author">' + ((b.author || '').split(/[,·]/)[0]) + '</div>' +
          '<div class="hh-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="hh-meta">' + (b.current_page || 0) + ' / ' + (b.pages || '?') + 'p · ' + pct + '%</div>' +
        '</div>' +
        '<div class="hh-gauge" style="--p:' + pct + '"><span>' + pct + '</span></div>' +
      '</div>' +
      '<button class="hh-btn" type="button" data-go>이어서 기록 →</button>';
    hero.querySelectorAll('[data-go]').forEach(function (el) {
      el.onclick = function () { if (window.openDetail) openDetail(b.id); };
    });
  }
  if (typeof window.buildBooks === 'function') {
    var _origBuildBooks = window.buildBooks;
    window.buildBooks = function () { _origBuildBooks.apply(this, arguments); try { renderHomeHero(); } catch (e) {} };
  }

  document.addEventListener('DOMContentLoaded', function () {
    setActive('books');
    applyAppMode();
    applyTheme();
    syncBoardDot();
    var src = document.getElementById('board-new-dot');
    if (src && window.MutationObserver) {
      new MutationObserver(syncBoardDot).observe(src, { attributes: true, attributeFilter: ['style'] });
    }
  });
})();
