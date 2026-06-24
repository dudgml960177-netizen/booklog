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
