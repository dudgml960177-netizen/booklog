
// 전역 에러 핸들러 - JS 에러가 버튼을 막지 않게
window.addEventListener('unhandledrejection', e => {
  console.warn('Unhandled promise rejection:', e.reason);
  e.preventDefault(); // 에러가 전파되어 앱을 막지 않도록
});
window.onerror = (msg, src, line) => {
  console.warn('Global error:', msg, src, line);
  return true; // 에러 전파 차단
};
// ═══════════════════════════════════════════
// 북로그 v3
// ═══════════════════════════════════════════
// ── 결제 설정
const PAYMENT_OPEN   = '2026-06-15';
const PAYMENT_CLOSE  = '2026-08-15';
const PAYMENT_PLANS  = {
  plan_a: { name: '가입권 + 초대장 1장', amount: 15000, invites: 1 },
  plan_b: { name: '가입권 + 초대장 2장', amount: 28000, invites: 2 },
  plan_c: { name: '가입권 + 초대장 3장', amount: 38000, invites: 3 }
};
// TODO: 실제 계좌 정보로 교체
const BANK_INFO = { bank: '카카오뱅크', account: '3333-37-6571647', holder: '김영희' };

const SUPABASE_URL = 'https://xowlwzpoxrudgaoavkbr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';
const NAVER_PROXY = `${SUPABASE_URL}/functions/v1/naver-book`;
const NAVER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';
const ALADIN_PROXY = '/api/aladin';

// 표지 검색 - 제목+작가+출판사 엄격 매칭
async function fetchBookCover(title, author='', publisher='') {
  const clean = s => String(s||'').replace(/<[^>]+>/g,'').trim();
  const normalize = s => clean(s).replace(/\s+/g,' ').toLowerCase();
  const normTitle = normalize(title);
  const normAuthor = normalize(author).split(/[,·]/)[0].trim();
  const normPub = normalize(publisher);

  try {
    const q = normAuthor ? `${title} ${author.split(/[,·]/)[0].trim()}` : title;
    const res = await fetch(`${NAVER_PROXY}?query=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${NAVER_KEY}` }
    });
    if(!res.ok) return null;
    const items = (await res.json()).items || [];
    if(!items.length) return null;

    const score = item => {
      const iTitle = normalize(item.title);
      const iAuthor = normalize(item.author).split(/[,·^]/)[0].trim();
      const iPub = normalize(item.publisher);
      let s = 0;

      // ── 제목 일치
      if(iTitle === normTitle) s += 100;
      else if(iTitle.includes(normTitle) || normTitle.includes(iTitle)) s += 60;
      else {
        const words = normTitle.split(' ').filter(w=>w.length>1);
        const matched = words.filter(w=>iTitle.includes(w));
        if(matched.length < words.length * 0.7) return 0; // 제목 70% 미만 일치 → 즉시 탈락
        s += 25;
      }

      // ── 작가 일치 (있으면 반드시 확인)
      if(normAuthor) {
        const authorMatch = iAuthor.includes(normAuthor) || normAuthor.includes(iAuthor) ||
          iAuthor.replace(/\s/g,'').includes(normAuthor.replace(/\s/g,''));
        if(!authorMatch) return 0; // 작가 불일치 → 즉시 탈락
        s += 50;
      }

      // ── 출판사 일치 (보너스)
      if(normPub && (iPub.includes(normPub) || normPub.includes(iPub))) s += 20;

      return s;
    };

    const best = items.map(item=>({item,s:score(item)})).reduce((a,b)=>a.s>=b.s?a:b);
    // 최소 점수 70 이상 (제목+작가 둘 다 맞아야)
    if(best.s < 70) {
      console.log(`표지 거부 [${best.s}점]: "${title}" → "${clean(best.item.title)}" / "${clean(best.item.author)}"`);
      return null;
    }
    console.log(`표지 채택 [${best.s}점]: "${title}" → "${clean(best.item.title)}"`);
    return best.item.image || null;
  } catch(e) { console.error('fetchBookCover:', e); return null; }
}
const { createClient } = supabase;
// Supabase 클라이언트 - 항상 새로 생성 (오염된 인스턴스 재사용 방지)
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'booklog-auth',
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  }
});
window.__sb = sb;


// ── 커스텀 Alert/Confirm (브라우저 기본 팝업 대체)
let _confirmResolveFunc = null;
function _confirmResolve(val) {
  closeModal('modal-confirm');
  if(_confirmResolveFunc) { _confirmResolveFunc(val); _confirmResolveFunc = null; }
}
function showAlert(msg) {
  return new Promise(resolve => {
    const el = document.getElementById('confirm-message');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    if(!el) { window.alert(msg); resolve(true); return; }
    el.textContent = msg;
    if(cancel) cancel.style.display = 'none';
    if(ok) ok.textContent = '확인';
    _confirmResolveFunc = resolve;
    openModal('modal-confirm');
  });
}
function showConfirm(msg) {
  return new Promise(resolve => {
    const el = document.getElementById('confirm-message');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    if(!el) { resolve(window.confirm(msg)); return; }
    el.textContent = msg;
    if(cancel) { cancel.style.display = ''; cancel.textContent = '취소'; }
    if(ok) ok.textContent = '확인';
    _confirmResolveFunc = resolve;
    openModal('modal-confirm');
    // 취소 버튼은 false 반환
    if(cancel) cancel.onclick = () => { closeModal('modal-confirm'); resolve(false); _confirmResolveFunc = null; };
  });
}

// ── 상태
let currentUser = null, allBooks = [], allQuotes = [], allCategories = [];
let curFilter = '전체', curCatFilter = new Set(), curView = 'gallery', curSort = 'recent';
let curTagQ = '전체', curBookId = null, editingBookId = null, selectedBook = null;
let curRating = 0, curStatus = '완독';
let calY = new Date().getFullYear(), calM = new Date().getMonth();
let monthChart = null, donutChart = null, pagesChart = null;
let curYM = 'all', curYR = 'all';
let timerInterval = null, timerSeconds = 0, timerRunning = false, timerBookId = null;
let timerTrackY = new Date().getFullYear(), timerTrackM = new Date().getMonth(), timerPeriod = 'month';
let goals = { books: 0, minutes: 0, pages: 0 };

const YC = {
  2021:{line:'#8b6b5a',rgb:'139,107,90'},
  2022:{line:'#6b8f6b',rgb:'107,143,107'},
  2023:{line:'#5a7a8a',rgb:'90,122,138'},
  2024:{line:'#c4714a',rgb:'196,113,74'},
  2025:{line:'#8b6b8b',rgb:'139,107,139'},
  2026:{line:'#c8a050',rgb:'200,160,80'},
  2027:{line:'#4a7a6a',rgb:'74,122,106'},
  2028:{line:'#7a6aaa',rgb:'122,106,170'},
};
const GCOLS = ['#c4714a','#6b8f6b','#5a7a8a','#c4a87a','#8a3a28','#7a5a8a','#3a6858','#c87850','#4a6888','#9a5040','#6a8a50','#a05030'];
const RCOLS = ['#c4714a','#c4a87a','#6b8f6b','#5a7a8a','#d4c8b0'];
const TRACKER_COLORS = [
  '#ede8df',  // 0: 없음 - 배경과 자연스럽게
  '#e8d4b0',  // 1: 아주 적음 - 연한 웜베이지
  '#d4a870',  // 2: 적음 - 골드베이지
  '#c08840',  // 3: 보통 - 웜골드
  '#a06820',  // 4: 많음 - 딥골드
  '#7a4a10',  // 5: 아주 많음 - 브라운
  '#4a2808',  // 6: 최대 - 딥브라운
];

// ── 초기화
let _loadingRetryTimer = null;
function showScreen(name) {
  ['loading','auth','app'].forEach(n => {
    const el = document.getElementById('screen-'+n);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('screen-'+name);
  if (el) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
  // 로딩 화면 10초 후 "다시 시도" 버튼 노출
  clearTimeout(_loadingRetryTimer);
  if(name === 'loading') {
    _loadingRetryTimer = setTimeout(() => {
      const btn = document.getElementById('loading-retry-btn');
      if(btn && _appState !== 'running') btn.style.display = 'block';
    }, 10000);
  } else {
    const btn = document.getElementById('loading-retry-btn');
    if(btn) btn.style.display = 'none';
  }
}


// ── localStorage 정리 (좋아요 기록 오래된 것 제거)
function cleanupLocalStorage() {
  try {
    // sb-* : Supabase 내부 세션 토큰 — 절대 건드리지 않음 (삭제 시 로그인 불가)
    // booklog-auth* : Supabase 세션 키 — 보존
    // bl_* : 북로그 앱 데이터 — 보존
    // liked_* : 좋아요 캐시 — 보존
    Object.keys(localStorage).forEach(k => {
      if(k.startsWith('sb-')) return;          // Supabase 세션 — 절대 보존
      if(k.startsWith('booklog-auth')) return; // Supabase 세션 — 절대 보존
      if(k.startsWith('bl_')) return;          // 앱 데이터 — 보존
      if(k.startsWith('liked_')) return;       // 좋아요 — 보존
      localStorage.removeItem(k);              // 나머지 알 수 없는 키만 삭제
    });
    // liked_ 키 50개 초과 시 오래된 것 정리
    const likedKeys = Object.keys(localStorage).filter(k => k.startsWith('liked_'));
    if(likedKeys.length > 50) likedKeys.slice(0, likedKeys.length - 30).forEach(k => localStorage.removeItem(k));
  } catch(e) {
    console.warn('Storage cleanup error:', e);
  }
}


// ── 폰트 크기 설정
function applyFontSize(size, save=true) {
  const root = document.documentElement;
  const ratio = parseInt(size) / 100;
  root.style.setProperty('--font-scale', ratio);
  root.style.fontSize = Math.round(16 * ratio) + 'px';
  localStorage.setItem('bl_font_size', size);
  const label = document.getElementById('font-size-label');
  const slider = document.getElementById('font-size-slider');
  if(label) label.textContent = size + '%';
  if(slider) slider.value = size;
  // DB에도 저장 (로그인 상태일 때)
  if(save && currentUser) {
    sb.from('profiles').update({font_size: parseInt(size)}).eq('id', currentUser.id)
      .then().catch(e => console.warn('font save:', e));
  }
}

function initFontSize(sizeFromDB) {
  // DB값 우선, 없으면 localStorage, 없으면 100
  const size = sizeFromDB || localStorage.getItem('bl_font_size') || '100';
  applyFontSize(size, false); // 초기화 시엔 DB 재저장 안 함
}

// ── 앱 상태 관리
// ── 앱 상태 관리
let _appState = 'idle'; // idle | starting | running | auth

async function startApp(user) {
  if(_appState === 'running' || _appState === 'starting') return;
  _appState = 'starting';
  showScreen('loading');

  // 20초 절대 타임아웃 — 네트워크 불량/세션 오염/SIGNED_OUT 등으로 로딩 화면에서 탈출
  const _abortTimer = setTimeout(() => {
    const loadEl = document.getElementById('screen-loading');
    const isLoadingVisible = loadEl && loadEl.style.display !== 'none';
    if(isLoadingVisible && _appState !== 'running') {
      console.warn('[startApp] 타임아웃 — 인증 화면으로 복귀');
      _appState = 'idle';
      currentUser = null;
      showScreen('auth');
      loadSavedEmail();
    }
  }, 20000);

  try {
    currentUser = user;
    // 데이터 로딩 (타임아웃 없이 완전히 기다림 - 중간에 강제 종료 시 데이터 누락)
    const _loadTimeout = new Promise(res => setTimeout(res, 15000)); // 15초 최대
    await Promise.race([
      Promise.all([
        typeof loadData === 'function' ? loadData().catch(e=>console.warn(e)) : Promise.resolve(),
        typeof loadGoals === 'function' ? loadGoals().catch(e=>console.warn(e)) : Promise.resolve(),
        typeof loadUserRole === 'function' ? loadUserRole().catch(e=>console.warn(e)) : Promise.resolve()
      ]),
      _loadTimeout
    ]);

    try {
      // 3초 타임아웃 — font_size 쿼리가 무한정 걸리지 않게
      const pfRace = Promise.race([
        sb.from('profiles').select('font_size').eq('id', user.id).single(),
        new Promise(res => setTimeout(() => res({ data: null }), 3000))
      ]);
      const { data: pf } = await pfRace;
      if(pf?.font_size) initFontSize(String(pf.font_size));
    } catch(e) {}

    // 데이터 로딩 중 SIGNED_OUT 등으로 취소된 경우 앱 화면 진입하지 않음
    if(_appState !== 'starting') {
      clearTimeout(_abortTimer);
      return;
    }

    clearTimeout(_abortTimer);
    initSystemFont();
    _appState = 'running';
    showScreen('app');
    buildBooks();
    // FAB 버튼 초기 표시 (기본 서재 탭)
    const fabInit = document.getElementById('fab-add-book');
    if(fabInit) fabInit.style.display = 'flex';

    // 방문 횟수 카운트
    const _vtd=kstToday();
    const _vk='bl_visit_'+_vtd;
    const _vc=parseInt(localStorage.getItem(_vk)||'0')+1;
    localStorage.setItem(_vk, String(_vc));
    if(_vc > parseInt(localStorage.getItem('bl_daily_visit_max')||'0'))
      localStorage.setItem('bl_daily_visit_max', String(_vc));

    // 인라인 도서관에서 복귀 시 storage 이벤트 미발생 → 직접 처리
    const _libDone = localStorage.getItem('bl_lib_session_done');
    if(_libDone) {
      try {
        const { bookId, minutes, date } = JSON.parse(_libDone);
        localStorage.removeItem('bl_lib_session_done');
        if(bookId && minutes >= 1) setTimeout(() => _addLibraryTime(bookId, minutes, date), 2000);
      } catch(_) {}
    }

    if(typeof flushPendingInviteCodes === 'function') setTimeout(flushPendingInviteCodes, 800);
    if(typeof loadNotifications === 'function') setTimeout(loadNotifications, 500);
    if(typeof checkAndGrantQuests === 'function') setTimeout(checkAndGrantQuests, 1500);
    if(typeof checkBoardNew === 'function') setTimeout(checkBoardNew, 2000);
    restoreTimerOnLoad();
    // Realtime WebSocket 연결은 앱 초기화 완료 후 3초 딜레이
    // (Auth 토큰 갱신과 WebSocket 핸드쉐이크 경쟁 방지)
    setTimeout(joinPresence, 3000);
    setTimeout(joinLibraryObserver, 3500);
  } catch(e) {
    clearTimeout(_abortTimer);
    console.error('startApp error:', e);
    // SIGNED_OUT이 이미 처리한 경우 중복 처리하지 않음
    if(_appState === 'starting') {
      _appState = 'idle';
      currentUser = null;
      showScreen('auth');
      loadSavedEmail();
    }
  }
}

function resetToAuth() {
  _appState = 'auth';
  currentUser = null; 
  allBooks = []; 
  allQuotes = [];
  // 세션 키(booklog-auth, sb-*)는 절대 삭제하지 않음
  // 삭제하면 다음 방문 시 자동 로그인 불가
  showScreen('auth');
  loadSavedEmail();
}

// onAuthStateChange - sb 생성 직후 등록
sb.auth.onAuthStateChange(async (event, session) => {
  try {
    // SIGNED_IN: 사용자가 직접 로그인 또는 토큰 갱신 완료
    if(event === 'SIGNED_IN') {
      if(session?.user) {
        if(_appState === 'running') {
          currentUser = session.user;
        } else if(_appState !== 'starting') {
          await startApp(session.user);
        }
      }
    }
    // TOKEN_REFRESHED: 백그라운드 토큰 갱신 (앱 실행 중이면 user만 갱신)
    if(event === 'TOKEN_REFRESHED' && session?.user) {
      currentUser = session.user;
    }
    // SIGNED_OUT: 로그아웃 or 토큰 만료
    if(event === 'SIGNED_OUT') {
      const wasActive = (_appState === 'starting' || _appState === 'running');
      _appState = 'idle';
      currentUser = null;
      if(wasActive) {
        showScreen('auth');
        loadSavedEmail();
      }
    }
    if(event === 'PASSWORD_RECOVERY') {
      clearTimeout(window._recoveryTimeout);
      showScreen('auth');
      authSwitch('newpw', null);
      showAuthError('새 비밀번호를 입력해주세요.', true);
    }
  } catch(e) { console.warn('OAC error:', e); }
});

function init() {
  initFontSize();
  cleanupLocalStorage();

  // 모달 바깥 클릭 닫기
  let _mdTarget = null;
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('mousedown', e => { _mdTarget = e.target; });
    el.addEventListener('click', e => {
      if(e.target === el && _mdTarget === el) el.style.display='none';
    });
  });

  // 모바일 뒤로가기 — 항상 pushState로 앱 밖 이탈 방지
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href); // 항상 상태 복원
    const open = [...document.querySelectorAll('.modal-overlay')].find(m => m.style.display !== 'none');
    // 파일 선택기가 열려있으면 모달 닫지 않음 (iOS에서 파일 픽커가 popstate 유발)
    if(open && _avatarPickerActive) return;
    if(open) { open.style.display='none'; return; }
    // 모달 없으면: 현재 탭이 서재가 아닌 경우 서재로 이동
    const booksTab = document.querySelector('.tab[onclick*="\'books\'"]') ||
                     document.querySelector('.tab[onclick*="books"]');
    const bookPanel = document.getElementById('p-books');
    if(booksTab && bookPanel && !bookPanel.classList.contains('on')) {
      booksTab.click();
    }
  });
  // 초기 히스토리 2개: 첫 번째 뒤로가기가 앱 내에서 처리되도록
  history.pushState(null, '', location.href);
  history.pushState(null, '', location.href);

  // URL 토큰 처리 (비밀번호 재설정)
  const urlQ = new URLSearchParams(window.location.search);

  // ⓪ 프록시 비밀번호 재설정 링크 감지 (스캐너 우회)
  // 이메일 보안 스캐너는 JS onclick을 실행하지 못하므로 PKCE 토큰이 보호됨
  const pwGo = urlQ.get('pw_go');
  if(pwGo) {
    window.history.replaceState(null, '', window.location.pathname);
    showPwGoScreen(pwGo);
    return;
  }

  // ① 에러 파라미터 먼저 확인 (이미 만료된 링크)
  const urlErr = urlQ.get('error') || urlQ.get('error_code');
  if(urlErr) {
    window.history.replaceState(null, '', window.location.pathname);
    showScreen('auth');
    authSwitch('reset', null);
    showAuthError('링크가 만료됐거나 이미 사용됐어요.\n이메일을 다시 입력해서 새 링크를 받으세요.');
    return;
  }
  // ② 신형 PKCE 방식: ?code=... (Supabase 클라이언트가 자동 교환)
  if(urlQ.get('type') === 'recovery' || urlQ.get('code')) {
    window.history.replaceState(null, '', window.location.pathname);
    showScreen('auth');
    authSwitch('reset', null);
    showAuthError('재설정 링크 확인 중…', true);
    // onAuthStateChange의 PASSWORD_RECOVERY 이벤트가 발동되면 newpw 화면으로 전환됨
    // 6초 후에도 전환 없으면 만료로 판단
    window._recoveryTimeout = setTimeout(() => {
      const newpwForm = document.getElementById('form-newpw');
      if(!newpwForm || newpwForm.style.display === 'none') {
        showAuthError('링크가 만료됐거나 이미 사용됐어요.\n이메일을 다시 입력해서 새 링크를 받으세요.');
      }
    }, 6000);
    return;
  }
  // ③ 구형 implicit 방식: #access_token=...
  const hash = window.location.hash;
  if(hash.includes('type=recovery') || hash.includes('access_token')) {
    try {
      const hashParams = new URLSearchParams(hash.replace('#',''));
      const accessToken = hashParams.get('access_token');
      if(accessToken) {
        sb.auth.setSession({ access_token: accessToken, refresh_token: hashParams.get('refresh_token')||'' })
          .then(() => { window.history.replaceState(null,'',window.location.pathname); showScreen('auth'); authSwitch('newpw',null); showAuthError('새 비밀번호를 입력해주세요.',true); })
          .catch(() => { showScreen('auth'); authSwitch('reset',null); showAuthError('링크가 만료됐거나 이미 사용됐어요.\n이메일을 다시 입력해서 새 링크를 받으세요.'); });
        return;
      }
    } catch(e) {}
  }

  // 타이머 미저장 시 페이지 이탈 방지
  window.addEventListener('beforeunload', e => {
    if(timerSeconds >= 60) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // 로딩 화면 표시 후 세션 직접 확인
  showScreen('loading');
  _initSession();
}

async function _initSession(retry=0) {
  try {
    // 5초 타임아웃 — 손상된 토큰/네트워크 불량으로 getSession이 무한 대기하는 상황 방지
    const sessionRace = Promise.race([
      sb.auth.getSession(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('session_timeout')), 5000))
    ]);
    const { data: { session }, error } = await sessionRace;
    if(error) throw error;
    if(session?.user) {
      await startApp(session.user);
    } else {
      if(retry < 1) {
        setTimeout(() => _initSession(retry+1), 2000);
      } else {
        // 세션 없음 — 로컬 토큰만 확실히 정리 후 로그인 화면
        try { await sb.auth.signOut({scope:'local'}); } catch(_) {}
        _appState = 'auth';
        showScreen('auth');
        loadSavedEmail();
      }
    }
  } catch(e) {
    console.warn('[initSession] error retry='+retry+':', e?.message||e);
    if(retry < 1) {
      setTimeout(() => _initSession(retry+1), 2000);
    } else {
      // 재시도 모두 실패 — 로컬 세션 강제 초기화 (네트워크 불필요)
      try { await sb.auth.signOut({scope:'local'}); } catch(_) {}
      _appState = 'auth';
      showScreen('auth');
      loadSavedEmail();
    }
  }
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

async function loadData() {
  const [bR, qR] = await Promise.all([
    sb.from('books').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
    sb.from('quotes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(5000),
  ]);
  if(!bR.error && bR.data) allBooks = bR.data;
  else if(!bR.error) allBooks = [];
  if(!qR.error && qR.data) allQuotes = qR.data;
  else if(!qR.error) allQuotes = [];
  // 카테고리 로컬 스토리지에서 로드
  try {
    const { data: pf } = await sb.from('profiles').select('categories').eq('id',currentUser.id).single();
    allCategories = pf?.categories || JSON.parse(localStorage.getItem('bl_cats_'+currentUser.id)||'[]');
  } catch(e) { try { allCategories = JSON.parse(localStorage.getItem('bl_cats_'+currentUser.id)||'[]'); } catch(e2){ allCategories=[]; } }
  // '소장 중' 폴더가 없으면 기본으로 추가 (기존 사용자 포함)
  if(!allCategories.includes('소장 중')) {
    allCategories = ['소장 중', ...allCategories];
    sb.from('profiles').update({categories: allCategories}).eq('id', currentUser.id).then(null, ()=>{});
    try { localStorage.setItem('bl_cats_'+currentUser.id, JSON.stringify(allCategories)); } catch(_) {}
  }
}

// ── 인증

function loadSavedEmail() {
  const saved = localStorage.getItem('bl_saved_email');
  const emailEl = document.getElementById('login-email');
  const chkEl = document.getElementById('save-email-chk');
  if(saved && emailEl) {
    emailEl.value = saved;
    if(chkEl) chkEl.checked = true;
  }
}

function authSwitch(tab, btn) {
  // auth-tab 버튼 on/off
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('on'));
  if(btn && btn.classList.contains('auth-tab')) btn.classList.add('on');
  // 폼 전환
  ['login','signup','reset','newpw'].forEach(f => {
    const el = document.getElementById('form-'+f);
    if(el) el.style.display = f===tab ? '' : 'none';
  });
  const authErr = document.getElementById('auth-error'); if(authErr) authErr.style.display = 'none';
}
async function doLogin() {
  // 이전 시작 시도가 멈춰있으면 상태 리셋
  if(_appState === 'starting') _appState = 'idle';
  const emailEl = document.getElementById('login-email');
  const pwEl = document.getElementById('login-pw');
  const email = emailEl?.value.trim() || '';
  const pw = pwEl?.value || '';
  if(!email || !pw) { showAuthError('이메일과 비밀번호를 입력해주세요.'); return; }
  const saveChk = document.getElementById('save-email-chk');
  if(saveChk?.checked) localStorage.setItem('bl_saved_email', email);
  else localStorage.removeItem('bl_saved_email');
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if(error) { showAuthError(error.message); return; }
    // 로그인 성공 → 직접 startApp 호출 (OAC 타이밍에 의존하지 않음)
    if(data?.user) {
      await startApp(data.user);
    }
  } catch(e) {
    showAuthError('연결 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
  }
}

function openInviteCheck() {
  // 회원가입 탭으로 전환 (초대코드 확인 없이 바로)
  authSwitch('signup', document.querySelectorAll('.auth-tab')[1]);
}

async function doResetPassword() {
  const email = document.getElementById('reset-email').value.trim();
  if(!email) { showAuthError('이메일을 입력해주세요.'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ action: 'request_reset', email })
    });
    const data = await res.json();
    if(!res.ok) { showAuthError('오류가 발생했어요. 잠시 후 다시 시도해주세요.'); return; }
    showAuthError('재설정 링크를 보냈어요! 이메일을 확인하고 버튼을 직접 눌러주세요.', true);
  } catch(e) {
    showAuthError('네트워크 오류가 발생했어요.');
  }
}

function showPwGoScreen(encoded) {
  // 스캐너가 미리 방문해도 이 함수가 실행되지만 버튼 클릭은 못함
  // 실제 유저만 버튼을 클릭해 Supabase URL로 이동
  window._pwGoEncoded = encoded;
  showScreen('auth');
  authSwitch('reset', null);

  // reset 폼을 숨기고 확인 버튼 화면으로 교체
  const resetForm = document.getElementById('form-reset');
  if(resetForm) {
    resetForm.innerHTML = `
      <div style="text-align:center;padding:1rem 0;">
        <div style="font-size:1.3rem;margin-bottom:.6rem;">🔑</div>
        <div style="font-size:.88rem;color:var(--tx1);font-weight:600;margin-bottom:.4rem;">비밀번호 재설정</div>
        <div style="font-size:.77rem;color:var(--tx3);line-height:1.6;margin-bottom:1.1rem;">
          아래 버튼을 눌러 비밀번호를 재설정하세요.<br>
          <span style="font-size:.7rem;">(버튼을 직접 클릭해야 진행됩니다)</span>
        </div>
        <button onclick="proceedPwReset()" style="width:100%;padding:.65rem;background:var(--acc);color:#fff;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;font-family:var(--ff);">비밀번호 재설정 계속하기 →</button>
      </div>
    `;
  }
}

function proceedPwReset() {
  try {
    const url = atob(window._pwGoEncoded || '');
    if(!url.startsWith('https://')) { showAuthError('유효하지 않은 링크예요.'); return; }
    window.location.href = url;
  } catch(e) {
    showAuthError('링크가 올바르지 않아요.');
  }
}

async function doUpdatePassword() {
  const pw = document.getElementById('newpw-input').value;
  const pw2 = document.getElementById('newpw-confirm').value;
  if(pw.length < 6) { showAuthError('비밀번호는 6자 이상이어야 해요.'); return; }
  if(pw !== pw2) { showAuthError('비밀번호가 일치하지 않아요.'); return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if(error) { showAuthError(error.message); return; }
  showAuthError('비밀번호가 변경됐어요! 다시 로그인해주세요.', true);
  setTimeout(() => { sb.auth.signOut(); authSwitch('login', document.querySelectorAll('.auth-tab')[0]); }, 2000);
}

function togglePwChange() {
  const form = document.getElementById('pw-change-form');
  const arrow = document.getElementById('pw-change-arrow');
  const msg = document.getElementById('pw-change-msg');
  if(!form) return;
  const open = form.style.display !== 'none';
  form.style.display = open ? 'none' : 'block';
  if(arrow) arrow.textContent = open ? '▾' : '▴';
  if(!open) {
    ['pw-current','pw-new','pw-confirm'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    if(msg) { msg.style.display='none'; msg.textContent=''; }
  }
}

async function changePassword() {
  const cur = document.getElementById('pw-current')?.value || '';
  const pw = document.getElementById('pw-new')?.value || '';
  const pw2 = document.getElementById('pw-confirm')?.value || '';
  const msg = document.getElementById('pw-change-msg');
  const showMsg = (text, ok=false) => {
    if(!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? '#2a7a3a' : '#c0392b';
    msg.style.display = 'block';
  };
  if(!cur) { showMsg('현재 비밀번호를 입력해주세요.'); return; }
  if(pw.length < 6) { showMsg('새 비밀번호는 6자 이상이어야 해요.'); return; }
  if(pw !== pw2) { showMsg('새 비밀번호가 일치하지 않아요.'); return; }
  if(cur === pw) { showMsg('새 비밀번호가 현재 비밀번호와 같아요.'); return; }

  const { error } = await sb.auth.updateUser({ password: pw });
  if(error) {
    if(error.message?.toLowerCase().includes('same password')) {
      showMsg('현재 비밀번호와 다른 비밀번호를 입력해주세요.'); return;
    }
    showMsg('변경 실패: 다시 로그인 후 시도해주세요.'); return;
  }
  showMsg('비밀번호가 변경됐어요!', true);
  ['pw-current','pw-new','pw-confirm'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  setTimeout(() => togglePwChange(), 2000);
}

async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pw    = document.getElementById('signup-pw').value;
  const name  = document.getElementById('signup-name').value.trim();
  const code  = document.getElementById('signup-code').value.trim().toUpperCase();
  if (!name) { showAuthError('닉네임을 입력해주세요.'); return; }
  if (!code) { showAuthError('초대코드를 입력해주세요.'); return; }
  // 초대코드 검증
  const { data: codeRow, error: codeErr } = await sb
    .from('invite_codes').select('*').eq('code', code).single();
  if (codeErr || !codeRow) { showAuthError('유효하지 않은 초대코드예요.'); return; }
  if (codeRow.used_by) { showAuthError('이미 사용된 초대코드예요.'); return; }
  // 회원가입
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { showAuthError(error.message); return; }
  if (data.user) {
    await sb.from('profiles').upsert({id:data.user.id, username:name, display_name:name, role:'user'});
    await sb.from('invite_codes').update({used_by:data.user.id, used_at:new Date().toISOString()}).eq('code', code);
    // 구매 코드로 가입한 경우: 같은 구매의 나머지 코드를 owner로 할당
    const { data: purchase } = await sb.from('pending_payments').select('id,codes').eq('status','confirmed').filter('codes', 'cs', JSON.stringify([code])).maybeSingle();
    if (purchase?.codes?.length) {
      const siblingCodes = purchase.codes.filter((c) => c !== code);
      if (siblingCodes.length) {
        await sb.from('invite_codes').update({owner_id: data.user.id}).in('code', siblingCodes);
      }
    } else if (codeRow.owner_id !== null && codeRow.source !== 'event_registration') {
      // 기존 유저의 초대코드(owner_id 있음)로 가입한 경우에만 1개 자동 발급
      // 구매 코드(owner_id null)나 이벤트 가입권은 제외 — 구매 패키지 수량 그대로만 지급
      const newCode = Math.random().toString(36).substring(2,8).toUpperCase()+Math.random().toString(36).substring(2,5).toUpperCase();
      await sb.from('invite_codes').insert({code:newCode, owner_id:data.user.id, created_at:new Date().toISOString()});
    }
  }
  showAuthError('가입 완료! 이메일 인증 후 로그인해주세요.', true);
}
async function deleteMyAccount() {
  const email = currentUser?.email || '';
  const confirmed = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    overlay.innerHTML = `
      <div style="background:var(--card);border-radius:14px;padding:1.4rem 1.3rem;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25);">
        <div style="font-size:1.1rem;font-weight:700;color:#c0392b;margin-bottom:.6rem;">⚠️ 회원 탈퇴</div>
        <div style="font-size:.78rem;color:var(--tx2);line-height:1.7;margin-bottom:.9rem;">
          탈퇴하면 아래 모든 데이터가 <strong>영구 삭제</strong>되며 복구할 수 없어요.<br><br>
          📚 서재의 모든 책 기록<br>
          ✍️ 문장 수첩<br>
          ⏱ 독서 타이머 기록<br>
          🚶 산책 게시판 글·댓글<br>
          🏆 획득한 뱃지·칭호
        </div>
        ${email ? `<div style="font-size:.68rem;color:var(--tx3);background:#faf6ef;border-radius:6px;padding:.4rem .6rem;margin-bottom:.9rem;word-break:break-all;">${email}</div>` : ''}
        <div style="display:flex;gap:.5rem;">
          <button id="_da_cancel" style="flex:1;padding:.55rem;border:1px solid var(--border2);border-radius:8px;background:none;font-size:.78rem;color:var(--tx2);cursor:pointer;font-family:var(--ff);">취소</button>
          <button id="_da_confirm" style="flex:1;padding:.55rem;border:none;border-radius:8px;background:#c0392b;color:#fff;font-size:.78rem;font-weight:700;cursor:pointer;font-family:var(--ff);">탈퇴하기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_da_cancel').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#_da_confirm').onclick = () => { overlay.remove(); resolve(true); };
  });
  if (!confirmed) return;

  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('로그인 세션이 없어요. 다시 로그인해주세요.');

    const resp = await fetch('/api/delete-my-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || '탈퇴 처리 실패');

    try { await sb.auth.signOut(); } catch(_) {}
    alert('탈퇴가 완료됐어요. 이용해주셔서 감사합니다 🙏');
    location.reload();
  } catch(e) {
    alert('탈퇴 오류: ' + (e.message || '서버 오류가 발생했어요'));
    console.error('deleteMyAccount error:', e);
  }
}

async function doLogout() {
  closeModal('modal-profile');
  try {
    await sb.auth.signOut();
  } catch(e) {
    console.warn('signOut error:', e);
  }
  resetToAuth();
}

async function resetSession() {
  try { await sb.auth.signOut({scope:'local'}); } catch(_) {}
  _appState = 'idle';
  showAuthError('세션이 초기화됐어요. 다시 로그인해주세요.', true);
  setTimeout(() => { showScreen('auth'); loadSavedEmail(); }, 1500);
}
function showAuthError(msg, success=false) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = '';
  el.style.color = success?'#2e7d32':'#9e3a1e';
  el.style.background = success?'#f0f8f0':'#fdf0ee';
  el.style.borderColor = success?'#a8d8a8':'#e8b8a8';
}

// ── 탭

// ── 시스템 폰트 설정
function applySystemFont(fontFamily) {
  if(!fontFamily) return;
  localStorage.setItem('bl_system_font', fontFamily);
  document.documentElement.style.setProperty('--ff', fontFamily);
  ['admin-font-select','user-font-select'].forEach(id=>{const s=document.getElementById(id);if(s)s.value=fontFamily;});
  ['font-preview-wrap','user-font-preview'].forEach(id=>{const p=document.getElementById(id);if(p)p.style.fontFamily=fontFamily;});
}

function initSystemFont() {
  const saved = localStorage.getItem('bl_system_font');
  if(saved) {
    document.documentElement.style.setProperty('--ff', saved);
    ['admin-font-select','user-font-select'].forEach(id=>{const s=document.getElementById(id);if(s)s.value=saved;});
    ['font-preview-wrap','user-font-preview'].forEach(id=>{const p=document.getElementById(id);if(p)p.style.fontFamily=saved;});
  }
}

function showUnsavedTimerBanner() {
  document.getElementById('unsaved-timer-banner')?.remove();
  const mins = Math.round(timerSeconds / 60);
  const banner = document.createElement('div');
  banner.id = 'unsaved-timer-banner';
  banner.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);background:#2a2016;color:#f5ede0;border-radius:12px;padding:.6rem .9rem;display:flex;align-items:center;gap:.55rem;box-shadow:0 4px 20px rgba(0,0,0,.38);z-index:9999;font-size:.78rem;max-width:92vw;';
  const icon = document.createElement('span');
  icon.textContent = '⏱'; icon.style.cssText = 'font-size:1rem;flex-shrink:0;';
  const textWrap = document.createElement('div');
  textWrap.style.cssText = 'flex:1;min-width:0;';
  const line1 = document.createElement('div');
  line1.style.cssText = 'font-weight:600;white-space:nowrap;';
  line1.textContent = `${mins}분 독서 기록이 저장되지 않았어요`;
  const line2 = document.createElement('div');
  line2.style.cssText = 'font-size:.68rem;color:#c8b8a0;margin-top:.08rem;white-space:nowrap;';
  line2.textContent = '저장하지 않으면 기록이 사라져요';
  textWrap.append(line1, line2);
  const goBtn = document.createElement('button');
  goBtn.textContent = '저장하러 가기';
  goBtn.style.cssText = 'background:#c4714a;color:#fff;border:none;border-radius:7px;padding:.3rem .6rem;font-size:.72rem;cursor:pointer;font-family:var(--ff);white-space:nowrap;flex-shrink:0;';
  goBtn.onclick = () => { document.querySelector('.tab[onclick*="record"]')?.click(); banner.remove(); };
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'background:none;border:none;color:#a09080;font-size:1.1rem;cursor:pointer;padding:0 .1rem;line-height:1;flex-shrink:0;';
  closeBtn.onclick = () => banner.remove();
  banner.append(icon, textWrap, goBtn, closeBtn);
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 10000);
}

function sw(name, btn) {
  // 기록 탭 벗어날 때 미저장 타이머 알림
  const currentPanel = [...document.querySelectorAll('.panel.on')].map(p=>p.id.replace('p-',''))[0];
  if(currentPanel === 'record' && name !== 'record' && timerSeconds >= 60) {
    showUnsavedTimerBanner();
  }
  // FAB 버튼: 어느 탭에서든 책 추가 가능
  const fab=document.getElementById('fab-add-book');
  if(fab) fab.style.display='flex';
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  const panel = document.getElementById('p-'+name); if(panel) panel.classList.add('on');
  if (name==='books')  buildBooks();
  if (name==='quotes') buildQuotes();
  if (name==='record') { renderCal(); buildTimer(); }
  if (name==='board')  buildBoard();
  if (name==='graph')  { buildStats(); buildMilestone(); buildGoalDisplay(); document.querySelectorAll('.gst').forEach((t,i)=>t.classList.toggle('on',i===0)); showGraph('monthly'); }
}

// ── 서재 (갤러리+리스트 통합)

let booksSearchQ = '';
function filterBooksSearch(q) {
  booksSearchQ = q.trim().toLowerCase();
  buildBooks();
}
function filterStatus(status, btn) {
  curFilter = status; curCatFilter = new Set();
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('on')); btn.classList.add('on');
  buildBooks();
}
function setView(v) {
  curView = v;
  document.getElementById('view-gallery-btn').classList.toggle('on', v==='gallery');
  document.getElementById('view-list-btn').classList.toggle('on', v==='list');
  document.getElementById('view-gallery').style.display = v==='gallery'?'':'none';
  document.getElementById('view-list').style.display = v==='list'?'':'none';
  buildBooks();
}
function getFilteredBooks() {
  let list = [...allBooks];
  if (curFilter === '다시읽기') list = list.filter(b=>b.reread);
  else if (curFilter !== '전체') list = list.filter(b=>b.status===curFilter);
  if (curCatFilter.size) list = list.filter(b=>curCatFilter.has(b.category||''));
  // 검색 필터
  if (booksSearchQ) {
    list = list.filter(b =>
      (b.title||'').toLowerCase().includes(booksSearchQ) ||
      (b.author||'').toLowerCase().includes(booksSearchQ) ||
      (b.publisher||'').toLowerCase().includes(booksSearchQ)
    );
  }
  // 정렬
  if(curSort === 'recent') {
    list.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  } else if(curSort === 'oldest') {
    list.sort((a,b) => new Date(a.created_at||0) - new Date(b.created_at||0));
  } else if(curSort === 'rating_high') {
    list.sort((a,b) => (b.rating||0) - (a.rating||0));
  } else if(curSort === 'rating_low') {
    list.sort((a,b) => (a.rating||0) - (b.rating||0));
  } else if(curSort === 'title') {
    list.sort((a,b) => (a.title||'').localeCompare(b.title||'', 'ko'));
  } else if(curSort === 'finish') {
    list.sort((a,b) => new Date(b.date_finish||0) - new Date(a.date_finish||0));
  }
  return list;
}

function toggleSortMenu(e) {
  if(e) e.stopPropagation();
  const menu = document.getElementById('sort-menu');
  if(!menu) return;
  const open = menu.style.display !== 'none';
  menu.style.display = open ? 'none' : 'block';
  if(!open) document.addEventListener('click', closeSortMenu, {once:true, capture:true});
}
function closeSortMenu() {
  const menu = document.getElementById('sort-menu');
  if(menu) menu.style.display = 'none';
}
function setSort(s) {
  curSort = s;
  document.querySelectorAll('.sort-mi').forEach(el => el.classList.toggle('on', el.dataset.val === s));
  closeSortMenu();
  buildBooks();
}

function buildBooks() {
  document.querySelectorAll('.sort-mi').forEach(el => el.classList.toggle('on', el.dataset.val === curSort));
  document.getElementById('view-gallery').style.display = curView==='gallery'?'':'none';
  document.getElementById('view-list').style.display = curView==='list'?'':'none';
  const list = getFilteredBooks();
  if (curView==='gallery') buildGallery(list);
  else buildList(list);
  // 필터 카운트 + 라벨 업데이트
  const fc = {
    all: allBooks.length,
    done: allBooks.filter(b=>b.status==='완독').length,
    now: allBooks.filter(b=>b.status==='읽는중').length,
    want: allBooks.filter(b=>b.status==='읽고싶음').length,
    stop: allBooks.filter(b=>b.status==='중단').length,
  };
  const setTxt = (id, v) => { const el=document.getElementById(id); if(el && v) el.textContent=v; };
  setTxt('fc-all',fc.all); setTxt('fc-done',fc.done); setTxt('fc-now',fc.now);
  setTxt('fc-want',fc.want); setTxt('fc-stop',fc.stop);
  const lbl=document.getElementById('lib-count-lbl');
  if(lbl) lbl.textContent=`MY LIBRARY · ${allBooks.length} VOLUMES`;
  // 필터 버튼 스타일 동기화
  document.querySelectorAll('.filter-btn').forEach(btn=>{
    const on = btn.classList.contains('on');
    btn.style.color = on ? 'var(--tx1)' : 'var(--tx2)';
    btn.style.fontWeight = on ? '700' : '500';
    btn.style.borderBottomColor = on ? 'var(--tx1)' : 'transparent';
  });
}
// ── 일괄 삭제
let selectMode = false, selectedIds = new Set();
function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds.clear();
  const btn = document.getElementById('select-mode-btn');
  const delBtn = document.getElementById('bulk-delete-btn');
  if(btn) btn.textContent = selectMode ? '✕ 취소' : '☑ 선택';
  if(delBtn) delBtn.style.display = selectMode ? '' : 'none';
  buildBooks();
}
async function bulkDelete() {
  if(!selectedIds.size){await showAlert('삭제할 책을 선택해주세요.');return;}
  if(!await showConfirm(`선택한 ${selectedIds.size}권을 삭제할까요?`))return;
  try {
    const ids = [...selectedIds];
    for(const id of ids){
      await sb.from('quotes').delete().eq('book_id',id);
      const {error} = await sb.from('books').delete().eq('id',id).eq('user_id',currentUser.id);
      if(error) throw error;
    }
    selectedIds.clear(); selectMode=false;
    const btn=document.getElementById('select-mode-btn');
    const delBtn=document.getElementById('bulk-delete-btn');
    if(btn)btn.textContent='☑ 선택';
    if(delBtn)delBtn.style.display='none';
    await loadData(); buildBooks(); if(document.getElementById('q-feed'))renderQuotes();
    alert('삭제됐어요!');
  }catch(e){alert('삭제 오류: '+(e.message||'알 수 없는 오류'));}
}

function buildGallery(list) {
  const g = document.getElementById('gal-grid'); g.innerHTML = '';
  if (!list.length) { g.innerHTML='<div class="empty-state">아직 기록된 책이 없어요.<br>+ 버튼으로 첫 책을 추가해보세요!</div>'; return; }
  list.forEach(b => {
    const el = document.createElement('div'); el.className='gi';
    if(selectMode) {
      const chk = selectedIds.has(b.id);
      el.style.outline = chk ? '2px solid var(--acc)' : '';
      el.style.opacity = chk ? '1' : '.85';
      el.onclick = () => {
        if(selectedIds.has(b.id)) selectedIds.delete(b.id); else selectedIds.add(b.id);
        buildBooks();
      };
    } else {
      el.onclick = ()=>openDetail(b.id);
    }
    const stColor={'완독':'#6b8f6b','읽는중':'#5a7a8a','읽고싶음':'#c4a87a','중단':'#8a3a28','다시읽기':'#c4714a'}[b.status]||'#4a3520';
    const stAccent='rgba(255,255,255,0.55)';
    const ttl = b.title||'';
    const titleDisp = ttl.length>16 ? ttl.slice(0,14)+'…' : ttl;
    const auth = (b.author||'').split(/[,·]/)[0].slice(0,12);
    const coverHtml = b.cover
      ? `<img src="${b.cover}" alt="${ttl}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:100%;background:${stColor};display:flex;flex-direction:column;justify-content:space-between;padding:${Math.round(68*0.12)}px ${Math.round(68*0.10)}px;box-sizing:border-box;overflow:hidden;">
           <div style="width:100%;height:1px;background:${stAccent};opacity:.5;"></div>
           <div style="display:flex;flex-direction:column;gap:4px;">
             <div style="font-family:var(--ff-disp);font-size:.42rem;color:${stAccent};font-style:italic;line-height:1.1;letter-spacing:.02em;">${titleDisp}</div>
             <div style="width:40%;height:1px;background:${stAccent};opacity:.55;margin-top:4px;"></div>
             <div style="font-family:var(--ff);font-size:.3rem;color:${stAccent};opacity:.75;letter-spacing:.08em;text-transform:uppercase;">${auth}</div>
           </div>
           <div style="width:100%;height:1px;background:${stAccent};opacity:.4;"></div>
         </div>`;
    const ratingVal = parseFloat(b.rating)||0;
    const ratingDisp = ratingVal>0 ? `<span style="display:inline-flex;align-items:center;gap:4px;margin-top:.15rem;"><span style="width:6px;height:6px;border-radius:50%;background:${stColor};display:inline-block;"></span><span style="font-family:var(--ff-disp);font-size:.68rem;font-style:italic;color:var(--rust);">★ ${ratingVal}</span></span>` : '';
    const totalMins = b.reading_time || 0;
    let timeStr;
    if(totalMins===0) timeStr='독서 기록 없음';
    else if(totalMins<60) timeStr=`${totalMins}분 독서`;
    else { const h=Math.floor(totalMins/60),m=totalMins%60; timeStr=m>0?`${h}시간 ${m}분 독서`:`${h}시간 독서`; }
    const thoughtCover = b.cover ? `<img src="${b.cover}" class="gi-thought-cover" alt="">` : `<div class="gi-thought-cover"></div>`;
    const statusLabel = {'완독':'✅ 완독','읽는중':'📖 읽는 중','읽고싶음':'🔖 읽고싶음','중단':'⏸ 중단'}[b.status]||b.status||'';
    el.innerHTML = `<div class="gi-thought">${thoughtCover}<div class="gi-thought-info"><div class="gi-thought-ttl">${ttl}</div><div class="gi-thought-time">⏱ ${timeStr}</div><div class="gi-thought-status">${statusLabel}</div></div></div>
      <div class="gi-cover">${coverHtml}</div>
      <div class="gi-title" title="${ttl}">${ttl}</div>
      <div class="gi-author">${auth}</div>
      ${ratingDisp}`;
    g.appendChild(el);
  });
}
function buildList(list) {
  const g = document.getElementById('book-list-items'); g.innerHTML = '';
  if (!list.length) { g.innerHTML='<div class="empty-state">아직 기록된 책이 없어요.</div>'; return; }
  list.forEach(b => {
    const el = document.createElement('div'); el.className='book-list-item';
    if(selectMode) {
      const chk = selectedIds.has(b.id);
      el.style.outline = chk ? '2px solid var(--acc)' : '';
      el.style.background = chk ? '#ede4d0' : '';
      el.onclick = () => { if(selectedIds.has(b.id)) selectedIds.delete(b.id); else selectedIds.add(b.id); buildBooks(); };
    } else {
      el.onclick = ()=>openDetail(b.id);
    }
    const coverEl = b.cover ? `<img class="bli-cover" src="${b.cover}" alt="${b.title}">` : `<div class="bli-cover"></div>`;
    el.innerHTML = `${coverEl}
      <div class="bli-info">
        <div class="bli-title">${b.title}</div>
        <div class="bli-author">${b.author||''}</div>
        <div class="bli-meta">
          <span class="pill">${b.status||''}</span>
          ${b.genre?`<span class="pill">${Array.isArray(b.genre)?b.genre[0]:b.genre}</span>`:''}
        </div>
      </div>
      <div class="bli-right">
        <div style="font-size:.7rem;color:var(--acc);">${'★'.repeat(b.rating||0)}</div>
        <div style="font-size:.62rem;color:var(--tx3);">${b.date_finish||''}</div>
      </div>`;
    g.appendChild(el);
  });
}

// ── 문장 수집
let quoteSearchQ = '';
let quoteSelectMode = false;
let quoteHlFilter = null;
let selectedQuoteIds = new Set();
let quotePage = 1;
const QUOTES_PER_PAGE = 20;

function qGoPage(p) {
  quotePage = p;
  renderQuotes();
  document.getElementById('q-feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildQuotes() {
  const filterEl = document.getElementById('q-filter');
  filterEl.innerHTML = '';

  // ── 검색바 (나의 서재 스타일)
  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:14px;color:var(--tx3);';
  searchRow.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input id="quote-search-input" type="text" placeholder="제목, 작가, 문장으로 검색"
      style="flex:1;border:none;background:transparent;font-size:.78rem;color:var(--tx1);font-style:italic;font-family:var(--ff);outline:none;" value="${quoteSearchQ}">`;
  filterEl.appendChild(searchRow);

  // ── 필터 행: 형광펜 칩 + 액션 버튼
  const filterRow = document.createElement('div');
  filterRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';

  const hlRow = document.createElement('div');
  hlRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  hlRow.innerHTML = `
    <span style="font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);">형광펜</span>
    <button id="hl-btn-yellow" onclick="toggleHlFilter('#f5e27a',this)" title="노란 형광펜"
      style="width:18px;height:18px;border-radius:50%;background:#f5e27a;border:2px solid ${quoteHlFilter==='#f5e27a'?'#8a6a00':'rgba(0,0,0,.08)'};cursor:pointer;transition:all .15s;"></button>
    <button id="hl-btn-mint" onclick="toggleHlFilter('#b8e8d4',this)" title="민트 형광펜"
      style="width:18px;height:18px;border-radius:50%;background:#b8e8d4;border:2px solid ${quoteHlFilter==='#b8e8d4'?'#2a7a5a':'rgba(0,0,0,.08)'};cursor:pointer;transition:all .15s;"></button>
    <button id="hl-btn-peach" onclick="toggleHlFilter('#f5c4a0',this)" title="살구 형광펜"
      style="width:18px;height:18px;border-radius:50%;background:#f5c4a0;border:2px solid ${quoteHlFilter==='#f5c4a0'?'#8a4a1a':'rgba(0,0,0,.08)'};cursor:pointer;transition:all .15s;"></button>`;

  const actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;align-items:center;gap:.3rem;';
  actionRow.innerHTML = `
    <button id="quote-select-btn" class="cat-btn" onclick="toggleQuoteSelect()" style="font-size:.7rem;">${quoteSelectMode?'✕ 취소':'☑ 선택'}</button>
    <button id="quote-delete-btn" class="cat-btn" onclick="bulkDeleteQuotes()" style="display:${quoteSelectMode?'flex':'none'};color:#c0392b;border-color:#e8b8a8;font-size:.7rem;">삭제</button>
    <button onclick="addQuoteFromTab()" style="padding:.3rem .9rem;background:var(--acc);color:#fff;border:none;border-radius:20px;font-size:.72rem;font-weight:600;cursor:pointer;font-family:var(--ff);box-shadow:0 2px 8px rgba(0,0,0,.12);">＋ 추가</button>`;

  filterRow.appendChild(hlRow);
  filterRow.appendChild(actionRow);
  filterEl.appendChild(filterRow);

  const inp = document.getElementById('quote-search-input');
  if(inp) inp.oninput = (e) => { quoteSearchQ = e.target.value; quotePage = 1; renderQuotes(); };

  renderQuotes();
}

function toggleHlFilter(color, btn) {
  quoteHlFilter = quoteHlFilter === color ? null : color;
  quotePage = 1;
  buildQuotes(); // 버튼 상태 포함 재렌더
}
function toggleQuoteSelect() {
  quoteSelectMode = !quoteSelectMode;
  selectedQuoteIds.clear();
  buildQuotes();
}

async function deleteAllQuotes() {
  if(!allQuotes.length) { await showAlert('삭제할 문장이 없어요.'); return; }
  if(!await showConfirm(`수집된 문장 ${allQuotes.length}개를 전부 삭제할까요?\n이 작업은 되돌릴 수 없어요.`)) return;
  try {
    await sb.from('quotes').delete().eq('user_id', currentUser.id);
    await loadData();
    buildQuotes();
  } catch(e) { alert('삭제 오류: '+e.message); }
}

async function bulkDeleteQuotes() {
  if(!selectedQuoteIds.size) { await showAlert('삭제할 문장을 선택해주세요.'); return; }
  if(!await showConfirm(`선택한 ${selectedQuoteIds.size}개의 문장을 삭제할까요?`)) return;
  try {
    const ids = [...selectedQuoteIds];
    for(const id of ids) {
      await sb.from('quotes').delete().eq('id', id).eq('user_id', currentUser.id);
    }
    selectedQuoteIds.clear();
    quoteSelectMode = false;
    await loadData();
    buildQuotes();
  } catch(e) { alert('삭제 오류: '+e.message); }
}

// ── 문장 카드 이미지 공유 (분할 지원)
async function shareQuoteCard(qtId, btn) {
  const qt = allQuotes.find(q=>q.id===qtId);
  if(!qt) return;
  const book = allBooks.find(b=>b.id===qt.book_id);

  // 플래시 효과
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:9999;pointer-events:none;transition:opacity .08s';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.opacity = '0.85';
    setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.remove(), 250); }, 100);
  });

  // 색상 테마
  const colors = ['#f5e8d0','#e8f0e8','#e8eef5','#f5ede8','#ede8f5'];
  const accs   = ['#c4714a','#5a8a5a','#4a6a8a','#8a5a3a','#6a4a8a'];
  const ci = Math.abs((qtId||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % colors.length;
  const bg = colors[ci], acc = accs[ci];

  // HTML 서식 보존 텍스트 준비
  const rawText = qt.text || '';
  // \n → <br> 변환 (이미 <br>이면 그대로)
  let richText = rawText
    .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
    .replace(/<\/div>\s*<div>/gi, '<br>')
    .replace(/<div>/gi, '<br>').replace(/<\/div>/gi, '')
    .replace(/<p>/gi, '').replace(/<\/p>/gi, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/(<br>){3,}/gi, '<br><br>');
  // html2canvas가 형광펜 span 내 텍스트 색상을 상속받지 못하는 버그 대응:
  // background-color가 있는 span에 명시적으로 color 추가
  // Fix 1: 형광펜 span에 명시적 color 주입 (기존 color 제거 후 재주입)
  // html2canvas가 background-color를 text color로 잘못 사용하는 버그 방지
  richText = richText.replace(
    /<span([^>]*)style="([^"]*)"/gi,
    (match, before, styleVal) => {
      if (!/background/i.test(styleVal)) return match;
      const clean = styleVal.replace(/(?:^|;)\s*color\s*:[^;]+/gi, '').replace(/^;+/, '').trim();
      return `<span${before}style="color:#2e1f0e;${clean}"`;
    }
  );
  // Fix 2: split highlight spans at every <br> so each visual line is a self-contained span
  // html2canvas misrenders text inside a background-color span that contains <br>
  richText = richText.replace(
    /<span([^>]*style="[^"]*background[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi,
    (match, attrs, content) => {
      if (!/<br>/i.test(content)) return match;
      return content.split(/<br>/i)
        .map(p => `<span${attrs}>${p}</span>`)
        .join('<br>');
    }
  );
  const plainText = rawText.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
  let lines = richText.split(/<br>/i);

  // 책 표지 base64 변환 (CORS 우회)
  let coverB64 = '';
  if(book?.cover) {
    try {
      // Image + canvas로 CORS 우회
      coverB64 = await new Promise((res) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            res(c.toDataURL('image/jpeg', 0.8));
          } catch(e) { res(''); }
        };
        img.onerror = () => {
          // crossOrigin 없이 재시도 (tainted canvas → html2canvas allowTaint)
          const img2 = new Image();
          img2.onload = () => res(img2.src);
          img2.onerror = () => res('');
          img2.src = book.cover + (book.cover.includes('?') ? '&' : '?') + '_t=' + Date.now();
        };
        img.src = book.cover;
      });
    } catch(e) { coverB64 = ''; }
  }

  // html2canvas 로드
  if(!window.html2canvas) {
    await new Promise((res,rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }

  // 전체를 한 장에 담기 (분할 없음)
  // 폰트 크기: 글자 수에 따라 자동 축소
  const pLen = plainText.length;
  let lineCount = lines.length;
  let fontSize = pLen > 400 || lineCount > 20 ? 9
               : pLen > 250 || lineCount > 14 ? 10
               : pLen > 150 || lineCount > 9  ? 11
               : pLen > 80  || lineCount > 5  ? 12 : 13;
  let lineH = fontSize <= 10 ? 1.75 : 1.9;

  // Fix 4: 하이라이트 span이 줄 중간에 시작하면 앞에 <br> 삽입
  // html2canvas 버그: background-color span이 x>0 에서 시작하면 텍스트 좌표가 잘못 계산돼
  // 텍스트가 하이라이트 뒤로 숨거나 오른쪽으로 밀려남
  // → 모든 하이라이트 span을 항상 줄 맨 앞(x=0)에서 시작하도록 강제
  richText = richText.replace(
    /([^>])<span([^>]*style="[^"]*background[^"]*"[^>]*)>/gi,
    '$1<br><span$2>'
  );

  // Fix 3: 실제 브라우저 레이아웃으로 자연 줄바꿈 위치 측정 후 span 분리
  // Fix 4로 모든 span이 x=0에서 시작하므로 측정이 정확함
  // DOM 수정 없이 splitOps를 수집한 뒤 richText 문자열에 직접 적용 (직렬화 오차 방지)
  await document.fonts.ready;
  (() => {
    const mDiv = document.createElement('div');
    mDiv.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:328px;` +
      `font-size:${fontSize}px;line-height:${lineH};` +
      `font-family:'Nanum Myeongjo','Georgia',serif;color:#2e1f0e;`;
    mDiv.innerHTML = richText;
    document.body.appendChild(mDiv);
    void mDiv.getBoundingClientRect();
    const splitOps = [];
    for (const span of [...mDiv.querySelectorAll('span')].filter(
      s => /background/i.test(s.getAttribute('style') || '')
    )) {
      const tNode = [...span.childNodes].find(n => n.nodeType === 3);
      if (!tNode || tNode.textContent.length <= 1) { splitOps.push(null); continue; }
      const txt = tNode.textContent;
      const range = document.createRange();
      const bps = [];
      let lastTop = null;
      for (let i = 0; i < txt.length; i++) {
        range.setStart(tNode, i); range.setEnd(tNode, i + 1);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const top = Math.round(r.top);
        if (lastTop !== null && top > lastTop + 2) bps.push(i);
        lastTop = top;
      }
      splitOps.push(bps.length ? {bps} : null);
    }
    mDiv.remove();
    let si = 0;
    richText = richText.replace(
      /<span([^>]*style="[^"]*background[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi,
      (match, attrs, content) => {
        const op = splitOps[si++];
        if (!op || /</.test(content)) return match;
        const parts = [];
        let prev = 0;
        for (const bp of op.bps) { parts.push(content.slice(prev, bp).trimEnd()); prev = bp; }
        parts.push(content.slice(prev).trimStart());
        return parts.filter(Boolean).map(p => `<span${attrs}>${p}</span>`).join('<br>');
      }
    );
  })();

  // Fix 1b: html2canvas가 display:inline span의 background-color를 렌더링 안 하는 버그 대응
  // Fix 3에서 줄바꿈 분리 완료 후 display:inline-block 적용
  // (Fix 3 측정은 display:inline 상태에서 해야 정확하므로 측정 후에 적용)
  richText = richText.replace(
    /<span([^>]*style="[^"]*background[^"]*"[^>]*)>/gi,
    (match, attrs) => {
      const newAttrs = attrs.replace(/style="([^"]*)"/, (m, s) => {
        const clean = s.replace(/(?:^|;)\s*display\s*:[^;]+/gi, '').replace(/^;+/, '').trim();
        return `style="display:inline-block;${clean}"`;
      });
      return `<span${newAttrs}>`;
    }
  );

  lines = richText.split(/<br>/i);
  const chunks = [lines.join('<br>')];
  const total = 1;

  // 카드 생성 및 캡처
  const dataUrls = [];
  for(let i = 0; i < total; i++) {
    const card = document.createElement('div');
    card.style.cssText = `position:absolute;left:-9999px;top:0;width:380px;min-width:380px;max-width:380px;background:${bg};padding:24px 26px 18px;font-family:'Nanum Myeongjo','Georgia',serif;box-sizing:border-box;border-radius:12px;`;
    const isFirst = i === 0;
    const isLast = i === total - 1;
    const pageLabel = total > 1 ? `<div style="font-size:9px;color:${acc};opacity:.5;text-align:right;margin-bottom:8px;font-family:sans-serif;">${i+1} / ${total}</div>` : '';
    card.innerHTML = `
      ${isFirst ? `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 477.75 390.69" width="44" height="36" style="display:block;">
  <!-- Generator: Adobe Illustrator 30.5.0, SVG Export Plug-In . SVG Version: 2.1.4 Build 64)  -->
  <defs>
    <style>
      .st0 {
        stroke: #c4714a;
      }

      .st0, .st1, .st2, .st3, .st4 {
        stroke-miterlimit: 10;
      }

      .st5 {
        fill: #c4714a;
      }

      .st1 {
        fill: #c4714a;
      }

      .st1, .st2, .st3, .st4 {
        stroke: #3a2810;
        stroke-width: .94px;
      }

      .st2 {
        fill: #c4a87a;
      }

      .st6 {
        fill: #d80b0b;
      }

      .st3 {
        fill: #6b8f6b;
      }

      .st4 {
        fill: #5a7a8a;
      }

      .st7 {
        display: none;
      }
    
  .loot-grid {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) !important;
    gap: 15px !important;
    padding: 15px !important;
    max-height: 450px !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    width: 100% !important;
    box-sizing: border-box !important;
    background: #fdf8ee !important;
  }
  .loot-item { background: #fff; border: 1px solid #d4af37; border-radius: 10px; cursor: pointer; }
  .loot-item span { font-weight: 400 !important; color: #333 !important; font-size: 12px; margin-top: 5px; }
  .loot-item.locked { opacity: 0.5; filter: grayscale(1); }
  .quest-card { background: #fdf8ee; border: 1px solid #d4af37; color: #111; }
  .quest-card h4 { color: #8B4513; }

</style>
  </defs>
  <g id="_레이어_1" data-name="레이어_1" style="display:none">
    <path class="st3" d="M420.41,177.82c-2.3.85-3.6,1.18-5.32,1.4l-7.68.98c-1.84.24-7.75,1.86-8.88,2.63-1.26.86-3.45-.24-5.11.62l-3.48,1.82c-1.58.83-3.66,1.83-3.72,3.73l-.61,18.07c-.1,2.91-4.82,15.04-3.65,14.51-5.32,2.44-1.77,4.88-4.51,8.96-2.6,3.87-4.63,7.69-4.75,7.81l-11.24,11.37-3.7,1.77c-1.18.57-3.45,1.02-4.37.09l-7.4-7.52c-2.97-3.01-3.2-12.99-1.94-21.11-.07.47,2.9-6.9,5.67-12.87l1.78-3.84,4.5-4.86c1.01-1.09.93-3.18.16-4.86l-3.18,1.6c-1.7.85-2.99,1.15-4.59,1.51l-4.15.92c-1.61.36-2.87.7-4.51,1.48l-3.54,1.69c-1.61.77-2.84.56-4.52,1.37l-3.7,1.8c-4.36,2.12-7.23,2.73-9.28,3.76l-3.67,1.84-3.71,1.85-3.71,1.85-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.85-3.69,1.82c-1.76.87-3.11,1.21-4.45,2.96-1.9,2.49-8.37,1.9-9.2-1.16-1.79-6.67.05-13.13,3.11-19.48l1.91-3.96,1.87-3.72,1.92-3.96c1.62-3.35,1.97-5.62,3.07-7.88l1.73-3.57c1.15-2.38,2.81-3.43,3.84-5.6l1.82-3.8,1.88-3.7,1.85-3.71,1.86-3.71,1.85-3.71,1.83-3.71c1.53-3.1,3.27-4.66,4.79-7.76l1.9-3.89,6.39-6.86c1.55-1.67,1.87-6.76,3.84-6.18.77.23,2.09,1.79,2.73,2.44,2.11,2.13,1.08,4.35-.28,6.14l-3.39,4.48c-1.29,1.7-3.77,5.63-4.88,7.96l-1.83,3.85c-.74,1.56-2.15,2.31-3.17,4.35l-1.8,3.6-1.84,3.7-1.85,3.71-1.85,3.71-1.86,3.71-1.86,3.71-1.87,3.71-1.93,4.02c-2.03,4.24-1.96,6.73-3.12,7.57-1.81,1.31-2.12,2.7-2.98,4.44l-1.82,3.69-1.85,3.71-1.9,3.78c-.64,1.28-1.79,2.44-1.28,4.65.97,4.15,6.13-1.4,12.27-4.53l3.78-1.93,4.15-2c.89-.43,1.82-2.98,4.12-2.91,1.72.05,2.63-.53,4.28-1.36l3.68-1.85,3.7-1.85,3.79-1.98,4.04-.92,3.79-1.98,3.71-1.85,3.68-1.84c2.08-1.04,4.65-1.62,8.08-2.97,3.65-1.44-2.53-11.19.6-14.53l2.61-2.78,1.87-4.08c4.23-9.23,15.02-2.29,18.52-5.47l6.81-6.2,7.78-.99c.61-.08,5.64-1.38,8.54-2.56,9.02-3.67,3.11,20.14,17.14,12.89l3.75-1.94,7.71-1c1.73-.22,7.33-3.25,19.45-3.15l3.45-1.89,15.15-.04,3.48-1.83,23.69-.6c1.01-.03,1.29-1.11,3.2-.14s3.38,1.43,2.98,4.46c-.24,1.83-2.12,2-2.94,2.38l-4.04,1.89-.99,4.45c-.52,2.32-7.01-3.08-8.78-3.09l-22.43-.06-3.51,1.78-9.47.15-4.64,1.73ZM369.04,182.84l4-3.67-1.61-3.09c-1.02-1.95-2.02-3.37-3.09-3.65-2.84-.72-8.72,2.31-9.54,4.25-.68,1.6-.75,4.39.03,6.18,1.15,2.66,3.66,1.66,5.84,1.11l4.38-1.12ZM349.33,183.36c.18-2.79-1.18-3.95-3.66-3.89-6.26.16-9.13,8.59-6.06,9.57.95.3,9.42-1.11,9.71-5.68ZM358.13,241.92l9.28-8.88c0-1.47.28-2.72,1.92-3.77-.09-1.39.2-2.7,1.86-3.69-.1-1.43.29-2.73,1.74-3.67.23-2,.99-3.41,2.56-4.97-1.03-1.91-.4-3.42,1.26-4.3-.11-1.48.26-2.82,1.91-3.77l.15-17.59c-2.02-.82-3.46-.12-4.26.88l-12.18,12.13c.03,3.83-4.39,5.03-5.85,8.86l-1.88,3.65-1.8,3.77-2.15,3.71c.73,1.74.21,3.23-1.35,4.14-.4,2.25-.38,4.3,0,6.4,1.59,1.26,1.68,2.36,1.74,4.24.1,3.2,4.52,5.28,7.04,2.87Z"/>
    <path class="st2" d="M20.86,255.79c-5.02.17-7.57,20.21-15.71,18.31-1.34-.31-4.39-3.39-4.65-4.64-.2-.92.83-2.07,1.12-3.3l.98-4.08,1.98-3.74c1.08-2.04,1.37-4.34,3.07-7.91l1.99-4.17c1.65-3.45,2-5.75,3.08-7.91l1.85-3.69,1.85-3.71,2-3.89c1.6-3.11,3.29-4.76,4.76-7.72l1.83-3.71,1.85-3.71,1.86-3.71,1.85-3.71,1.86-3.7,1.88-3.91c.75-1.56,2.11-2.28,3.17-4.39l1.8-3.55,1.83-3.68,1.79-3.63c.93-1.88,3.04-2.87,3.33-4.33l.9-4.46,4.58-4.87,1.82-3.82,1.86-3.71,1.97-3.85c.36-.71.49-2.55,1.83-3.39,3.31-2.07,3.58-7.4,4.3-8.86l1.73-3.5c1.8-3.64,5.72-7.72,8.05-12.41l1.85-3.72,1.79-3.73,5.62-5.79c.79-.82,3.89-.89,4.34-.15,1.24,2.01-.49,3.87-1.05,5.04l-1.98,4.16-3.13,4.07c-1.18,1.53-1,3.3-3.16,4.49-.91.5-1.7,2.55-.5,3.92.58.67,3.4.71,4.32-.16l4.89-4.63,6.17-.91,3.1-2.73c4.41-3.89,21.98-3.26,24.74.07,1.12,1.35.88,4.66.13,6.08l-1.97,3.75-1.68,3.81-26.86,27.07-3.54,1.85-5.01,4.36c-.96.83-1.48,4-.72,4.03l19.34.87c2.35.11,5.82,5.88,3.76,13.93l-2.72,2.8c-1.06,1.09-2.14,2.94-2.96,4.6l-1.74,3.52-7.69,7.5c-1.06,1.04-3.1,1-4.52,2.88-3.9,5.18-7.69,5.6-8.36,6.51-.89,1.21-2.04,2.8-3.67,3.58l-3.78,1.81c-5.05,2.42-12.62,10.23-20.91,14.21l-3.77,1.81c-2.07,1-3.32,2.96-4.7,4.55-1.49,1.73-3.17,1.51-4.73,2.95l-4.69,4.31c-2.05,1.88-5.84.54-8.61.63ZM42.76,236.96c1.74-3.72,5.26-3.34,6.29-4.86,1.1-1.63,2.51-2.52,4.58-2.52.94-1.55,2.26-1.92,3.72-1.83l4.6-5.14c3.55.11,5.47-4.56,11.19-7.46,2.1-.02,3.29-.97,4.67-2.46l4.56-4.92c3.11,0,5.36-2.26,5.36-5.36l6.96-6.48c-.02-1.48.41-2.74,1.7-3.75,1.25-3.05-.05-5.76-2.67-6.8-2.38,3.23-7.2.77-9.28,2.29-3.31,2.42-6.9.15-8.58,2.97l-10.22.02c-3.37-3.5-5.46-5.39-2.78-7.81l4.96-4.47c.82-.74,2.43-.79,3.51-1.89l18.49-18.75c1.54-.12,2.71-.64,3.75-1.67l18.62-18.51c1.38-1.37,1.48-3.24.47-4.48-.8-.98-2.68-2.66-4.81-1.61l-3.52,1.74c-1.61.79-3.11.17-4.38,1.65-1.39.16-2.41,1.37-3.85,1.69l-4.17.92c-1.48.33-2.38,1.54-3.94,1.67-.96,1.44-2.14,1.93-3.92,1.7-1.66,3.9-6.17,3.26-7.96,7.13-3.39-.11-5.48,2.17-5.54,5.35l-6.69,6.65c-.53.53-.31,2.68-1.93,3.6s-2.54,2.52-2.45,4.5c-1.63.92-1.95,2.3-1.8,3.64-1.77,1.2-1.29,2.74-2.26,3.78l-2.64,2.83c-.97,1.04-.49,2.57-2.26,3.78.13,1.33-.12,2.68-1.84,3.67.26,3.67-4.18,4.5-4.07,8.29-1.56.93-1.92,2.25-1.8,3.67-1.67,1-1.95,2.3-1.86,3.71-1.66,1.01-1.95,2.3-1.86,3.71-1.66,1.01-1.95,2.29-1.86,3.72-1.61,1.01-2.01,2.19-1.79,3.94-1.95.95-3.08,2.08-3.63,4l-1.8,3.95c-1.03.99-2.06,3.15-1.67,4.16.25.65,1.5,1.59,1.54,2.99l.25,8.78c1.68,1.01,1.94,2.34,1.9,3.83,5.32,2.07,6.24-3.38,10.73-3.57Z"/>
    <path class="st4" d="M180.15,229.78l-3.43-1.78c-.85-.44-5.16-1.5-8.79-2.12-1.41-2.25-3.65-1.67-4.91-.42l-6.67,6.62c.06,1.49-.25,2.76-1.89,3.79.09,1.41-.24,2.71-1.81,3.69l-.45,4.57c-1.57.98-1.9,2.28-1.8,3.69-1.67,1-1.93,2.35-1.89,3.65-1.67,1.25-1.02,2.93-1.71,4.33l-1.75,3.55c-.91,1.85-.69,4.32-2.48,5.26-.59.31-2.26-.72-2.83-1.9l-.12-10.15c1.58-.95,1.94-2.3,1.82-3.7,1.68-1,1.93-2.35,1.89-3.65,1.66-1.29.88-2.83,1.71-4.44l1.76-3.41c.83-1.61.04-3.15,1.71-4.44-.05-1.3.21-2.65,1.89-3.65-.09-1.4.19-2.7,1.85-3.71-.09-1.41.19-2.71,1.85-3.71-.1-1.42.23-2.71,1.8-3.7l.45-4.57c1.57-.98,1.9-2.28,1.8-3.7,1.65-1.01,1.95-2.27,1.86-3.74,1.7-.92,2.15-2.42,1.42-4.14l2.16-3.71,1.76-3.81,2.16-3.71c-.73-1.72-.28-3.22,1.42-4.15-.06-1.45.11-2.7,1.95-3.79.26-3.19,1.37-7.53,2.01-8.81l1.72-3.45c.82-1.65.08-3.18,1.72-4.42l.39-6.35c1.59-1.02,1.91-2.3,1.95-3.74,1.3-1.88,2.65-2.69,5.32-1.97l-.07,9.07-1.79,3.47-.29,6.96c-1.54,1.19-.89,2.84-1.65,4.35l-1.75,3.45c-.82,1.63-.04,3.15-1.7,4.44.05,1.3-.21,2.65-1.89,3.65.1,1.4-.19,2.7-1.85,3.7.1,1.42-.24,2.71-1.79,3.7l-.48,4.53c-1.52,1.18-1.9,2.35-1.77,4.41.19,1.55,1.82,2.03,2.72,1.5l2.87-1.7c2.09-.41,3.2-1.59,4.11-3.58,3.85.52,4.68-4.09,8.55-4.03.93-1.55,2.24-1.92,3.67-1.81,1.01-1.62,2.18-2.02,3.95-1.79.92-1.95,2.07-3.1,4.01-3.6l3.72-1.83,3.72-2.13c1.73.73,3.23.21,4.13-1.35,2.29-.37,4.24-.42,6.62,0,.69,1.56.72,3.75-.18,4.7l-5.57,5.9c-1.38.05-2.67.32-3.73,1.96-1.39-.11-2.72.24-3.65,1.81-3.89-.06-4.7,4.55-8.46,3.97-1.4,2.86-3.09,3.28-5.32,4.34-3.07,1.45-5.09,6.96-9.5,6.97-1.23,1.72-2.19,2.64-3.92,4.01.28,1.41,1.74,3.13,3.58,3.14l36.55.17c1.89,1.51,2.65,2.77,2.07,5.46l-5.45.02-3.4,1.81h-29.9Z"/>
    <path class="st3" d="M107.86,253.01c-1.86,1.21-3.46,1.37-5.73.5-.83,1-2.26,2.18-3.46,2.19l-16.87.04-3.51-1.76c-.81-.41-7.46-1.48-7.45-5.66l.03-14.59c1.96.03,3.04-.32,4.19-1.88,1.35.05,2.67-.22,3.68-1.88,1.4.09,2.7-.19,3.71-1.86,1.41.09,2.7-.19,3.71-1.86,1.41.09,2.71-.19,3.71-1.86,1.42.11,2.73-.25,3.67-1.8,2.04-.06,3.43-.85,4.7-2.55,1.03-1.39,2.26-2.81,4.14-3.23,1.75-.39,3.17,0,4.18,1.67,1.41-.1,2.77.23,3.71,1.9l10.26.26c1.7,3.12,3.71,4.03,7.23,3.68,1.06,1.81,2.37,1.99,3.71,1.95,1.14,1.59,2.22,1.94,4.17,1.84l.05,10.96c0,1.41-1.13,2.61-2.38,3.04-.95,2-2.54,2.76-4.51,2.7-.96,1.64-2.33,1.93-3.62,1.87-1.24,1.68-2.9,1.01-4.35,1.72l-3.59,1.75c-1.45.7-3.1-.04-4.37,1.79-1.3-.11-3.12-.24-5,1.06ZM98.26,246.96l8.89-1c7.61-.86,20.54-6.04,21.2-10.58.9-6.23-8.56-4.46-11.92-6.88-5.11-3.67-13.66-3.52-20.76,0l-3.77,1.87-3.7,1.86-3.73,1.81c-2.54,1.23-4.4,3.21-5.69,5.68l-1.87,3.57c-.77,1.46-.2,2.58,1.33,3.32l3.61,1.74c2.66,1.28,6.17-.61,8.76.71,2.93,1.49,4.8-1.78,7.66-2.1Z"/>
    <path class="st1" d="M143.77,218.9c-1.21,2.09-3.74,2.02-4.9.06-1.91-.12-3.44-.87-4.45-2.75-1.89-.78-2.76-2.39-2.07-4.74,1.45-1.07,2.6-2.04,3.77-3.7,2.34-.36,4.36-.35,6.5.02,1.18,1.6,2.38,1.78,4.21,1.62s2.75,2.14,1.66,3.54c.96,3.76-1.82,5.91-4.72,5.96Z"/>
  </g>
  <g id="_레이어_2" data-name="레이어_2" style="display:none">
    <g>
      <path d="M261.55,347.1c-2.5,0-5.5-.49-7.24-1.18-.01-.02-.03-.04-.04-.06-2.11-3.3-2.73-6.12-1.73-7.93l3.27-5.94,1.32-6.11,2.99-5.65c.79-1.49,1.3-3.04,1.89-4.84.67-2.03,1.42-4.33,2.78-7.18l3.02-6.33c1.36-2.85,2.14-5.18,2.83-7.25.59-1.75,1.1-3.27,1.83-4.75l2.79-5.59,2.77-5.61c1.11-2.25,2.3-3.97,3.56-5.8,1.21-1.75,2.46-3.57,3.66-5.92l3.04-5.92,2.81-5.65,2.82-5.63,2.79-5.61,3.17-6.02c.97-1.83,1.55-2.94-.53-4.91l-4.21-4c-.66-.62-1.44-.94-2.34-.94-1.62,0-3.26,1.06-4.26,2.05l-11.38,11.37-5.56,2.61-5.63,2.85-22.52,11.26-5.63,2.81-5.7,2.99-6.14,1.39-5.8,3.04-5.58,2.78c-1.48.74-3,1.25-4.76,1.84-2.06.69-4.39,1.47-7.24,2.83l-6.34,3.02c-4.05,1.93-9.26,4.13-11.78,4.72l-6.41,1.48c-2.5.58-4.47,1.08-6.96,2.28l-5.35,2.56c-2.3,1.1-4.46,1.64-6.65,2.15l-6.38,1.47-.95.21c-1.98.44-3.86.86-6.1,2.01l-5.38,2.76c-.58.3-1.33.43-2.38.43-.7,0-1.43-.06-2.2-.12-.78-.06-1.58-.13-2.35-.13-1.47,0-2.54.24-3.39.76-2.27,1.39-12.23,3.7-12.9,3.76l-19.3,1.33c-.25.02-.51.16-.94.39-1.01.55-2.89,1.58-5.99,1.58-2.81,0-5.99-.85-9.47-2.54l-5.3-2.56c-.89-.43-2.23-.78-3.78-1.19-3.6-.94-8.54-2.23-9.44-5.31-1.25-4.29-1.74-10.62.14-14.41l2.8-5.62,2.86-5.65,2.58-5.61,15.47-16.07,2.58-5.33,14.25-14.23,5.36-2.64,10.38-9.75c.84-.79,2.61-1.58,5.27-2.35,2.42-.7,3.44-2.46,4.25-3.87.54-.93,1-1.73,1.73-2.1l5.32-2.7c4.81-2.44,13.85-9.84,21.11-15.79l1.51-1.24c1.44-1.18,2.15-2.38,2.19-3.67.07-2.34-2.14-4.38-4.28-6.35-1.39-1.28-2.7-2.49-3.29-3.67l-2.9-5.82-1.49-9.44-4.14-4.24c-1.74-1.78-2.4-3.86-2.85-5.85l-1.45-6.4c-.49-2.18-1.41-4.81-2.29-7.35-.79-2.28-1.54-4.43-1.88-5.97l-1.41-6.33c-.52-2.35-1.02-4.35-2.28-6.96l-2.57-5.3c-1.18-2.44-1.81-4.09-2.16-6.91l-1.47-11.6c-.25-1.98-2.44-10.53-3.95-13.63-.84-1.73-.6-3.9-.34-6.2.28-2.47.57-5.02-.59-7.11l-2.81-5.08-.02-20.19-2.61-5.41c-1.42-2.95-.84-13.07,3.54-19.03.34.32.54.73.62,1.22.17,1.08-.35,2.27-.93,2.97l-.2.24.12.28c1.11,2.57.91,4.71.71,6.79-.17,1.83-.34,3.56.53,5.23l2.72,5.2.18,11.69,2.84,5.45c.62,1.2.48,2.9.34,4.7-.16,2.01-.33,4.09.59,5.67,1.41,2.4,1.74,5.68,2.1,9.15.4,3.89.81,7.91,2.67,11.64l2.69,5.37c.05.13.09.83.14,1.49.17,2.62.53,8.06,2.84,12.85l2.57,5.32c1.19,2.46,1.62,4.33,2.17,6.69l1.5,6.45c.53,2.27,1.09,4.5,2.22,6.87l2.58,5.43c.47,1,.62,1.94.78,2.94.19,1.24.39,2.53,1.24,3.92,3.59,5.94,7,15.56,6.52,23.65l-.03.57.57-.04c.25-.02.49-.03.72-.03,5.28,0,6.8,4.98,8.02,8.99.87,2.85,1.61,5.31,3.58,5.31.27,0,.55-.05.84-.15l6.54-2.2c2.34-.79,4.56-1.42,6.52-1.97,6.45-1.83,10.71-3.04,10.67-7.22-.1-9.59,9.4-11.38,18.59-13.11,4.62-.87,8.98-1.69,12.22-3.44.52-.28,1.05-.62,1.57-.95,1.29-.82,2.61-1.67,3.84-1.68l28.28-.1,5.18,2.62c1.26.64,2.4.83,3.5,1.03,1.12.2,2.19.38,3.37,1.01l5.76,3.04,6.13,1.37,5.68,2.98,5.64,2.86,5.63,2.52,21.51,21.17c.83.82,2.58,1.11,3.83,1.11,1.83,0,3.18-.53,3.62-1.43l2.86-5.85,2.82-5.63,2.76-5.6c1.31-2.65,2.69-4.43,3.9-6,1.76-2.27,3.15-4.07,2.89-7.06-.22-2.49,2.99-6.47,5.12-9.1,1.03-1.28,1.85-2.29,2.17-2.96l2.9-5.95c1.13-2.33,2.35-4.05,3.65-5.88,1.26-1.78,2.57-3.62,3.78-6.07l2.78-5.6,2.69-5.59,8.47-8.74c.47-.49,1.89-.84,3.38-.84s2.32.35,2.46.57c1.27,2.1-.02,4.3-1.07,6.08-.25.42-.47.81-.65,1.16l-3.91,7.8-6.63,7.32-2.93,5.95c-.31.63-.18,1.49.36,2.36.64,1.03,1.95,2.14,3.3,2.14.33,0,.65-.07.94-.2.26-.12.66-.27,1.13-.45,2.4-.91,4.27-1.68,4.59-2.69,1.12-3.44,3.34-3.88,6.71-4.55,3.77-.75,8.94-1.77,14.9-7.73.37-.37,1.52-.39,2.97-.42,2.53-.04,6.36-.11,10.97-2.02,1.98-.82,4.46-1.26,7.17-1.26s5.3.42,7.45,1.19c1.2.43,2.3,1.74,3.47,3.13,1.54,1.83,3.27,3.89,5.65,4.29l.21,2.32c-.25-.09-.49-.13-.72-.13-1.82,0-2.78,2.37-4.38,6.31-.49,1.2-1.03,2.54-1.67,4l-2.5,5.65-32.29,32.66-5.38,2.69-16.03,15.3c-2.69,2.57-3.65,4.12-3.22,5.2.41,1.03,1.93,1.17,3.21,1.17,1.83,0,4.37-.33,7.31-.7,4-.51,8.54-1.09,12.93-1.09,3.2,0,5.84.31,8.08.94,2.49.7,6.11,5.78,7.94,10.07.93,2.18.95,3.18.82,3.43l-2.41,4.5-3.07,5.88c-.37.7-.72,1.64-1.09,2.63-.64,1.7-1.37,3.63-2.25,4.54l-26.42,27.04-5.36,2.7-7.62,6.9-5.71,2.71c-2.53,1.2-6.46,3.57-11.67,7.03-.16.1-.28.18-.36.24h-.05l-7.67,7.06c-.09.06-.21.14-.4.26-5.19,3.46-9.09,5.81-11.58,6.99l-5.9,2.79-7.32,6.65c-.97.88-1.98,1.31-3.05,1.76-1.37.58-2.79,1.19-4.12,2.75-.38.44-.75.9-1.13,1.37-1.66,2.05-3.38,4.18-5.83,5.42l-5.64,2.87c-.97.49-1.88.73-2.79.73-1.32,0-2.4-.51-3.45-1-.9-.42-1.75-.82-2.64-.82s-1.67.39-2.42,1.18c-.35.37-.75.74-1.17,1.13-1.62,1.51-3.45,3.22-3.57,5.65-.32,6.24-4.29,10.44-5.98,12.23-.46.49-.67.72-.77.91l-2.82,5.49c-.36.7-1.95,1.12-4.26,1.12ZM318.42,223.59l-2.84,6-2.83,5.63-5.63,11.27-2.81,5.64-2.78,5.63c-1.24,2.51-2.63,4.33-3.85,5.93-2.42,3.17-4.33,5.67-3.67,11.27l1.74,14.79c.24,2.01,2.03,5.02,3.07,5.99.89.82,2.16,1.23,3.77,1.23,4.96,0,12.2-3.95,15-6.67l4.14-4.01c.55-.5,9.98-6.46,12.8-6.46,3.37,0,4.77-3.06,5.79-5.3.41-.89.83-1.82,1.18-2l5.64-2.97c1.67-.88,3.62-2.46,5.68-4.13,2.99-2.43,6.38-5.18,9.59-6.29l.49-.17c1.55-.52,4.15-1.4,5.16-2.39l21.44-21c.54-.53.9-1.28,1.34-2.23.96-2.04,2.41-5.12,7.17-8.92,1.5-1.2,2.23-3.16,1.89-5.11-.35-2.03-1.78-3.66-3.82-4.36-1.93-.66-4.3-1.04-6.5-1.04-2.4,0-4.49.44-6.05,1.26-3.46,1.84-6.44,1.88-9.07,1.92-1.93.03-3.6.05-5.06.8l-5.52,2.85c-2.87,1.48-4.97,2.14-6.82,2.14-2.29,0-4.4-1.01-7.3-3.49-2.02-1.73-3.22-3.91-3.28-6-.05-1.72.66-3.35,2.08-4.72l12.92-12.52,5.38-2.73,29.54-29.87,5.38-2.77,8.71-8.72,2.7-5.29,7.49-6.77c1-.9,1.97-2.93,1.8-4.65-.09-.92-.5-1.63-1.2-2.05-1.02-.61-2.67-.92-4.91-.92-4.52,0-10.39,1.29-14.26,3.13l-5.39,2.56c-1.14.54-2.15.74-3.22.95-1.13.22-2.31.46-3.64,1.12l-5.55,2.75c-3.31,1.64-7.66,4.44-10.26,6.11-1.01.65-1.96,1.26-2.13,1.34l.15-.03.45.29-.06.49-.69-.72-3.97,3.93c-1.21,1.2-2.48,1.7-3.82,2.24-1.16.46-2.35.94-3.48,1.88-1.64,1.37-2.32,2.99-2.92,4.42-.4.96-.79,1.87-1.41,2.54l-12.5,13.42-2.72,5.74-2.79,5.61c-1.12,2.26-2.31,3.98-3.57,5.81-1.21,1.76-2.46,3.57-3.66,5.91l-3.04,5.92-2.83,5.66-2.78,5.88-3.85,4.26ZM79.22,268.97l-5.76,8.42c-2.47,3.62-.87,7.97.3,10.24,1.58,3.07,4.12,5.68,5.54,5.7l38.94.69,5.44-2.82c.25.02.82.05,1.66.05h0c3.89,0,11.8-.74,21.08-5.72,4.03-2.17,10.09-4.42,12.21-4.89l6.29-1.39c2.58-.57,4.64-1.15,6.94-2.29l5.2-2.58c.88-.44,11.03-3.94,15.29-4.92l6.37-1.48,5.79-3.06,5.57-2.78c1.25-.62,2.31-.83,3.45-1.06,1.06-.21,2.16-.43,3.38-1l5.48-2.59c1.04-.49,2-.69,3.01-.89,1.16-.24,2.37-.48,3.76-1.18l33.74-16.88,5.64-2.81,5.61-2.77c3.25-1.6,7.56-4.37,10.14-6.03,1.07-.69,2.08-1.34,2.27-1.42l-.14.02-.45-.29.05-.49.69.73,3.98-3.98c.64-.64,3.3-1.98,5.88-3.29,3.12-1.58,6.07-3.06,7.02-4.01l3.97-3.94c.12-.1.83-.46,1.51-.8,3.51-1.76,10.03-5.05,8.58-8.06l-2.78-5.73-17.23-17.25c-.62-.62-1.91-1.1-3.55-1.72-2.82-1.06-6.68-2.51-8.79-5.34-.77-1.03-2.23-1.49-4.45-2.18-1.91-.6-4.28-1.34-7.27-2.73l-6.5-3.03c-.26-.12-.65-.4-1.09-.72-1.14-.82-2.71-1.95-4.35-1.96l-31.01-.16c-4.8,0-17.89,5.52-20.94,13.13-.37.12-.98.47-2.32,1.25-2.46,1.43-6.59,3.83-10.46,5.06l-6.63,2.1c-7.86,2.49-9.5,9.86-10.7,15.24-.84,3.76-1.43,6.07-3.15,6.07-.47,0-1.05-.17-1.72-.49l-6.07-2.99c-.43-.21-.9-.47-1.4-.75-1.77-.98-3.97-2.19-6.06-2.19-1.24,0-2.32.43-3.22,1.27l-13.29,12.49c-.39.36-1.14.63-1.94.91-1.67.59-3.75,1.32-4.67,3.53-.23.54-2.86,1.98-5.19,3.24-4.48,2.43-10.61,5.76-12.94,9.22-.77,1.14-2.62,2.22-4.75,3.46-3.67,2.14-8.25,4.81-10.79,9.6l-2.84,5.34-22.29,22.88Z"/>
      <path class="st5" d="M119.42,16.16c.06.13.1.28.12.44.12.79-.21,1.85-.82,2.57l-.39.47.24.56c1.06,2.45.86,4.53.67,6.54-.18,1.91-.35,3.71.59,5.51l2.67,5.1.18,11.45v.24s.11.21.11.21l2.78,5.34c.56,1.07.42,2.7.28,4.43-.17,2.09-.35,4.25.66,5.96,1.35,2.3,1.68,5.53,2.03,8.94.38,3.75.82,8.01,2.72,11.81l2.66,5.31c.04.21.08.82.12,1.37.17,2.65.54,8.16,2.89,13.03l2.57,5.32c1.16,2.41,1.59,4.25,2.13,6.58v.05s1.49,6.4,1.49,6.4c.53,2.3,1.11,4.56,2.26,6.98l2.58,5.43c.44.93.58,1.84.73,2.81.19,1.23.41,2.62,1.3,4.1,3.55,5.88,6.92,15.38,6.44,23.36l-.07,1.14,1.14-.09c.23-.02.46-.03.68-.03,4.91,0,6.31,4.59,7.54,8.63.92,3.04,1.72,5.66,4.06,5.66.32,0,.66-.06,1-.17l6.54-2.2c2.33-.78,4.54-1.41,6.5-1.97,6.43-1.82,11.08-3.14,11.03-7.71-.09-9.17,8.78-10.84,18.18-12.61,4.66-.88,9.06-1.71,12.37-3.49.54-.29,1.08-.64,1.6-.97,1.23-.78,2.49-1.59,3.58-1.6l28.16-.1,5.08,2.56c1.33.67,2.5.88,3.64,1.07,1.08.19,2.11.37,3.22.96l5.71,3.01.12.06.13.03,6,1.34,5.64,2.96,5.67,2.88,5.52,2.47,21.45,21.11c.94.92,2.78,1.25,4.18,1.25.97,0,3.32-.17,4.07-1.71l2.85-5.84,2.82-5.64,2.76-5.6c1.29-2.61,2.65-4.37,3.85-5.92,1.83-2.36,3.27-4.23,2.99-7.41-.2-2.29,2.93-6.18,5.01-8.75,1.05-1.31,1.88-2.34,2.23-3.05l2.9-5.95c1.11-2.29,2.32-4,3.6-5.81,1.27-1.8,2.59-3.66,3.82-6.14l2.79-5.61,2.65-5.52,8.41-8.68c.33-.34,1.55-.69,3.02-.69,1.22,0,1.89.23,2.05.36,1.01,1.7.14,3.44-1.09,5.53-.25.42-.48.82-.67,1.19l-3.88,7.74-6.54,7.22-.09.1-.06.13-2.9,5.89c-.39.79-.25,1.82.38,2.84.74,1.18,2.17,2.38,3.72,2.38.4,0,.79-.08,1.15-.24.24-.11.64-.26,1.1-.44,2.61-.99,4.5-1.78,4.89-3,1.03-3.17,2.91-3.54,6.34-4.21,3.84-.76,9.09-1.79,15.16-7.86.23-.23,1.61-.25,2.62-.27,2.57-.04,6.45-.11,11.15-2.06,1.92-.8,4.33-1.22,6.98-1.22s5.18.41,7.28,1.16c1.07.38,2.13,1.64,3.25,2.98,1.51,1.8,3.21,3.82,5.56,4.38l.11,1.28c-.06,0-.11,0-.17,0-2.15,0-3.17,2.49-4.84,6.62-.48,1.19-1.03,2.54-1.67,3.99l-2.46,5.57-32.16,32.53-5.24,2.62-.13.07-.11.1-15.98,15.25c-2.9,2.77-3.87,4.43-3.34,5.75.53,1.31,2.24,1.48,3.68,1.48,1.86,0,4.42-.33,7.38-.71,3.99-.51,8.5-1.09,12.87-1.09,3.15,0,5.75.3,7.94.92,1.65.47,4.27,3.44,6.37,7.24,1.81,3.28,2.18,5.2,2.09,5.54l-2.41,4.51-3.07,5.87c-.38.73-.74,1.68-1.12,2.69-.62,1.66-1.33,3.53-2.14,4.37l-26.37,26.98-5.23,2.63-.12.06-.1.09-7.52,6.81-5.64,2.68c-2.55,1.21-6.5,3.59-11.73,7.07-.24.16-.4.26-.45.3l.51.85-.67-.73-7.49,6.89c-.1.06-.22.14-.37.24-5.17,3.45-9.05,5.79-11.52,6.96l-5.83,2.76-.13.06-.11.1-7.27,6.6c-.9.82-1.88,1.24-2.91,1.68-1.36.58-2.9,1.23-4.3,2.89-.38.45-.76.91-1.14,1.38-1.63,2.01-3.32,4.09-5.67,5.29l-5.64,2.87c-.9.46-1.73.68-2.56.68-1.21,0-2.24-.48-3.24-.95-.95-.45-1.85-.87-2.85-.87-1.02,0-1.93.44-2.79,1.34-.34.35-.73.72-1.14,1.11-1.6,1.5-3.6,3.36-3.73,5.99-.31,6.05-4.19,10.16-5.84,11.91-.48.51-.72.76-.85,1.03l-2.82,5.49c-.15.29-1.14.85-3.82.85-2.34,0-5.22-.46-6.9-1.09-1.97-3.11-2.56-5.72-1.67-7.34l3.23-5.88.07-.13.03-.14,1.29-5.97,2.96-5.59c.81-1.53,1.32-3.1,1.92-4.92.66-2.01,1.41-4.3,2.75-7.12l3.02-6.33c1.37-2.88,2.16-5.23,2.85-7.3.58-1.74,1.09-3.24,1.81-4.69l2.8-5.6,2.77-5.61c1.1-2.22,2.27-3.93,3.52-5.73,1.22-1.77,2.48-3.59,3.7-5.97l3.04-5.93,2.81-5.64,2.82-5.63,2.78-5.59,3.06-5.81.12-.22c.97-1.83,1.73-3.27-.63-5.51l-4.21-4c-.74-.7-1.67-1.07-2.68-1.07-2.23,0-4.09,1.68-4.61,2.2l-11.32,11.31-5.5,2.59-5.62,2.84-5.63,2.81-5.63,2.82-5.63,2.82-5.63,2.82-5.65,2.82-5.63,2.95-6.01,1.36-.13.03-.12.06-5.72,3-5.59,2.79c-1.45.72-2.95,1.23-4.69,1.81-2.07.69-4.42,1.48-7.3,2.85l-6.34,3.02c-4.02,1.92-9.19,4.11-11.68,4.68l-6.41,1.48c-2.53.59-4.52,1.09-7.06,2.31l-5.35,2.56c-2.25,1.08-4.38,1.61-6.55,2.11l-6.38,1.47c-.32.07-.64.14-.95.21-2.02.45-3.92.87-6.22,2.05l-5.38,2.76c-.5.26-1.19.38-2.16.38-.68,0-1.4-.06-2.16-.12-.79-.06-1.6-.13-2.39-.13-1.56,0-2.72.26-3.65.83-2.15,1.31-11.77,3.58-12.67,3.69l-19.3,1.33c-.36.03-.67.2-1.15.45-.97.53-2.78,1.52-5.74,1.52-2.73,0-5.84-.84-9.25-2.49l-5.3-2.56c-.93-.45-2.3-.81-3.87-1.22-3.49-.91-8.27-2.16-9.09-4.97-1.23-4.2-1.71-10.38.11-14.05l2.79-5.61,2.87-5.69,2.54-5.51,15.36-15.96.11-.11.07-.14,2.51-5.19,14.13-14.11,5.21-2.57.13-.07.11-.1,10.33-9.7c.54-.5,1.85-1.3,5.07-2.24,2.61-.76,3.69-2.61,4.55-4.1.5-.86.93-1.6,1.53-1.91l5.32-2.7c4.86-2.47,13.92-9.88,21.2-15.85l1.52-1.24c1.53-1.26,2.33-2.62,2.38-4.04.08-2.57-2.22-4.69-4.44-6.73-1.29-1.19-2.63-2.43-3.18-3.53l-2.87-5.75-1.46-9.21-.05-.31-.22-.23-4.03-4.12c-1.65-1.69-2.28-3.7-2.72-5.61l-1.45-6.4c-.5-2.2-1.42-4.85-2.31-7.41-.79-2.26-1.53-4.4-1.86-5.91l-1.41-6.33c-.51-2.3-1.04-4.42-2.32-7.07l-2.57-5.3c-1.16-2.39-1.77-4.01-2.12-6.75l-1.47-11.6c-.25-2-2.47-10.65-4-13.79-.78-1.6-.54-3.7-.29-5.92.29-2.55.59-5.18-.65-7.41l-2.75-4.96-.02-19.95v-.23s-.1-.21-.1-.21l-2.56-5.31c-1.16-2.4-1.05-11.79,3.09-17.95M371.7,149.9s.16-.07.36-.07v.86s-.65-.65-.65-.65l-3.97,3.93c-1.14,1.13-2.36,1.61-3.65,2.13-1.19.47-2.42.96-3.62,1.96-1.73,1.45-2.44,3.12-3.06,4.61-.4.96-.75,1.79-1.31,2.39l-12.45,13.37-.11.11-.07.14-2.68,5.65-2.8,5.61c-1.11,2.23-2.29,3.94-3.53,5.75-1.22,1.77-2.48,3.6-3.69,5.97l-3.04,5.93-2.84,5.67-2.74,5.8-3.75,4.15-.1.11-.06.13-2.8,5.91-2.83,5.65-2.82,5.63-2.82,5.63-2.81,5.64-2.78,5.63c-1.22,2.47-2.59,4.26-3.8,5.85-2.39,3.13-4.45,5.83-3.77,11.63l1.74,14.79c.25,2.16,2.1,5.26,3.23,6.3.98.91,2.36,1.37,4.11,1.37,5.15,0,12.41-3.97,15.35-6.81l4.11-3.99c.8-.67,9.87-6.34,12.52-6.34,3.64,0,5.18-3.37,6.2-5.59.31-.68.73-1.61.96-1.77l5.64-2.97c1.72-.9,3.68-2.5,5.76-4.19,2.96-2.4,6.31-5.13,9.43-6.21l.48-.16c2.15-.73,4.34-1.52,5.35-2.51l21.44-21c.61-.59.98-1.38,1.45-2.38.94-2,2.36-5.01,7.03-8.74,1.65-1.32,2.44-3.46,2.07-5.58-.38-2.21-1.93-3.99-4.15-4.75-1.98-.68-4.41-1.07-6.67-1.07-2.48,0-4.65.46-6.28,1.32-3.36,1.78-6.27,1.82-8.84,1.86-1.91.03-3.72.05-5.28.86l-5.52,2.85c-2.79,1.44-4.82,2.08-6.59,2.08-2.16,0-4.18-.98-6.98-3.37-1.91-1.64-3.05-3.69-3.11-5.63-.05-1.6.6-3.06,1.92-4.35l12.87-12.47,5.24-2.66.14-.07.11-.12,29.43-29.76,5.24-2.7.14-.07.11-.11,8.6-8.61.11-.11.07-.14,2.63-5.14,7.42-6.71c1.11-1,2.15-3.17,1.96-5.07-.11-1.09-.6-1.93-1.44-2.43-1.1-.66-2.84-.99-5.17-.99-4.59,0-10.54,1.31-14.48,3.17l-5.39,2.56c-1.09.52-2.06.71-3.1.92-1.17.23-2.37.47-3.77,1.16l-5.55,2.75c-3.34,1.65-7.7,4.46-10.31,6.13-.92.59-1.88,1.21-2.07,1.3M209.28,173.35c-.42.18-1.05.54-2.2,1.21-2.45,1.42-6.54,3.8-10.36,5.01l-6.63,2.1c-8.14,2.58-9.81,10.11-11.03,15.61-.78,3.52-1.33,5.67-2.66,5.67-.4,0-.9-.15-1.5-.44l-6.07-2.99c-.42-.21-.89-.46-1.38-.74-1.82-1-4.08-2.25-6.3-2.25-1.37,0-2.57.47-3.57,1.41l-13.29,12.49c-.31.29-1.01.54-1.76.8-1.66.59-3.94,1.39-4.96,3.78-.38.53-2.93,1.91-4.98,3.02-4.78,2.59-10.72,5.82-13.12,9.37-.7,1.04-2.51,2.09-4.59,3.31-3.73,2.18-8.37,4.88-10.98,9.79l-2.81,5.27-22.24,22.82-.06.06-.05.07-5.71,8.36c-2.62,3.83-.96,8.39.27,10.76,1.5,2.91,4.15,5.94,5.98,5.97l38.81.69h.25s.23-.11.23-.11l5.2-2.7c.3.02.83.04,1.55.04,3.94,0,11.94-.75,21.31-5.78,3.93-2.11,10.04-4.39,12.08-4.84l6.29-1.39c2.61-.58,4.71-1.17,7.06-2.33l5.2-2.58c.78-.39,10.99-3.91,15.18-4.88l6.3-1.46.13-.03.11-.06,5.71-3.01,5.58-2.79c1.18-.59,2.22-.8,3.32-1.01,1.09-.22,2.22-.44,3.5-1.04l5.48-2.59c.98-.46,1.91-.65,2.9-.85,1.2-.24,2.43-.5,3.89-1.22l5.59-2.8,5.62-2.81,5.63-2.82,5.63-2.82,5.63-2.82,5.63-2.82,5.63-2.81,5.61-2.77c3.28-1.62,7.6-4.4,10.19-6.06.98-.63,1.99-1.28,2.2-1.38-.01,0-.15.07-.35.07v-.83s.65.64.65.64l3.98-3.98c.58-.58,3.45-2.03,5.75-3.19,3.71-1.87,6.21-3.17,7.15-4.1l3.94-3.9c.18-.12.84-.45,1.42-.74,3.92-1.97,10.47-5.27,8.8-8.72l-2.74-5.66-.07-.15-.12-.12-17.17-17.19c-.69-.69-1.97-1.17-3.73-1.83-2.76-1.04-6.54-2.45-8.57-5.17-.87-1.16-2.39-1.64-4.7-2.36-1.89-.59-4.25-1.33-7.21-2.71l-6.5-3.03c-.22-.1-.6-.38-1.01-.67-1.2-.86-2.84-2.04-4.64-2.05l-31.05-.16c-4.83,0-18,5.55-21.29,13.24M119.32,14.59c-4.94,6.26-5.36,16.92-3.89,19.95l2.56,5.31.02,20.21,2.87,5.19c2.11,3.81-.95,9.46.91,13.29,1.5,3.08,3.67,11.66,3.9,13.48l1.47,11.6c.36,2.8.96,4.49,2.21,7.06l2.57,5.3c1.2,2.48,1.71,4.43,2.24,6.85l1.41,6.33c.73,3.29,3.24,9.22,4.17,13.32l1.45,6.4c.52,2.29,1.26,4.33,2.98,6.09l4.03,4.12,1.48,9.36,2.94,5.89c2.02,4.05,11.63,8.07,5.51,13.08-7.43,6.08-17.43,14.38-22.53,16.97l-5.32,2.7c-2.11,1.07-2.13,4.85-5.9,5.94-1.49.43-4.23,1.3-5.47,2.47l-10.33,9.7-5.36,2.64-14.37,14.34-2.58,5.34-15.47,16.08-2.61,5.67-2.86,5.66-2.8,5.62c-2.01,4.04-1.41,10.57-.18,14.78,1.36,4.67,10.49,5.36,13.48,6.81l5.3,2.56c4.05,1.96,7.23,2.59,9.69,2.59,4.32,0,6.39-1.94,6.96-1.98l19.3-1.33c.58-.04,10.72-2.37,13.12-3.83.88-.53,1.96-.68,3.13-.68,1.49,0,3.11.25,4.55.25.98,0,1.88-.11,2.61-.49l5.38-2.76c2.53-1.3,4.56-1.63,6.94-2.18l6.38-1.47c2.19-.5,4.39-1.05,6.76-2.18l5.35-2.56c2.5-1.2,4.44-1.68,6.86-2.24l6.41-1.48c2.57-.6,7.74-2.78,11.88-4.75l6.34-3.02c5.23-2.49,8.72-3.03,12-4.67l5.59-2.79,5.74-3.01,6.14-1.39,5.75-3.01,5.63-2.81,5.63-2.82,5.63-2.82,5.63-2.82,5.62-2.81,5.62-2.84,5.64-2.65,11.44-11.43c.96-.96,2.47-1.91,3.9-1.91.71,0,1.4.23,2,.8l4.21,4c1.88,1.78,1.34,2.59.31,4.54l-3.06,5.81-2.79,5.61-2.82,5.63-2.81,5.64-3.04,5.92c-2.42,4.71-5,7.22-7.22,11.72l-2.77,5.61-2.79,5.59c-1.64,3.28-2.18,6.77-4.67,12l-3.02,6.33c-2.58,5.41-3.02,8.9-4.66,12l-3.02,5.71-1.32,6.11-3.23,5.88c-1.9,3.46,1.93,8.63,1.86,8.63,0,0,0,0,0,0,1.72.72,4.88,1.28,7.58,1.28,2.26,0,4.19-.39,4.71-1.39l2.82-5.49c.4-.78,6.4-5.52,6.8-13.34.15-2.84,2.93-4.7,4.6-6.46.72-.76,1.39-1.03,2.06-1.03,1.74,0,3.48,1.82,6.09,1.82.89,0,1.89-.21,3.01-.79l5.64-2.87c3.11-1.58,5.06-4.5,7.11-6.92,2.26-2.67,4.81-2.38,7.12-4.47l7.27-6.6,5.83-2.76c4.41-2.08,12.05-7.31,12.08-7.31,0,0,0,0,0,0l7.55-6.95s0,0,0,0c.04,0,7.65-5.21,12.09-7.32l5.78-2.74,7.63-6.91,5.38-2.7,26.48-27.1c1.49-1.53,2.44-5.39,3.43-7.29l3.07-5.87,2.41-4.5c1.02-1.91-4.95-13.05-9.06-14.22-2.48-.7-5.3-.96-8.21-.96-7.71,0-16.02,1.79-20.25,1.79-3.44,0-4.17-1.19.35-5.51l15.98-15.25,5.39-2.69,32.41-32.78,2.53-5.74c2.62-5.92,3.63-10.01,5.6-10.01.39,0,.82.16,1.3.5l-.32-3.64c-4.17-.34-6.31-6.34-9.41-7.44-2.2-.79-4.91-1.22-7.62-1.22-2.62,0-5.23.41-7.37,1.3-7.49,3.11-12.8,1.25-14.1,2.55-11.16,11.15-19.2,4.64-21.74,12.47-.36,1.11-4.29,2.31-5.46,2.83-.24.11-.48.15-.73.15-1.81,0-3.84-2.52-3.21-3.78l2.9-5.89,6.63-7.32,3.94-7.86c.96-1.92,3.44-4.85,1.7-7.72-.33-.54-1.55-.81-2.88-.81-1.49,0-3.1.33-3.74.99l-8.53,8.79-2.72,5.66-2.78,5.6c-2.41,4.85-5.14,7.25-7.43,11.95l-2.9,5.95c-.99,2.03-7.68,8.47-7.34,12.33.41,4.69-3.45,6.13-6.74,12.8l-2.76,5.6-2.82,5.63-2.85,5.85c-.39.79-1.75,1.15-3.17,1.15s-2.85-.35-3.48-.97l-21.58-21.24-5.69-2.54-5.63-2.86-5.74-3.01-6.13-1.37-5.71-3.01c-2.46-1.3-4.45-.81-6.88-2.04l-5.29-2.67-28.4.1c-1.9,0-3.84,1.71-5.65,2.69-9.77,5.28-31.22,2.17-31.07,17,.05,5.02-7.13,5.45-16.85,8.72l-6.54,2.2c-.25.08-.47.12-.69.12-4.03,0-2.23-14.3-11.6-14.3-.24,0-.5,0-.76.03.47-7.81-2.7-17.5-6.59-23.94-1.45-2.4-.88-4.48-1.99-6.82l-2.58-5.43c-1.11-2.34-1.68-4.6-2.18-6.77l-1.48-6.4c-.55-2.36-1-4.31-2.22-6.84l-2.57-5.32c-3.04-6.29-2.63-13.65-2.98-14.35l-2.69-5.37c-3.54-7.06-1.77-15.68-4.79-20.81-1.64-2.79.51-7.61-.92-10.35l-2.78-5.34-.18-11.69-2.78-5.31c-1.72-3.29.95-6.95-1.23-11.99,1.16-1.39,1.75-3.99-.17-5.21h0ZM372.06,150.82c.28,0,7.54-5.03,12.46-7.47l5.55-2.75c2.5-1.24,4.4-.91,6.85-2.07l5.39-2.56c3.95-1.88,9.77-3.08,14.05-3.08,2.01,0,3.68.27,4.66.85,1.86,1.12.72,4.63-.68,5.89l-7.56,6.83-2.71,5.3-8.6,8.61-5.38,2.77-29.54,29.87-5.37,2.72-12.98,12.57c-3.71,3.59-2.44,8.32,1.23,11.46,2.81,2.41,5.05,3.61,7.63,3.61,2,0,4.21-.73,7.05-2.2l5.52-2.85c3.23-1.67,8,.53,14.13-2.72,1.61-.85,3.69-1.21,5.82-1.21,2.25,0,4.54.4,6.34,1.02,4.04,1.39,4.65,6.3,1.78,8.6-6.98,5.58-6.99,9.65-8.55,11.19l-21.44,21c-1.04,1.02-4.11,1.98-5.46,2.44-5.51,1.9-11.28,8.32-15.33,10.45l-5.64,2.96c-1.49.78-2.19,7.25-6.69,7.25-.01,0-.02,0-.03,0,0,0-.01,0-.02,0-3.08,0-12.66,6.13-13.14,6.6l-4.14,4.01c-2.8,2.71-9.88,6.53-14.66,6.53-1.4,0-2.59-.33-3.43-1.1-1.02-.95-2.7-3.85-2.92-5.68l-1.74-14.79c-.97-8.24,3.8-9.5,7.47-16.92l2.78-5.63,2.81-5.64,2.82-5.63,2.82-5.63,2.83-5.64,2.81-5.93,3.85-4.26,2.81-5.93,2.83-5.65,3.04-5.92c2.4-4.68,4.97-7.2,7.23-11.73l2.8-5.61,2.69-5.67,12.45-13.37c1.63-1.75,1.62-4.69,4.28-6.91,2.33-1.94,4.96-1.79,7.33-4.14l3.97-3.93c-.06.05-.07.08-.05.08h0ZM209.99,174.28c2.66-7.51,15.78-13.17,20.58-13.16,0,0,.02,0,.03,0l31.01.16c2.1.01,4.19,2.14,5.23,2.63l6.5,3.03c6.47,3.02,10.27,3.07,11.53,4.76,3.4,4.55,10.86,5.58,12.4,7.11l17.17,17.19,2.74,5.66c1.59,3.28-9.35,7.65-9.99,8.28l-3.97,3.94c-1.72,1.71-11.46,5.85-12.9,7.29l-3.98,3.98c.07-.07.09-.1.06-.1-.31,0-7.57,5.05-12.49,7.47l-5.61,2.77-5.64,2.81-5.63,2.82-5.63,2.82-5.63,2.82-5.63,2.82-5.62,2.81-5.59,2.8c-2.55,1.27-4.47.98-6.76,2.07l-5.48,2.59c-2.41,1.14-4.31.8-6.83,2.07l-5.58,2.79-5.73,3.03-6.3,1.46c-4.22.98-14.49,4.51-15.4,4.96l-5.2,2.58c-2.31,1.15-4.4,1.72-6.83,2.25l-6.29,1.39c-2.2.49-8.35,2.8-12.34,4.94-9.43,5.07-17.42,5.66-20.84,5.66-1.06,0-1.68-.06-1.76-.06,0,0,0,0-.01,0l-5.44,2.83-38.81-.69c-2.23-.04-9.49-9.23-5.44-15.17l5.71-8.36,22.34-22.93,2.87-5.4c4.01-7.52,13.33-9.78,15.52-13.02,3.7-5.48,17.42-10.73,18.17-12.54,1.29-3.09,5.18-3.03,6.49-4.27l13.29-12.49c.88-.82,1.86-1.14,2.88-1.14,2.52,0,5.28,1.93,7.24,2.89l6.07,2.99c.76.37,1.4.55,1.94.55,5.44,0,1.26-17.3,13.99-21.33l6.63-2.1c5.89-1.86,12.23-6.34,12.91-6.34.05,0,.07.03.05.09h0Z"/>
    </g>
    <g>
      <path d="M183.75,124.49c-2.1,0-4-.4-5.35-1.12l-3.7-1.98c-3.89-2.07-4.81-3.73-5.98-5.81-.53-.95-1.14-2.03-2.09-3.23l.04-14.98c2.13-3.04,4.13-10.21,4.62-13.27l1.43-8.98c.3-1.9,3.24-9.71,5.79-13.93.84-1.38,1.04-2.66,1.23-3.9.16-1.01.3-1.97.79-2.99l2.59-5.45c.58-1.21.79-2.3,1-3.36.22-1.13.44-2.2,1.06-3.45l5.61-11.21,2.8-5.63,3.06-5.79,1.38-6.24,6.81-7.35c1.23-1.33,2.58-1.6,3.5-1.6,1.52,0,2.98.75,3.79,1.96,1.43,2.12,1.11,5.57-1.9,7.66l-.22.15v.27c.06,2.03-.74,3.24-1.51,4.41-.29.44-.59.89-.83,1.36l-3.8,7.57c-1.56,3.11-3.31,10.42-3.99,13.42l-1.45,6.4c-.73,3.24-1.99,6.82-2.91,9.43-.67,1.9-1.15,3.28-1.26,3.99l-1.42,8.97c-.26,1.66-1.23,4.38-2.16,7.01-.95,2.68-1.85,5.21-2.03,6.67l-1.47,11.6c-.12.99-2.63,8.45-4.54,11.23-.51.75-.47,2.13.09,3.22.55,1.06,1.46,1.65,2.56,1.67h.25c2.79,0,4.18-.75,5.94-1.69.32-.17.66-.35,1.02-.54l5.68-2.91c1.12-.57,2.28-.85,3.55-.85,1.98,0,3.84.67,5.65,1.33,1.54.55,2.99,1.08,4.31,1.08,1.4,0,2.5-.59,3.36-1.79,3.58-4.99,13.83-5.58,18.75-5.87,1.81-.1,2.46-.15,2.77-.32l5.36-2.8c.6-.31,1.17-.46,1.74-.46,1.19,0,2.2.67,3.09,1.26.24.16.47.31.69.44.37.22,3.56,2.29,1.57,6.02-2.81,5.27-7.43,5.87-10.66,5.87-.93,0-1.78-.06-2.54-.1-.58-.04-1.09-.07-1.5-.07-.57,0-.92.06-1.19.2l-5.24,2.76-22.07.16-.14.24c-.9,1.51-2.04,1.87-3.25,2.26-.8.26-1.62.52-2.3,1.14l-4.26,3.89-5.92,2.77c-1.69.79-3.95,1.24-6.2,1.24Z"/>
      <path class="st5" d="M208.34,4.72c1.34,0,2.66.68,3.38,1.74,1.3,1.92.99,5.05-1.77,6.97l-.45.31v.54c.06,1.87-.66,2.97-1.42,4.12-.3.45-.6.91-.85,1.41l-3.8,7.58c-1.58,3.16-3.34,10.52-4.03,13.53l-1.45,6.4c-.73,3.21-1.98,6.78-2.89,9.38-.68,1.93-1.17,3.32-1.28,4.07l-1.42,8.97c-.26,1.62-1.21,4.31-2.14,6.92-.96,2.71-1.87,5.26-2.06,6.77l-1.47,11.6c-.1.79-2.5,8.17-4.46,11.01-.62.9-.6,2.47.06,3.74.63,1.21,1.72,1.92,3,1.94h.26c2.92,0,4.43-.81,6.17-1.75.32-.17.65-.35,1.01-.54l5.68-2.91c1.05-.54,2.14-.8,3.32-.8,1.89,0,3.72.66,5.48,1.3,1.58.57,3.07,1.11,4.48,1.11,1.57,0,2.8-.65,3.77-2,3.44-4.8,13.53-5.38,18.37-5.66,1.98-.11,2.57-.16,2.98-.37l5.36-2.8c.52-.27,1.02-.41,1.51-.41,1.03,0,1.94.6,2.81,1.18.24.16.48.32.7.45.54.32,3.13,2.1,1.39,5.35-2.68,5.03-7.12,5.61-10.22,5.61-.91,0-1.76-.06-2.5-.1-.59-.04-1.1-.07-1.54-.07-.65,0-1.08.08-1.42.26l-5.13,2.71-21.67.16h-.56s-.29.49-.29.49c-.81,1.35-1.81,1.67-2.97,2.04-.85.27-1.73.55-2.49,1.25l-4.21,3.84-5.85,2.73c-1.62.76-3.8,1.19-5.98,1.19-2.02,0-3.83-.38-5.12-1.06l-3.7-1.97c-3.76-2.01-4.65-3.6-5.78-5.62-.52-.93-1.11-1.98-2.03-3.16l.04-14.65c2.14-3.18,4.13-10.29,4.61-13.35l1.43-8.98c.29-1.82,3.25-9.66,5.73-13.75.89-1.47,1.1-2.8,1.29-4.08.15-.98.29-1.9.75-2.85l2.59-5.45c.6-1.27.82-2.39,1.04-3.48.22-1.1.42-2.14,1.02-3.32l2.8-5.58,2.82-5.62,2.79-5.61,3.03-5.74.06-.12.03-.13,1.33-6.04,6.72-7.25c1.11-1.19,2.32-1.44,3.13-1.44M208.34,3.72c-1.33,0-2.72.52-3.87,1.76l-6.91,7.44-1.39,6.31-3.03,5.74-2.8,5.63-2.82,5.62-2.8,5.58c-1.27,2.52-.93,4.43-2.07,6.82l-2.59,5.45c-1.13,2.38-.54,4.45-1.99,6.85-2.61,4.31-5.56,12.2-5.86,14.11l-1.43,8.98c-.53,3.31-2.6,10.42-4.62,13.19l-.04,15.31c3.07,3.77,2.4,6.14,8.34,9.31l3.7,1.97c1.52.81,3.53,1.18,5.59,1.18,2.29,0,4.64-.46,6.41-1.29l5.99-2.8,4.32-3.94c1.53-1.4,4-.77,5.65-3.51l21.92-.16,5.35-2.82c.2-.1.53-.14.95-.14.94,0,2.38.18,4.04.18,3.61,0,8.27-.83,11.1-6.14,1.81-3.4-.27-5.79-1.75-6.68-1.08-.65-2.37-1.78-4.03-1.78-.6,0-1.26.15-1.97.52l-5.36,2.8c-1.08.57-16.94-.31-21.7,6.34-.84,1.17-1.83,1.58-2.95,1.58-2.7,0-6.15-2.41-9.96-2.41-1.23,0-2.49.25-3.78.91l-5.68,2.91c-2.32,1.19-3.57,2.18-6.73,2.18-.08,0-.16,0-.25,0-2.31-.04-2.96-3.08-2.25-4.11,2-2.9,4.5-10.45,4.63-11.46l1.47-11.6c.36-2.83,3.65-10.27,4.19-13.66l1.42-8.97c.26-1.64,2.92-7.9,4.16-13.39l1.45-6.4c1.17-5.17,2.68-10.79,3.95-13.31l3.8-7.58c.85-1.69,2.48-3.03,2.4-6.01,3.15-2.18,3.71-5.86,2.03-8.35-.89-1.32-2.5-2.18-4.21-2.18h0Z"/>
    </g>
    <path class="st0" d="M194.68,245.89c-5,4.23-9.47,6.51-12.27,4.19-3.56-2.94-4.04-10.09.88-15.08,3.85-3.9,11.32-7.06,14.64-5.99,2.69.87,4.81,3.71,4.84,8.21.03,5.34-2.91,8.75-8.08,8.66Z"/>
  </g>
  <g id="_레이어_3" data-name="레이어_3" opacity=".12">
    <path d="M95.7,357.41l-7.21,3.26-6.12,3.09c-7.31,3.7-13.67,2.99-15.77-2.06-2.71-6.52.73-16.94,5.22-26.16l3.2-6.57,3.2-6.57c2.84-5.83,3.24-9.59,5.07-13.08l3.29-6.24,1.5-6.69,3.29-6.28,3.06-6.15,3.09-6.15,3.02-6.33,7.63-8.11,1.45-7.44c.42-2.15,5.24-3.58,5.19-7.27-.08-5.8,4.21-6.94,7.38-13.95l2.98-6.59,4.28-4.33c2.43-2.46,8.8-18.92,17.33-23.05l6.22-3.02c4.94-2.39,7.64-5.25,12.87-7.93l6.46-3.31,6.16-3.07,6.16-3.09,6.35-3.04,8.04-7.39c2.37-2.18,7.59-1.33,10.22.01l6.17,3.15c6.59,3.36,20.78,2.22,28.8,8.1l7.42,5.43c1.78,1.3,5.72,1.25,7.25,5.19,3.46,8.95-1.84,18.6-9.57,22.42l-6.25,3.09-6.18,3.01c-17.85,8.7-27.4,7.55-26.7,7.22l-5.99,2.8-7.14,2.37c-9.88,3.28-22.08,3.57-31.81.03l-6.79-2.47c-4.51-1.64-7.6-6.41-9.91-7.85-4.28-2.64-6.48.72-7.03,3.85-1.14,6.52-10.65,15.34-13.08,20.32l-3.24,6.66-3.08,6.14-3.07,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.07,6.15-3.32,6.2-1.48,7.16c-.5,2.43-5.22,3.72-5.18,7.2.06,6.28-4.86,6.67-6.84,15.3-1.02,4.45,2.32,7.56,5.81,5.06,2.9-2.08,5.19-4.36,9.17-6.29l5.87-2.86,6.18-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.14-3.07,6.11-3.06c14.85-7.43,34.62-9.79,35.01-17.82.32-6.66-1.86-14.36,1.04-20.16l3.03-6.06,3.1-6.36c3.17-6.51,11.71-9.31,16.27-6.23,5.57,3.76,11.2,3.32,15.96-1.45,3.85-3.86,2.15-6.78,10.73-10.66,3.65-1.65,8.22.64,11.55-1.07l5.84-3c4.94-2.54,9.84-3.23,9.69-9.28,0,.09,7.78-19.01,8.22-19.32,5.57-3.94,2.4-8.64,5.95-15.72l3.08-6.14,3.07-6.14,3.08-6.15,3.07-6.17,3.28-6.32,1.53-9.69,3.28-6.32,3.07-6.16,3.07-6.15,3.06-6.11c4.11-8.22,6.82-20.22,10.42-26.99l3.29-6.2,1.59-6.9c1.56-6.78,4.35-13.49,4.53-14.74l1.43-9.94c.55-3.8,4.62-4.16,6.68-3.75,2.39.47,4.23,2.25,4.74,4.69-.46-2.2-4.02,28.52-8.03,36.12l-3.31,6.27-1.49,6.69-3.3,6.27-3.04,6.11c-4.21,8.46-8.25,20.89-7.31,21.88,2.09,2.19,6.25-1.18,7.92-1.97l6.85-3.25,6.5-5.02c3.52-2.72,5.78-4.69,9.57-6.48l6.26-2.96,6.14-3.11,6.14-3.07,6.15-3.08,6.17-3.08,6.29-3.12c3.1-1.54,10.04-1.88,12.85-.12,2.12,1.33.73,4.97-.77,6.37l-14.46,13.53-6.24,3.14-7.08,1.56-11.16,10.77-7.35,1.54-14.3,13.75-6.25,2.91c-2.7,1.26-.7,4.47.09,4.25,4.7-1.51,6.9,2.16,8.33,2.18l53.99.8c2.94.04,7.43,4.24,9.2,9.12l-15.36.08-5.7,3.02-48.45-.7c2.69.04-9.55-3.96-18.22-8.16-6.68-3.24-15,11.93-14.37,11.3l-4.33,4.34-3.06,6.71-3.28,6.26-1.5,6.69-3.29,6.23c-1.43,2.72-.99,4.84-2.25,7.47l-2.82,5.88c-7.22,15.05.47,33.47,4.07,30.65,3.71-2.9,7.54-2.49,12.36-4.93l6.04-3.05c3.15-1.59,8.18.71,11.36-.97l5.75-3.04,12.92-.1,5.52-2.95,12.94-.13,5.58-2.96,25.12-.1,5.75-2.98,39.24.61c2.57.04,3.44,3.25,3.74,4.4,1.38,5.36-9.23,4.13-8.74,10.59.32,4.24-3.08,8.99-6.54,6.2l-7.06-5.69-38.94-.71-5.87,2.96-12.87.08-5.79,3.07c-3.01,1.59-8.34-.79-11.29.98-2.18,1.31-10.92,3.78-14.65,4.37l-9.82,1.57c-3.98.64-11.84,4.14-14.8,4.6l-10.1,1.57-1.85,7.49c-.89,3.6-3.13,7.54,0,11.4,2.48,3.05-5.66,36.74-13.53,52.25l-3.2,6.3c-2.81,5.53-8,12.92-7.79,12.71l-12.65,12.86-6.14,2.85-6.1,3.27c-1.82.98-5.61,1.64-7.26,0l-12.39-12.37-1.61-7.26c-1.16-5.24-4.82-14.54-1.26-21.48,5.78-11.26,8.95-28.38,13.49-32.79l16.15-15.64c-1.43-3.15-7.38-2.99-13.4.19l-6.21,3.29-6.8,1.52c-3.66.82-21.56,7.72-26.99,10.57l-6.24,3.28-6.69,1.5-6.28,3.29-6.15,3.06-6.11,3.06c-3.58,1.79-7.44,2.36-13.34,5.23l-8.76,4.27c-2.06,1-3.62,3.31-7.1,5.07l-5.87,2.98-6.13,3.05-6.21,3.08-6.95,3.81ZM210.41,216.32c4.14-1.73,7.94-1.45,11.44-1.31,1.58-3.11,4.19-3.68,6.99-2.59l8.78-4.69c1.47-.78,2.94-5.06,7.14-4.46,2.2-.68,2.86-3.04,2.26-4.69-3.57-9.75-14.21-6.45-19.05-10.85-2.24.17-4.56-.37-6.11-3.15h-25.98c-1.55,2.77-3.84,3.33-6.15,3.13-1.67,2.78-3.82,3.24-6.16,3.09-1.67,2.76-3.82,3.23-6.15,3.08-1.69,2.73-3.8,3.25-6.3,3.09l-9.56,9.6-.07,11.48c3-.38,5.05.29,6.71,3h25.96c1.72-2.78,3.98-3.41,7.06-2.96,3.02.63,6.1.84,9.2-1.78ZM243.27,278.86l6.61-6.04c.74-3.77.82-6.89.16-11.27l-14.25.21-5.99,6.59c-3.53,3.89-.12,10.44,5.25,11.33,2.87.47,6.47.77,8.21-.82ZM213.41,284.66c3.29-1.38,3.17-4.99,2.79-6.12-.98-2.89-6.4-7.68-8.94-8.08-7.71-1.24-6.22,6.82-10.56,11.48-4.52,4.85,8.93,5.99,16.71,2.73ZM247.04,355.8c-.14-2.31.32-4.47,3.08-6.14-.15-2.34.32-4.49,3.08-6.15-.15-2.34.32-4.49,3.07-6.15-.16-2.35.39-4.5,2.98-6.13l.77-7.56c4.92-3.65.44-10.38,5.38-13.98v-13.72c-2.62-1.75-3.25-3.68-2.74-6.75-3.1.34-4.06,1.85-5.3,3.57l-23.22,23.05c-1.71,1.69-2.73,3.47-2.44,6.58-3.15,1.47-5.12,3.39-5.92,6.61l-3.03,6.16-3.55,6.18c1.22,2.83.41,5.4-2.38,6.87v19.87c2.65,1.71,3.16,3.83,3.42,6.16,2.06,4.33,6.7,4.63,9.51,1.84l14.11-14.05c-.04-2.44.45-4.54,3.17-6.26Z"/>
    <path d="M53.73,256.94c-1.56,2.81-9.36,7.35-13.56,5.63-3.94-1.61-5.63-2.5-5.4-7.51.13-2.89,1.99-4.67,2.57-7.28l1.53-6.88c.53-2.36,3.01-8.33,5.27-13.08l3.3-6.92c2.73-5.73,3.31-9.54,5.1-13.12l3.06-6.11,3.07-6.14,3.08-6.15,3.07-6.16,3.32-6.46c2.64-5.15,5.46-7.88,7.89-12.8l3.03-6.14,3.07-6.16,3.08-6.15,3.07-6.14,3.08-6.13,3.16-6.52c1.19-2.47,3.45-3.77,5.21-7.24l2.89-5.68c1.59-3.13,4.92-4.84,5.44-7.19l1.58-7.24,3.24-6.33,7.37-8.09,3.02-6.32,3.31-6.42c.57-1.11.78-4.19,3.01-5.58,5.51-3.44,5.95-12.35,7.14-14.74l2.86-5.74c1.64-3.29,3.98-4.79,5.12-7.14l3.2-6.6c2.6-5.36,5.69-7.86,8.17-13.13l2.9-6.16,10.42-11.27c2.45-2.65,6.73-2.29,7.27.34,1.87,9.22-17.26,24.79-15.69,31.86.67,3.01,5.36,3.66,7.41.5,1.39-2.14,3.29-5.88,6.23-6.25l13.47-1.68,7.83-7.51c10.28-1.6,21.67-1.25,32.07-.2,1.55.16,3.94,3.73,4.84,4.55,3.01,2.77.84,6.38-.9,10.13l-3.85,8.3-60,60.15c-1.49,1.5-3.39,2.22-3.44,5.37l21.25-.15c2.18-.01,3.83-2.05,4.87-2.53,1.6-.74,10.04,2.03,13.56,9.02l2.89,5.73c1.63,3.24-.77,5.09-1.96,7.51l-3.03,6.16c-1.39,2.83-3.85,4.61-5.14,7.36l-2.81,5.99-25.06,24.78c-1.34,1.32-5.76.99-7.36,4.88-.78,1.89-4.69,1.74-5.87,2.86l-4.67,4.43c-1.4,1.33-10.86,5.33-13.56,7.8l-8.38,7.67c-1.01.92-4.89.69-5.9,3.04-.29.67-10.05,8.13-16.78,11.28l-6.07,2.85-11.16,10.13-9.69,6.51-15.81,1.83c-2.2.25-3.26,9.83-6.56,15.77l-3.67,6.62ZM89.22,208.66c2.41.38,4.91-.73,7.29-2.49l7.17-5.31c2.53-1.87,4.84-3.82,7.46-5.14l5.98-3.01c3.67-1.85,6.34-3.47,9.54-6.44l7.49-6.92c3.2-2.96,5.88-4.65,9.53-6.43l5.93-2.9c3.26-1.6,11.2-7.7,15.14-12.58,2.86-3.53,11.25-4.94,16.92-14.23s13.98-16.17,13-21.59c-.4-2.24-2.23-4.32-4.7-4.72-1.72-.28-4.7,2.41-7.08,2.5l-12.73.47-5.81,2.79c-9.56,4.59-22.03,5.86-25.99-1.68-1.62-3.09-2.27-5.73.39-8.34l29.59-29.06,5.96-2.96,44.63-44.85c1.39-1.4,1.36-6.37-.16-7.39-3.05-2.05-12.29-.35-17.72,2.25l-5.9,2.83c-2.66,1.27-4.75.83-7.48,2.25l-6.4,3.31c-1.09.57-4.07.75-5.57,3.01-3.21,4.8-11.74,5.96-13.52,7.76l-21.66,21.85c.39-.39-5.27,7.59-7.88,12.92l-3.26,6.66c-1.25,2.55-3.54,3.83-5.23,7.2l-2.98,5.96-3.03,6.11-2.98,5.89c-1.77,3.5-4.02,4.69-5.26,7.28l-3.13,6.48-3.08,6.13-3.07,6.15-3.18,6.23c-2.73,5.33-5.6,8.13-8.03,13.04l-3.03,6.13-3.03,6.12-3.44,6.43c-2.98,5.57,3.3,4.84,4.01,8.96-.11-.63-4.74,17.72,5.31,19.32Z"/>
    <path fill="#d80b0b" opacity=".4" d="M278.35,167.56c-3.02,3.39-5.39,4.54-8.55,5.11-1.93,3.04-6.09,3.23-8.09-.2-4.96-.09-9.12-3.89-8.17-9.64-.57-3.86.74-6.48,3.84-8.78,4.66-.72,9.06-.68,13.7-.08,1.74,2.51,3.79,3.06,6.2,3.31,4.17,2.1,5.17,7.09,1.06,10.28Z"/>
  </g>
</svg>
        ${coverB64 ? `<img src="${coverB64}" style="width:20px;height:28px;object-fit:cover;border-radius:2px;box-shadow:1px 1px 4px rgba(0,0,0,.15);">` : ''}
      </div>` : pageLabel}
      <div style="font-size:${fontSize}px;line-height:${lineH};color:#2e1f0e;margin-bottom:18px;">${chunks[i]}</div>
      ${isLast ? `<div style="border-top:1px solid ${acc}33;padding-top:10px;display:flex;align-items:center;gap:8px;">
        ${coverB64 ? `<img src="${coverB64}" style="width:24px;height:34px;object-fit:cover;border-radius:2px;flex-shrink:0;">` : ''}
        <div style="min-width:0;flex:1;overflow:hidden;">
          <div style="font-size:10px;font-weight:700;color:#2e1f0e;font-family:sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${book?.title||''}</div>
          ${book?.author ? `<div style="font-size:9px;color:#7a6a5a;font-family:sans-serif;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${book.author.split(/[,·]/)[0].trim()}</div>` : ''}
        </div>
      </div>` : `<div style="text-align:right;font-size:9px;color:${acc};opacity:.4;font-family:sans-serif;">계속 →</div>`}
    `;
    document.body.appendChild(card);
    try {
      const cardH = card.scrollHeight || card.offsetHeight || 800;
      const canvas = await html2canvas(card, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: bg,
        width: 380,
        height: cardH,
        windowWidth: 460,
        windowHeight: cardH + 200,
        logging: false,
        imageTimeout: 8000,
      });
      dataUrls.push(canvas.toDataURL('image/png'));
    } finally {
      card.remove();
    }
  }

  if(!dataUrls.length) { await showAlert('이미지 생성 실패'); return; }

  // 공유 모달
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  const imgHtml = dataUrls.map((u,i)=>`
    <div style="margin-bottom:.5rem;position:relative;">
      <img src="${u}" style="width:100%;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);">
      <a href="${u}" download="booklog-quote-${i+1}.png" style="position:absolute;bottom:.4rem;right:.4rem;background:rgba(0,0,0,.5);color:#fff;border-radius:6px;font-size:.65rem;padding:.2rem .5rem;text-decoration:none;">⬇ 저장</a>
    </div>`).join('');
  ov.innerHTML = `
    <div class="modal" style="max-width:360px;padding:0;overflow:hidden;max-height:90vh;display:flex;flex-direction:column;">
      <div style="background:var(--paper);padding:.85rem 1rem;display:flex;align-items:center;border-bottom:1px solid var(--border);justify-content:space-between;flex-shrink:0;">
        <div style="font-size:.8rem;font-weight:700;color:#fff;font-family:var(--fs);">📷 문장 카드 ${total > 1 ? `(${total}장)` : ''}</div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:24px;height:24px;color:#fff;cursor:pointer;">✕</button>
      </div>
      <div style="padding:.75rem;overflow-y:auto;flex:1;">
        ${imgHtml}
        <button onclick="shareQuoteImage('${dataUrls[0]}')" class="btn-cancel" style="width:100%;font-size:.75rem;margin-top:.2rem;">📤 공유</button>
      </div>
    </div>`;
  let mt = null;
  ov.addEventListener('mousedown', e => mt=e.target);
  ov.addEventListener('click', e => { if(e.target===ov&&mt===ov) ov.remove(); });
  document.body.appendChild(ov);
}

async function shareQuoteImage(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], 'booklog-quote.png', {type:'image/png'});
    if(navigator.share && navigator.canShare({files:[file]})) {
      await navigator.share({files:[file], title:'북로그 문장 카드'});
    } else {
      // 클립보드 복사
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      await showAlert('✅ 클립보드에 복사됐어요!');
    }
  } catch(e) {
    await showAlert('공유 오류: '+e.message);
  }
}

function toggleQText(id, btn) {
  const el = document.getElementById('qt-'+id);
  if(!el) return;
  if(el.classList.contains('collapsed')) {
    el.classList.remove('collapsed');
    btn.textContent = '접기 ▴';
  } else {
    el.classList.add('collapsed');
    btn.textContent = '더 보기 ▾';
  }
}

// 문장 탭에서 책 선택 후 문장 추가
function addQuoteFromTab() {
  // 서재 책 검색 모달 표시
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:1100;';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px;padding:0;overflow:hidden;">
      <div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);">
        <span style="font-weight:700;color:var(--tx1);font-size:.9rem;font-family:var(--fs);">어느 책에 추가할까요?</span>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;border-radius:50%;width:26px;height:26px;color:var(--tx3);cursor:pointer;font-size:.85rem;">✕</button>
      </div>
      <div style="padding:.75rem;">
        <input id="qft-search" type="text" placeholder="책 제목이나 저자 검색..."
          style="width:100%;box-sizing:border-box;padding:.45rem .7rem;border:1px solid var(--border2);border-radius:8px;font-size:.78rem;font-family:var(--ff);margin-bottom:.5rem;"
          oninput="filterQftBooks(this.value)">
        <div id="qft-list" style="max-height:300px;overflow-y:auto;"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });

  // 초기 목록 표시
  window._qftBooks = allBooks.filter(b=>b.status==='완독'||b.status==='읽는중')
    .sort((a,b)=>(a.title||'').localeCompare(b.title||''));
  filterQftBooks('');
  document.getElementById('qft-search')?.focus();
}

function filterQftBooks(q) {
  const list = document.getElementById('qft-list');
  if(!list) return;
  const books = (window._qftBooks||[]).filter(b =>
    !q || (b.title||'').toLowerCase().includes(q.toLowerCase()) ||
    (b.author||'').toLowerCase().includes(q.toLowerCase())
  );
  if(!books.length) {
    list.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;text-align:center;">일치하는 책이 없어요.</div>';
    return;
  }
  list.innerHTML = books.map(b => `
    <div onclick="selectQftBook('${b.id}')"
      style="display:flex;align-items:center;gap:.6rem;padding:.45rem .5rem;border-radius:8px;cursor:pointer;transition:background .12s;"
      onmouseenter="this.style.background='var(--bg)'" onmouseleave="this.style.background=''">
      ${b.cover ? `<img src="${b.cover}" style="width:28px;height:40px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : `<div style="width:28px;height:40px;background:var(--acc2);border-radius:3px;flex-shrink:0;"></div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-size:.76rem;font-weight:600;color:var(--tx1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.title||''}</div>
        <div style="font-size:.65rem;color:var(--tx3);">${(b.author||'').split(/[,·]/)[0]||''} · ${b.status}</div>
      </div>
    </div>`).join('');
}

function selectQftBook(bookId) {
  const book = allBooks.find(b=>b.id===bookId);
  if(!book) return;
  // 모달 닫기
  document.querySelector('#qft-list')?.closest('.modal-overlay')?.remove();
  // 책 상세 열기 (openDetail 사용)
  openDetail(book.id);
  // 문장 추가 에디터 스크롤 + 포커스
  setTimeout(() => {
    // 책 상세 화면에서 문장 추가 섹션으로 이동
    const addSection = document.querySelector('.q-add-section, [data-section="add-quote"]');
    const editor = document.querySelector('.qeditor-body[contenteditable="true"]');
    const target = addSection || editor;
    if(target) {
      target.scrollIntoView({behavior:'smooth', block:'start'});
      setTimeout(() => { if(editor) editor.focus(); }, 300);
    }
  }, 700);
}

function renderQuotes() {
  const qHeader = document.getElementById('q-tab-header');
  if(qHeader) qHeader.innerHTML = '';
  const countLbl = document.getElementById('quote-count-lbl');
  if(countLbl) countLbl.textContent = allQuotes.length ? `MY SENTENCES · ${allQuotes.length}` : 'MY SENTENCES';
  const feed = document.getElementById('q-feed'); feed.innerHTML = '';
  if (!allQuotes.length) { feed.innerHTML='<div class="empty-state">수집된 문장이 없어요.<br><small style="color:var(--tx3);font-size:.72rem;">책을 추가할 때 인상 깊은 문장을 기록해보세요.</small></div>'; return; }
  const q = quoteSearchQ.trim().toLowerCase();
  let list = q ? allQuotes.filter(qt => {
    const book = allBooks.find(b=>b.id===qt.book_id);
    return (book?.title||'').toLowerCase().includes(q) ||
           (book?.author||'').toLowerCase().includes(q) ||
           qt.text.toLowerCase().includes(q);
  }) : allQuotes;
  // 형광펜 필터 - hex(#f5e27a)와 rgb(245, 226, 122) 두 형식 모두 검사
  if(quoteHlFilter) {
    const hlMap = {
      '#f5e27a': ['rgb(245, 226, 122)', 'rgb(245,226,122)', '#f5e27a'],
      '#b8e8d4': ['rgb(184, 232, 212)', 'rgb(184,232,212)', '#b8e8d4'],
      '#f5c4a0': ['rgb(245, 196, 160)', 'rgb(245,196,160)', '#f5c4a0'],
    };
    const targets = hlMap[quoteHlFilter] || [quoteHlFilter];
    list = list.filter(qt => {
      const t = (qt.text||'').toLowerCase();
      return targets.some(c => t.includes(c.toLowerCase()));
    });
  }
  if (!list.length) { feed.innerHTML=`<div class="empty-state">"${quoteSearchQ}" 검색 결과가 없어요.</div>`; return; }

  // 책별 그룹 → 각 책 안에서 페이지 오름차순 → 페이지 없으면 뒤로
  list = [...list].sort((a, b) => {
    const ai = allBooks.findIndex(bk => bk.id === a.book_id);
    const bi = allBooks.findIndex(bk => bk.id === b.book_id);
    if(ai !== bi) return ai - bi;
    const ap = (a.page != null && String(a.page) !== 'null' && a.page !== '') ? parseInt(a.page) : null;
    const bp = (b.page != null && String(b.page) !== 'null' && b.page !== '') ? parseInt(b.page) : null;
    if(ap !== null && bp !== null) return ap - bp;
    if(ap !== null) return -1;
    if(bp !== null) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  // 페이지네이션
  const totalQ = list.length;
  const totalQPages = Math.ceil(totalQ / QUOTES_PER_PAGE);
  if(quotePage > totalQPages) quotePage = 1;
  const pageList = list.slice((quotePage - 1) * QUOTES_PER_PAGE, quotePage * QUOTES_PER_PAGE);

  pageList.forEach(qt => {
    const book = allBooks.find(b=>b.id===qt.book_id);
    const color = randomQuoteColor(qt.book_id);
    const isSelected = selectedQuoteIds.has(qt.id);

    // 텍스트 처리 - 줄바꿈 + HTML 서식 유지
    let text = qt.text || '';
    const hasHtml = /<[a-zA-Z]/i.test(text); // div/p/b/span 등 모든 태그 포함
    // 통합 처리: div/p/br/\ n 모두 <br>로 변환, 서식 태그 보존

    text = text
      .replace(/<div><br\s*\/?><\/div>/gi, '<br>')   // 빈 div
      .replace(/<\/div>\s*<div>/gi, '<br>')            // div 경계
      .replace(/<div>/gi, '\n')                        // 열리는 div → 줄바꿈(단독 div 처리)
      .replace(/<\/div>/gi, '<br>')                    // 닫히는 div → br
      .replace(/<p>/gi, '').replace(/<\/p>/gi, '<br>') // p 태그
      .replace(/\n/g, '<br>')                          // 줄바꿈 문자
      .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')    // 3개 이상 br → 2개
      .replace(/^(<br\s*\/?>\s*)+/gi, '')              // 앞 br 제거
      .replace(/(<br\s*\/?>\s*)+$/gi, '');             // 뒤 br 제거
    if (!hasHtml) {
      // 서식 태그 없는 경우 특수문자 이스케이프
      text = text.replace(/&(?!amp;|lt;|gt;|nbsp;|#)/g, '&amp;');
    }
    if(q) {
      const re = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
      // 항상 태그 사이의 텍스트만 하이라이트
      text = text.replace(/>([^<]*)</g, (_,t) => '>'+t.replace(re,'<mark style="background:#f5d87a;border-radius:2px;padding:0 1px;">$1</mark>')+'<');
      // 태그 없는 경우도 처리
      if(!text.includes('<')) text = text.replace(re,'<mark style="background:#f5d87a;border-radius:2px;padding:0 1px;">$1</mark>');
    }
    const plainLen = (qt.text||'').replace(/<[^>]+>/g,'').length;
    const isLong = plainLen > 150;

    const el = document.createElement('div');
    el.className = 'qcard' + (quoteSelectMode && isSelected ? ' qcard-selected' : '');

    if(quoteSelectMode) {
      el.style.cursor = 'pointer';
      el.onclick = () => {
        if(selectedQuoteIds.has(qt.id)) selectedQuoteIds.delete(qt.id);
        else selectedQuoteIds.add(qt.id);
        renderQuotes();
      };
    } else {
      // 클릭 시 수정 모달
      el.style.cursor = 'pointer';
      el.onclick = (e) => {
        if(e.target.classList.contains('qcard-expand') || e.target.closest('.qcard-actions')) return;
        openEditQuote(qt);
      };
    }

    el.innerHTML = `
      <div class="qcard-bar" style="background:${color}"></div>
      ${quoteSelectMode ? `<div class="qcard-select-box" style="border-color:${isSelected?'var(--acc)':'var(--border2)'};background:${isSelected?'var(--acc)':'#fff'};">${isSelected?'<span style="color:#fff;font-size:.55rem;">✓</span>':''}</div>` : ''}
      <div class="qcard-inner">
        <!-- 공유 버튼 -->
        ${quoteSelectMode ? '' : `<button class="qcard-share-btn" onclick="event.stopPropagation();shareQuoteCard('${qt.id}',this)" title="이미지로 저장">📷</button>`}
        <!-- 문장 -->
        <div style="display:flex;gap:.35rem;align-items:flex-start;margin-bottom:.4rem;">
          <div class="qcard-quote-mark" style="color:${color};flex-shrink:0;">"</div>
          <div style="flex:1;min-width:0;">
            <div class="qcard-text${isLong?' collapsed':''}" id="qt-${qt.id}">${text}</div>
            ${isLong ? `<button class="qcard-expand" onclick="event.stopPropagation();toggleQText('${qt.id}',this)">더 보기 ▾</button>` : ''}
          </div>
        </div>
        <!-- 출처 + 칩 한 줄 -->
        <div style="padding-top:.35rem;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
            <div style="display:flex;align-items:center;gap:.35rem;min-width:0;flex:1;overflow:hidden;">
              ${book?.cover ? `<img src="${book.cover}" style="width:14px;height:20px;object-fit:cover;border-radius:2px;flex-shrink:0;box-shadow:1px 1px 3px rgba(0,0,0,.12);">` : ''}
              <div style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
                <span class="qcard-book">${book?.title||''}</span>
                ${book?.author ? `<span class="qcard-author" style="margin-left:.3rem;">— ${book.author}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:.2rem;flex-shrink:0;">
              ${qt.page&&String(qt.page)!=='null' ? `<span class="qcard-chip">p.${qt.page}</span>` : ''}
            </div>
          </div>
          ${qt.tag&&String(qt.tag)!=='null' ? `<div style="margin-top:.28rem;"><span class="qcard-chip qcard-tag" style="white-space:normal;word-break:break-word;display:inline-block;">💬 ${qt.tag}</span></div>` : ''}
        </div>
      </div>`;

    el.style.position = 'relative';
    feed.appendChild(el);
  });

  // 페이지네이션 UI
  const pg = document.getElementById('q-pagination');
  if(pg) {
    if(totalQPages <= 1) { pg.innerHTML = ''; }
    else {
      let html = `<button class="yr-btn" onclick="qGoPage(${quotePage-1})" ${quotePage===1?'disabled ':''}style="font-size:.72rem;">‹</button>`;
      for(let i=1;i<=totalQPages;i++){
        if(totalQPages>7 && i>2 && i<totalQPages-1 && Math.abs(i-quotePage)>1){
          if(i===3||i===totalQPages-2) html+=`<span style="padding:0 .2rem;color:var(--tx3);">…</span>`;
          continue;
        }
        html+=`<button class="yr-btn${i===quotePage?' on':''}" onclick="qGoPage(${i})" style="${i===quotePage?'background:var(--acc);color:#fff;border-color:transparent;':''}">${i}</button>`;
      }
      html+=`<button class="yr-btn" onclick="qGoPage(${quotePage+1})" ${quotePage===totalQPages?'disabled ':''}style="font-size:.72rem;">›</button>`;
      html+=`<span style="font-size:.7rem;color:var(--tx3);margin-left:.3rem;">${quotePage}/${totalQPages}</span>`;
      pg.innerHTML = html;
    }
  }
}

function openEditQuote(qt) {
  // qt가 문자열이면 파싱
  if(typeof qt === 'string') { try { qt = JSON.parse(qt); } catch(e) { return; } }
  const book = allBooks.find(b=>b.id===qt.book_id);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;padding:0;overflow:hidden;max-height:90vh;display:flex;flex-direction:column;">
      <div style="background:var(--card);padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:.82rem;font-weight:700;color:var(--tx1);font-family:var(--fs);">문장 수정</div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;border-radius:50%;width:26px;height:26px;color:var(--tx3);cursor:pointer;font-size:.8rem;">✕</button>
      </div>
      <div style="padding:.85rem .95rem;overflow-y:auto;flex:1;">
        ${book ? `<div style="font-size:.65rem;color:var(--tx3);margin-bottom:.5rem;">📖 ${book.title}</div>` : ''}
        <!-- 에디터 툴바 -->
        <div class="qeditor-toolbar" style="margin-bottom:0;border-radius:6px 6px 0 0;" onmousedown="event.preventDefault()">
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('bold')"><b>B</b></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('italic')"><i>I</i></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('underline')"><u>U</u></button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtSize('small')">A<sub>↓</sub></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtSize('large')">A<sup>↑</sup></button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5e27a')" style="background:#f5e27a;width:18px;height:14px;border-radius:3px;border:1px solid #e0c840;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#b8e8d4')" style="background:#b8e8d4;width:18px;height:14px;border-radius:3px;border:1px solid #7acaaa;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5c4a0')" style="background:#f5c4a0;width:18px;height:14px;border-radius:3px;border:1px solid #d8906a;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('removeFormat')" style="font-size:.6rem;color:var(--tx3);">초기화</button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="openImageOCR('eq-text')" title="사진에서 텍스트 추출" style="font-size:.75rem;">📷</button>
        </div>
        <div id="eq-text" class="qeditor-body" contenteditable="true" data-qtext
          style="border-radius:0 0 6px 6px;margin-bottom:.45rem;min-height:80px;">${
          (()=>{
            const t = qt.text||'';
            const hasHtml = /<[a-z]/i.test(t);
            if(hasHtml) {
              return t
                .replace(/<div><br\s*\/?><\/div>/gi,'<br>')
                .replace(/<\/div>\s*<div>/gi,'<br>')
                .replace(/<div>/gi,'')
                .replace(/<\/div>/gi,'<br>')
                .replace(/<p>/gi,'').replace(/<\/p>/gi,'<br>')
                .replace(/\n/g,'<br>')
                .replace(/(<br\s*\/?>[\s]*){3,}/gi,'<br><br>')
                .replace(/^(<br\s*\/?>\s*)+/,'')
                .replace(/(<br\s*\/?>\s*)+$/,'');
            }
            // 일반 텍스트: 줄바꿈→<br>, 특수문자 이스케이프
            return t.replace(/&(?!amp;|lt;|gt;)/g,'&amp;').replace(/\n/g,'<br>');
          })()
        }</div>
        <div style="display:flex;gap:.35rem;margin-bottom:.6rem;">
          <input id="eq-tag" type="text" class="form-input" placeholder="💬 코멘트" value="${(qt.tag && String(qt.tag)!=='null') ? qt.tag : ''}" style="flex:1;font-size:.75rem;">
          <input id="eq-page" type="text" class="form-input" placeholder="p.42" value="${(qt.page!=null && String(qt.page)!=='null') ? qt.page : ''}" style="width:60px;font-size:.75rem;text-align:center;">
        </div>
        <div style="display:flex;gap:.4rem;">
          <button onclick="saveEditQuote('${qt.id}',this)" class="btn-save" style="flex:1;font-size:.75rem;">저장</button>
          <button onclick="deleteSingleQuote('${qt.id}',this)" class="btn-cancel btn-delete" style="font-size:.75rem;">삭제</button>
        </div>
      </div>
    </div>`;
  let mdTarget = null;
  overlay.addEventListener('mousedown', e => { mdTarget = e.target; });
  overlay.addEventListener('click', e => { if(e.target===overlay && mdTarget===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function openAddQuoteFromDetail(bookId) {
  const book = allBooks.find(b=>b.id===bookId);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;padding:0;overflow:hidden;max-height:90vh;display:flex;flex-direction:column;">
      <div style="padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="font-size:.9rem;font-weight:700;color:var(--tx1);font-family:var(--fs);">문장 추가</div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none;border:none;border-radius:50%;width:26px;height:26px;color:var(--tx3);cursor:pointer;font-size:.8rem;">✕</button>
      </div>
      <div style="padding:.85rem .95rem;overflow-y:auto;flex:1;">
        ${book ? `<div style="font-size:.65rem;color:var(--tx3);margin-bottom:.5rem;">📖 ${book.title}</div>` : ''}
        <div class="qeditor-toolbar" style="margin-bottom:0;border-radius:6px 6px 0 0;" onmousedown="event.preventDefault()">
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('bold')"><b>B</b></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('italic')"><i>I</i></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('underline')"><u>U</u></button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtSize('small')">A<sub>↓</sub></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtSize('large')">A<sup>↑</sup></button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5e27a')" style="background:#f5e27a;width:18px;height:14px;border-radius:3px;border:1px solid #e0c840;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#b8e8d4')" style="background:#b8e8d4;width:18px;height:14px;border-radius:3px;border:1px solid #7acaaa;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5c4a0')" style="background:#f5c4a0;width:18px;height:14px;border-radius:3px;border:1px solid #d8906a;"></button>
          <button type="button" onmousedown="event.preventDefault()" onclick="qfmt('removeFormat')" style="font-size:.6rem;color:var(--tx3);">초기화</button>
          <span class="qeditor-sep"></span>
          <button type="button" onmousedown="event.preventDefault()" onclick="openImageOCR('aq-text')" title="사진에서 텍스트 추출" style="font-size:.75rem;">📷</button>
        </div>
        <div id="aq-text" class="qeditor-body" contenteditable="true"
          data-placeholder="인상 깊은 문장을 입력해주세요..."
          style="border-radius:0 0 6px 6px;margin-bottom:.45rem;min-height:80px;"></div>
        <div style="display:flex;gap:.35rem;margin-bottom:.6rem;">
          <input id="aq-tag" type="text" class="form-input" placeholder="💬 코멘트" style="flex:1;font-size:.75rem;">
          <input id="aq-page" type="text" class="form-input" placeholder="p.42" style="width:60px;font-size:.75rem;text-align:center;">
        </div>
        <button onclick="saveNewQuoteFromDetail('${bookId}',this)" class="btn-save" style="width:100%;font-size:.75rem;">저장</button>
      </div>
    </div>`;
  // paste 핸들러
  const ed = overlay.querySelector('#aq-text');
  ed.addEventListener('paste', e => {
    e.preventDefault();
    const plain = (e.clipboardData||window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, plain);
  });
  let mdTarget = null;
  overlay.addEventListener('mousedown', e => { mdTarget = e.target; });
  overlay.addEventListener('click', e => { if(e.target===overlay && mdTarget===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function saveNewQuoteFromDetail(bookId, btn) {
  const overlay = btn.closest('.modal-overlay');
  const edEl = overlay.querySelector('#aq-text');
  const rawHtml = edEl.innerHTML;
  const text = cleanEditorHtml(rawHtml);
  if(!text) { await showAlert('문장을 입력해주세요.'); return; }
  const tag = overlay.querySelector('#aq-tag').value.trim();
  const page = overlay.querySelector('#aq-page').value.trim();
  try {
    const {error:insertErr} = await sb.from('quotes').insert({book_id:bookId, user_id:currentUser.id, text, tag:tag||null, page:page||null, created_at:new Date().toISOString()});
    if(insertErr) throw insertErr;
    await loadData();
    overlay.remove();
    // 책 상세 모달 새로고침
    openDetail(bookId);
    if(document.getElementById('q-feed')) renderQuotes();
  } catch(e) { await showAlert('저장 오류: '+e.message); }
}

async function saveEditQuote(id, btn) {
  const overlay = btn.closest('.modal-overlay');
  const edEl = overlay.querySelector('#eq-text');
  if(!edEl) { await showAlert('에디터를 찾을 수 없어요.'); return; }
  const rawHtml = edEl.isContentEditable ? edEl.innerHTML : edEl.value;
  console.log('saveEditQuote - rawHtml:', rawHtml.slice(0,100));
  const text = cleanEditorHtml(rawHtml);
  console.log('saveEditQuote - cleaned text:', text.slice(0,100));
  const tag = overlay.querySelector('#eq-tag').value.trim();
  const page = overlay.querySelector('#eq-page').value.trim();
  if(!text) { await showAlert('문장을 입력해주세요.'); return; }
  try {
    const { error } = await sb.from('quotes').update({text, tag: tag||null, page: page||null}).eq('id', id).eq('user_id', currentUser.id);
    if(error) throw error;
    await loadData();
    overlay.remove();
    const detailOpen = document.getElementById('modal-detail')?.style.display !== 'none';
    if(detailOpen && curBookId) openDetail(curBookId);
    else buildQuotes();
    if(document.getElementById('q-feed')) renderQuotes();
  } catch(e) { await showAlert('저장 오류: '+e.message); }
}

async function deleteSingleQuote(id, btn) {
  if(!await showConfirm('이 문장을 삭제할까요?')) return;
  try {
    await sb.from('quotes').delete().eq('id', id);
    await loadData();
    btn.closest('.modal-overlay').remove();
    const detailOpen = document.getElementById('modal-detail')?.style.display !== 'none';
    if(detailOpen && curBookId) openDetail(curBookId);
    else buildQuotes();
    if(document.getElementById('q-feed')) renderQuotes();
  } catch(e) { await showAlert('삭제 오류: '+e.message); }
}

const QUOTE_COLORS = ['#c4714a','#7a9e7e','#5a8a8a','#c8a87a','#9a7090','#8a8aaa','#b06040','#7a6e9e','#6a8a6a','#9e7a5a'];
function genreColor(genre) {
  const g = Array.isArray(genre)?genre[0]:genre;
  return {'소설':'#c4714a','에세이':'#7a9e7e','인문':'#5a8a8a','자기계발':'#c8a87a','과학':'#8a8aaa','시/시집':'#9a7090'}[g]||'#b07030';
}
function randomQuoteColor(bookId) {
  // bookId 기반 일관된 색상 (같은 책은 항상 같은 색)
  if(!bookId) return QUOTE_COLORS[0];
  let hash = 0;
  for(const c of bookId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return QUOTE_COLORS[Math.abs(hash) % QUOTE_COLORS.length];
}

// ── 달력
function moveCal(dir) { calM+=dir; if(calM>11){calM=0;calY++;} if(calM<0){calM=11;calY--;} renderCal(); }

// ── 달력 공유 기능 (Base64 변환 로직 + 모던 빈티지 디자인 적용)
let _sharingCalendar = false;
async function shareCalendar() {
  if(_sharingCalendar) return;
  _sharingCalendar = true;
  const shareBtn = document.querySelector('[onclick="shareCalendar()"]');
  if(shareBtn) { shareBtn.disabled=true; shareBtn.textContent='저장 중...'; }

  try {
    // html2canvas 로드
    if(!window.html2canvas) {
      await new Promise((res,rej) => {
        const sc=document.createElement('script');
        sc.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        sc.onload=res; sc.onerror=rej; document.head.appendChild(sc);
      });
    }

    const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ymPrefix=calY+'-'+String(calM+1).padStart(2,'0');
    const finished=allBooks.filter(b=>b.status==='완독'&&b.date_finish?.startsWith(ymPrefix))
      .sort((a,b)=>(b.rating||0)-(a.rating||0)||(new Date(a.date_finish)-new Date(b.date_finish)));

    // ── 표지 fetch → base64 변환 (data URI는 html2canvas에서 CORS 문제 없음)
    const coverMap={};
    await Promise.all(finished.map(async b=>{
      if(!b.cover) return;
      try {
        const resp=await fetch('https://images.weserv.nl/?url='+encodeURIComponent(b.cover));
        if(!resp.ok) return;
        const blob=await resp.blob();
        coverMap[b.id]=await new Promise(res=>{
          const r=new FileReader();
          r.onload=()=>res(r.result);
          r.onerror=()=>res(null);
          r.readAsDataURL(blob);
        });
      } catch(e) { /* 네트워크/CORS 실패 → 색상 폴백 */ }
    }));

    // ── 카드 DOM 생성 (빈티지 스타일)
    const card=document.createElement('div');
    card.style.cssText='position:fixed;left:-9999px;top:0;width:420px;background:#f2ece0;padding:28px;box-sizing:border-box;font-family:"Pretendard","Noto Sans KR",sans-serif;color:#2a1f10;';

    card.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;">
        <div>
          <div style="font-family:'Cormorant Garamond','Noto Serif KR',serif;font-size:28px;font-style:italic;color:#2a1f10;line-height:1;letter-spacing:-0.01em;">${MONTHS[calM]}</div>
          <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9a8460;margin-top:5px;">${calY}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'Cormorant Garamond','Noto Serif KR',serif;font-size:28px;color:#2a1f10;line-height:1;">${finished.length}</div>
          <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#9a8460;">BOOKS READ</div>
        </div>
      </div>
      <div style="border-top:1px solid #d9ccb0;margin-bottom:14px;"></div>`;

    // 달력 그리드
    const calDiv=document.createElement('div');
    calDiv.style.marginBottom='14px';
    const dowRow=document.createElement('div');
    dowRow.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);padding-bottom:6px;border-bottom:1px solid #d9ccb0;margin-bottom:4px;';
    ['일','월','화','수','목','금','토'].forEach((d,i)=>{
      const c=document.createElement('div');
      c.style.cssText=`text-align:center;font-size:9px;color:${i===0?'#c4714a':'#9a8460'};letter-spacing:.1em;`;
      c.textContent=d; dowRow.appendChild(c);
    });
    calDiv.appendChild(dowRow);
    const grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);';
    const firstDay=new Date(calY,calM,1).getDay();
    const numDays=new Date(calY,calM+1,0).getDate();
    const today=new Date();
    // 빈칸
    for(let i=0;i<firstDay;i++){const b=document.createElement('div');b.style.cssText='aspect-ratio:1/1.1;border-bottom:1px solid #d9ccb0;';grid.appendChild(b);}
    // 날짜
    for(let d=1;d<=numDays;d++){
      const dp=ymPrefix+'-'+String(d).padStart(2,'0');
      const book=finished.find(b=>b.date_finish?.startsWith(dp));
      const isToday=today.getFullYear()===calY&&today.getMonth()===calM&&today.getDate()===d;
      const cell=document.createElement('div');
      cell.style.cssText='aspect-ratio:1/1.1;position:relative;border-bottom:1px solid #d9ccb0;overflow:hidden;';
      if(book){
        const src=coverMap[book.id];
        if(src&&src.startsWith('data:')){
          // base64 → img
          const im=document.createElement('img');
          im.src=src; im.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
          cell.appendChild(im);
        } else if(src){
          // 원본 URL — allowTaint 모드에서 crossOrigin 없이 렌더링
          const im=document.createElement('img');
          im.src=src; im.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
          cell.appendChild(im);
        } else {
          cell.style.background='#6b8f6b';
        }
        const dn=document.createElement('span');
        dn.style.cssText='position:absolute;top:2px;left:3px;font-size:8px;color:rgba(255,255,255,.9);font-family:Cormorant Garamond,serif;font-style:italic;text-shadow:0 1px 2px rgba(0,0,0,.5);z-index:1;';
        dn.textContent=d; cell.appendChild(dn);
      } else {
        cell.style.cssText+=(isToday?'background:#fbf6e8;':'');
        const dn=document.createElement('div');
        dn.style.cssText=`padding:3px 4px;font-family:'Cormorant Garamond',serif;font-size:11px;color:${isToday?'#c4714a':'#2a1f10'};${isToday?'font-style:italic;':''}`;
        dn.textContent=d; cell.appendChild(dn);
      }
      grid.appendChild(cell);
    }
    calDiv.appendChild(grid);
    card.appendChild(calDiv);

    // 구분선
    const hr=document.createElement('div');
    hr.style.cssText='border-top:1px dashed #d9ccb0;margin-bottom:12px;';
    card.appendChild(hr);

    // 완독 리스트
    if(finished.length>0){
      const lt=document.createElement('div');
      lt.style.cssText='font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#9a8460;margin-bottom:8px;';
      lt.textContent='Reading List'; card.appendChild(lt);
      finished.slice(0,5).forEach(b=>{
        const src=coverMap[b.id];
        const row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #ede4d0;';
        const thumb=document.createElement('div');
        thumb.style.cssText='width:22px;height:32px;border-radius:2px;overflow:hidden;flex-shrink:0;background:#6b8f6b;';
        if(src){
          const ti=document.createElement('img');
          ti.src=src; ti.style.cssText='width:100%;height:100%;object-fit:cover;';
          thumb.appendChild(ti);
        }
        row.appendChild(thumb);
        const txt=document.createElement('div');
        txt.style.cssText='flex:1;min-width:0;';
        txt.innerHTML=`<div style="font-size:11px;font-weight:600;color:#2a1f10;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.title||''}</div><div style="font-size:9px;color:#9a8460;margin-top:1px;">${(b.author||'').split(/[,·]/)[0].slice(0,18)}</div>`;
        row.appendChild(txt);
        if(b.rating){const st=document.createElement('div');st.style.cssText='font-size:10px;color:#c4714a;flex-shrink:0;font-family:Cormorant Garamond,serif;font-style:italic;';st.textContent='★ '+b.rating;row.appendChild(st);}
        card.appendChild(row);
      });
      if(finished.length>5){const more=document.createElement('div');more.style.cssText='font-size:9px;color:#9a8460;text-align:right;font-style:italic;';more.textContent='and '+(finished.length-5)+' more books';card.appendChild(more);}
    }

    // 푸터
    const footer=document.createElement('div');
    footer.style.cssText='border-top:1px solid #d9ccb0;margin-top:12px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;';
    footer.innerHTML=`<span style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#bda788;">BOOKLOG</span><span style="font-size:9px;color:#9a8460;">${allBooks.filter(b=>b.status==='완독').length} books in total</span>`;
    card.appendChild(footer);

    // 모든 img 로딩 대기
    document.body.appendChild(card);
    await new Promise(res=>setTimeout(res,100));
    const imgs=[...card.querySelectorAll('img')];
    await Promise.all(imgs.map(img=>new Promise(res=>{
      if(img.complete&&img.naturalWidth>0)res();
      else{img.onload=res;img.onerror=res;setTimeout(res,5000);}
    })));
    await new Promise(res=>setTimeout(res,200));

    const canvas=await html2canvas(card,{
      scale:3.5,
      backgroundColor:'#f2ece0',
      useCORS:true,
      allowTaint:true,
      logging:false,
      imageTimeout:20000
    });
    card.remove();

    const dataUrl=canvas.toDataURL('image/png');
    const a=document.createElement('a');
    a.href=dataUrl; a.download='Booklog_'+calY+'_'+MONTHS[calM]+'.png';
    a.click();
    await showAlert('달력 이미지가 저장됐어요! 📅');

  } catch(err) {
    console.error('shareCalendar error:',err);
    await showAlert('이미지 저장 실패: '+err.message);
  } finally {
    _sharingCalendar=false;
    if(shareBtn){shareBtn.disabled=false;shareBtn.textContent='📤 공유';}
  }
}

function renderCal() {
  const MONTHS_EN=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const MONTHS_SHORT=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  // 헤더 업데이트
  const ttlEl = document.getElementById('cal-ttl');
  if(ttlEl) ttlEl.innerHTML = `<span style="font-family:var(--ff-disp);font-size:.85rem;font-style:italic;letter-spacing:-.01em;">${calY}.${String(calM+1).padStart(2,'0')}</span>`;
  // 기록 페이지 부제 업데이트
  const recMonthLbl = document.getElementById('record-month-lbl');
  if(recMonthLbl) recMonthLbl.textContent = MONTHS_SHORT[calM]+' '+calY;
  const grid = document.getElementById('cal-grid');
  const dows = [...grid.querySelectorAll('.dow')]; grid.innerHTML=''; dows.forEach(d=>grid.appendChild(d));
  const first=new Date(calY,calM,1).getDay(), days=new Date(calY,calM+1,0).getDate(), prev=new Date(calY,calM,0).getDate(), today=new Date();
  // 빈 칸
  for(let i=0;i<first;i++){const d=document.createElement('div');d.className='day other';const dn=document.createElement('span');dn.textContent=prev-first+1+i;d.appendChild(dn);grid.appendChild(d);}
  for(let d=1;d<=days;d++){
    const ds=calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const book=allBooks.find(b=>b.date_finish===ds&&b.status==='완독');
    const el=document.createElement('div');
    const isT=today.getFullYear()===calY&&today.getMonth()===calM&&today.getDate()===d;
    const questAch = QUESTS.filter(q => localStorage.getItem('bl_quest_ach_'+q.id) === ds);
    // 타이머 기록 날짜 확인
    const timerKey = 'bl_daily_timer_'+ds;
    const hasTimer = parseInt(localStorage.getItem(timerKey)||'0') > 0;
    // 책별 reading_time_log 확인 (완독 표지 날짜 제외)
    const hasBookLog = allBooks.some(bk => bk.date_finish !== ds && (bk.reading_time_log?.[ds]||0) > 0);
    const hasActivity = hasTimer || hasBookLog;

    if(book){
      el.className='day hbook'; el.title=book.title; el.onclick=()=>openDetail(book.id);
      el.style.padding='0'; el.style.overflow='hidden';
      if(book.cover){
        const img=document.createElement('img');
        img.style.cssText='width:100%;height:100%;object-fit:cover;display:block;';
        img.src=book.cover; img.alt=book.title;
        img.onerror=()=>{ img.style.display='none'; el.style.background='#6b8f6b'; };
        el.appendChild(img);
      } else {
        // 표지 없으면 상태 색 배경
        const stColor={'완독':'#6b8f6b'}[book.status]||'#6b8f6b';
        el.style.background=stColor;
        const ph=document.createElement('div');
        ph.style.cssText='position:absolute;inset:0;display:flex;align-items:flex-end;padding:2px 3px;';
        const ti=document.createElement('div');
        ti.style.cssText='font-size:.38rem;color:rgba(255,255,255,.8);font-family:var(--ff-disp);font-style:italic;line-height:1.1;overflow:hidden;';
        ti.textContent=(book.title||'').slice(0,8); ph.appendChild(ti); el.appendChild(ph);
      }
      // 날짜 숫자 (우상단 오버레이)
      const dn=document.createElement('span');
      dn.style.cssText='position:absolute;top:2px;left:4px;font-size:.55rem;color:rgba(255,255,255,.9);font-family:var(--ff-disp);font-style:italic;text-shadow:0 1px 2px rgba(0,0,0,.5);z-index:1;';
      dn.textContent=d; el.appendChild(dn);
    } else {
      el.className='day'+(isT?' today':'');
      // 날짜 숫자
      const dn=document.createElement('div');
      dn.textContent=d; dn.style.cssText='font-family:var(--ff-disp);font-size:.7rem;'+(isT?'color:var(--rust);font-style:italic;':'');
      el.appendChild(dn);
      // 형광펜 바 (타이머·독서 기록 있는 날)
      if(hasActivity){
        el.style.position='relative';
        // 어떤 책들이 해당 날짜에 읽혔는지 확인
        const activeBks=allBooks.filter(bk=>bk.date_finish!==ds&&(bk.reading_time_log?.[ds]||0)>0);
        const barColor=activeBks.length>0?GCOLS[allBooks.indexOf(activeBks[0])%GCOLS.length]:'#c4714a';
        const calTipLines=activeBks.map(bk=>{
          const mins=bk.reading_time_log?.[ds]||0;
          const t=mins>=60?Math.floor(mins/60)+'h '+(mins%60?mins%60+'m':''):mins+'m';
          const auth=bk.author?bk.author.split(/[,·]/)[0].trim():'';
          return `<b>${bk.title}</b>${auth?' · '+auth:''}<br><span style="opacity:.7;font-size:.85em;">${t}</span>`;
        }).join('<br>');
        const bar=document.createElement('div');
        bar.style.cssText=`position:absolute;bottom:0;left:0;right:0;height:5px;background:${barColor};opacity:.62;border-radius:0 0 3px 3px;cursor:default;`;
        if(calTipLines){
          bar.addEventListener('mouseenter',e=>showTip(e,calTipLines));
          bar.addEventListener('mousemove',moveTip);
          bar.addEventListener('mouseleave',hideTip);
        }
        el.appendChild(bar);
        // 2권 이상이면 보조 바
        if(activeBks.length>1){
          const bar2=document.createElement('div');
          const col2=GCOLS[allBooks.indexOf(activeBks[1])%GCOLS.length];
          bar2.style.cssText=`position:absolute;bottom:0;left:0;width:40%;height:5px;background:${col2};opacity:.55;border-radius:0 0 0 3px;pointer-events:none;`;
          el.appendChild(bar2);
        }
      }
      // 퀘스트 달성 뱃지
      if(questAch.length>0){
        const qb=document.createElement('span');
        qb.style.cssText='position:absolute;bottom:2px;right:2px;font-size:.45rem;line-height:1;';
        qb.textContent=questAch[0].reward.item||'🏆';
        qb.title=questAch.map(q=>q.name).join(', ');
        el.appendChild(qb);
        el.style.position='relative';
      }
    }
    grid.appendChild(el);
  }
  const rem=42-first-days; for(let i=1;i<=rem;i++){const d=document.createElement('div');d.className='day other';const dn=document.createElement('span');dn.textContent=i;d.appendChild(dn);grid.appendChild(d);}
  // 완독 리스트
  const list=document.getElementById('cal-list'); list.innerHTML='';
  const mk=calY+'-'+String(calM+1).padStart(2,'0');
  const mb=allBooks.filter(b=>b.date_finish?.startsWith(mk)&&b.status==='완독');
  if(!mb.length) list.innerHTML='<div style="font-size:.68rem;color:var(--tx3);padding:.3rem 0;font-style:italic;">이 달에 완독한 책이 없습니다.</div>';
  else mb.forEach(b=>{
    const r=document.createElement('div');r.className='cli';r.onclick=()=>openDetail(b.id);
    const stColor='#6b8f6b';
    r.innerHTML=`<span style="display:inline-block;width:22px;height:30px;border-radius:2px;overflow:hidden;flex-shrink:0;margin-right:8px;">${b.cover?`<img src="${b.cover}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;background:${stColor};"></div>`}</span><span style="flex:1;font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.title}</span><span style="color:var(--tx3);font-size:.6rem;font-family:var(--ff-disp);font-style:italic;flex-shrink:0;">${b.date_finish?.slice(5)||''}</span>`;
    list.appendChild(r);
  });
}

// ── 타이머

function showTimerBookDetail(bookId) {
  const wrap = document.getElementById('timer-book-detail');
  if(!wrap) return;
  if(!bookId) { wrap.innerHTML=''; return; }
  const book = allBooks.find(b=>b.id===bookId);
  if(!book) return;
  const mins = book.reading_time || 0;
  const pages = book.pages || 0;
  const curPage = book.current_page || 0;
  const pct = pages && curPage ? Math.min(100,Math.round(curPage/pages*100)) : 0;
  wrap.innerHTML = `
    <div style="background:#f5f0e8;border-radius:6px;padding:.45rem .6rem;border:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${pages&&curPage?'.35rem':'0'};">
        <span style="font-size:.62rem;color:var(--tx3);">⏱ 누적 ${Math.floor(mins/60)}h ${mins%60}m</span>
        ${pages&&curPage?`<span style="font-size:.62rem;color:var(--tx3);">${curPage}/${pages}p</span>`:''}
      </div>
      ${pages&&curPage?`<div style="height:4px;background:#ddd5c5;border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--acc),var(--gold));border-radius:2px;"></div>
      </div>
      <div style="font-size:.55rem;color:var(--tx3);margin-top:.15rem;text-align:right;">${pct}% 완료</div>`:''}
    </div>`;
}

function buildTimer() {
  const sel = document.getElementById('timer-book-select');
  sel.innerHTML = '<option value="">읽는 중인 책 선택...</option>';
  allBooks.filter(b=>b.status==='읽는중').forEach(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=b.title;sel.appendChild(o);});
  sel.onchange = () => showTimerBookDetail(sel.value);
  updateTimerDisplay();
  buildWeeklyStats();
  updateTrackerPeriodBtns();
  buildTrackerGrid();
}

function buildWeeklyStats() {
  const el = document.getElementById('timer-weekly');
  if(!el) return;
  const today = new Date();
  const todayStr = kstToday();
  const DOW = ['일','월','화','수','목','금','토'];
  // 최근 7일
  const days = [];
  const fmtLocal=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  for(let i=6;i>=0;i--){
    const d=new Date(today); d.setDate(d.getDate()-i);
    const ds=fmtLocal(d);
    const lsMins=parseInt(localStorage.getItem('bl_daily_timer_'+ds)||'0');
    const bookMins=allBooks.reduce((s,b)=>s+(b.reading_time_log?.[ds]||0),0);
    days.push({ds,mins:Math.max(lsMins,bookMins),dow:d.getDay()});
  }
  const total=days.reduce((s,d)=>s+d.mins,0);
  const maxM=Math.max(...days.map(d=>d.mins),1);
  // 지난 7일 (비교)
  let lastTotal=0;
  for(let i=7;i<=13;i++){
    const d2=new Date(today); d2.setDate(d2.getDate()-i);
    const ds2=fmtLocal(d2);
    const m=parseInt(localStorage.getItem('bl_daily_timer_'+ds2)||'0');
    const bm=allBooks.reduce((s,b)=>s+(b.reading_time_log?.[ds2]||0),0);
    lastTotal+=Math.max(m,bm);
  }
  const totalH=Math.floor(total/60),totalMin=total%60;
  const diff=total-lastTotal;
  const absDiff=Math.abs(diff);
  const diffStr=diff===0?'지난주와 동일':(diff>0?'+':'−')+Math.floor(absDiff/60)+'h '+absDiff%60+'m';
  const diffColor=diff>=0?'#7a9e7e':'#c4714a';
  el.innerHTML=`
    <div style="font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);margin-bottom:.45rem;">이 주의 통계</div>
    <div style="display:flex;align-items:baseline;gap:.35rem;margin-bottom:.6rem;min-width:0;overflow:hidden;">
      <span style="font-family:var(--ff-disp);font-style:italic;font-size:1.2rem;color:var(--tx1);line-height:1;white-space:nowrap;flex-shrink:0;">${totalH}h ${totalMin}m</span>
      <span style="font-size:.53rem;color:${diffColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${diffStr}</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:2px;height:38px;margin-bottom:.2rem;width:100%;">
      ${days.map(d=>{
        const h=d.mins?Math.max(d.mins/maxM*34,3):0;
        const isTd=d.ds===todayStr;
        const WEEK_COLS=['#6b8f6b','#5a7a8a','#c4a87a','#7a5a8a','#c4714a','#3a6858','#c87850'];
        const barCol=isTd?'#c4714a':WEEK_COLS[d.dow];
        return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;" title="${d.mins?d.mins+'분':''}"><div style="width:100%;height:${h}px;background:${barCol};opacity:${isTd?'1':d.mins?'.75':'.18'};border-radius:2px 2px 0 0;transition:opacity .2s;"></div></div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:2px;width:100%;">

      ${days.map(d=>`<div style="flex:1;text-align:center;font-size:.44rem;color:var(--tx3);">${DOW[d.dow]}</div>`).join('')}
    </div>`;
}
function updateTrackerPeriodBtns() {
  document.querySelectorAll('.tracker-period-btn').forEach(b=>{
    b.classList.toggle('on', b.dataset.period===timerPeriod);
  });
}
function updateTimerDisplay() {
  const h=Math.floor(timerSeconds/3600), m=Math.floor((timerSeconds%3600)/60), s=timerSeconds%60;
  const el=document.getElementById('timer-display');
  if(el) el.textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const btn=document.getElementById('timer-btn');
  if(btn) btn.textContent=timerRunning?'⏸ 일시정지':(timerSeconds>0?'▶ 계속':'▶ 시작');
  // 미저장 힌트: 60초 이상 + 정지 상태일 때 표시
  const hasUnsaved = timerSeconds >= 60 && !timerRunning;
  const hint = document.getElementById('timer-save-hint');
  if(hint) hint.style.display = hasUnsaved ? '' : 'none';
  const saveBtn = document.getElementById('timer-save-btn');
  if(saveBtn) {
    saveBtn.style.outline = hasUnsaved ? '2px solid #c4714a' : '';
    saveBtn.style.boxShadow = hasUnsaved ? '0 0 0 3px rgba(196,113,74,.18)' : '';
  }
  updateTimerIndicator();
}

function updateTimerIndicator() {
  let ind = document.getElementById('timer-indicator');
  if(!timerRunning) {
    if(ind) ind.style.display='none';
    return;
  }
  if(!ind) {
    ind = document.createElement('div');
    ind.id = 'timer-indicator';
    ind.style.cssText = 'position:fixed;bottom:72px;right:16px;z-index:9999;background:var(--tx1);color:#f5f0e8;border-radius:20px;padding:.38rem .85rem .38rem .65rem;display:flex;align-items:center;gap:.5rem;font-family:var(--ff);font-size:.72rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.22);cursor:pointer;user-select:none;';
    ind.onclick = () => { const btn=document.querySelector('.tab[onclick*="record"]'); if(btn) btn.click(); };
    const dot = document.createElement('span');
    dot.id='timer-ind-dot';dot.style.cssText='width:7px;height:7px;border-radius:50%;background:var(--rust);display:inline-block;animation:timerPulse 1.2s ease-in-out infinite;flex-shrink:0;';
    const txt = document.createElement('span');
    txt.id='timer-ind-txt';
    ind.appendChild(dot);ind.appendChild(txt);
    document.body.appendChild(ind);
  }
  const h=Math.floor(timerSeconds/3600),m=Math.floor((timerSeconds%3600)/60),s=timerSeconds%60;
  const timeTxt = h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
  const book = timerBookId ? (allBooks.find(b=>b.id===timerBookId)?.title||'').slice(0,12) : '';
  const txt=document.getElementById('timer-ind-txt');
  if(txt) txt.textContent = (book?book+' · ':'') + timeTxt;
  ind.style.display='flex';
}
function toggleTimer() {
  const sel=document.getElementById('timer-book-select');
  if(!timerRunning&&sel&&!sel.value){showAlert('읽는 중인 책을 먼저 선택해주세요.');return;}
  if(timerRunning){
    clearInterval(timerInterval);timerRunning=false;
    // 타이머 상태 저장 해제
    localStorage.removeItem('bl_timer_start');
    localStorage.removeItem('bl_timer_book_id');
    localStorage.removeItem('bl_timer_offset');
  } else {
    // 시작 시 카운트
    localStorage.setItem('bl_timer_total', String((parseInt(localStorage.getItem('bl_timer_total')||'0')+1)));
    const _td=kstToday();
    const _dtk='bl_daily_timer_'+_td;
    const _dtc=parseInt(localStorage.getItem(_dtk)||'0')+1;
    localStorage.setItem(_dtk, String(_dtc));
    if(_dtc > parseInt(localStorage.getItem('bl_daily_timer_max')||'0'))
      localStorage.setItem('bl_daily_timer_max', String(_dtc));
    timerBookId=sel?.value||null;timerRunning=true;
    requestTimerNotifPerm();
    // 타이머 상태 localStorage 저장 (페이지 이탈/화면 꺼짐 복원용)
    localStorage.setItem('bl_timer_start', String(Date.now() - timerSeconds*1000));
    localStorage.setItem('bl_timer_book_id', timerBookId||'');
    localStorage.setItem('bl_timer_offset', String(timerSeconds));
    timerInterval=setInterval(()=>{timerSeconds++;updateTimerDisplay();},1000);
  }
  updateTimerDisplay();
  updateTimerBtn();
}

function updateTimerBtn() {
  const btn = document.getElementById('timer-btn');
  if(!btn) return;
  if(timerRunning) {
    btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> 일시정지';
    btn.style.background = 'var(--rust)';
  } else {
    btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> 시작';
    btn.style.background = 'var(--tx1)';
  }
}

// ── 백그라운드 타이머 알림
let _timerNotif = null;
async function requestTimerNotifPerm() {
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted') return true;
  if(Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}
function showTimerNotif() {
  if(!timerRunning || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    _timerNotif?.close();
    const h=Math.floor(timerSeconds/3600),m=Math.floor((timerSeconds%3600)/60);
    const timeStr = h>0?`${h}시간 ${m}분`:`${m}분`;
    const bookTitle = timerBookId ? (allBooks.find(b=>b.id===timerBookId)?.title||'') : '';
    _timerNotif = new Notification('📚 독서 타이머 작동 중', {
      body: (bookTitle?`"${bookTitle}" · `:'')+timeStr+' 경과',
      tag: 'bl-reading-timer',
      silent: true,
      requireInteraction: true
    });
    _timerNotif.onclick = () => { window.focus(); _timerNotif?.close(); };
  } catch(e) {}
}
function closeTimerNotif() {
  try { _timerNotif?.close(); _timerNotif = null; } catch(e) {}
}

// 백그라운드·화면꺼짐·이탈 시 타이머 유지
document.addEventListener('visibilitychange', () => {
  if(document.hidden && timerRunning) {
    // 페이지가 숨겨질 때: localStorage에 현재 시작 시각 저장 후 interval 정지
    localStorage.setItem('bl_timer_start', String(Date.now() - timerSeconds*1000));
    clearInterval(timerInterval); timerInterval=null;
    showTimerNotif();
  } else if(!document.hidden) {
    closeTimerNotif();
    const savedStart = localStorage.getItem('bl_timer_start');
    const savedBook  = localStorage.getItem('bl_timer_book_id');
    if(savedStart) {
      // 저장된 시작 시각으로 경과 시간 계산
      const elapsed = Math.round((Date.now() - parseInt(savedStart)) / 1000);
      if(elapsed > 0 && elapsed < 86400) {
        timerSeconds = elapsed;
        if(!timerRunning && savedBook) {
          timerRunning = true;
          timerBookId = savedBook;
        }
      }
    }
    if(timerRunning && !timerInterval) {
      timerInterval = setInterval(()=>{timerSeconds++;updateTimerDisplay();},1000);
    }
    updateTimerDisplay();
    updateTimerBtn();
    updateTimerIndicator();
  }
});

function restoreTimerOnLoad() {
  const savedStart  = localStorage.getItem('bl_timer_start');
  const savedBookId = localStorage.getItem('bl_timer_book_id');
  if(!savedStart || !savedBookId) return;
  const elapsed = Math.round((Date.now() - parseInt(savedStart)) / 1000);
  if(elapsed <= 0 || elapsed >= 86400) {
    localStorage.removeItem('bl_timer_start');
    localStorage.removeItem('bl_timer_book_id');
    return;
  }
  timerSeconds = elapsed;
  timerBookId   = savedBookId;
  timerRunning  = true;
  clearInterval(timerInterval);
  timerInterval = setInterval(()=>{timerSeconds++;updateTimerDisplay();},1000);
  updateTimerDisplay();
  updateTimerBtn();
  updateTimerIndicator();
}
function resetTimer() {
  if(!confirm('타이머를 초기화할까요?'))return;
  clearInterval(timerInterval);timerRunning=false;timerSeconds=0;timerInterval=null;
  localStorage.removeItem('bl_timer_start');
  localStorage.removeItem('bl_timer_book_id');
  localStorage.removeItem('bl_timer_offset');
  updateTimerDisplay();updateTimerBtn();updateTimerIndicator();
}
async function saveTimer() {
  if(timerSeconds<60){alert('최소 1분 이상 읽어야 저장할 수 있어요.');return;}
  const sel=document.getElementById('timer-book-select');
  const bookId=sel?.value||timerBookId;
  if(!bookId){alert('책을 선택해주세요.');return;}
  const book=allBooks.find(b=>b.id===bookId);
  if(!book){alert('책을 찾을 수 없어요.');return;}
  const mins=Math.round(timerSeconds/60);
  const today=kstToday();
  const cy = new Date().getFullYear();
  try {
    // 연도별 독서 시간 누적
    const cyStr = String(cy);
    const yearData = book.reading_time_year || {};
    // string 키로 통일 (Supabase jsonb 왕복 후 키가 string이 됨)
    yearData[cyStr] = (yearData[cyStr] ?? yearData[cy] ?? 0) + mins;
    if(yearData[cy] !== undefined && cy !== cyStr) delete yearData[cy];
    // 날짜별 기록 (트래커 + 통계 정확도)
    const timeLog = book.reading_time_log || {};
    timeLog[today] = (timeLog[today] || 0) + mins;
    const updateData = {
      reading_time:(book.reading_time||0)+mins,
      reading_time_year: yearData,
      reading_time_log: timeLog,
      last_read:today
    };
    // 타이머에서 현재 페이지 입력값 반영
    const timerPageInput = document.getElementById('timer-current-page');
    if(timerPageInput?.value) {
      const cp = parseInt(timerPageInput.value);
      if(!book.pages || cp <= book.pages) updateData.current_page = cp;
    }
    const {error} = await sb.from('books').update(updateData).eq('id',bookId).eq('user_id',currentUser.id);
    if(error) throw error;
    if(mins <= 2) localStorage.setItem('bl_quick_timer_count', String((parseInt(localStorage.getItem('bl_quick_timer_count')||'0')+1)));
    clearInterval(timerInterval);timerRunning=false;timerSeconds=0;timerInterval=null;
    localStorage.removeItem('bl_timer_start');
    localStorage.removeItem('bl_timer_book_id');
    localStorage.removeItem('bl_timer_offset');
    if(timerPageInput) timerPageInput.value='';
    await loadData(); updateTimerDisplay(); updateTimerBtn(); updateTimerIndicator(); buildTimer();
    alert(`${mins}분 저장됐어요!`);
  } catch(e){ alert('저장 오류: '+(e.message||'알 수 없는 오류')); }
}
function moveTimerMonth(dir) {
  if(timerPeriod === 'week') {
    // 주 단위 이동
    const cur = new Date(timerTrackY, timerTrackM, 1);
    cur.setDate(cur.getDate() + dir * 7);
    timerTrackY = cur.getFullYear();
    timerTrackM = cur.getMonth();
    // 이동 후 해당 주의 일요일로 설정
    window._timerWeekOffset = (window._timerWeekOffset||0) + dir;
  } else if(timerPeriod === 'year') {
    timerTrackY += dir;
  } else {
    timerTrackM += dir;
    if(timerTrackM>11){timerTrackM=0;timerTrackY++;}
    if(timerTrackM<0){timerTrackM=11;timerTrackY--;}
  }
  buildTrackerGrid();
}
function setTimerPeriod(p) {
  timerPeriod=p;
  if(p==='week') window._timerWeekOffset=0;
  document.querySelectorAll('.tracker-period-btn').forEach(b=>b.classList.toggle('on',b.dataset.period===p));
  buildTrackerGrid();
}
function buildTrackerGrid() {
  const wrap = document.getElementById('timer-tracker-grid');
  if(!wrap) return;
  wrap.innerHTML = '';
  wrap.style.cssText = '';

  const dayMap = {};
  allBooks.forEach(b => {
    if(b.reading_time_log && typeof b.reading_time_log === 'object') {
      Object.entries(b.reading_time_log).forEach(([date, mins]) => {
        if(date && mins > 0) dayMap[date] = (dayMap[date]||0) + mins;
      });
    } else if(b.last_read && b.reading_time) {
      dayMap[b.last_read] = (dayMap[b.last_read]||0) + b.reading_time;
    }
  });
  const allVals = Object.values(dayMap);
  const maxMins = allVals.length ? Math.max(...allVals) : 1;
  const fmtKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date();

  if(timerPeriod === 'week') {
    // 이번 주 일요일 기준 + offset(주 단위)
    const offset = window._timerWeekOffset || 0;
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - today.getDay() + offset * 7);
    // 주차 레이블
    const saturday = new Date(sunday); saturday.setDate(sunday.getDate()+6);
    const labelEl = document.getElementById('timer-month-label');
    if(labelEl) {
      const mo = sunday.getMonth()+1;
      // 몇 번째 주인지 계산
      const weekNum = Math.ceil(sunday.getDate()/7);
      labelEl.textContent = `${sunday.getFullYear()}년 ${mo}월 ${weekNum}주`;
    }
    const days = Array.from({length:7}, (_,i) => {
      const d = new Date(sunday); d.setDate(sunday.getDate()+i); return d;
    });
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:5px;';
    const DOW = ['일','월','화','수','목','금','토'];
    days.forEach((d,i) => {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:.6rem;color:var(--tx3);text-align:center;padding:.12rem 0;font-weight:600;';
      h.textContent = DOW[i]; wrap.appendChild(h);
    });
    days.forEach(d => {
      const key = fmtKey(d);
      const mins = dayMap[key]||0;
      const intensity = mins===0?0:Math.min(6,Math.ceil((mins/maxMins)*6));
      const isToday = fmtKey(d)===fmtKey(today);
      const cell = document.createElement('div');
      cell.style.cssText = `aspect-ratio:1;border-radius:8px;background:${TRACKER_COLORS[intensity]};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:${isToday?'2px solid var(--acc)':'1px solid rgba(0,0,0,.06)'};`;
      cell.title = `${d.getMonth()+1}/${d.getDate()}: ${mins?mins+'분':'없음'}`;
      cell.innerHTML = `<span style="font-size:.7rem;font-weight:600;color:${intensity>=2?'#fff':'var(--tx2)'};">${d.getDate()}</span>
        ${mins?`<span style="font-size:.55rem;color:${intensity>=2?'rgba(255,255,255,.85)':'var(--acc)'};">${mins}m</span>`:''}`;
      wrap.appendChild(cell);
    });
    const total = days.reduce((a,d)=>a+(dayMap[fmtKey(d)]||0),0);
    const sum = document.getElementById('tracker-summary');
    if(sum) sum.textContent = `이번 주 ${Math.floor(total/60)}h ${total%60}m`;

  } else if(timerPeriod === 'month') {
    const y = timerTrackY, m = timerTrackM;
    const daysInMonth = new Date(y,m+1,0).getDate();
    const firstDay = new Date(y,m,1).getDay();
    const MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const labelEl = document.getElementById('timer-month-label');
    if(labelEl) labelEl.textContent = `${y}년 ${MN[m]}`;
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:3px;';
    ['일','월','화','수','목','금','토'].forEach(d=>{
      const h=document.createElement('div');
      h.style.cssText='font-size:.58rem;color:var(--tx3);text-align:center;padding:.1rem 0;font-weight:600;';
      h.textContent=d; wrap.appendChild(h);
    });
    for(let i=0;i<firstDay;i++){
      const e=document.createElement('div');
      e.style.cssText='aspect-ratio:1;border-radius:5px;background:#f5f0e8;opacity:.3;';
      wrap.appendChild(e);
    }
    const todayKey = fmtKey(today);
    for(let d=1;d<=daysInMonth;d++){
      const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const mins=dayMap[key]||0;
      const intensity=mins===0?0:Math.min(6,Math.ceil((mins/maxMins)*6));
      const isToday=key===todayKey;
      const cell=document.createElement('div');
      cell.style.cssText=`aspect-ratio:1;border-radius:5px;background:${TRACKER_COLORS[intensity]};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:${isToday?'2px solid var(--acc)':'1px solid rgba(0,0,0,.05)'};cursor:default;transition:transform .12s;`;
      cell.title=`${m+1}월 ${d}일: ${mins?mins+'분':'없음'}`;
      cell.innerHTML=`<span style="font-size:.58rem;font-weight:${isToday?700:500};color:${intensity>=2?'#fff':'var(--tx2)'};">${d}</span>
        ${mins?`<span style="font-size:.48rem;color:${intensity>=2?'rgba(255,255,255,.85)':'var(--acc)'};">${mins<60?mins+'m':Math.floor(mins/60)+'h'}</span>`:''}`;
      cell.onmouseenter=()=>cell.style.transform='scale(1.08)';
      cell.onmouseleave=()=>cell.style.transform='scale(1)';
      wrap.appendChild(cell);
    }
    const total=Object.entries(dayMap).filter(([k])=>k.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)).reduce((a,[,v])=>a+v,0);
    const sum=document.getElementById('tracker-summary');
    if(sum) sum.textContent=`이달 ${Math.floor(total/60)}h ${total%60}m`;

  } else {
    // 연간
    const y = timerTrackY;
    const labelEl = document.getElementById('timer-month-label');
    if(labelEl) labelEl.textContent = `${y}년`;
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:5px;';
    const MN2=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    for(let mo=0;mo<12;mo++){
      const card=document.createElement('div');
      card.style.cssText='background:#fff;border:1px solid var(--border);border-radius:6px;padding:.4rem .45rem;box-shadow:0 1px 4px rgba(0,0,0,.06);';
      const days=new Date(y,mo+1,0).getDate();
      const fd=new Date(y,mo,1).getDay();
      const moTotal=Object.entries(dayMap).filter(([k])=>k.startsWith(`${y}-${String(mo+1).padStart(2,'0')}`)).reduce((a,[,v])=>a+v,0);
      const moLabel=document.createElement('div');
      moLabel.style.cssText='font-size:.58rem;font-weight:600;color:var(--tx2);margin-bottom:3px;display:flex;justify-content:space-between;';
      moLabel.innerHTML=`<span>${MN2[mo]}</span>${moTotal?`<span style="color:var(--acc);font-size:.52rem;">${Math.floor(moTotal/60)}h${moTotal%60}m</span>`:''}`;
      card.appendChild(moLabel);
      const miniGrid=document.createElement('div');
      miniGrid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:1px;';
      for(let i=0;i<fd;i++){const e=document.createElement('div');e.style.cssText='aspect-ratio:1;background:transparent;';miniGrid.appendChild(e);}
      for(let d=1;d<=days;d++){
        const key=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const mins=dayMap[key]||0;
        const intensity=mins===0?0:Math.min(6,Math.ceil((mins/maxMins)*6));
        const isT=(today.getFullYear()===y&&today.getMonth()===mo&&today.getDate()===d);
        const cell=document.createElement('div');
        cell.style.cssText=`aspect-ratio:1;border-radius:1px;background:${TRACKER_COLORS[intensity]};${isT?'outline:1.5px solid var(--acc);':''}`;
        cell.title=`${mo+1}/${d}: ${mins?mins+'분':'없음'}`;
        miniGrid.appendChild(cell);
      }
      card.appendChild(miniGrid);
      wrap.appendChild(card);
    }
    const yearTotal=Object.entries(dayMap).filter(([k])=>k.startsWith(String(y))).reduce((a,[,v])=>a+v,0);
    const sum=document.getElementById('tracker-summary');
    if(sum) sum.textContent=`연간 ${Math.floor(yearTotal/60)}h ${yearTotal%60}m`;
  }
}
function buildTimerBookList() {
  const wrap=document.getElementById('timer-book-list'); if(!wrap) return;
  wrap.innerHTML='';
  const booksWithTime=allBooks.filter(b=>b.reading_time>0).sort((a,b)=>b.reading_time-a.reading_time);
  if(!booksWithTime.length){wrap.innerHTML='<div style="font-size:.72rem;color:var(--tx3);">아직 기록된 독서 시간이 없어요.</div>';return;}
  const maxT=booksWithTime[0].reading_time;
  booksWithTime.forEach(b=>{
    const pct=Math.round(b.reading_time/maxT*100);
    const h=Math.floor(b.reading_time/60), m=b.reading_time%60;
    const row=document.createElement('div');row.className='timer-book-item';
    row.innerHTML=`<span style="min-width:100px;font-weight:500;color:var(--tx1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.title}</span>
      <div class="timer-book-bar"><div class="timer-book-bar-fill" style="width:${pct}%"></div></div>
      <span style="min-width:52px;text-align:right;color:var(--tx3);">${h}h ${m}m</span>`;
    wrap.appendChild(row);
  });
}


// ═══════════════════════════════════════════════
// 독서 퀘스트 & 전리품 시스템
// ═══════════════════════════════════════════════

// 퀘스트 정의
// condition(allBooks, profile): boolean — 달성 여부 판정
// ── 빈티지 퀘스트 전리품 디자인
const QUESTS = [
  // ── 0. 시초의 독자
  {
    id: 'pioneer',
    name: '시초의 독자',
    hint: '북로그의 첫 번째 독자들에게 주어지는 특별한 칭호',
    desc: '🎉 북로그의 테스트에 참여해주셨어요! 당신은 북로그의 시초 독자입니다. 감사해요.',
    condition: (books, profile) => {
      const joinedAt = profile?.created_at || '';
      if(!joinedAt) return false;
      return new Date(joinedAt) <= new Date('2026-05-31T23:59:59Z');
    },
    reward: {
      title: '북로그의 시초',
      item: '🗝️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_pio" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#E8C37B"/><stop offset="100%" stop-color="#8B6508"/></linearGradient><filter id="s_pio"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#3E2723" flood-opacity="0.6"/></filter></defs><g filter="url(#s_pio)"><path d="M16 4C11.58 4 8 7.58 8 12c0 3.86 2.73 7.08 6.36 7.84V24l3 3 3-3v-1.5l1.5-1.5V19.84C25.27 19.08 28 15.86 28 12c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" fill="url(#g_pio)" stroke="#5C4033" stroke-width="0.5"/></g></svg>`,
      itemName: '시초의 황금 열쇠',
      itemDesc: '북로그의 문을 처음 연 독자에게',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 1. 돌아온 독서가
  {
    id: 'returnee',
    name: '돌아온 독서가',
    hint: '어디에서 오셨나요?',
    desc: '과거 주름 잡던 독서가시죠? 받들어 모시겠습니다!',
    condition: (books) => books.filter(b => b.source === 'import').length >= 100,
    reward: {
      title: '📚 돌아온 독서가',
      item: '📕',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_ret" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#641E16"/><stop offset="100%" stop-color="#3B110B"/></linearGradient><filter id="s_ret"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#1A0500" flood-opacity="0.7"/></filter></defs><g filter="url(#s_ret)"><rect x="6" y="4" width="20" height="24" rx="2" fill="url(#g_ret)" stroke="#D4AF37" stroke-width="1.5"/><rect x="8" y="4" width="4" height="24" fill="#4A150D"/><path d="M14 10h6M14 14h6M14 18h4" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="8" r="1" fill="#D4AF37"/><circle cx="10" cy="24" r="1" fill="#D4AF37"/></g></svg>`,
      itemName: '전설의 고서',
      itemDesc: '다른 앱에서 100권을 가져온 독서 고수에게',
      color: '#8B3A3A', bg: '#fdf5f5', border: '#e8c8c8',
    }
  },

  // ── 2. 활자 중독자
  {
    id: 'bookworm30',
    name: '활자 중독자',
    hint: '그저 꾸준히 읽을 뿐이지요…',
    desc: '30권이나 읽으셨다고요? 이미 활자 중독이군요!',
    condition: (books) => books.filter(b => b.status === '완독' && b.source !== 'import').length >= 30,
    reward: {
      title: '📑 활자 중독자',
      item: '🔖',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_bw30" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#A0522D"/><stop offset="100%" stop-color="#5C4033"/></linearGradient><filter id="s_bw30"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#271300" flood-opacity="0.6"/></filter></defs><g filter="url(#s_bw30)"><path d="M10 2h12v24l-6-4-6 4V2z" fill="url(#g_bw30)" stroke="#3E2723" stroke-width="1"/><path d="M13 6h6M13 10h6M13 14h4" stroke="#DEB887" stroke-width="1.5" stroke-linecap="round"/></g></svg>`,
      itemName: '마호가니 책갈피',
      itemDesc: '북로그에서 30권을 완독한 독서 중독자에게',
      color: '#6B4A20', bg: '#fdf8f0', border: '#e8d4a0',
    }
  },

  // ── 3. 관상용 수집가
  {
    id: 'dusty_reader',
    name: '관상용 수집가',
    hint: '어우, 설마 책 위에 그거 곰팡이에요?',
    desc: '드디어 먼지를 털어내셨군요. 책이 감동해서 울고 있습니다.',
    condition: (books) => {
      return books.some(b => {
        if(b.status !== '읽는중' && b.status !== '완독') return false;
        const added = new Date(b.created_at);
        const started = b.date_start ? new Date(b.date_start) : null;
        if(!started) return false;
        return (started - added) / 86400000 >= 30;
      });
    },
    reward: {
      title: '🧹 관상용 수집가',
      item: '🪣',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_dust" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#DEB887"/><stop offset="100%" stop-color="#8B4513"/></linearGradient><filter id="s_dust"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.5"/></filter></defs><g filter="url(#s_dust)"><path d="M16 28L12 12h8l-4 16z" fill="#5C4033"/><ellipse cx="16" cy="10" rx="8" ry="6" fill="url(#g_dust)"/><path d="M12 8q4-6 8 0" stroke="url(#g_dust)" stroke-width="2" fill="none"/></g></svg>`,
      itemName: '엔틱 먼지떨이',
      itemDesc: '30일 동안 묵혀둔 책을 드디어 펼친 수집가에게',
      color: '#9a7a50', bg: '#fdf8f0', border: '#e8d4b0',
    }
  },

  // ── 4. 활자 좀비 (디자인 재설계)
  {
    id: 'dawn_reader',
    name: '활자 좀비',
    hint: '나의 새벽 친구!',
    desc: '나의 새벽 친구는 충혈된 눈과 책이겠지요.',
    condition: (books, profile, extra) => {
      return parseInt(localStorage.getItem('bl_dawn_sessions') || '0') >= 1;
    },
    reward: {
      title: '🧟 활자 좀비',
      item: '👁️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="potion_liquid" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#6E0B14"/>
            <stop offset="50%" stop-color="#C2182B"/>
            <stop offset="100%" stop-color="#FF4D4D"/>
          </linearGradient>
          <filter id="glass_glow">
            <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#C2182B" flood-opacity="0.5"/>
          </filter>
        </defs>
        <g filter="url(#glass_glow)">
          <path d="M13 8h6v3l5 8v9a3 3 0 01-3 3H11a3 3 0 01-3-3v-9l5-8V8z" fill="rgba(255,255,255,0.15)" stroke="#E8D4A0" stroke-width="1"/>
          <path d="M9.5 18l1-1.6c.5-.8 1-1.4 1.5-1.4h8c.5 0 1 .6 1.5 1.4l1 1.6V28a2 2 0 01-2 2H11a2 2 0 01-2-2V18z" fill="url(#potion_liquid)"/>
          <path d="M11 20a1 1 0 011-1h1a1 1 0 011 1 1 1 0 01-1 1h-1a1 1 0 01-1-1zM20 25a1 1 0 011-1h1a1 1 0 011 1 1 1 0 01-1 1h-1a1 1 0 01-1-1z" fill="#FFF" opacity="0.6"/>
          <path d="M10 22c2 1 4 0 6 0s4 1 6 0" fill="none" stroke="#FFF" stroke-width="0.8" opacity="0.3"/>
          <rect x="14" y="2" width="4" height="6" rx="1" fill="#8B5A2B"/>
          <rect x="13" y="2" width="6" height="2" rx="0.5" fill="#5C3A18"/>
          <path d="M13 10h6" stroke="#4A2F1D" stroke-width="1.5"/>
        </g>
      </svg>`,
      itemName: '새벽의 엘릭서',
      itemDesc: '새벽에도 책을 놓지 않는 활자 좀비에게',
      color: '#C2182B', bg: '#fff5f5', border: '#ffcccc',
    }
  },

  // ── 5. 의지의 독서인
  {
    id: 'streak3',
    name: '의지의 독서인',
    hint: '작심삼일?',
    desc: '고비를 넘겼습니다! 당신의 의지는 3일은 넘기는군요.',
    condition: (books, profile) => {
      const streak = parseInt(localStorage.getItem('bl_login_streak') || '0');
      return streak >= 3;
    },
    reward: {
      title: '💪 의지의 독서인',
      item: '🪢',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_rope" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D2B48C"/><stop offset="100%" stop-color="#8B4513"/></linearGradient><filter id="s_rope"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_rope)"><path d="M8 8c8-8 16 8 16 8s8-16 0-8-16 8-16 8z" fill="none" stroke="url(#g_rope)" stroke-width="4" stroke-linecap="round"/><path d="M12 16c4 8 8 0 8 0" fill="none" stroke="#5C4033" stroke-width="1.5"/></g></svg>`,
      itemName: '질긴 마죽밧줄',
      itemDesc: '북로그를 3일 연속으로 방문한 의지의 독서인에게',
      color: '#8B6B3A', bg: '#fdf8f0', border: '#e8d4a0',
    }
  },

  // ── 6. 독서 기계
  {
    id: 'streak100',
    name: '독서 기계',
    hint: '북로그는 이제 당신의 장기나 다름없습니다.',
    desc: '100일이라니! 당신의 뇌세포들이 기립박수를 칩니다.',
    hasInvite: true,
    condition: (books, profile) => {
      const streak = parseInt(localStorage.getItem('bl_login_streak') || '0');
      return streak >= 100;
    },
    reward: {
      title: '⚙️ 독서 기계',
      item: '🍡',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_gear" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#E8C37B"/><stop offset="100%" stop-color="#B8860B"/></radialGradient><filter id="s_gear"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#222" flood-opacity="0.7"/></filter></defs><g filter="url(#s_gear)"><path d="M16 2l2 4h-4l2-4zm10 4l-2 3-3-3 5-3v3zm4 10l-4 2v-4l4 2zm-4 10l-3-2 3-3 3 5h-3zm-10 4l-2-4h4l-2 4zm-10-4l2-3 3 3-5 3v-3zm-4-10l4-2v4l-4-2zm4-10l3 2-3 3-3-5h3z" fill="url(#g_gear)"/><circle cx="16" cy="16" r="8" fill="url(#g_gear)" stroke="#5C4033" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#3E2723"/></g></svg>`,
      itemName: '태엽 장치',
      itemDesc: '북로그 100일 연속 방문 달성! 뇌세포들이 경례합니다.',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 7. 방구석 현자
  {
    id: 'weekend_sage',
    name: '방구석 현자',
    hint: '주말에 약속 없으시죠? 그냥 책이랑 노는 게 최고입니다.',
    desc: '밖은 위험합니다. 종이 속에서 안전하게 살아남으셨군요.',
    condition: (books, profile) => {
      const weekendCount = parseInt(localStorage.getItem('bl_weekend_timer_weeks') || '0');
      return weekendCount >= 4;
    },
    reward: {
      title: '🛋️ 방구석 현자',
      item: '🛋️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_sofa" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8B4513"/><stop offset="100%" stop-color="#3E2723"/></linearGradient><filter id="s_sofa"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity="0.6"/></filter></defs><g filter="url(#s_sofa)"><rect x="4" y="14" width="24" height="10" rx="3" fill="url(#g_sofa)" stroke="#1A0500" stroke-width="1"/><path d="M4 14C4 8 8 8 8 8h16s4 0 4 6" fill="url(#g_sofa)" stroke="#1A0500" stroke-width="1"/><rect x="8" y="14" width="16" height="6" rx="2" fill="#A0522D"/><line x1="8" y1="24" x2="8" y2="28" stroke="#3E2723" stroke-width="3"/><line x1="24" y1="24" x2="24" y2="28" stroke="#3E2723" stroke-width="3"/></g></svg>`,
      itemName: '고급 가죽 소파',
      itemDesc: '4주 연속 주말을 책과 함께한 방구석 현자에게',
      color: '#7a5a40', bg: '#fdf8f4', border: '#e8d0b8',
    }
  },

  // ── 8. 벽돌 격파왕
  {
    id: 'brick_buster',
    name: '벽돌 격파왕',
    hint: '과연 이 책의 운명은?',
    desc: '라면 받침대는 아니네요! 이 벽돌을 부수다니! 당신의 손목 건강이 걱정될 정도입니다.',
    condition: (books) => books.some(b => b.status === '완독' && (b.pages || 0) >= 500),
    reward: {
      title: '🧱 벽돌 격파왕',
      item: '🧱',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_brick" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#BDB76B"/><stop offset="100%" stop-color="#8B864E"/></linearGradient><filter id="s_brick"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#4A4A4A" flood-opacity="0.8"/></filter></defs><g filter="url(#s_brick)"><rect x="4" y="8" width="24" height="16" rx="1" fill="url(#g_brick)" stroke="#555" stroke-width="1"/><path d="M4 16h24M12 8v8M20 8v8M8 16v8M16 16v8M24 16v8" stroke="#555" stroke-width="1"/></g></svg>`,
      itemName: '고대 석판',
      itemDesc: '500페이지 이상의 두꺼운 책을 완독한 격파왕에게',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 9. 밤샘 독서가
  {
    id: 'allnight',
    name: '밤샘 독서가',
    hint: '잠은 죽어서 자는 거야',
    desc: '해가 뜨는 걸 보며 마지막 장을 덮는 그 짜릿함!',
    hasInvite: true,
    condition: (books, profile) => {
      return parseInt(localStorage.getItem('bl_allnight_reads') || '0') >= 1;
    },
    reward: {
      title: '🌃 밤샘 독서가',
      item: '👁️‍🗨️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_owl" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#696969"/><stop offset="100%" stop-color="#2F4F4F"/></linearGradient><filter id="s_owl"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.8"/></filter></defs><g filter="url(#s_owl)"><path d="M8 24C8 12 12 4 16 4s8 8 8 20z" fill="url(#g_owl)"/><circle cx="12" cy="14" r="3" fill="#FFD700"/><circle cx="20" cy="14" r="3" fill="#FFD700"/><circle cx="12" cy="14" r="1" fill="#000"/><circle cx="20" cy="14" r="1" fill="#000"/><path d="M16 16l-1 3h2z" fill="#D2691E"/></g></svg>`,
      itemName: '올빼미 조각상',
      itemDesc: '밤새 책을 읽고 해를 맞이한 밤샘 독서가에게',
      color: '#7760a0', bg: '#f8f5ff', border: '#d8ccee',
    }
  },

  // ── 10. 활자폭주족
  {
    id: 'speed_reader',
    name: '활자폭주족',
    hint: '칙칙폭폭 폭주 기관차 갑니다!',
    desc: '인정합니다! 당신은 브레이크가 고장난 폭주기관차네요!',
    condition: (books) => {
      const done = books.filter(b => b.status === '완독' && b.date_finish && b.source !== 'import')
        .sort((a,b) => new Date(a.date_finish) - new Date(b.date_finish));
      if(done.length < 10) return false;
      // 연속 완독: 완독일 기준 30일 내에 10권
      for(let i = 0; i <= done.length - 10; i++) {
        const start = new Date(done[i].date_finish);
        const end = new Date(done[i+9].date_finish);
        if((end - start) / 86400000 <= 30) return true;
      }
      return false;
    },
    reward: {
      title: '🚂 활자폭주족',
      item: '🚂',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_train" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#4A4A4A"/><stop offset="100%" stop-color="#1A1A1A"/></linearGradient><filter id="s_train"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.6"/></filter></defs><g filter="url(#s_train)"><rect x="6" y="14" width="16" height="10" fill="url(#g_train)"/><rect x="18" y="8" width="6" height="16" fill="#8B4513"/><rect x="8" y="10" width="4" height="4" fill="#D4AF37"/><circle cx="10" cy="24" r="3" fill="#D4AF37"/><circle cx="18" cy="24" r="3" fill="#D4AF37"/><circle cx="24" cy="24" r="2" fill="#D4AF37"/></g></svg>`,
      itemName: '황동 증기기관차',
      itemDesc: '30일 내 10권을 연달아 완독한 폭주기관차에게',
      color: '#5a5a7a', bg: '#f5f5ff', border: '#c8c8e8',
    }
  },

  // ── 11. 프로 하차러
  {
    id: 'quick_quit',
    name: '프로 하차러',
    hint: '제목만 읽는 것도 독서죠.',
    desc: '칼 같은 포기! 맞지 않는 책에 시간을 낭비하지 않는 결단력!',
    condition: (books, profile) => {
      return parseInt(localStorage.getItem('bl_quick_quits') || '0') >= 1;
    },
    reward: {
      title: '✂️ 프로 하차러',
      item: '🔖',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_quit" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#F5DEB3"/><stop offset="100%" stop-color="#D2B48C"/></linearGradient><filter id="s_quit"><feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#8B4513" flood-opacity="0.5"/></filter></defs><g filter="url(#s_quit)"><path d="M10 4h12v20l-6-4-6 4V4z" fill="url(#g_quit)" stroke="#8B4513" stroke-width="1"/><path d="M8 14l16-4M8 16l16-4" stroke="#8B0000" stroke-width="1.5"/></g></svg>`,
      itemName: '찢어진 양피지',
      itemDesc: '5분 만에 과감하게 하차를 결정한 결단력의 소유자에게',
      color: '#6B4A20', bg: '#fdf8f0', border: '#e8d4a0',
    }
  },

  // ── 12. 활자의 신
  {
    id: 'book_god',
    name: '활자의 신',
    hint: '인간의 뇌 용량을 초과하신 것 같습니다.',
    desc: '당신은 이제 걸어 다니는 도서관입니다. 인류의 보물입니다.',
    hasInvite: true,
    condition: (books) => books.length >= 1000,
    reward: {
      title: '👑 활자의 신',
      item: '👑',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_god" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#DAA520"/></linearGradient><filter id="s_god"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#8B6508" flood-opacity="0.7"/></filter></defs><g filter="url(#s_god)"><path d="M4 24l2-14 6 6 4-10 4 10 6-6 2 14H4z" fill="url(#g_god)" stroke="#8B6508" stroke-width="1"/><circle cx="6" cy="10" r="2" fill="#DC143C"/><circle cx="16" cy="6" r="2" fill="#4169E1"/><circle cx="26" cy="10" r="2" fill="#2E8B57"/><rect x="4" y="25" width="24" height="3" fill="#B8860B"/></g></svg>`,
      itemName: '보석 왕관',
      itemDesc: '총 1,000권을 기록한 걸어다니는 도서관에게',
      color: '#c8a050', bg: '#fdf8e8', border: '#e8d490',
    }
  },

  // ── 13. 욕망의 수집가
  {
    id: 'wish_collector',
    name: '욕망의 수집가',
    hint: '일단 담으세요. 장바구니는 무겁지 않아요.',
    desc: '언젠간 전부 읽으시겠지요?',
    condition: (books) => books.filter(b => b.status === '읽고싶은').length >= 100,
    reward: {
      title: '🛒 욕망의 수집가',
      item: '🛒',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_cart" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8B4513"/><stop offset="100%" stop-color="#5C4033"/></linearGradient><filter id="s_cart"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#222" flood-opacity="0.5"/></filter></defs><g filter="url(#s_cart)"><path d="M4 6h4l4 12h12l4-8H10" fill="none" stroke="url(#g_cart)" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="24" r="2" fill="#D4AF37"/><circle cx="22" cy="24" r="2" fill="#D4AF37"/><rect x="12" y="10" width="12" height="8" fill="#D2B48C" opacity="0.8"/></g></svg>`,
      itemName: '나무 수레',
      itemDesc: '읽고 싶은 책 100권을 담아둔 욕망의 수집가에게',
      color: '#5a8B3a', bg: '#f5faf0', border: '#c0e0b0',
    }
  },

  // ── 14. 초보 산책가
  {
    id: 'walker_novice',
    name: '초보 산책가',
    hint: '공원으로 마실을 나가볼까요?',
    desc: '때때로 산책을 하는 것도 독서에 도움이 되죠!',
    condition: (books, profile, extra) => (extra?.postCount || 0) >= 2,
    reward: {
      title: '🌿 초보 산책가',
      item: '🪧',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_sign" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#DEB887"/><stop offset="100%" stop-color="#A0522D"/></linearGradient><filter id="s_sign"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_sign)"><rect x="14" y="4" width="4" height="24" fill="#8B4513"/><path d="M8 8h16l4 4-4 4H8z" fill="url(#g_sign)" stroke="#5C4033" stroke-width="1"/><circle cx="10" cy="12" r="1" fill="#fff" opacity="0.5"/></g></svg>`,
      itemName: '오크나무 표지판',
      itemDesc: '산책 게시판에 첫 발을 내딛은 초보 산책가에게',
      color: '#8B6B3A', bg: '#fdf8f0', border: '#e8d4a0',
    }
  },

  // ── 15. 고급 산책가
  {
    id: 'walker_expert',
    name: '고급 산책가',
    hint: '마실만 나가실 거예요?',
    desc: '이제는 아는 사람들도 생기셨죠?',
    condition: (books, profile, extra) => (extra?.postCount || 0) >= 5,
    reward: {
      title: '🏅 고급 산책가',
      item: '🪧',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_sign_gold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/></linearGradient><filter id="s_sign_gold"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#8B6508" flood-opacity="0.6"/></filter></defs><g filter="url(#s_sign_gold)"><rect x="14" y="4" width="4" height="24" fill="#5C4033"/><path d="M8 8h16l4 4-4 4H8z" fill="url(#g_sign_gold)" stroke="#8B6508" stroke-width="1"/><circle cx="24" cy="12" r="2" fill="#fff" opacity="0.6"/></g></svg>`,
      itemName: '황금 표지판',
      itemDesc: '산책 게시판에 활발히 참여하는 고급 산책가에게',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 16. 순애보 독자
  {
    id: 'loyal_reader',
    name: '순애보 독자',
    hint: '질리지 않으세요? 이 정도면 책이랑 연애하는 겁니다.',
    desc: '진정한 팬심! 책의 모든 구절이 당신의 피와 살이 되었습니다.',
    condition: (books) => {
      // 같은 제목 책이 5번 이상 완독
      const titleCount = {};
      books.filter(b => b.status === '완독').forEach(b => {
        titleCount[b.title] = (titleCount[b.title] || 0) + 1;
      });
      return Object.values(titleCount).some(c => c >= 5);
    },
    reward: {
      title: '💌 순애보 독자',
      item: '∞',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_wax" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#8B0000"/><stop offset="100%" stop-color="#3E0000"/></radialGradient><filter id="s_wax"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.5"/></filter></defs><g filter="url(#s_wax)"><circle cx="16" cy="16" r="10" fill="url(#g_wax)" stroke="#4A0000" stroke-width="1"/><path d="M12 16a2 2 0 11-4 0 2 2 0 014 0zm12 0a2 2 0 11-4 0 2 2 0 014 0zm-8 0c-2-4-6 0-6 0s4 4 6 0c2 4 6 0 6 0s-4-4-6 0z" fill="#D4AF37"/></g></svg>`,
      itemName: '밀랍 씰인장',
      itemDesc: '같은 책을 5번 이상 읽어낸 진정한 순애보 독자에게',
      color: '#ee5577', bg: '#fff5f8', border: '#ffc8d8',
    }
  },

  // ── 17. 왕눈이
  {
    id: 'big_font',
    name: '왕눈이',
    hint: '시력이 좋지 않으신 모양이네요!',
    desc: '시원시원한 독서! 이렇게 안구에게 평화를 주기도 하는 법이죠.',
    condition: (books, profile) => {
      const fontSize = parseInt(localStorage.getItem('bl_font_size') || '100');
      return fontSize >= 150;
    },
    reward: {
      title: '🔍 왕눈이',
      item: '🔍',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_mag" cx="30%" cy="30%" r="70%"><stop offset="0%" stop-color="#E0FFFF"/><stop offset="100%" stop-color="#87CEEB"/></radialGradient><filter id="s_mag"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_mag)"><circle cx="14" cy="14" r="10" fill="url(#g_mag)" stroke="#D4AF37" stroke-width="2"/><line x1="21" y1="21" x2="28" y2="28" stroke="#8B4513" stroke-width="4" stroke-linecap="round"/><text x="14" y="19" text-anchor="middle" font-size="14" fill="#333" font-family="serif">A</text></g></svg>`,
      itemName: '황동 돋보기',
      itemDesc: '폰트 크기를 최대로 설정한 왕눈이에게',
      color: '#5a5a8a', bg: '#f5f5ff', border: '#c8c8e8',
    }
  },

  // ── 18. 프로 참견러
  {
    id: 'commenter',
    name: '프로 참견러',
    hint: '남의 이야기에 훈수 좀 두시겠습니까? 친절하게요!',
    desc: '독서계의 오지랖 대장! 당신 덕분에 북로그가 시끌벅적합니다.',
    hasInvite: true,
    condition: (books, profile, extra) => (extra?.commentCount || 0) >= 30,
    reward: {
      title: '📢 프로 참견러',
      item: '📣',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_mega" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D4AF37"/><stop offset="100%" stop-color="#8B6508"/></linearGradient><filter id="s_mega"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#4A3B14" flood-opacity="0.6"/></filter></defs><g filter="url(#s_mega)"><path d="M4 12v8h6l10 8V4L10 12H4z" fill="url(#g_mega)" stroke="#5C4033" stroke-width="1"/><path d="M22 8a8 8 0 010 16M26 4a12 12 0 010 24" fill="none" stroke="#D4AF37" stroke-width="1.5"/></g></svg>`,
      itemName: '황동 축음기 나팔',
      itemDesc: '산책 게시판에 댓글 30개를 달아준 오지랖 대장에게',
      color: '#e87030', bg: '#fff8f0', border: '#f8d4b0',
    }
  },

  // ── 19. 독서인러버
  {
    id: 'social_reader',
    name: '독서인러버',
    hint: '친구 만나러 오셨어요?',
    desc: '독서하는 사람 치곤 친구가 많은데요?',
    condition: (books, profile, extra) => (extra?.friendCount || 0) >= 10,
    reward: {
      title: '💌 독서인러버',
      item: '💌',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_env" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#F5DEB3"/><stop offset="100%" stop-color="#DEB887"/></linearGradient><filter id="s_env"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#5C4033" flood-opacity="0.6"/></filter></defs><g filter="url(#s_env)"><rect x="4" y="8" width="24" height="16" fill="url(#g_env)" stroke="#8B4513" stroke-width="1"/><path d="M4 8l12 8 12-8" fill="none" stroke="#8B4513" stroke-width="1.5"/><circle cx="16" cy="16" r="4" fill="#8B0000"/><path d="M16 18l-2-2a2 2 0 012-3 2 2 0 012 3z" fill="#FFD700"/></g></svg>`,
      itemName: '밀봉된 편지',
      itemDesc: '북로그에서 친구 10명을 만든 독서인러버에게',
      color: '#d06080', bg: '#fff5f8', border: '#f8c8d8',
    }
  },

  // ── 20. 서재 탐정
  {
    id: 'surf100',
    name: '서재 탐정',
    hint: '북서퍼라기보다는 좀…',
    desc: '남의 서재 구경하기, 참 좋아하시네요!',
    condition: (books, profile) => {
      return parseInt(localStorage.getItem('bl_surf_count') || '0') >= 100;
    },
    reward: {
      title: '🕵️ 서재 탐정',
      item: '🎩',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_hat" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#696969"/><stop offset="100%" stop-color="#2F4F4F"/></linearGradient><filter id="s_hat"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.7"/></filter></defs><g filter="url(#s_hat)"><ellipse cx="16" cy="24" rx="14" ry="4" fill="#2F4F4F"/><path d="M8 24V10c0-4 3-6 8-6s8 2 8 6v14H8z" fill="url(#g_hat)"/><path d="M8 20h16v4H8z" fill="#8B0000"/></g></svg>`,
      itemName: '탐정의 모자',
      itemDesc: '서재 파도타기를 100번 이용한 서재 탐정에게',
      color: '#5a5a8a', bg: '#f5f5ff', border: '#c8c8e8',
    }
  },

  // ── 21. 책발효 장인
  {
    id: 'vintage_reader',
    name: '책발효 장인',
    hint: '숙성된 지식입니다. 이제 썩기 전에 읽어보시죠.',
    desc: '빈티지 도서 획득! 100일간의 고민 끝에 지갑이 열렸습니다.',
    hasInvite: true,
    condition: (books) => {
      return books.some(b => {
        if(b.status !== '완독' && b.status !== '읽는중') return false;
        const added = new Date(b.created_at);
        const started = b.date_start ? new Date(b.date_start) : (b.date_finish ? new Date(b.date_finish) : null);
        if(!started) return false;
        return (started - added) / 86400000 >= 100;
      });
    },
    reward: {
      title: '🍷 책발효 장인',
      item: '🍷',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_wine" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4A0000"/><stop offset="100%" stop-color="#8B0000"/></linearGradient><filter id="s_wine"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_wine)"><path d="M12 4h8v6l4 8v10H8V18l4-8V4z" fill="url(#g_wine)" stroke="#D4AF37" stroke-width="1"/><rect x="11" y="4" width="10" height="4" fill="#D4AF37"/><rect x="14" y="16" width="4" height="6" fill="#F5DEB3"/></g></svg>`,
      itemName: '숙성된 빈티지 와인',
      itemDesc: '100일 동안 묵혀뒀다 읽기 시작한 책발효 장인에게',
      color: '#9a2060', bg: '#fff5f8', border: '#e8b0c8',
    }
  },

  // ── 22. 책귀신과의 친구
  {
    id: 'ghost_reader',
    name: '책귀신과의 친구',
    hint: '이 시간에 책을 보면 귀신이 옆에서 같이 읽어줄지도?',
    desc: '오싹한 지적 탐구! 귀신도 감동해서 도망갈 열정입니다.',
    condition: (books, profile) => {
      return parseInt(localStorage.getItem('bl_ghost_hour') || '0') >= 1;
    },
    reward: {
      title: '👻 책귀신과의 친구',
      item: '🧻',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_scroll" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8B0000"/><stop offset="100%" stop-color="#3E0000"/></linearGradient><filter id="s_scroll"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.8"/></filter></defs><g filter="url(#s_scroll)"><rect x="6" y="8" width="20" height="16" fill="#F5DEB3" stroke="#8B4513" stroke-width="1"/><rect x="4" y="6" width="24" height="4" rx="2" fill="url(#g_scroll)"/><rect x="4" y="22" width="24" height="4" rx="2" fill="url(#g_scroll)"/><path d="M10 12h12M10 16h12M10 20h6" stroke="#8B0000" stroke-width="1"/></g></svg>`,
      itemName: '붉은 고대 스크롤',
      itemDesc: '새벽 4시 44분에 독서를 기록한 오싹한 독서가에게',
      color: '#8a2a8a', bg: '#faf5ff', border: '#d8c0e8',
    }
  },

  // ── 23. 북로그 인테리어 업자
  {
    id: 'design_lover',
    name: '북로그 인테리어 업자',
    hint: '개발자와 디자이너가 당신의 눈길에 감동해 눈물을 흘립니다.',
    desc: '책은 안 읽고 북로그 디자인만 보셨네요. 저희 예쁘죠?',
    condition: (books, profile) => {
      return parseInt(localStorage.getItem('bl_main_stare') || '0') >= 1;
    },
    reward: {
      title: '🎨 북로그 인테리어 업자',
      item: '🖱️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_frame" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D4AF37"/><stop offset="100%" stop-color="#8B6508"/></linearGradient><filter id="s_frame"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_frame)"><rect x="4" y="4" width="24" height="24" rx="2" fill="url(#g_frame)" stroke="#5C4033" stroke-width="1"/><rect x="8" y="8" width="16" height="16" fill="#F5DEB3"/><path d="M10 10l12 12M22 10L10 22" stroke="url(#g_frame)" stroke-width="1"/></g></svg>`,
      itemName: '황금 액자 프레임',
      itemDesc: '북로그 메인을 5분간 감상한 인테리어 업자에게',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 24. 독서 중독가 (30권 완독 -> 50권 완독) + 초대권
  {
    id: 'bookworm50',
    name: '독서 중독가',
    hint: '우와, 벌써 북로그에서 이만큼?',
    desc: '50권이나 읽으셨다고요? 이미 완벽한 독서가군요!',
    hasInvite: true,
    condition: (books) => books.filter(b => b.status === '완독' && b.source !== 'import').length >= 50,
    reward: {
      title: '🥇 독서 중독가',
      item: '🔖',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_goldbm" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/></linearGradient><filter id="s_goldbm"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#8B6508" flood-opacity="0.7"/></filter></defs><g filter="url(#s_goldbm)"><path d="M10 2h12v26l-6-5-6 5V2z" fill="url(#g_goldbm)" stroke="#8B6508" stroke-width="1"/><circle cx="16" cy="8" r="3" fill="#FFF"/><text x="16" y="10" text-anchor="middle" font-size="6" fill="#B8860B" font-family="serif">50</text></g></svg>`,
      itemName: '금색 책갈피',
      itemDesc: '북로그에서 50권을 완독한 독서 중독가에게',
      color: '#c8a050', bg: '#fdf8ee', border: '#e8d4a0',
    }
  },

  // ── 25. 평점 테러리스트
  {
    id: 'harsh_critic',
    name: '평점 테러리스트',
    hint: '세상 모든 작가들이 당신의 눈치를 보게 만드세요.',
    desc: '독설의 연금술사! 당신의 평점 테러에 서재가 벌벌 떱니다.',
    condition: (books) => books.filter(b => b.rating === 1).length >= 10,
    reward: {
      title: '💢 평점 테러리스트',
      item: '🪑',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_throne" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#696969"/><stop offset="100%" stop-color="#2F4F4F"/></linearGradient><filter id="s_throne"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.8"/></filter></defs><g filter="url(#s_throne)"><path d="M8 2l2 12H6zM16 2l2 12h-4zM24 2l2 12h-4z" fill="url(#g_throne)"/><rect x="6" y="14" width="20" height="4" fill="#8B4513"/><rect x="8" y="18" width="4" height="12" fill="url(#g_throne)"/><rect x="20" y="18" width="4" height="12" fill="url(#g_throne)"/></g></svg>`,
      itemName: '가시 돋친 철왕좌',
      itemDesc: '별점 1점을 10번 이상 준 독설의 연금술사에게',
      color: '#8a5a5a', bg: '#fff5f5', border: '#e8c8c8',
    }
  },

  // ── 26. 병렬 독서가
  {
    id: 'parallel_reader',
    name: '병렬 독서가',
    hint: '찍먹 찍먹 찍먹 24시간이 모자라',
    desc: '24시간이 모자란 우리가 쓸 수 있는 방법은 이것 뿐이죠.',
    hasInvite: true,
    condition: (books) => books.filter(b => b.status === '읽는중').length >= 10,
    reward: {
      title: '🔋 병렬 독서가', item: '🔋',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_vial" x1="0%" y1="100%" x2="0%" y2="0%"><stop offset="0%" stop-color="#2E8B57"/><stop offset="50%" stop-color="#3CB371"/><stop offset="100%" stop-color="#fff"/></linearGradient><filter id="s_vial"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.5"/></filter></defs><g filter="url(#s_vial)"><path d="M8 10h16v18a2 2 0 01-2 2H10a2 2 0 01-2-2V10z" fill="url(#g_vial)" stroke="#D4AF37" stroke-width="1.5"/><rect x="12" y="4" width="8" height="6" fill="#8B4513" stroke="#5C4033" stroke-width="1"/><rect x="14" y="2" width="4" height="2" fill="#D4AF37"/></g></svg>`,
      itemName: '연금술사의 물약', itemDesc: '동시에 10권을 읽는 멀티태스킹 독서가에게',
      color: '#44aa44', bg: '#f0fff0', border: '#b0e8b0',
    }
  },

  // ── 27. 성실 리뷰어
  {
    id: 'daily_reviewer',
    name: '성실 리뷰어',
    hint: '감상이 밀리지 않는 타입이신가요?',
    desc: '기억이 휘발되기 전에 다 붙잡으셨습니다.',
    hasInvite: true,
    condition: (books, profile) => parseInt(localStorage.getItem('bl_review_streak')||'0') >= 7,
    reward: {
      title: '📝 성실 리뷰어', item: '📓',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_journal" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#5C4033"/><stop offset="100%" stop-color="#3E2723"/></linearGradient><filter id="s_journal"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity="0.6"/></filter></defs><g filter="url(#s_journal)"><rect x="8" y="4" width="16" height="24" rx="2" fill="url(#g_journal)" stroke="#8B4513" stroke-width="1"/><rect x="8" y="4" width="4" height="24" fill="#8B4513"/><path d="M16 10h4M16 14h4M16 18h2" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="16" r="1.5" fill="#D4AF37"/></g></svg>`,
      itemName: '가죽 양장 일기장', itemDesc: '한 주 동안 매일 독서 감상을 기록한 성실한 리뷰어에게',
      color: '#a09030', bg: '#fffcee', border: '#e8d890',
    }
  },

  // ── 28. 집중 회로 사용자
  {
    id: 'focus_user',
    name: '집중 회로 사용자',
    hint: '집중 ON/OFF가 확실하시군요.',
    desc: '이제 당신의 뇌는 타이머 소리에도 반응합니다.',
    condition: (books, profile) => parseInt(localStorage.getItem('bl_daily_timer_max')||'0') >= 5,
    reward: {
      title: '⏱️ 집중 회로 사용자', item: '⏱️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_timer" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#C0C0C0"/><stop offset="100%" stop-color="#696969"/></radialGradient><filter id="s_timer"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#333" flood-opacity="0.6"/></filter></defs><g filter="url(#s_timer)"><circle cx="16" cy="18" r="10" fill="url(#g_timer)" stroke="#8B4513" stroke-width="2"/><circle cx="16" cy="18" r="8" fill="#F5F5DC"/><path d="M16 10v8l4 4" fill="none" stroke="#333" stroke-width="1.5"/><rect x="14" y="4" width="4" height="4" fill="#D4AF37"/><line x1="16" y1="2" x2="16" y2="4" stroke="#D4AF37" stroke-width="2"/></g></svg>`,
      itemName: '태엽식 스톱워치', itemDesc: '하루에 독서 타이머를 5번 이상 실행한 집중력의 소유자에게',
      color: '#5050a0', bg: '#f5f5ff', border: '#c0c0e8',
    }
  },

  // ── 29. 시간 투자자 (연 100시간)
  {
    id: 'time_investor',
    name: '시간 투자자',
    hint: '시계는 영원한 친구!',
    desc: '활자와 함께한 시간이 세 자릿수에 도달했습니다.',
    condition: (books) => {
      const cy = String(new Date().getFullYear());
      const total = books.reduce((sum, b) => {
        if(b.reading_time_log && typeof b.reading_time_log === 'object') {
          const ls = Object.entries(b.reading_time_log).filter(([d])=>d.startsWith(cy)).reduce((s,[,m])=>s+(m||0),0);
          if(ls>0) return sum+ls;
        }
        const yrV = b.reading_time_year?.[cy]??b.reading_time_year?.[parseInt(cy)];
        return sum+(yrV||0);
      }, 0);
      return total >= 6000;
    },
    reward: {
      title: '⌚ 시간 투자자', item: '⏱',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_clock" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D4AF37"/><stop offset="100%" stop-color="#8B6508"/></linearGradient><filter id="s_clock"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#4A3B14" flood-opacity="0.6"/></filter></defs><g filter="url(#s_clock)"><circle cx="16" cy="16" r="12" fill="#F5DEB3" stroke="url(#g_clock)" stroke-width="3"/><path d="M16 6v10l6 2" fill="none" stroke="#5C4033" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="2" fill="url(#g_clock)"/><text x="16" y="24" text-anchor="middle" font-size="5" fill="#8B4513" font-family="serif">100H</text></g></svg>`,
      itemName: '황금 회중시계', itemDesc: '한 해에 100시간 독서를 달성한 시간 투자자에게',
      color: '#907040', bg: '#fdf8f0', border: '#e0c890',
    }
  },

  // ── 30. 야간 개장 독서가 (새벽 10회)
  {
    id: 'night_reader',
    name: '야간 개장 독서가',
    hint: '수면과 협상은 되셨나요?',
    desc: '밤과 책의 계약이 성립되었습니다.',
    condition: (books, profile) => parseInt(localStorage.getItem('bl_dawn_sessions')||'0') >= 10,
    reward: {
      title: '🌙 야간 개장 독서가', item: '😴',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_mask" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4B0082"/><stop offset="100%" stop-color="#191970"/></linearGradient><filter id="s_mask"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.6"/></filter></defs><g filter="url(#s_mask)"><path d="M6 14c0-4 4-6 10-6s10 2 10 6c0 6-4 8-10 8s-10-2-10-8z" fill="url(#g_mask)" stroke="#D4AF37" stroke-width="1"/><path d="M12 12c-1 1-3 1-4 0M24 12c-1 1-3 1-4 0" fill="none" stroke="#D4AF37" stroke-width="1.5" stroke-linecap="round"/></g></svg>`,
      itemName: '비단 수면 안대', itemDesc: '새벽 시간 독서를 10번 기록한 야간 개장 독서가에게',
      color: '#6858b0', bg: '#f8f5ff', border: '#c8c0e8',
    }
  },

  // ── 31. 공감 수집가 (게시글 좋아요 20개) + 초대권
  {
    id: 'like_collector',
    name: '공감 수집가',
    hint: '누가 그렇게 공감한 거죠?',
    desc: '오늘 당신의 글이 제대로 터졌군요!',
    hasInvite: true,
    condition: (books, profile, extra) => (extra?.maxPostLikes||0) >= 20,
    reward: {
      title: '💖 공감 수집가', item: '❤️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_heart" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#DC143C"/><stop offset="100%" stop-color="#8B0000"/></radialGradient><filter id="s_heart"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#4A0000" flood-opacity="0.6"/></filter></defs><g filter="url(#s_heart)"><path d="M16 26l-10-10a6 6 0 018-8l2 2 2-2a6 6 0 018 8z" fill="url(#g_heart)" stroke="#D4AF37" stroke-width="1"/><circle cx="12" cy="12" r="1.5" fill="#FFF" opacity="0.5"/></g></svg>`,
      itemName: '루비 하트 브로치', itemDesc: '하루 게시글로 좋아요 20개를 받은 인기 독서가에게',
      color: '#dd1155', bg: '#fff5f8', border: '#ffb0cc',
    }
  },

  // ── 32. 장르 연구가 (같은 장르 20권)
  {
    id: 'genre_expert',
    name: '장르 연구가',
    hint: '취향이 확고하시군요.',
    desc: '특정 장르 전문가로 진화했습니다.',
    condition: (books) => {
      const gc={};
      books.filter(b=>b.status==='완독'&&b.genre).forEach(b=>{gc[b.genre]=(gc[b.genre]||0)+1;});
      return Object.values(gc).some(c=>c>=20);
    },
    reward: {
      title: '📖 장르 연구가', item: '📚',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_grim" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4A235A"/><stop offset="100%" stop-color="#154360"/></linearGradient><filter id="s_grim"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#000" flood-opacity="0.6"/></filter></defs><g filter="url(#s_grim)"><rect x="6" y="4" width="20" height="24" rx="2" fill="url(#g_grim)" stroke="#D4AF37" stroke-width="1.5"/><circle cx="16" cy="16" r="4" fill="none" stroke="#D4AF37" stroke-width="1"/><path d="M16 12v8M12 16h8" stroke="#D4AF37" stroke-width="1"/></g></svg>`,
      itemName: '마법의 장르 도감', itemDesc: '같은 장르 책을 20권 이상 완독한 장르 전문가에게',
      color: '#3060a0', bg: '#f0f5ff', border: '#b0c8e8',
    }
  },

  // ── 33. 잡식성 독자 (다른 장르 10개)
  {
    id: 'omnivore_reader',
    name: '잡식성 독자',
    hint: '편식은 나쁜 거죠.',
    desc: '골고루 독서하는 당신의 독서 스펙트럼을 보세요!',
    condition: (books) => {
      const genres = new Set(books.filter(b=>b.status==='완독'&&b.genre).map(b=>b.genre));
      return genres.size >= 10;
    },
    reward: {
      title: '🌈 잡식성 독자', item: '🌈',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_prism" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#E6E6FA"/><stop offset="100%" stop-color="#B0E0E6"/></linearGradient><filter id="s_prism"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.4"/></filter></defs><g filter="url(#s_prism)"><polygon points="16,4 4,26 28,26" fill="url(#g_prism)" stroke="#D4AF37" stroke-width="1"/><path d="M10 26l8-14l6 14" fill="none" stroke="#FF6347" stroke-width="1"/><path d="M12 26l4-7l4 7" fill="none" stroke="#32CD32" stroke-width="1"/></g></svg>`,
      itemName: '수정 프리즘', itemDesc: '10가지 이상 다양한 장르를 완독한 잡식성 독자에게',
      color: '#8844ee', bg: '#f8f5ff', border: '#d0b8f0',
    }
  },

  // ── 34. 따뜻한 평론가 (연 평점 평균 4점+)
  {
    id: 'warm_critic',
    name: '따뜻한 평론가',
    hint: '꽤 관대한 독서가시네요.',
    desc: '세상에 대한 애정이 느껴집니다.',
    condition: (books) => {
      const cy = String(new Date().getFullYear());
      const rated = books.filter(b=>b.rating>0&&b.date_finish?.startsWith(cy));
      if(rated.length < 5) return false;
      return rated.reduce((s,b)=>s+b.rating,0)/rated.length >= 4.0;
    },
    reward: {
      title: '⭐ 따뜻한 평론가', item: '⭐',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_star" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFF8DC"/><stop offset="100%" stop-color="#DAA520"/></linearGradient><filter id="s_star"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#8B6508" flood-opacity="0.6"/></filter></defs><g filter="url(#s_star)"><path d="M16 4l3.5 10H30l-8.5 6.5L24 30l-8-6-8 6 2.5-9.5L2 14h10.5z" fill="url(#g_star)" stroke="#B8860B" stroke-width="1"/></g></svg>`,
      itemName: '황금 별 훈장', itemDesc: '한 해 평균 평점 4점 이상을 유지한 따뜻한 평론가에게',
      color: '#c09010', bg: '#fdf8e8', border: '#e8d490',
    }
  },

  // ── 35. 기록 세공사 (수정 30회)
  {
    id: 'record_editor',
    name: '기록 세공사',
    hint: '신중한 타입이군요.',
    desc: '독후감도 퇴고의 시대입니다.',
    condition: (books, profile) => parseInt(localStorage.getItem('bl_edit_count')||'0') >= 30,
    reward: {
      title: '✏️ 기록 세공사', item: '🖊️',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_quill" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#F5F5F5"/><stop offset="100%" stop-color="#A9A9A9"/></linearGradient><filter id="s_quill"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.5"/></filter></defs><g filter="url(#s_quill)"><path d="M24 4C14 10 10 20 6 28c4-4 12-4 20-14 2-2 0-8-2-10z" fill="url(#g_quill)" stroke="#8B4513" stroke-width="1"/><path d="M6 28l4-2-2-2z" fill="#D4AF37"/></g></svg>`,
      itemName: '엔틱 깃펜', itemDesc: '독서 기록을 30번 이상 다듬은 세심한 기록 세공사에게',
      color: '#808080', bg: '#f8f8f8', border: '#d8d8d8',
    }
  },

  // ── 36. 상시 접속자 (알림 100회) + 초대권
  {
    id: 'always_on',
    name: '상시 접속자',
    hint: '관심이 고프신가요?',
    desc: '북로그가 생활 루틴이 되어 기뻐요.',
    hasInvite: true,
    condition: (books, profile) => parseInt(localStorage.getItem('bl_notif_click')||'0') >= 100,
    reward: {
      title: '🔔 상시 접속자', item: '🔔',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_bell" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/></linearGradient><filter id="s_bell"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#8B6508" flood-opacity="0.6"/></filter></defs><g filter="url(#s_bell)"><path d="M16 4C10 4 8 12 6 20h20c-2-8-4-16-10-16z" fill="url(#g_bell)" stroke="#8B6508" stroke-width="1"/><rect x="4" y="20" width="24" height="3" fill="#DAA520"/><circle cx="16" cy="26" r="2" fill="#8B6508"/></g></svg>`,
      itemName: '황금 종', itemDesc: '알림 확인을 100번 클릭한 북로그의 열성 팬에게',
      color: '#d4a020', bg: '#fdf8e8', border: '#e8d490',
    }
  },

  // ── 37. 상주 독서인 (하루 10회) + 초대권
  {
    id: 'resident_reader',
    name: '상주 독서인',
    hint: '자주 들어오시네요!',
    desc: '북로그도 당신을 자주 보게 되어 기쁩니다.',
    hasInvite: true,
    condition: (books, profile) => parseInt(localStorage.getItem('bl_daily_visit_max')||'0') >= 10,
    reward: {
      title: '🏠 상주 독서인', item: '🔑',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_door" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8B4513"/><stop offset="100%" stop-color="#3E2723"/></linearGradient><filter id="s_door"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_door)"><path d="M8 4h16v24H8z" fill="url(#g_door)" stroke="#1A0500" stroke-width="1"/><rect x="10" y="6" width="12" height="8" fill="#5C4033"/><rect x="10" y="16" width="12" height="10" fill="#5C4033"/><circle cx="22" cy="16" r="1.5" fill="#D4AF37"/></g></svg>`,
      itemName: '목재 서재문', itemDesc: '하루에 10번 이상 접속한 북로그 상주 독서인에게',
      color: '#907040', bg: '#fdf8f0', border: '#e0c890',
    }
  },

  // ── 38. 마지막 장의 수호자 (디자인 재설계)
{
    id: 'finisher',
    name: '마지막 장의 수호자',
    hint: '끝날 때까지 끝난 게 아니다.',
    desc: '끝까지 가는 힘이 중요하죠.',
    condition: (books) => books.filter(b => b.status === '완독' && b.source !== 'import').length >= 50 || parseInt(localStorage.getItem('bl_finish_count')||'0') >= 50,
    reward: {
      title: '🏁 마지막 장의 수호자', item: '✅',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="emerald_wax" cx="40%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#288F5A"/>
            <stop offset="70%" stop-color="#0E4D2C"/>
            <stop offset="100%" stop-color="#062615"/>
          </radialGradient>
          <filter id="wax_shadow">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.5"/>
          </filter>
        </defs>
        <g filter="url(#wax_shadow)">
          <path d="M16 2c3.5 0 6.5 1.2 9.2 3.8 2.5 2.5 4.8 5.5 4.8 10.2 0 4.5-2.2 8-4.5 10.5-2.8 3-6.5 4.5-9.5 4.5-4 0-7.5-1.5-10.2-4.2C3.2 24 1 20.5 1 16 1 11.5 2.5 8 5.5 5.5 8.2 3.2 12 2 16 2z" fill="url(#emerald_wax)"/>
          <circle cx="16" cy="16" r="10" fill="#0E4D2C" stroke="#288F5A" stroke-width="0.8"/>
          <path d="M10 16l4 4 8-9" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 16l4 4 8-9" fill="none" stroke="#FFF7C2" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </svg>`,
      itemName: '에메랄드 왁스 씰', itemDesc: '읽는 중에서 완독으로 전환을 50번 달성한 독자에게',
      color: '#166339', bg: '#f0fff5', border: '#a3d9b8',
    }
  },
  // ── 39. 상시 독서가 (읽는 중 5권 유지)
  {
    id: 'constant_reader',
    name: '상시 독서가',
    hint: '늘 읽는 책이 존재하는 삶, 멋지잖아요.',
    desc: '책도 인생의 반려자가 되니까요.',
    condition: (books) => books.filter(b=>b.status==='읽는중'&&b.source!=='import').length >= 5,
    reward: {
      title: '📚 상시 독서가', item: '📖',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_stand" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#DEB887"/><stop offset="100%" stop-color="#8B4513"/></linearGradient><filter id="s_stand"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.6"/></filter></defs><g filter="url(#s_stand)"><path d="M4 12l12-4 12 4v12l-12-4-12 4z" fill="#F5DEB3" stroke="#8B4513" stroke-width="1"/><path d="M16 8v12" stroke="#8B4513" stroke-width="1.5"/><rect x="12" y="24" width="8" height="4" fill="url(#g_stand)"/></g></svg>`,
      itemName: '오래된 독서대', itemDesc: '늘 5권 이상의 책을 동시에 읽고 있는 상시 독서가에게',
      color: '#9a7030', bg: '#fdf8f0', border: '#e0c890',
    }
  },

  // ── 40. 시간 관리자 (타이머 1000회)
  {
    id: 'timer_master',
    name: '시간 관리자',
    hint: '째깍째깍째깍!',
    desc: '째깍째깍째깍! 버튼 누르기의 신이군요.',
    condition: (books, profile) => parseInt(localStorage.getItem('bl_timer_total')||'0') >= 1000,
    reward: {
      title: '⌛ 시간 관리자', item: '⏰',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g_stop" cx="35%" cy="25%"><stop offset="0%" stop-color="#fff8dc"/><stop offset="100%" stop-color="#daa520"/></radialGradient><filter id="s_stop"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#8b6508" flood-opacity="0.6"/></filter></defs><g filter="url(#s_stop)"><circle cx="16" cy="16" r="10" fill="url(#g_stop)" stroke="#8b6508" stroke-width="2"/><path d="M16 6v10l6 2" fill="none" stroke="#5c4033" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="16" r="2" fill="#daa520"/></g></svg>`,
      itemName: '낡은 스톱워치', itemDesc: '독서 타이머를 총 1000번 실행한 시간 관리의 달인에게',
      color: '#706050', bg: '#f8f6f0', border: '#d8d0c0',
    }
  },

  // ── 41. 전작주의자 (같은 작가 10권)
  {
    id: 'author_fan',
    name: '전작주의자',
    hint: '자네, 대학원으로 따라오게.',
    desc: '거의 전공 수준인데요?',
    condition: (books) => {
      const ac={};
      books.filter(b=>b.status==='완독'&&b.author&&b.source!=='import').forEach(b=>{ac[b.author]=(ac[b.author]||0)+1;});
      return Object.values(ac).some(c=>c>=10);
    },
    reward: {
      title: '✍️ 전작주의자', item: '📖',
      dotArt: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g_pen" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#2F4F4F"/><stop offset="100%" stop-color="#000"/></linearGradient><filter id="s_pen"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity="0.5"/></filter></defs><g filter="url(#s_pen)"><rect x="6" y="6" width="20" height="20" fill="#F5DEB3" stroke="#8B4513" stroke-width="1"/><path d="M22 10L14 22l-4-2 2-8z" fill="url(#g_pen)"/><circle cx="10" cy="20" r="1" fill="#D4AF37"/></g></svg>`,
      itemName: '서명 없는 만년필', itemDesc: '한 작가의 책을 10권 이상 읽은 열정적인 팬에게',
      color: '#5050a0', bg: '#f5f5ff', border: '#c0c0e8',
    }
  },

  // ── 42. 얼굴 있는 독서가 (프로필 이미지 등록)
  {
    id: 'profile_face',
    name: '얼굴 있는 독서가',
    hint: '얼굴 없이 가능할까요',
    desc: '드디어 독서가다운 정체성이 생겼네요. 책 표지가 영원히 내 얼굴일 순 없죠.',
    condition: (books, profile) => !!(profile?.avatar_url),
    reward: {
      title: '📸 얼굴 있는 독서가', item: '🖼️',
      itemName: '프로필 액자', itemDesc: '프로필 사진을 등록한 독서가에게',
      color: '#c4714a', bg: '#fff5ee', border: '#f0c8a0',
    }
  },

  // ── 43. 과속 독서가 (하루 3권 이상 완독)
  {
    id: 'speed_reader3',
    name: '과속 독서가',
    hint: '오늘 독서량 꽤 공격적인데요?',
    desc: '눈, 손목, 다 괜찮은 거죠?',
    condition: (books) => {
      const dc={};
      books.filter(b=>b.status==='완독'&&b.date_finish&&b.source!=='import').forEach(b=>{dc[b.date_finish]=(dc[b.date_finish]||0)+1;});
      return Object.values(dc).some(c=>c>=3);
    },
    reward: {
      title: '🏎️ 과속 독서가', item: '🏁',
      itemName: '닳은 손목 보호대', itemDesc: '하루에 3권을 완독한 속독의 달인에게',
      color: '#e05020', bg: '#fff5f0', border: '#f8c0a0',
    }
  },

  // ── 44. 시간 여행자 (타이머 총 100시간)
  {
    id: 'timer_100h',
    name: '시간 여행자',
    hint: '슬슬 전문가 영역인데요?',
    desc: '활자와 함께한 시간이 세 자릿수에 도달했습니다.',
    condition: (books) => books.reduce((a,b)=>a+(b.reading_time||0),0) >= 6000,
    reward: {
      title: '⌛ 시간 여행자', item: '⏱️',
      itemName: '오래된 스톱워치', itemDesc: '타이머로 100시간을 채운 시간 여행자에게',
      color: '#5050a0', bg: '#f5f5ff', border: '#c0c0e8',
      hasInvite: true,
    }
  },

  // ── 45. 월간 정복자 (한 달에 15권 이상)
  {
    id: 'monthly_15',
    name: '월간 정복자',
    hint: '이번 달 삶이 책 중심이었군요.',
    desc: '현실보다 활자 세계에 오래 머무르셨습니다.',
    condition: (books) => {
      const mc={};
      books.filter(b=>b.status==='완독'&&b.date_finish&&b.source!=='import').forEach(b=>{const m=b.date_finish.slice(0,7);mc[m]=(mc[m]||0)+1;});
      return Object.values(mc).some(c=>c>=15);
    },
    reward: {
      title: '📅 월간 정복자', item: '📆',
      itemName: '찢어진 달력', itemDesc: '한 달에 15권을 완독한 정복자에게',
      color: '#207050', bg: '#f0fff8', border: '#a0e0c0',
    }
  },

  // ── 46. 읽지 않는 자 (타이머 0분인 채로 30일 이상 방치된 읽는중 책 3권+)
  {
    id: 'never_reader',
    name: '읽지 않는 자',
    hint: '읽을 거죠...?',
    desc: '읽지 않는 것도 재능인 법',
    condition: (books) => {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
      const cutoffStr = toKSTDate(cutoff.toISOString());
      return books.filter(b => b.status==='읽는중' && !b.reading_time && b.date_start && b.date_start <= cutoffStr).length >= 3;
    },
    reward: {
      title: '🌫️ 읽지 않는 자', item: '🌫️',
      itemName: '먼지', itemDesc: '책을 3일 동안 방치한 독서가에게',
      color: '#808090', bg: '#f5f5f8', border: '#d0d0e0',
    }
  },

  // ── 47. 13일의 금요일 독서가 (13일 금요일 완독)
  {
    id: 'friday13',
    name: '13일의 금요일 독서가',
    hint: '우연치곤 기분이 묘하네요.',
    desc: '책도 무사히 끝났고 당신도 무사합니다.',
    condition: (books) => books.some(b => {
      if(b.status!=='완독'||!b.date_finish) return false;
      const d=new Date(b.date_finish+'T12:00:00');
      return d.getDate()===13 && d.getDay()===5;
    }),
    reward: {
      title: '🖤 13일의 금요일 독서가', item: '🪶',
      itemName: '검은 깃털', itemDesc: '13일 금요일에 책을 완독한 독서가에게',
      color: '#202028', bg: '#f0f0f5', border: '#a0a0b8',
    }
  },

  // ── 48. 계획형 독자 (읽는중 0 + 비완독 100권 이상)
  {
    id: 'plan_reader',
    name: '계획형 독자',
    hint: '계획은 완벽합니다.',
    desc: '문제는 시작뿐입니다.',
    condition: (books) => {
      const reading = books.filter(b=>b.status==='읽는중').length;
      const planned = books.filter(b=>b.status!=='완독').length;
      return reading === 0 && planned >= 100;
    },
    reward: {
      title: '📋 계획형 독자', item: '🛒',
      itemName: '무한 장바구니', itemDesc: '실행 없는 완벽한 계획을 세운 독서가에게',
      color: '#3060a0', bg: '#f0f5ff', border: '#a0b8e8',
    }
  },

  // ── 49. 새로고침의 신 (하루 30번 이상 방문)
  {
    id: 'refresh_god',
    name: '새로고침의 신',
    hint: '새로고침 중독!',
    desc: '서버는 당신을 기억할 겁니다.',
    condition: () => parseInt(localStorage.getItem('bl_daily_visit_max')||'0') >= 30,
    reward: {
      title: '⌨️ 새로고침의 신', item: '⌨️',
      itemName: 'F5 키', itemDesc: '하루에 앱을 30번 이상 방문한 독서가에게',
      color: '#408060', bg: '#f0fff5', border: '#a0d8b8',
    }
  },

  // ── 50. 프로필 완벽주의자 (프로필 20번 이상 저장)
  {
    id: 'profile_perfectionist',
    name: '프로필 완벽주의자',
    hint: '아직도 마음에 안 드세요?',
    desc: '자기소개도 퇴고하는 독서인.',
    condition: () => parseInt(localStorage.getItem('bl_profile_save_count')||'0') >= 20,
    reward: {
      title: '🔄 프로필 완벽주의자', item: '🖊️',
      itemName: '수정 테이프', itemDesc: '프로필을 20번 이상 저장한 완벽주의자에게',
      color: '#a04090', bg: '#fff0ff', border: '#e0a8e0',
    }
  },

  // ── 51. 1월 1일의 독서가 (1월 1일에 읽음)
  {
    id: 'jan1_reader',
    name: '1월 1일의 독서가',
    hint: '새해 목표는 언제나! 이번 해는 얼마나 읽으실 거예요?',
    desc: 'Happy book year!',
    condition: (books) => books.some(b => b.source!=='import' && ((b.date_finish||'').slice(5)==='01-01' || (b.date_start||'').slice(5)==='01-01')),
    reward: {
      title: '🎊 1월 1일의 독서가', item: '📅',
      itemName: '새 달력', itemDesc: '새해 첫날에 책을 읽은 독서가에게',
      color: '#d03060', bg: '#fff0f5', border: '#f0a0c0',
      hasInvite: true,
    }
  },

  // ── 52. 연말의 독서가 (12월 31일 완독)
  {
    id: 'dec31_reader',
    name: '연말의 독서가',
    hint: '한 해의 마무리는 언제나! 마지막 페이지와 함께 한 해가 끝났습니다',
    desc: 'Happy Last Book Year!',
    condition: (books) => books.some(b => b.status==='완독' && b.source!=='import' && (b.date_finish||'').slice(5)==='12-31'),
    reward: {
      title: '🎁 연말의 독서가', item: '🎀',
      itemName: '연말 리본', itemDesc: '한 해의 마지막 날에 책을 완독한 독서가에게',
      color: '#a03020', bg: '#fff5f0', border: '#f0b8a0',
      hasInvite: true,
    }
  },

  // ── 53. 찍먹의 달인 (1~2분 타이머 20번 이상)
  {
    id: 'timer_1min',
    name: '찍먹의 달인',
    hint: '시작은 했죠. 시작은.',
    desc: '최소한의 양심은 지켰으니까…',
    condition: () => parseInt(localStorage.getItem('bl_quick_timer_count')||'0') >= 20,
    reward: {
      title: '⏳ 찍먹의 달인', item: '⏳',
      itemName: '1분 모래시계', itemDesc: '1~2분짜리 타이머를 20번 이상 저장한 독서가에게',
      color: '#c07830', bg: '#fff8e8', border: '#f0d0a0',
    }
  },

  // ── 54. 백년의 고독자 (친구 0명 + 완독 50권)
  {
    id: 'solo_50',
    name: '백년의 고독자',
    hint: '혼자 읽는 것도 나쁘지 않습니다.',
    desc: '고독을 유지하셨군요.',
    condition: (books, profile, extra) => {
      const done = books.filter(b=>b.status==='완독'&&b.source!=='import').length;
      return done >= 50 && extra.friendCount === 0;
    },
    reward: {
      title: '🦋 백년의 고독자', item: '🦋',
      itemName: '노란 나비', itemDesc: '혼자서 50권을 완독한 고독한 독서가에게',
      color: '#9060a0', bg: '#f8f0ff', border: '#d0b0e8',
      hasInvite: true,
    }
  },

  // ── 55. 오만, 편견 그리고 다아시의 친구 (오만과 편견 완독 OR 2점→4점+ 별점 수정)
  {
    id: 'prejudice',
    name: '오만, 편견 그리고 다아시의 친구',
    hint: '첫인상은 언제나 틀릴 수 있습니다.',
    desc: '편견을 극복했습니다.',
    condition: (books) => {
      const ratingRevised = !!(localStorage.getItem('bl_rating_revised_up'));
      const hasPnP = books.some(b => b.status==='완독' && (b.title||'').includes('오만과 편견'));
      return ratingRevised || hasPnP;
    },
    reward: {
      title: '💌 오만, 편견 그리고 다아시의 친구', item: '💌',
      itemName: '젖은 편지', itemDesc: '편견을 극복한 독서가에게',
      color: '#a05070', bg: '#fff0f5', border: '#e0b0c8',
    }
  },

  // ── 56. 빅브라더 (365일 연속 방문)
  {
    id: 'big_brother',
    name: '빅브라더',
    hint: '누군가 지켜보고 있는 것 같습니다',
    desc: '보이지 않는 감시자는 당신이군요!',
    condition: () => parseInt(localStorage.getItem('bl_login_streak')||'0') >= 365,
    reward: {
      title: '📷 빅브라더', item: '📹',
      itemName: '감시 카메라', itemDesc: '365일 연속 방문한 독서가에게',
      color: '#303060', bg: '#f0f0f8', border: '#b0b0d8',
      hasInvite: true,
    }
  },

  // ── 57. 농장 관리자 (친구 30명 이상)
  {
    id: 'farm_manager',
    name: '농장 관리자',
    hint: '모두가 친구입니다.',
    desc: '어떤 친구는 조금 더 친구입니다.',
    condition: (books, profile, extra) => extra.friendCount >= 30,
    reward: {
      title: '🐷 농장 관리자', item: '🐷',
      itemName: '돼지 가면', itemDesc: '30명 이상의 친구를 사귄 독서가에게',
      color: '#c06080', bg: '#fff0f5', border: '#f0b0c0',
    }
  },

  // ── 58. 아브락사스의 아이 (책 777권 이상 등록)
  {
    id: 'abraxas',
    name: '아브락사스의 아이',
    hint: '새는 알에서 나오려고 투쟁합니다.',
    desc: '알을 깨고 세상으로!',
    condition: (books) => books.length >= 777,
    reward: {
      title: '🥚 아브락사스의 아이', item: '🥚',
      itemName: '깨진 달걀', itemDesc: '777권의 책을 등록한 독서가에게',
      color: '#607020', bg: '#f8ffe0', border: '#d0e080',
    }
  },

  // ── 59. 메피스토의 고객 (구매/전자책 666권 이상)
  {
    id: 'mephisto',
    name: '메피스토의 고객',
    hint: '위험한 숫자!',
    desc: '영혼 대신 지갑을 계약했죠.',
    condition: (books) => books.filter(b => b.source==='구매' || b.source==='전자책').length >= 666,
    reward: {
      title: '📜 메피스토의 고객', item: '📜',
      itemName: '피의 계약서', itemDesc: '구매/전자책으로 666권을 등록한 독서가에게',
      color: '#800020', bg: '#fff0f2', border: '#e0a0a8',
      hasInvite: true,
    }
  },

  // ── 60. 드라큘라 (새벽 타이머 50회 이상)
  {
    id: 'dracula',
    name: '드라큘라',
    hint: '이 시간에 건강은 괜찮은 건가요?',
    desc: '햇빛이 낯설군요.',
    condition: () => parseInt(localStorage.getItem('bl_dawn_sessions')||'0') >= 50,
    reward: {
      title: '🧛 드라큘라', item: '🦷',
      itemName: '송곳니', itemDesc: '새벽 독서를 50번 이상 기록한 독서가에게',
      color: '#600040', bg: '#f8f0f5', border: '#d0a0c0',
    }
  },

  // ── 61. 독서가의 벗 (친구 3명과 같은 책)
  {
    id: 'three_friends',
    name: '독서가의 벗',
    hint: '천하를 셋으로 나누라!',
    desc: '내가 유비할게, 관우와 장비는 누가 할래?',
    condition: () => !!(localStorage.getItem('bl_friend_same_book_3')),
    reward: {
      title: '🍶 독서가의 벗', item: '🍶',
      itemName: '도원결의 술잔', itemDesc: '3명의 친구와 같은 책을 읽은 독서가에게',
      color: '#a06020', bg: '#fffae8', border: '#e8d080',
    }
  },

  // ── 62. 재판 대기자 (별점 없이 완독 50권)
  {
    id: 'no_verdict',
    name: '재판 대기자',
    hint: '판단을 미루고 계시는군요.',
    desc: '무슨 죄인지는 모르겠지만 평가는 하지 않았습니다.',
    condition: (books) => books.filter(b=>b.status==='완독'&&!b.rating&&b.source!=='import').length >= 50,
    reward: {
      title: '📎 재판 대기자', item: '📋',
      itemName: '빈 판결문', itemDesc: '별점 없이 50권을 완독한 독서가에게',
      color: '#506070', bg: '#f0f5f8', border: '#b0c8d8',
    }
  },

  // ── 63. 개연성 파괴자 (0권 달 다음 달 10권+)
  {
    id: 'deus_ex',
    name: '개연성 파괴자',
    hint: '요즘 좀 조용하네요.',
    desc: '데우스 엑스 마키나! 갑자기 어디서 독서력이 튀어나왔죠?',
    condition: (books) => {
      const mc={};
      books.filter(b=>b.status==='완독'&&b.date_finish).forEach(b=>{const m=b.date_finish.slice(0,7);mc[m]=(mc[m]||0)+1;});
      return Object.keys(mc).some(m=>{
        if(mc[m]<10) return false;
        const d=new Date(m+'-01'); d.setMonth(d.getMonth()-1);
        const prev=d.toISOString().slice(0,7);
        return !mc[prev];
      });
    },
    reward: {
      title: '🎭 개연성 파괴자', item: '🎭',
      itemName: '무대 장치', itemDesc: '갑자기 10권을 완독한 개연성 파괴자에게',
      color: '#7040a0', bg: '#f8f0ff', border: '#d0b0f0',
    }
  },

  // ── 64. 독서가 케빈 (12월 25일 완독 + 타이머 사용)
  {
    id: 'xmas_kevin',
    name: '독서가 케빈',
    hint: '흰 눈 사이로, 썰매를 타고',
    desc: '혼자였어요? 울지마요, 독서 했으니 됐잖아!',
    condition: (books) => {
      const hasXmasBook = books.some(b => b.status==='완독' && (b.date_finish||'').slice(5)==='12-25');
      let hasXmasTimer = false;
      books.forEach(b=>{
        if(b.reading_time_log) Object.keys(b.reading_time_log).forEach(d=>{if(d.slice(5)==='12-25') hasXmasTimer=true;});
      });
      return hasXmasBook && hasXmasTimer;
    },
    reward: {
      title: '🎄 독서가 케빈', item: '🎄',
      itemName: '크리스마스 트리', itemDesc: '크리스마스에 홀로 책을 읽은 독서가에게',
      color: '#207040', bg: '#f0fff5', border: '#a0d8b0',
    }
  },
];

// 퀘스트 보상 초대코드 DB 저장 (실패 시 localStorage 임시 보관 → 다음 로그인 때 재시도)
async function _saveInviteCodeToDB(code) {
  const { error } = await sb.from('invite_codes').insert({
    code,
    owner_id: currentUser.id,
    created_at: new Date().toISOString(),
  });
  if(error) {
    // 중복 키 오류는 이미 저장된 것이므로 성공으로 간주
    if(error.code === '23505') return true;
    return false;
  }
  return true;
}

async function flushPendingInviteCodes() {
  if(!currentUser) return;
  try {
    const pending = JSON.parse(localStorage.getItem('bl_pending_invite_codes') || '[]');
    if(!pending.length) return;
    const remaining = [];
    for(const item of pending) {
      const { data: existing } = await sb.from('invite_codes').select('code').eq('code', item.code).maybeSingle();
      if(existing) continue; // 이미 DB에 있음
      const ok = await _saveInviteCodeToDB(item.code);
      if(!ok) remaining.push(item);
    }
    localStorage.setItem('bl_pending_invite_codes', JSON.stringify(remaining));
  } catch(e) { console.warn('flush pending invite codes failed:', e); }
}

// 프로필 초대코드 섹션 새로고침 (공통)
async function _refreshProfileCodes() {
  const codeWrap = document.getElementById('profile-invite-codes');
  if(!codeWrap) return;
  const { data } = await sb.from('invite_codes').select('*').eq('owner_id', currentUser.id);
  if(!data) return;
  const available = data.filter(c => !c.used_by);
  const used = data.filter(c => c.used_by);
  codeWrap.innerHTML = `<div class="profile-card"><div class="profile-card-title">내 초대코드</div>`
    + available.map(c => `<div style="font-family:monospace;font-size:.78rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--rs);padding:.28rem .6rem;margin-bottom:.25rem;display:flex;justify-content:space-between;align-items:center;gap:.4rem;">
      <span>${c.code}</span>
      <div style="display:flex;align-items:center;gap:.35rem;flex-shrink:0;">
        <button onclick="navigator.clipboard.writeText('${c.code}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='복사',1200)})" style="font-size:.6rem;padding:.15rem .4rem;background:var(--acc);color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:var(--ff);flex-shrink:0;">복사</button>
        <span style="font-size:.65rem;color:var(--acc);font-weight:600;">사용 가능</span>
      </div></div>`).join('')
    + (available.length === 0 ? '<div style="font-size:.73rem;color:var(--tx3);">사용 가능한 코드가 없어요.</div>' : '')
    + (used.length ? `<div style="font-size:.65rem;color:var(--tx3);margin-top:.3rem;">${used.length}개 사용됨</div>` : '')
    + `</div>`;
}

// 초대권 자동 발급 (hasInvite:true 퀘스트 달성 시)
async function grantInviteCode(quest) {
  const newCode = Math.random().toString(36).slice(2,8).toUpperCase() + '-' + quest.id.slice(0,4).toUpperCase();

  // DB 저장 시도 — 실패하면 localStorage에 임시 보관 (다음 로그인 때 재시도)
  const saved = await _saveInviteCodeToDB(newCode);
  if(!saved) {
    try {
      const pending = JSON.parse(localStorage.getItem('bl_pending_invite_codes') || '[]');
      if(!pending.find(p => p.code === newCode)) {
        pending.push({ code: newCode, questId: quest.id, at: new Date().toISOString() });
        localStorage.setItem('bl_pending_invite_codes', JSON.stringify(pending));
      }
    } catch(e) {}
    console.warn('invite code DB save failed, stored in localStorage:', newCode);
  }

  // 팝업은 DB 저장 성공 여부와 무관하게 항상 표시
  await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fdf8ee;border-radius:16px;padding:1.6rem 1.4rem;max-width:280px;width:100%;text-align:center;box-shadow:0 16px 56px rgba(0,0,0,.3);border:2px solid #e8d4a0;';
    box.innerHTML = `
      <div style="font-size:2rem;margin-bottom:.5rem;">🎟️</div>
      <div style="font-size:.72rem;font-weight:700;color:#c8a050;letter-spacing:.08em;margin-bottom:.3rem;">북로그 초대권 발급!</div>
      <div style="font-size:.88rem;font-weight:700;color:#2e1f0e;margin-bottom:.5rem;">${quest.name} 달성 보상</div>
      <div style="background:#f5f0e0;border-radius:8px;padding:.6rem .8rem;margin-bottom:.4rem;font-family:monospace;font-size:1rem;font-weight:700;color:#8B6B3A;letter-spacing:.1em;display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
        <span>${newCode}</span>
        <button id="_ic_copy_${newCode}" onclick="navigator.clipboard.writeText('${newCode}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='복사',1500)})" style="font-size:.6rem;padding:.2rem .5rem;background:#c8a050;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:var(--ff);flex-shrink:0;">복사</button>
      </div>
      <div style="font-size:.65rem;color:#a08c72;margin-bottom:.9rem;">설정 → 프로필에서 언제든 다시 확인할 수 있어요</div>`;
    const btn = document.createElement('button');
    btn.textContent = '확인';
    btn.style.cssText = 'background:#c8a050;color:#fff;border:none;border-radius:20px;padding:.5rem 2rem;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--ff);';
    btn.onclick = () => {
      overlay.remove();
      resolve();
      // 프로필 모달이 열려있으면 즉시 갱신
      const profileModal = document.getElementById('modal-profile');
      if(profileModal && profileModal.style.display !== 'none') _refreshProfileCodes();
    };
    box.appendChild(btn);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if(e.target===overlay){ overlay.remove(); resolve(); } });
    document.body.appendChild(overlay);
  });
}

// 퀘스트 달성 체크 및 자동 보상 적용
async function checkAndGrantQuests() {
  if(!currentUser) return;
  const { data: profile } = await sb.from('profiles')
    .select('created_at, user_title, completed_quests')
    .eq('id', currentUser.id).single();
  if(!profile) return;

  // 새벽 접속 체크 (새벽 2~5시)
  const nowH = new Date().getHours();
  if(nowH >= 2 && nowH < 5) {
    localStorage.setItem('bl_dawn_sessions', String((parseInt(localStorage.getItem('bl_dawn_sessions')||'0')+1)));
  }
  // 새벽 4:44 체크
  const nowM = new Date().getMinutes();
  if(nowH === 4 && nowM === 44) {
    localStorage.setItem('bl_ghost_hour', '1');
  }

  // 연속 로그인 체크
  const today = kstToday();
  const lastLogin = localStorage.getItem('bl_last_login_date');
  if(lastLogin) {
    const diff = (new Date(today) - new Date(lastLogin)) / 86400000;
    if(diff === 1) {
      localStorage.setItem('bl_login_streak', String((parseInt(localStorage.getItem('bl_login_streak')||'0')+1)));
    } else if(diff > 1) {
      localStorage.setItem('bl_login_streak', '1');
    }
  } else {
    localStorage.setItem('bl_login_streak', '1');
  }
  localStorage.setItem('bl_last_login_date', today);

  // 주말 타이머 체크 (토/일)
  const dayOfWeek = new Date().getDay();
  if(dayOfWeek === 0 || dayOfWeek === 6) {
    const weekKey = 'bl_weekend_' + new Date().toISOString().slice(0,7) + '_w' + Math.ceil(new Date().getDate()/7);
    if(!localStorage.getItem(weekKey)) {
      localStorage.setItem(weekKey, '1');
      localStorage.setItem('bl_weekend_timer_weeks', String((parseInt(localStorage.getItem('bl_weekend_timer_weeks')||'0')+1)));
    }
  }

  // 서버에서 extra 데이터 로드 (게시글 수, 댓글 수, 친구 수)
  let extra = { postCount: 0, commentCount: 0, friendCount: 0 };
  try {
    const [postsR, commentsR, friendsR] = await Promise.all([
      sb.from('posts').select('id', {count:'exact',head:true}).eq('user_id', currentUser.id),
      sb.from('comments').select('id', {count:'exact',head:true}).eq('user_id', currentUser.id),
      sb.from('friendships').select('id', {count:'exact',head:true}).or(`requester_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`).eq('status','accepted'),
    ]);
    extra.postCount = postsR.count || 0;
    extra.commentCount = commentsR.count || 0;
    extra.friendCount = friendsR.count || 0;
    try {
      const { data: myPosts } = await sb.from('posts').select('id,likes').eq('user_id',currentUser.id).order('likes',{ascending:false}).limit(1);
      extra.maxPostLikes = myPosts?.[0]?.likes || 0;
    } catch(e) {}
  } catch(e) { console.warn('extra data load failed:', e); }

  const completed = profile.completed_quests || [];
  const newlyCompleted = [];

  for(const quest of QUESTS) {
    if(completed.includes(quest.id)) continue;
    if(quest.condition(allBooks, profile, extra)) {
      newlyCompleted.push(quest);
    }
  }

  if(!newlyCompleted.length) return;

  // 새로 달성한 퀘스트 보상 적용
  const newCompleted = [...completed, ...newlyCompleted.map(q=>q.id)];
  // 칭호: 가장 최근 달성 퀘스트의 칭호로 덮어씌우지 않고 최초만 적용
  const updateData = { completed_quests: newCompleted };
  // 칭호가 아직 없으면 첫 번째 달성 칭호 부여
  if(!profile.user_title && newlyCompleted.length > 0) {
    updateData.user_title = newlyCompleted[0].reward.title;
  }

  await sb.from('profiles').update(updateData).eq('id', currentUser.id);

  // 달성 팝업 + 달성 날짜 기록
  const achDate = new Date().toISOString().slice(0,10);
  for(const quest of newlyCompleted) {
    await showQuestRewardPopup(quest);
    const achKey = 'bl_quest_ach_' + quest.id;
    if(!localStorage.getItem(achKey)) localStorage.setItem(achKey, achDate);
    // DB의 completed_quests에 이미 저장되므로 팝업은 newlyCompleted에서만 발생
  }
  // 초대권 보상
  for(const quest of newlyCompleted) {
    if(quest.hasInvite) {
      await grantInviteCode(quest);
    }
  }

  // 전리품 & 퀘스트 패널 새로고침
  buildLoot(profile.user_title || updateData.user_title, newCompleted);
  buildQuestPanel(newCompleted);
}

// 퀘스트 달성 팝업
async function showQuestRewardPopup(quest) {
  const r = quest.reward;
  const idx = QUESTS.indexOf(quest);
  await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;animation:fadeIn .25s ease;';
    const box = document.createElement('div');
    box.setAttribute('data-popup','');
    box.style.cssText = `background:#fdf8ee;border-radius:16px;padding:2rem 1.5rem;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.25);border:2px solid ${r.border||'#e8d4a0'};animation:popIn .3s cubic-bezier(.34,1.56,.64,1);`;

    const sparkle = document.createElement('div');
    sparkle.style.cssText = 'font-size:1.8rem;margin-bottom:.4rem;animation:spin1 .8s ease;display:inline-block;';
    sparkle.textContent = '✨';
    box.appendChild(sparkle);

    const badge = document.createElement('div');
    badge.style.cssText = `font-size:.65rem;font-weight:700;color:${r.color||'#c8a050'};letter-spacing:.1em;text-transform:uppercase;margin-bottom:.3rem;`;
    badge.textContent = '퀘스트 달성!';
    box.appendChild(badge);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:1.1rem;font-weight:700;color:#2e1f0e;margin-bottom:.8rem;';
    title.textContent = quest.name;
    box.appendChild(title);

    const rewardBox = document.createElement('div');
    rewardBox.style.cssText = `background:${r.bg||'#fdf8ee'};border:1.5px solid ${r.border||'#e8d4a0'};border-radius:12px;padding:1rem;margin-bottom:1rem;`;

    const imgDiv = document.createElement('div');
    imgDiv.style.cssText = 'width:64px;height:64px;margin:0 auto .5rem;';
    const img = document.createElement('img');
    img.src = `loot/${idx+1}.png`;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    img.onerror = () => { imgDiv.innerHTML = `<div style="font-size:2.2rem;line-height:64px;">${r.item}</div>`; };
    imgDiv.appendChild(img);
    rewardBox.appendChild(imgDiv);

    const itemNameEl = document.createElement('div');
    itemNameEl.style.cssText = 'font-size:.82rem;font-weight:700;color:#2e1f0e;';
    itemNameEl.textContent = r.itemName;
    rewardBox.appendChild(itemNameEl);

    const itemDescEl = document.createElement('div');
    itemDescEl.style.cssText = 'font-size:.7rem;color:#7a6a5a;margin-top:.2rem;';
    itemDescEl.textContent = r.itemDesc;
    rewardBox.appendChild(itemDescEl);

    const titleSection = document.createElement('div');
    titleSection.style.cssText = `margin-top:.6rem;padding-top:.6rem;border-top:1px solid ${r.border||'#e8d4a0'};`;
    const titleLabel = document.createElement('div');
    titleLabel.style.cssText = 'font-size:.6rem;color:#a08c72;margin-bottom:.2rem;';
    titleLabel.textContent = '칭호 획득';
    const titleVal = document.createElement('div');
    titleVal.style.cssText = `font-size:.82rem;font-weight:700;color:${r.color||'#c8a050'};`;
    titleVal.textContent = r.title;
    titleSection.appendChild(titleLabel);
    titleSection.appendChild(titleVal);
    rewardBox.appendChild(titleSection);

    box.appendChild(rewardBox);

    const btn = document.createElement('button');
    btn.textContent = '확인';
    btn.style.cssText = `background:${r.color||'#c8a050'};color:#fff;border:none;border-radius:20px;padding:.5rem 2rem;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--ff);`;
    btn.onclick = () => { overlay.remove(); resolve(); };
    box.appendChild(btn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// 전리품 패널 빌드 — stat-grid에 전리품·퀘스트 행 추가
function buildLoot(userTitle, completedIds) {
  const panel = document.getElementById('stat-grid');
  if(!panel) return;
  panel.querySelectorAll('.loot-card,.quest-card,.loot-row').forEach(el=>el.remove());
  const earned = QUESTS.filter(q => completedIds?.includes(q.id));
  const earnedCount = earned.length;
  const doneCount = completedIds?.length || 0;
  const pct = QUESTS.length ? Math.round(doneCount / QUESTS.length * 100) : 0;

  const row = document.createElement('div');
  row.className = 'loot-row';
  row.style.cssText = 'width:100%;display:flex;gap:.32rem;';

  // ① 전리품 카드
  const lootCard = document.createElement('div');
  lootCard.className = 'loot-card';
  lootCard.style.cssText = `flex:1;background:${earnedCount?'#fdf8ee':'var(--card)'};border:1px solid ${earnedCount?'#e8d4a0':'var(--border)'};border-radius:var(--rs);padding:.55rem .7rem;cursor:pointer;transition:box-shadow .15s;`;

  const previewWrap = document.createElement('div');
  previewWrap.style.cssText = 'display:flex;gap:.28rem;align-items:center;margin-bottom:.35rem;min-height:32px;';
  if(earnedCount > 0) {
    earned.slice(-4).forEach(q => {
      const idx = QUESTS.indexOf(q);
      const img = document.createElement('img');
      img.src = `loot/${idx+1}.png`;
      img.style.cssText = 'width:28px;height:28px;object-fit:contain;flex-shrink:0;';
      img.onerror = () => { const s=document.createElement('span');s.textContent=q.reward.item;s.style.cssText='font-size:1.1rem;';img.replaceWith(s); };
      previewWrap.appendChild(img);
    });
    if(earned.length > 4) {
      const more = document.createElement('span');
      more.style.cssText = 'font-size:.58rem;color:var(--tx3);';
      more.textContent = `+${earned.length-4}`;
      previewWrap.appendChild(more);
    }
  } else {
    previewWrap.innerHTML = '<span style="font-size:.62rem;color:var(--tx3);opacity:.5;">퀘스트를 달성하세요</span>';
  }

  const lootMeta = document.createElement('div');
  lootMeta.innerHTML = `
    <div style="font-size:.58rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${earnedCount?'var(--acc)':'var(--tx3)'};">전리품 도감</div>
    <div style="font-size:.52rem;color:var(--tx3);margin-top:.1rem;">${earnedCount} / ${QUESTS.length} 획득</div>`;

  lootCard.appendChild(previewWrap);
  lootCard.appendChild(lootMeta);
  lootCard.onclick = () => openLootBox(userTitle, completedIds);
  lootCard.onmouseenter = () => lootCard.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)';
  lootCard.onmouseleave = () => lootCard.style.boxShadow = '';

  // ② 퀘스트 카드
  const questCard = document.createElement('div');
  questCard.className = 'quest-card';
  questCard.style.cssText = 'flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:.55rem .7rem;cursor:pointer;transition:box-shadow .15s;';
  questCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.4rem;">
      <div style="font-size:.58rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tx2);">퀘스트</div>
      <div style="font-family:var(--fs);font-style:italic;font-size:.85rem;color:var(--rust);">${doneCount}<span style="font-size:.55rem;color:var(--tx3);font-style:normal;"> / ${QUESTS.length}</span></div>
    </div>
    <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:.3rem;">
      <div style="width:${pct}%;height:100%;background:var(--acc);border-radius:2px;transition:width .6s;"></div>
    </div>
    <div style="font-size:.52rem;color:var(--tx3);">${pct}% 달성</div>`;
  questCard.onclick = () => openQuestModal(completedIds);
  questCard.onmouseenter = () => questCard.style.boxShadow = '0 2px 8px rgba(0,0,0,.08)';
  questCard.onmouseleave = () => questCard.style.boxShadow = '';

  row.appendChild(lootCard);
  row.appendChild(questCard);
  panel.appendChild(row);
}

// ── 전리품 도감 (전체 전리품 모달)
function openLootBox(userTitle, completedIds) {
  const done = completedIds || [];
  document.getElementById('lootbox-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'lootbox-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:#fdf8ee;border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.25);';

  // 헤더
  const header = document.createElement('div');
  header.style.cssText = 'padding:.9rem 1.1rem .75rem;border-bottom:1px solid #e8d4a0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  header.innerHTML = `
    <div>
      <div style="font-family:var(--fs);font-size:1.1rem;color:#2e1f0e;">전리품 도감</div>
      <div style="font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;color:#a08c72;margin-top:.2rem;">${done.length} / ${QUESTS.length} UNLOCKED</div>
    </div>
    <button onclick="document.getElementById('lootbox-overlay').remove()" style="background:#ede4d0;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:.8rem;color:#5c3d1e;display:flex;align-items:center;justify-content:center;">✕</button>`;
  sheet.appendChild(header);

  // 그리드 영역
  const scrollArea = document.createElement('div');
  scrollArea.style.cssText = 'overflow-y:auto;padding:.75rem;flex:1;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:.45rem;';

  QUESTS.forEach((q, idx) => {
    const achieved = done.includes(q.id);
    const r = q.reward;
    const cell = document.createElement('div');
    cell.style.cssText = `background:${achieved?'#fff8ee':'#f2ede4'};border:1px solid ${achieved?'#e8d4a0':'#d9d3c0'};border-radius:10px;padding:.5rem .3rem .45rem;display:flex;flex-direction:column;align-items:center;gap:.28rem;text-align:center;cursor:${achieved?'pointer':'default'};transition:transform .15s;position:relative;overflow:hidden;`;

    // 번호
    const numLbl = document.createElement('div');
    numLbl.style.cssText = 'position:absolute;top:.28rem;left:.4rem;font-size:.45rem;color:#c0a870;font-family:var(--fs);font-style:italic;';
    numLbl.textContent = idx;
    cell.appendChild(numLbl);

    // 이미지 래퍼
    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = `width:52px;height:52px;position:relative;${achieved?'':'filter:grayscale(1);opacity:.3;'}`;
    const img = document.createElement('img');
    img.src = `loot/${idx+1}.png`;
    img.alt = r.itemName;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    img.onerror = () => {
      imgWrap.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.6rem;">${r.item}</div>`;
      if(!achieved) imgWrap.style.filter = 'grayscale(1)';
      if(!achieved) imgWrap.style.opacity = '.3';
    };
    imgWrap.appendChild(img);

    if(!achieved) {
      const lockDiv = document.createElement('div');
      lockDiv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
      lockDiv.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a08c72" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      imgWrap.appendChild(lockDiv);
    }
    cell.appendChild(imgWrap);

    // 이름
    const nameLbl = document.createElement('div');
    nameLbl.style.cssText = `font-size:.52rem;font-weight:${achieved?'700':'400'};color:${achieved?'#5c3d1e':'#b0a090'};line-height:1.25;padding:0 .1rem;`;
    nameLbl.textContent = r.itemName;
    cell.appendChild(nameLbl);

    if(achieved) {
      cell.addEventListener('mouseenter', () => cell.style.transform = 'scale(1.06)');
      cell.addEventListener('mouseleave', () => cell.style.transform = '');
      cell.addEventListener('click', () => showLootItemDetail(q.id, userTitle));
    } else {
      cell.title = q.hint;
    }
    grid.appendChild(cell);
  });

  scrollArea.appendChild(grid);
  sheet.appendChild(scrollArea);

  // 푸터
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:.45rem .8rem .6rem;text-align:center;font-size:.58rem;color:#a08c72;border-top:1px solid #e8d4a0;flex-shrink:0;';
  footer.textContent = '획득한 아이템을 눌러 상세 정보를 확인하세요';
  sheet.appendChild(footer);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
}

// 전리품 아이템 상세
function showLootItemDetail(questId, userTitle) {
  const quest = QUESTS.find(q => q.id === questId);
  if(!quest) return;
  const r = quest.reward;
  const idx = QUESTS.indexOf(quest);
  const isActive = userTitle === r.title;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  const detailBox = document.createElement('div');
  detailBox.style.cssText = `background:#fdf8ee;border-radius:16px;padding:1.8rem 1.5rem;max-width:280px;width:100%;text-align:center;box-shadow:0 16px 56px rgba(0,0,0,.3);border:2px solid ${r.border||'#e8d4a0'};`;

  const imgDiv = document.createElement('div');
  imgDiv.style.cssText = 'width:80px;height:80px;margin:0 auto .9rem;';
  const img = document.createElement('img');
  img.src = `loot/${idx+1}.png`;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
  img.onerror = () => { imgDiv.innerHTML = `<div style="font-size:3rem;line-height:80px;">${r.item}</div>`; };
  imgDiv.appendChild(img);
  detailBox.appendChild(imgDiv);

  const infoHtml = document.createElement('div');
  infoHtml.innerHTML = `
    <div style="font-size:1rem;font-weight:700;color:#2e1f0e;margin-bottom:.25rem;">${r.itemName}</div>
    <div style="font-size:.72rem;color:#7a6a5a;margin-bottom:.9rem;">${r.itemDesc}</div>
    <div style="background:${r.bg||'#fdf8ee'};border:1px solid ${r.border||'#e8d4a0'};border-radius:10px;padding:.7rem;margin-bottom:.9rem;">
      <div style="font-size:.58rem;color:#a08c72;margin-bottom:.25rem;font-weight:600;letter-spacing:.05em;">획득 칭호</div>
      <div style="font-size:.88rem;font-weight:700;color:${r.color||'#c8a050'};">${r.title}</div>
      <div style="font-size:.6rem;color:#a08c72;margin-top:.3rem;">${isActive?'✓ 현재 사용 중':'설정에서 칭호를 변경할 수 있어요'}</div>
    </div>`;
  detailBox.appendChild(infoHtml);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '확인';
  closeBtn.style.cssText = `background:${r.color||'#c8a050'};color:#fff;border:none;border-radius:20px;padding:.5rem 2rem;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--ff);`;
  closeBtn.onclick = () => overlay.remove();
  detailBox.appendChild(closeBtn);
  overlay.appendChild(detailBox);
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}


// 퀘스트 상세 팝업
function showQuestDetail(questId, achieved) {
  const q = QUESTS.find(x => x.id === questId);
  if(!q) return;
  const r = q.reward;
  const idx = QUESTS.indexOf(q);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;';
  const box = document.createElement('div');
  box.style.cssText = `background:#fdf8ee;border-radius:16px;padding:1.6rem 1.4rem;max-width:300px;width:100%;text-align:center;box-shadow:0 16px 56px rgba(0,0,0,.3);border:2px solid ${achieved?r.border||'#e8d4a0':'var(--border)'};`;

  const iconDiv = document.createElement('div');
  iconDiv.style.cssText = 'width:72px;height:72px;margin:0 auto .8rem;';
  if(achieved) {
    const img = document.createElement('img');
    img.src = `loot/${idx+1}.png`;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    img.onerror = () => { iconDiv.innerHTML = `<div style="font-size:2.8rem;line-height:72px;">${r.item}</div>`; };
    iconDiv.appendChild(img);
  } else {
    iconDiv.innerHTML = `<div style="width:100%;height:100%;background:#f0ece0;border:2px dashed #d9d3c0;border-radius:10px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c0b0a0" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>`;
  }
  box.appendChild(iconDiv);

  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = `
    <div style="font-size:.58rem;font-weight:700;color:${achieved?r.color||'#c8a050':'#a08c72'};letter-spacing:.08em;text-transform:uppercase;margin-bottom:.3rem;">${achieved?'달성 완료 ✓':'도전 중'}</div>
    <div style="font-size:1rem;font-weight:700;color:#2e1f0e;margin-bottom:.5rem;">${q.name}</div>
    <div style="font-size:.78rem;color:#5c4a30;line-height:1.7;margin-bottom:.8rem;padding:.7rem .8rem;background:${achieved?r.bg||'#fdf8ee':'#f5f0e8'};border-radius:10px;border:1px solid ${achieved?r.border||'#e8d4a0':'var(--border)'};">
      ${achieved && q.desc ? q.desc : q.hint}
    </div>
    ${achieved ? `
    <div style="font-size:.62rem;color:#a08c72;margin-bottom:.3rem;">획득 전리품</div>
    <div style="font-size:.78rem;font-weight:700;color:#2e1f0e;margin-bottom:.2rem;">${r.itemName}</div>
    <div style="font-size:.72rem;font-weight:600;color:${r.color||'#c8a050'};margin-bottom:.8rem;">${r.title}</div>
    ` : ''}`;
  box.appendChild(contentDiv);
  const btn = document.createElement('button');
  btn.textContent = '확인';
  btn.style.cssText = `background:${achieved?r.color||'#c8a050':'#b09070'};color:#fff;border:none;border-radius:20px;padding:.5rem 2rem;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--ff);`;
  btn.onclick = () => overlay.remove();
  box.appendChild(btn);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── 퀘스트 모달
function openQuestModal(completedIds) {
  const overlay = document.createElement('div');
  overlay.id = 'quest-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

  const questRows = QUESTS.map((q, idx) => {
    const achieved = completedIds?.includes(q.id);
    const r = q.reward;
    const imgHtml = achieved
      ? `<img src="loot/${idx+1}.png" style="width:28px;height:28px;object-fit:contain;" onerror="this.parentElement.innerHTML='<span style=font-size:1.3rem>${r.item}</span>'">`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c0b0a0" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    return `<div onclick="showQuestDetail('${q.id}',${achieved})" style="display:flex;align-items:center;gap:.7rem;padding:.65rem .7rem;border-radius:10px;background:${achieved?r.bg||'#fdf8ee':'#f5f0e8'};border:1px solid ${achieved?r.border||'#e8d4a0':'var(--border)'};margin-bottom:.4rem;cursor:pointer;transition:opacity .15s;" onmouseenter="this.style.opacity='.85'" onmouseleave="this.style.opacity='1'">
      <div style="width:36px;height:36px;border-radius:8px;background:${achieved?r.color+'22':'rgba(0,0,0,.06)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${imgHtml}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.78rem;font-weight:700;color:${achieved?'#2e1f0e':'var(--tx2)'};">${q.name}</div>
        <div style="font-size:.63rem;color:var(--tx3);margin-top:.08rem;">${achieved?r.title:q.hint}</div>
      </div>
      <div style="flex-shrink:0;">
        ${achieved
          ? `<span style="font-size:.6rem;font-weight:700;color:${r.color||'#c8a050'};background:${r.bg};padding:.15rem .5rem;border-radius:8px;border:1px solid ${r.border};">달성 ✓</span>`
          : `<span style="font-size:.6rem;color:var(--tx3);background:#ede4d0;padding:.15rem .5rem;border-radius:8px;">도전 중</span>`}
      </div>
    </div>`;
  }).join('');

  const done = (completedIds||[]).length;
  overlay.innerHTML = `
    <div style="background:#fdf8ee;border-radius:16px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 48px rgba(0,0,0,.25);">
      <div style="padding:1rem 1.1rem .7rem;border-bottom:1px solid #e8d4a0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:.5rem;">
          <span style="font-size:1rem;">🗺️</span>
          <div>
            <div style="font-size:.88rem;font-weight:700;color:#2e1f0e;">독서 퀘스트</div>
            <div style="font-size:.6rem;color:#a08c72;">${done}/${QUESTS.length} 달성</div>
          </div>
        </div>
        <button onclick="document.getElementById('quest-overlay').remove()" style="background:#ede4d0;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:.8rem;color:#5c3d1e;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="overflow-y:auto;padding:.8rem .9rem 1.2rem;flex:1;">${questRows}</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
}

// 전리품 상세 팝업 (레거시 - openLootBox로 대체)
async function showLootDetail(quest, userTitle) {
  openLootBox(userTitle);
}

// 퀘스트 패널 빌드 (하위호환 — quest-panel은 이제 숨김)
function buildQuestPanel(completedIds) {
  const panel = document.getElementById('quest-panel');
  if(panel) panel.style.display = 'none'; // 카드 방식으로 대체됨
  return;
  // eslint-disable-next-line no-unreachable
  if(!panel) return;

  const total = QUESTS.length;
  const done = QUESTS.filter(q => completedIds?.includes(q.id)).length;

  panel.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:.6rem .8rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
        <div style="display:flex;align-items:center;gap:.35rem;">
          <span style="font-size:.85rem;">🗺️</span>
          <span style="font-size:.72rem;font-weight:700;color:var(--tx2);">독서 퀘스트</span>
        </div>
        <span style="font-size:.62rem;color:var(--tx3);">${done}/${total} 달성</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:.35rem;">
        ${QUESTS.map(q => {
          const achieved = completedIds?.includes(q.id);
          const r = q.reward;
          return `<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .5rem;border-radius:var(--r);background:${achieved ? r.bg||'#fdf8ee' : '#f5f0e8'};border:1px solid ${achieved ? r.border||'#e8d4a0' : 'var(--border)'};opacity:${achieved?1:0.7};">
            <span style="font-size:1rem;flex-shrink:0;">${achieved ? r.item : '?'}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:.72rem;font-weight:${achieved?700:500};color:${achieved?'#2e1f0e':'var(--tx2)'};">${q.name}</div>
              <div style="font-size:.62rem;color:var(--tx3);margin-top:.08rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${achieved ? r.title : q.hint}</div>
            </div>
            ${achieved ? `<span style="font-size:.6rem;font-weight:700;color:${r.color||'#c8a050'};flex-shrink:0;">달성✓</span>` : '<span style="font-size:.6rem;color:var(--tx3);flex-shrink:0;">도전중</span>'}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}


// ── 차트 툴팁 유틸리티
function showTip(e, html) {
  let tt=document.getElementById('_chart_tip');
  if(!tt){
    tt=document.createElement('div');
    tt.id='_chart_tip';
    tt.style.cssText='position:fixed;background:#2a1f10;color:#f5f0e8;font-size:.6rem;line-height:1.5;padding:.3rem .6rem;border-radius:5px;pointer-events:none;opacity:0;transition:opacity .12s;z-index:99999;white-space:pre;font-family:var(--ff);box-shadow:0 2px 8px rgba(0,0,0,.25);';
    document.body.appendChild(tt);
  }
  tt.innerHTML=html;
  tt.style.opacity='1';
  _moveTip(e, tt);
}
function _moveTip(e, tt) {
  tt=tt||document.getElementById('_chart_tip');
  if(!tt) return;
  const x=e.clientX, y=e.clientY, w=tt.offsetWidth||100, h=tt.offsetHeight||24;
  tt.style.left=Math.min(x+12, window.innerWidth-w-8)+'px';
  tt.style.top=(y-h-10<4?y+14:y-h-10)+'px';
}
function moveTip(e){ _moveTip(e); }
function hideTip(){ const tt=document.getElementById('_chart_tip'); if(tt) tt.style.opacity='0'; }

// ── 통계
function buildStats() {
  const sg=document.getElementById('stat-grid');
  if(!sg) return;
  // 연도 subtitle 업데이트
  const yearEl=document.getElementById('stats-year');
  if(yearEl) yearEl.textContent=new Date().getFullYear();
  // 통계 카드만 제거 (loot-card, quest-card는 buildLoot가 관리)
  [...sg.children].filter(el=>!el.classList.contains('loot-card')&&!el.classList.contains('quest-card')).forEach(el=>el.remove());
  const done=allBooks.filter(b=>b.status==='완독');
  const total=done.length;
  const avg=total>0?(done.reduce((a,b)=>a+(b.rating||0),0)/total).toFixed(1):'—';
  const years=new Set(done.map(b=>b.date_finish?.slice(0,4)).filter(Boolean));
  const totalMins=allBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const thisYear=done.filter(b=>b.date_finish?.startsWith(String(new Date().getFullYear())));
  // 완독된 책만 누적 페이지
  const totalPages=done.reduce((a,b)=>a+(b.pages||0),0);
  // 최애 작가/출판사
  const aMap={},pMap={},aRating={},pRating={};
  done.forEach(b=>{
    if(b.author){aMap[b.author]=(aMap[b.author]||0)+1;aRating[b.author]=(aRating[b.author]||0)+(b.rating||0);}
    if(b.publisher){pMap[b.publisher]=(pMap[b.publisher]||0)+1;pRating[b.publisher]=(pRating[b.publisher]||0)+(b.rating||0);}
  });
  const topA=Object.entries(aMap).sort((a,b)=>b[1]-a[1]||(aRating[b[0]]||0)-(aRating[a[0]]||0))[0];
  const topP=Object.entries(pMap).sort((a,b)=>b[1]-a[1]||(pRating[b[0]]||0)-(pRating[a[0]]||0))[0];
  const cy = new Date().getFullYear();
  const cyStr = String(cy);
  // 올해 기준 통계 - dayMap에서 올해 날짜만 합산 (정확한 날짜별 기록 기반)
  // 올해 독서 시간: reading_time_log(날짜별) > reading_time_year(연별) > last_read 폴백
  const thisYearMins = allBooks.reduce((sum, b) => {
    // 1순위: 날짜별 로그에서 올해 합산 (가장 정확)
    if(b.reading_time_log && typeof b.reading_time_log === 'object') {
      const logSum = Object.entries(b.reading_time_log)
        .filter(([d]) => d.startsWith(cyStr))
        .reduce((s, [, m]) => s + (m||0), 0);
      if(logSum > 0) return sum + logSum;
    }
    // 2순위: 연도별 컬럼 (string 키와 number 키 모두 처리)
    const yrVal = b.reading_time_year?.[cyStr] ?? b.reading_time_year?.[cy];
    if(yrVal > 0) return sum + yrVal;
    // 폴백 없음 — last_read 기반 전체 reading_time은 과다 집계 유발
    return sum;
  }, 0);
  // 완독 외 읽는중·중단 페이지도 반영
  const thisYearPages = allBooks.reduce((a, b) => {
    if(b.status==='완독' && b.date_finish?.startsWith(cyStr)) return a+(b.pages||0);
    if(b.status==='읽는중') return a+(b.current_page||0);
    if(b.status==='중단' && b.date_start?.startsWith(cyStr)) return a+(b.current_page||0);
    return a;
  }, 0);
  // 올해 등록된 문장
  const thisYearQuotes = allQuotes.filter(q=>q.created_at?.startsWith(String(cy)));
  // 최장 연속 독서일 계산
  const longestStreak = (() => {
    const todayStr = kstToday();
    const readDays = new Set();
    allBooks.forEach(b => {
      if (!b.date_start) return;
      const endStr = (b.status === '완독' && b.date_finish) ? b.date_finish
                   : (b.status === '읽는중') ? todayStr
                   : (b.date_finish) ? b.date_finish
                   : b.date_start;
      let d = new Date(b.date_start + 'T00:00:00');
      const endD = new Date(endStr + 'T00:00:00');
      while (d <= endD) {
        readDays.add(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
    });
    if (!readDays.size) return 0;
    const days = [...readDays].sort();
    let max = 1, cur = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = (new Date(days[i]) - new Date(days[i-1])) / 86400000;
      cur = diff === 1 ? cur + 1 : 1;
      if (cur > max) max = cur;
    }
    return max;
  })();
  // 6개 핵심 지표 — 3×2 hairline 그리드 (컨셉 이미지 스타일)
  const timeStr = thisYearMins >= 60
    ? Math.floor(thisYearMins/60)+' h'
    : (thisYearMins > 0 ? thisYearMins+' m' : '—');
  const grid6 = [
    {n: timeStr,                                              l:'시간'},
    {n: thisYearPages>0 ? thisYearPages.toLocaleString()+' p' : '—', l:'페이지'},
    {n: thisYearQuotes.length || '—',                        l:'문장'},
    {n: avg,                                                  l:'평점 평균'},
    {n: longestStreak ? longestStreak+'일' : '—',             l:'최장 연속'},
    {n: Object.keys(aMap).length || '—',                     l:'올해 작가'},
  ];
  const gridEl = document.createElement('div');
  gridEl.style.cssText = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:.55rem;display:grid;grid-template-columns:repeat(3,1fr);';
  gridEl.innerHTML = grid6.map((it,i)=>`
    <div style="padding:.55rem .7rem;${i<3?'border-bottom:1px solid var(--border);':''}${i%3<2?'border-right:1px solid var(--border);':''}">
      <div style="font-size:.55rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);margin-bottom:.22rem;">${it.l}</div>
      <div style="font-family:var(--fs);font-size:1.05rem;font-style:italic;color:var(--tx1);line-height:1;letter-spacing:-.01em;">${it.n}</div>
    </div>`).join('');
  sg.appendChild(gridEl);
  // 전리품 & 퀘스트 패널 초기 로드
  sb.from('profiles').select('user_title,completed_quests').eq('id',currentUser.id).single().then(({data:pf})=>{
    buildLoot(pf?.user_title, pf?.completed_quests||[]);
    buildQuestPanel(pf?.completed_quests||[]);
  });
}

function showGraph(name, btn) {
  if(btn){document.querySelectorAll('.gst').forEach(t=>t.classList.remove('on'));btn.classList.add('on');}
  ['monthly','genre','rating'].forEach(n=>document.getElementById('g-'+n).style.display=n===name?'':'none');
  // Chart.js 기본값을 앱 디자인에 맞게 설정
  if(window.Chart) {
    Chart.defaults.color = '#a08c72';
    Chart.defaults.font.family = 'Pretendard';
    Chart.defaults.font.size = 10;
    Chart.defaults.plugins.tooltip.backgroundColor = '#faf6ef';
    Chart.defaults.plugins.tooltip.borderColor = '#cfc3ac';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#2e1f0e';
    Chart.defaults.plugins.tooltip.bodyColor = '#5c3d1e';
    Chart.defaults.plugins.tooltip.titleFont = {family:'Pretendard',size:11};
    Chart.defaults.plugins.tooltip.bodyFont = {family:'Pretendard',size:11};
    Chart.defaults.plugins.tooltip.padding = 8;
  }
  if(name==='monthly') buildMonthly();
  if(name==='genre')   buildGenre();
  if(name==='rating')  buildRatingAuthor();
}

function buildYrRow(elId, curYr, onChange) {
  const el=document.getElementById(elId); el.innerHTML='';
  const done=allBooks.filter(b=>b.status==='완독'&&b.date_finish);
  const YEARS=[...new Set(done.map(b=>parseInt(b.date_finish.slice(0,4))))].sort();
  const allBtn=document.createElement('button');allBtn.className='yr-btn'+(curYr==='all'?' on':'');
  allBtn.textContent='전체';allBtn.style.cssText=curYr==='all'?'background:var(--acc2);color:#fff;border-color:transparent;':'color:var(--tx3);';
  allBtn.onclick=()=>onChange('all');el.appendChild(allBtn);
  YEARS.forEach(y=>{
    const c=YC[y]||{line:'#b07030'};const btn=document.createElement('button');btn.className='yr-btn'+(curYr===y?' on':'');
    btn.textContent=y+'년';btn.style.cssText=curYr===y?`background:${c.line};color:#fff;border-color:transparent;`:`color:${c.line};border-color:${c.line};`;
    btn.onclick=()=>onChange(y);el.appendChild(btn);
  });
  return YEARS;
}

function buildMonthly() {
  const YEARS=buildYrRow('yr-row-m',curYM,yr=>{curYM=yr;buildMonthly();});
  if(monthChart){monthChart.destroy();monthChart=null;}
  const done=allBooks.filter(b=>b.status==='완독'&&b.date_finish);
  const viz=document.getElementById('monthly-viz');
  viz.innerHTML='';
  const MO=['1','2','3','4','5','6','7','8','9','10','11','12'];
  const now=new Date();
  const BAR_DARK='#3a2a1a';
  const BAR_HI='#c4714a';

  // 섹션 레이블
  const secLabel=document.createElement('div');
  secLabel.style.cssText='font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.65rem;';
  secLabel.textContent='월별 완독';
  viz.appendChild(secLabel);

  if(curYM==='all') {
    if(!YEARS.length){
      viz.innerHTML+='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem 0;">완독 기록이 없어요.</div>';
    } else {
      // 연도별 페이지 합계 미리 계산
      const pagesByYear={};
      const pagesByYearMonth={};
      allBooks.filter(b=>b.status==='완독'&&b.date_finish&&b.pages).forEach(b=>{
        const yr=parseInt(b.date_finish.slice(0,4));
        const mo=parseInt(b.date_finish.slice(5,7))-1;
        pagesByYear[yr]=(pagesByYear[yr]||0)+(b.pages||0);
        if(!pagesByYearMonth[yr]) pagesByYearMonth[yr]=Array(12).fill(0);
        pagesByYearMonth[yr][mo]+=(b.pages||0);
      });
      const maxYearPages=Math.max(...YEARS.map(y=>pagesByYear[y]||0),1);

      // ── 전체 연도 히트맵 뷰
      YEARS.forEach(y=>{
        const c=YC[y]||{line:'#8a7060'};
        const vals=Array(12).fill(0);
        done.filter(b=>parseInt(b.date_finish.slice(0,4))===y).forEach(b=>vals[parseInt(b.date_finish.slice(5,7))-1]++);
        const maxV=Math.max(...vals,1), total=vals.reduce((a,v)=>a+v,0);
        const yPages=pagesByYear[y]||0;
        const moPages=pagesByYearMonth[y]||Array(12).fill(0);
        const row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:.55rem;margin-bottom:.4rem;';
        const yl=document.createElement('div');
        yl.style.cssText=`font-family:var(--fs);font-style:italic;font-size:.8rem;color:${c.line};min-width:34px;line-height:1;`;
        yl.textContent=y;
        const cells=document.createElement('div');
        cells.style.cssText='flex:1;display:flex;gap:2px;';
        vals.forEach((v,i)=>{
          const cell=document.createElement('div');
          const opacity=v>0?Math.max(v/maxV*.85+.15,0.15):0.05;
          cell.style.cssText=`flex:1;height:16px;border-radius:2px;background:${c.line};opacity:${opacity.toFixed(2)};transition:opacity .2s;cursor:default;`;
          const mp=moPages[i]||0;
          const tipText=`${y}년 ${MO[i]}월<br><b>${v}권</b> 완독${mp?'<br>'+mp.toLocaleString()+'p':''}`;
          cell.addEventListener('mouseenter',e=>showTip(e,tipText));
          cell.addEventListener('mousemove',moveTip);
          cell.addEventListener('mouseleave',hideTip);
          cells.appendChild(cell);
        });
        // 권수
        const tl=document.createElement('div');
        tl.style.cssText=`font-family:var(--fs);font-style:italic;font-size:.78rem;color:${c.line};min-width:22px;text-align:right;line-height:1;`;
        tl.textContent=total;
        // 페이지 수 (muted, smaller)
        const pl=document.createElement('div');
        pl.style.cssText=`font-size:.58rem;color:var(--tx3);min-width:46px;text-align:right;line-height:1;white-space:nowrap;`;
        pl.textContent=yPages?yPages.toLocaleString()+'p':'';
        row.appendChild(yl);row.appendChild(cells);row.appendChild(tl);row.appendChild(pl);
        viz.appendChild(row);
      });
      // 월 레이블
      const lr=document.createElement('div');
      lr.style.cssText='display:flex;align-items:center;gap:.55rem;margin-top:.15rem;';
      const sp=document.createElement('div');sp.style.minWidth='34px';
      const ml=document.createElement('div');ml.style.cssText='flex:1;display:flex;gap:2px;';
      MO.forEach((m,i)=>{
        const l=document.createElement('div');
        l.style.cssText=`flex:1;font-size:.42rem;color:${i%2===0?'var(--tx3)':'transparent'};text-align:center;`;
        l.textContent=m; ml.appendChild(l);
      });
      lr.appendChild(sp);lr.appendChild(ml);viz.appendChild(lr);

    }
  } else {
    // ── 단일 연도 — 완독 바 + 페이지 면적 통합 차트 (SVG)
    const c=YC[curYM]||{line:'#8a7060'};
    const vals=Array(12).fill(0);
    done.filter(b=>parseInt(b.date_finish.slice(0,4))===curYM).forEach(b=>vals[parseInt(b.date_finish.slice(5,7))-1]++);
    const pageValsM=Array(12).fill(0);
    allBooks.filter(b=>b.status==='완독'&&b.date_finish&&b.pages&&parseInt(b.date_finish.slice(0,4))===curYM)
      .forEach(b=>pageValsM[parseInt(b.date_finish.slice(5,7))-1]+=(b.pages||0));
    const maxV=Math.max(...vals,1);
    const maxPM=Math.max(...pageValsM,1);
    const hasPg=pageValsM.some(v=>v>0);
    const isCurrentYear=curYM===now.getFullYear();
    const curMo=now.getMonth();
    const svgNS='http://www.w3.org/2000/svg';
    const W=1200,H=108,SLOT=100,BARW=62;
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio','none');
    svg.style.cssText=`width:100%;height:${H}px;display:block;overflow:visible;`;
    // ── 월별 완독 바
    MO.forEach((m,i)=>{
      const isCurMo=isCurrentYear&&i===curMo;
      const isMax=vals[i]===maxV&&maxV>0;
      const barH=vals[i]>0?Math.max(vals[i]/maxV*H,4):0;
      const bx=i*SLOT+(SLOT-BARW)/2, by=H-barH;
      const rect=document.createElementNS(svgNS,'rect');
      rect.setAttribute('x',bx);rect.setAttribute('y',by);
      rect.setAttribute('width',BARW);rect.setAttribute('height',barH);
      rect.setAttribute('fill',(isMax||isCurMo)?c.line:BAR_DARK);
      rect.setAttribute('opacity',(isMax||isCurMo)?'.92':'.32');
      rect.setAttribute('rx','2');
      svg.appendChild(rect);
    });
    // ── 기준선
    const bl=document.createElementNS(svgNS,'line');
    bl.setAttribute('x1','0');bl.setAttribute('y1',H);bl.setAttribute('x2',W);bl.setAttribute('y2',H);
    bl.setAttribute('stroke','var(--border)');bl.setAttribute('stroke-width','1');
    svg.appendChild(bl);
    // ── 페이지 면적 + 선 + 점
    if(hasPg){
      const pts=pageValsM.map((v,i)=>({x:i*SLOT+SLOT/2,y:v>0?H-v/maxPM*H:null,v,ix:i}));
      let seg=[],segs=[];
      pts.forEach(pt=>{if(pt.v>0)seg.push(pt);else{if(seg.length){segs.push(seg);seg=[];}}});
      if(seg.length)segs.push(seg);
      segs.forEach(s=>{
        // 면적
        let d=`M ${s[0].x} ${H}`;
        if(s.length===1){d+=` L ${s[0].x} ${s[0].y}`;}
        else{d+=` L ${s[0].x} ${s[0].y}`;for(let k=1;k<s.length;k++){const cx=(s[k-1].x+s[k].x)/2;d+=` C ${cx} ${s[k-1].y},${cx} ${s[k].y},${s[k].x} ${s[k].y}`;}}
        d+=` L ${s[s.length-1].x} ${H} Z`;
        const ap=document.createElementNS(svgNS,'path');
        ap.setAttribute('d',d);ap.setAttribute('fill',c.line);ap.setAttribute('fill-opacity','.14');
        svg.appendChild(ap);
        // 선
        if(s.length===1) {
          // 단일 점: 선 생략 (dot이 표시)
        } else {
          let ld=`M ${s[0].x} ${s[0].y}`;
          for(let k=1;k<s.length;k++){const cx=(s[k-1].x+s[k].x)/2;ld+=` C ${cx} ${s[k-1].y},${cx} ${s[k].y},${s[k].x} ${s[k].y}`;}
          const lp=document.createElementNS(svgNS,'path');
          lp.setAttribute('d',ld);
          lp.setAttribute('fill','none');
          lp.setAttribute('stroke',c.line);
          lp.setAttribute('stroke-width','1.5');
          lp.setAttribute('opacity','.55');
          lp.setAttribute('vector-effect','non-scaling-stroke');
          svg.appendChild(lp);
        }
      });
    }
    // ── 히트 영역 (툴팁, 맨 위) — 첫 번째 hit 참조 저장
    let firstHitRef=null;
    MO.forEach((m,i)=>{
      const hit=document.createElementNS(svgNS,'rect');
      hit.setAttribute('x',i*SLOT);hit.setAttribute('y','0');hit.setAttribute('width',SLOT);hit.setAttribute('height',H);
      hit.setAttribute('fill','transparent');hit.style.cursor='default';
      const pgLine=pageValsM[i]>0?`<br><span style="opacity:.8;">${pageValsM[i].toLocaleString()}p</span>`:'';
      const tip=`${curYM}년 ${m}월<br><b>${vals[i]}권</b> 완독${pgLine}`;
      hit.addEventListener('mouseenter',e=>showTip(e,tip));
      hit.addEventListener('mousemove',moveTip);
      hit.addEventListener('mouseleave',hideTip);
      if(i===0)firstHitRef=hit;
      svg.appendChild(hit);
    });
    // ── SVG를 래퍼에 삽입
    const chartOuter=document.createElement('div');
    chartOuter.style.cssText=`position:relative;height:${H}px;`;
    svg.style.cssText=`width:100%;height:${H}px;display:block;overflow:visible;`;
    chartOuter.appendChild(svg);
    viz.appendChild(chartOuter);
    // ── 점: rAF로 실제 너비 측정 후 타원→정원 보정
    if(hasPg){
      requestAnimationFrame(()=>{
        const xScale=Math.max(chartOuter.getBoundingClientRect().width/W,0.01);
        const DR=2.8;
        pageValsM.forEach((v,i)=>{
          if(v===0)return;
          const cx=i*SLOT+SLOT/2,cy=H-v/maxPM*H;
          const halo=document.createElementNS(svgNS,'ellipse');
          halo.setAttribute('cx',cx);halo.setAttribute('cy',cy);
          halo.setAttribute('rx',(DR+1.5)/xScale);halo.setAttribute('ry',DR+1.5);
          halo.setAttribute('fill','var(--card)');halo.setAttribute('opacity','.85');
          if(firstHitRef)svg.insertBefore(halo,firstHitRef);else svg.appendChild(halo);
          const dot=document.createElementNS(svgNS,'ellipse');
          dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);
          dot.setAttribute('rx',DR/xScale);dot.setAttribute('ry',DR);
          dot.setAttribute('fill',c.line);dot.setAttribute('opacity','.92');
          if(firstHitRef)svg.insertBefore(dot,firstHitRef);else svg.appendChild(dot);
        });
      });
    }
    // ── 월 레이블 (HTML)
    const lblRow=document.createElement('div');
    lblRow.style.cssText='display:flex;margin-top:3px;';
    MO.forEach((m,i)=>{
      const isCurMo=isCurrentYear&&i===curMo;
      const isMax=vals[i]===maxV&&maxV>0;
      const lbl=document.createElement('div');
      lbl.style.cssText=`flex:1;font-size:.5rem;color:${(isMax||isCurMo)?c.line:'var(--tx3)'};visibility:${i%2===0?'visible':'hidden'};text-align:center;`;
      lbl.textContent=m;
      lblRow.appendChild(lbl);
    });
    viz.appendChild(lblRow);
    // ── 범례
    if(hasPg){
      const legRow=document.createElement('div');
      legRow.style.cssText='display:flex;align-items:center;gap:1.2rem;margin-top:.35rem;font-size:.52rem;color:var(--tx3);';
      legRow.innerHTML=`<span style="display:inline-flex;align-items:center;gap:.28rem;"><span style="display:inline-block;width:7px;height:11px;background:${c.line};border-radius:1px;opacity:.75;vertical-align:middle;"></span>완독 권수</span><span style="display:inline-flex;align-items:center;gap:.28rem;"><span style="display:inline-block;width:14px;height:2px;background:${c.line};border-radius:1px;opacity:.5;vertical-align:middle;"></span>읽은 페이지</span>`;
      viz.appendChild(legRow);
    }
  }

  const filtered=curYM==='all'?done:done.filter(b=>parseInt(b.date_finish.slice(0,4))===curYM);
  const total=filtered.length,cnt=Array(12).fill(0);
  filtered.forEach(b=>cnt[parseInt(b.date_finish.slice(5,7))-1]++);
  const mx=Math.max(...cnt),bestM=mx===0?'—':(cnt.indexOf(mx)+1)+'월 ('+mx+'권)';
  const yrs=new Set(done.map(b=>b.date_finish.slice(0,4))).size||1;
  document.getElementById('monthly-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">${curYM==='all'?'누적 완독':curYM+'년 완독'}</span></div><div class="si"><span class="sn">${curYM==='all'?Math.round(total/yrs*10)/10:Math.round(total/12*10)/10}</span><span class="sl">${curYM==='all'?'연평균':'월평균'}</span></div><div class="si"><span class="sn">${bestM}</span><span class="sl">최다 독서월</span></div>`;
}

function buildGenre() {
  if(donutChart){donutChart.destroy();donutChart=null;}
  const done=allBooks.filter(b=>b.status==='완독');
  const genreMap={};
  done.forEach(b=>{
    const g=Array.isArray(b.genre)?(b.genre[0]||''):(b.genre||'');
    if(!g) return;
    genreMap[g]=(genreMap[g]||0)+1;
  });
  const dl=document.getElementById('donut-layout');
  dl.innerHTML='';
  if(!Object.keys(genreMap).length){dl.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem 0;">장르가 설정된 완독 책이 없어요.</div>';return;}
  const sorted=Object.entries(genreMap).sort((a,b)=>b[1]-a[1]);
  const total=sorted.reduce((a,[,v])=>a+v,0)||1;
  const maxV=sorted[0][1]||1;

  // 섹션 레이블
  const secLabel=document.createElement('div');
  secLabel.style.cssText='font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.65rem;';
  secLabel.textContent='장르 분포';
  dl.appendChild(secLabel);

  sorted.forEach(([g,v],i)=>{
    const barW=Math.round(v/maxV*100);
    const col=GCOLS[i%GCOLS.length];
    const row=document.createElement('div');
    row.style.cssText='display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:.65rem;margin-bottom:.55rem;';
    const name=document.createElement('div');
    name.style.cssText='font-size:.7rem;color:var(--tx1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    name.textContent=g;
    const barWrap=document.createElement('div');
    barWrap.style.cssText='height:10px;background:var(--bg);border-radius:3px;overflow:hidden;position:relative;cursor:default;';
    const barFill=document.createElement('div');
    barFill.style.cssText=`height:100%;width:${barW}%;background:${col};border-radius:3px;transition:width .6s ease;`;
    const gPct=Math.round(v/total*100);
    const gTip=`${g}<br><b>${v}권</b> · ${gPct}%`;
    barWrap.addEventListener('mouseenter',e=>showTip(e,gTip));
    barWrap.addEventListener('mousemove',moveTip);
    barWrap.addEventListener('mouseleave',hideTip);
    row.addEventListener('mouseenter',e=>showTip(e,gTip));
    row.addEventListener('mousemove',moveTip);
    row.addEventListener('mouseleave',hideTip);
    barWrap.appendChild(barFill);
    const count=document.createElement('div');
    count.style.cssText=`font-family:var(--fs);font-style:italic;font-size:.85rem;color:var(--tx1);min-width:20px;text-align:right;`;
    count.textContent=v;
    row.appendChild(name);row.appendChild(barWrap);row.appendChild(count);
    dl.appendChild(row);
  });
  document.getElementById('genre-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">장르 완독</span></div><div class="si"><span class="sn">${sorted.length}</span><span class="sl">장르 수</span></div>`;
}

function buildRating() {
  buildYrRow('yr-row-r',curYR,yr=>{curYR=yr;buildRating();});
  const done=allBooks.filter(b=>b.status==='완독');
  const filtered=curYR==='all'?done:done.filter(b=>parseInt(b.date_finish?.slice(0,4))===curYR);
  const total=filtered.length,dist=[5,4,3,2,1].map(s=>filtered.filter(b=>b.rating===s).length);
  const maxD=Math.max(...dist)||1,avg=total>0?(filtered.reduce((a,b)=>a+(b.rating||0),0)/total).toFixed(2):'—';
  const stars=s=>'★'.repeat(s)+'☆'.repeat(5-s);
  const layout=document.getElementById('rating-layout');layout.innerHTML='';
  // 섹션 레이블
  const rSecLabel=document.createElement('div');
  rSecLabel.style.cssText='font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.65rem;width:100%;';
  rSecLabel.textContent='평점 분포';
  layout.appendChild(rSecLabel);
  const barsEl=document.createElement('div');barsEl.className='rating-bars';
  [5,4,3,2,1].forEach((s,i)=>{
    const cnt=dist[i],pct=total>0?Math.round(cnt/total*100):0,wpct=Math.round(cnt/maxD*100);const inside=wpct>=22;
    const row=document.createElement('div');row.className='rbar-row';
    row.innerHTML=`<span class="rbar-label">${stars(s)}</span><div class="rbar-outer"><div class="rbar-fill" style="width:${wpct}%;background:${RCOLS[i]}">${inside?`<span class="rbar-val">${cnt}권</span>`:''}</div>${!inside&&cnt>0?`<span class="rbar-val-out" style="left:${wpct}%;">${cnt}권</span>`:''}</div><span style="font-size:.62rem;color:var(--tx3);min-width:24px;text-align:right;">${pct}%</span>`;
    const rTip=`${stars(s)}<br><b>${cnt}권</b> · ${pct}%`;
    row.addEventListener('mouseenter',e=>showTip(e,rTip));
    row.addEventListener('mousemove',moveTip);
    row.addEventListener('mouseleave',hideTip);
    barsEl.appendChild(row);
  });
  layout.appendChild(barsEl);
  const sumEl=document.createElement('div');sumEl.className='rating-summary';
  sumEl.innerHTML=`<div class="rs-avg">${avg}</div><div class="rs-lbl">평균 평점</div>`;
  const distEl=document.createElement('div');distEl.className='rs-dist';
  [5,4,3,2,1].forEach((s,i)=>{const r=document.createElement('div');r.className='rs-star-row';r.innerHTML=`<span class="rs-star" style="font-size:10px;">${'★'.repeat(s)}</span><div class="rs-mini"><div class="rs-mini-fill" style="width:${Math.round(dist[i]/maxD*100)}%;background:${RCOLS[i]}"></div></div>`;distEl.appendChild(r);});
  sumEl.appendChild(distEl);layout.appendChild(sumEl);
}

function buildRatingAuthor() {
  buildYrRow('yr-row-r',curYR,yr=>{curYR=yr;buildRatingAuthor();});
  const done=allBooks.filter(b=>b.status==='완독');
  const filtered=curYR==='all'?done:done.filter(b=>parseInt(b.date_finish?.slice(0,4))===curYR);
  const total=filtered.length;
  const layout=document.getElementById('rating-layout');
  layout.innerHTML='';
  layout.style.cssText='display:block;';
  if(!total){layout.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem 0;">완독된 책이 없어요.</div>';return;}

  // ── 작가/출판사 데이터 (평점 카드용으로 미리 계산)
  // 작가: b.author에 포함된 각 이름 정규화 (역할 괄호 제거, 구분자 분리)
  const authorMap={},pubMap={},authorRating={},pubRating={},authorRatedCount={};
  filtered.forEach(b=>{
    if(b.author){
      const names=b.author.split(/[,·;]/)
        .map(n=>n.replace(/\([^)]+\)/g,'').replace(/\[[^\]]+\]/g,'').trim())
        .filter(n=>n.length>1);
      names.forEach(name=>{
        authorMap[name]=(authorMap[name]||0)+1;
        if(b.rating>=1&&b.rating<=5){
          authorRating[name]=(authorRating[name]||0)+b.rating;
          authorRatedCount[name]=(authorRatedCount[name]||0)+1;
        }
      });
    }
    if(b.publisher){pubMap[b.publisher]=(pubMap[b.publisher]||0)+1;}
  });
  // 1순위: 완독 수 많은 순, 2순위: 평점 평균 높은 순, 3순위: 이름 가나다순 (동점 안정성)
  const aSorted=Object.entries(authorMap).sort((a,b)=>{
    if(b[1]!==a[1])return b[1]-a[1];
    const aAvg=authorRatedCount[a[0]]?authorRating[a[0]]/authorRatedCount[a[0]]:0;
    const bAvg=authorRatedCount[b[0]]?authorRating[b[0]]/authorRatedCount[b[0]]:0;
    if(Math.abs(bAvg-aAvg)>0.001)return bAvg-aAvg;
    return a[0].localeCompare(b[0],'ko');
  });
  // 출판사: 완독 수 많은 순, 동점 시 이름순
  const pSorted=Object.entries(pubMap).sort((a,b)=>b[1]-a[1]||(a[0].localeCompare(b[0],'ko')));
  const AUTHOR_COLS=['#c4714a','#c4a87a','#8a3a28','#c87850','#9a5040','#b06030'];
  const PCOLS=['#5a7a8a','#6b8f6b','#7a5a8a','#3a6858','#4a6888','#6a8a50'];

  // ── 평점 바 (좌) + 최애 카드 (우)
  const dist=[5,4,3,2,1].map(s=>filtered.filter(b=>b.rating===s).length);
  const maxD=Math.max(...dist)||1;
  const ratedTotal=dist.reduce((a,v)=>a+v,0);
  const avg=ratedTotal>0?(dist.reduce((a,v,i)=>a+v*(5-i),0)/ratedTotal).toFixed(1):'—';
  const starsStr=s=>'★'.repeat(s)+'☆'.repeat(5-s);

  const ratingWrap=document.createElement('div');
  ratingWrap.style.cssText='display:grid;grid-template-columns:1fr auto;gap:.9rem;align-items:start;margin-bottom:.2rem;';
  const rLeft=document.createElement('div');
  // 평점 헤더
  const rHead=document.createElement('div');
  rHead.style.cssText='display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.75rem;';
  rHead.innerHTML=`<span style="font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);">평점</span>
    <span style="display:flex;align-items:baseline;gap:.3rem;">
      <span style="font-family:var(--fs);font-style:italic;font-size:1.55rem;color:var(--tx1);line-height:1;">${avg}</span>
      <span style="font-size:.56rem;color:var(--tx3);padding-bottom:.1rem;">/ 5 &nbsp;·&nbsp; ${ratedTotal}권</span>
    </span>`;
  rLeft.appendChild(rHead);
  // 5단계 바
  [5,4,3,2,1].forEach((s,i)=>{
    const cnt=dist[i],pct=ratedTotal>0?Math.round(cnt/ratedTotal*100):0;
    const wpct=Math.round(cnt/maxD*100);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.5rem;margin-bottom:.38rem;cursor:default;';
    const starEl=document.createElement('div');
    starEl.style.cssText=`font-size:.62rem;color:${RCOLS[i]};min-width:54px;letter-spacing:-.01em;line-height:1;`;
    starEl.textContent=starsStr(s);
    const bOuter=document.createElement('div');
    bOuter.style.cssText='flex:1;height:14px;background:var(--bg);border-radius:3px;overflow:hidden;position:relative;';
    const bFill=document.createElement('div');
    bFill.style.cssText=`position:absolute;inset:0;width:${wpct}%;background:${RCOLS[i]};border-radius:3px;transition:width .5s ease;`;
    bOuter.appendChild(bFill);
    if(cnt>0){
      const vEl=document.createElement('div');
      vEl.style.cssText=`position:absolute;top:50%;transform:translateY(-50%);font-size:.55rem;font-weight:600;line-height:1;${wpct>=26?`right:5px;color:#fff;`:`left:calc(${wpct}% + 5px);color:var(--tx3);`}`;
      vEl.textContent=cnt+'권';
      bOuter.appendChild(vEl);
    }
    const pEl=document.createElement('div');
    pEl.style.cssText='font-size:.6rem;color:var(--tx3);min-width:28px;text-align:right;line-height:1;';
    pEl.textContent=pct+'%';
    const rTip=`${starsStr(s)}<br><b>${cnt}권</b> · ${pct}%`;
    row.addEventListener('mouseenter',e=>showTip(e,rTip));row.addEventListener('mousemove',moveTip);row.addEventListener('mouseleave',hideTip);
    row.appendChild(starEl);row.appendChild(bOuter);row.appendChild(pEl);
    rLeft.appendChild(row);
  });
  // 최애 카드 (우)
  const rRight=document.createElement('div');
  rRight.style.cssText='display:flex;flex-direction:column;gap:.4rem;width:90px;flex-shrink:0;';
  function makeTopCard(title,name,cnt,col){
    const card=document.createElement('div');
    card.style.cssText='background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.48rem .6rem;overflow:hidden;';
    const esc=s=>s.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    card.innerHTML=`<div style="font-size:.43rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);margin-bottom:.18rem;">${title}</div><div style="font-family:var(--fs);font-style:italic;font-size:.78rem;color:var(--tx1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(name)}">${esc(name)}</div><div style="font-size:.52rem;color:${col};margin-top:.1rem;">${cnt}권</div>`;
    return card;
  }
  if(aSorted.length) rRight.appendChild(makeTopCard('최애 작가',aSorted[0][0],aSorted[0][1],AUTHOR_COLS[0]));
  if(pSorted.length) rRight.appendChild(makeTopCard('최애 출판사',pSorted[0][0],pSorted[0][1],PCOLS[0]));
  ratingWrap.appendChild(rLeft);ratingWrap.appendChild(rRight);
  layout.appendChild(ratingWrap);

  if(!aSorted.length) return;

  // 공통 렌더 함수 — 목록형, 타겟 엘리먼트에 추가
  function renderSection(sorted, cols, isAuthor, target) {
    const maxV=sorted[0][1];
    const expanded=isAuthor?authorExpanded:pubExpanded;
    const list=expanded?sorted:sorted.slice(0,5);
    list.forEach(([name,cnt],i)=>{
      const pct=Math.round(cnt/maxV*100);
      const col=cols[i%cols.length];
      const ratedCnt=isAuthor?(authorRatedCount[name]||0):0;
      const avgR=isAuthor&&ratedCnt>0?(authorRating[name]/ratedCnt).toFixed(1):null;
      const item=document.createElement('div');
      item.style.cssText='padding:.38rem 0;border-bottom:1px solid var(--border);cursor:default;';
      // 상단 행: 순위 · 이름 · [공간] · 별점평균 · 권수
      const topRow=document.createElement('div');
      topRow.style.cssText='display:flex;align-items:baseline;gap:.4rem;';
      const rankEl=document.createElement('span');
      rankEl.style.cssText=`font-family:var(--fs);font-style:italic;font-size:.7rem;color:${col};flex-shrink:0;min-width:13px;line-height:1;`;
      rankEl.textContent=i+1;
      const nameEl=document.createElement('span');
      nameEl.style.cssText='font-size:.73rem;color:var(--tx1);font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1;';
      nameEl.title=name;nameEl.textContent=name;
      topRow.appendChild(rankEl);topRow.appendChild(nameEl);
      if(avgR){
        const rEl=document.createElement('span');
        rEl.style.cssText='font-size:.6rem;color:var(--tx3);flex-shrink:0;letter-spacing:-.01em;';
        rEl.textContent='★ '+avgR;
        topRow.appendChild(rEl);
      }
      const cntEl=document.createElement('span');
      cntEl.style.cssText=`font-family:var(--fs);font-style:italic;font-size:.85rem;color:${col};flex-shrink:0;line-height:1;`;
      cntEl.textContent=cnt+'권';
      topRow.appendChild(cntEl);
      // 하단 비율 바 (2px, 은은하게)
      const barWrap=document.createElement('div');
      barWrap.style.cssText='margin-top:.26rem;height:2px;background:var(--bg);border-radius:2px;overflow:hidden;';
      const barFill=document.createElement('div');
      barFill.style.cssText=`height:100%;width:${pct}%;background:${col};border-radius:2px;opacity:.55;transition:opacity .15s;`;
      barWrap.appendChild(barFill);
      item.appendChild(topRow);item.appendChild(barWrap);
      const tip=`${name}<br><b>${cnt}권</b> 완독${avgR?' · ★'+avgR:''}`;
      item.addEventListener('mouseenter',e=>{barFill.style.opacity='.9';showTip(e,tip);});
      item.addEventListener('mousemove',moveTip);
      item.addEventListener('mouseleave',()=>{barFill.style.opacity='.55';hideTip();});
      target.appendChild(item);
    });
    if(sorted.length>5){
      const btn=document.createElement('button');btn.className='add-quote-btn';btn.style.cssText='margin-top:.2rem;font-size:.6rem;';
      btn.textContent=expanded?'접기 ▲':`+${sorted.length-5}${isAuthor?'명':'개'} 더`;
      btn.onclick=()=>{isAuthor?authorExpanded=!authorExpanded:pubExpanded=!pubExpanded;buildRatingAuthor();};
      target.appendChild(btn);
    }
  }

  // ── 작가(좌) + 출판사(우) 2열 레이아웃
  const twoCol=document.createElement('div');
  twoCol.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:.95rem;align-items:start;';
  const leftCol=document.createElement('div');
  const aHdr=document.createElement('div');
  aHdr.style.cssText='font-size:.52rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.38rem;padding-bottom:.25rem;border-bottom:1px solid var(--border);';
  aHdr.textContent='작가';
  leftCol.appendChild(aHdr);
  twoCol.appendChild(leftCol);
  if(pSorted.length){
    const rightCol=document.createElement('div');
    const pHdr=document.createElement('div');
    pHdr.style.cssText='font-size:.52rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.38rem;padding-bottom:.25rem;border-bottom:1px solid var(--border);';
    pHdr.textContent='출판사';
    rightCol.appendChild(pHdr);
    twoCol.appendChild(rightCol);
    renderSection(pSorted,PCOLS,false,rightCol);
  }
  layout.appendChild(twoCol);
  renderSection(aSorted,AUTHOR_COLS,true,leftCol);
}

let authorExpanded=false, pubExpanded=false;
function buildAuthorChart() {
  const wrap=document.getElementById('author-chart-wrap'); wrap.innerHTML='';
  const done=allBooks.filter(b=>b.status==='완독');
  const authorMap={}, pubMap={};
  done.forEach(b=>{
    if(b.author) authorMap[b.author]=(authorMap[b.author]||0)+1;
    if(b.publisher) pubMap[b.publisher]=(pubMap[b.publisher]||0)+1;
  });
  // 동점 시 별점 합산으로 정렬
  const authorRating={}, pubRating={};
  done.forEach(b=>{
    if(b.author) authorRating[b.author]=(authorRating[b.author]||0)+(b.rating||0);
    if(b.publisher) pubRating[b.publisher]=(pubRating[b.publisher]||0)+(b.rating||0);
  });
  const aSorted=Object.entries(authorMap).sort((a,b)=>b[1]-a[1]||((authorRating[b[0]]||0)-(authorRating[a[0]]||0)));
  const pSorted=Object.entries(pubMap).sort((a,b)=>b[1]-a[1]||((pubRating[b[0]]||0)-(pubRating[a[0]]||0)));
  if(!aSorted.length){wrap.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem 0;">완독한 책이 없어요.</div>';return;}

  // 섹션 레이블
  const authorSecLabel=document.createElement('div');
  authorSecLabel.style.cssText='font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.65rem;';
  authorSecLabel.textContent='작가 · 출판사';
  wrap.appendChild(authorSecLabel);

  // ─ 명예의 전당
  const hallEl=document.createElement('div');
  hallEl.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:1rem;';
  const topA=aSorted[0], topP=pSorted[0];
  hallEl.innerHTML=`
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.65rem .8rem;text-align:center;">
      <div style="font-size:.52rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);margin-bottom:.3rem;">최애 작가</div>
      <div style="font-family:var(--fs);font-size:.95rem;font-style:italic;color:var(--tx1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topA[0]}">${topA[0]}</div>
      <div style="font-size:.62rem;color:var(--rust);margin-top:.18rem;">${topA[1]}권 완독</div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.65rem .8rem;text-align:center;">
      <div style="font-size:.52rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);margin-bottom:.3rem;">최애 출판사</div>
      <div style="font-family:var(--fs);font-size:.95rem;font-style:italic;color:var(--tx1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topP?topP[0]:'—'}">${topP?topP[0]:'—'}</div>
      <div style="font-size:.62rem;color:var(--rust);margin-top:.18rem;">${topP?topP[1]+'권 완독':''}</div>
    </div>`;
  wrap.appendChild(hallEl);

  // ─ 작가별 가로 바
  const sec1=document.createElement('div');sec1.style.marginBottom='.9rem';
  const h1=document.createElement('div');h1.style.cssText='font-size:.68rem;font-weight:600;color:var(--acc2);margin-bottom:.5rem;';h1.textContent='작가별 독서';sec1.appendChild(h1);
  const aList=authorExpanded?aSorted:aSorted.slice(0,5);
  const maxA=aSorted[0][1];
  const MEDAL=['🥇','🥈','🥉'];
  const AUTHOR_COLS=['#c4714a','#c4a87a','#8a3a28','#c87850','#9a5040','#b06030'];
  aList.forEach(([name,cnt],i)=>{
    const pct=Math.round(cnt/maxA*100);
    const bg=AUTHOR_COLS[i]||'#c8b07a';
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.5rem;margin-bottom:.38rem;';
    row.innerHTML=`<span style="font-size:.62rem;color:var(--tx2);min-width:72px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${i<3?'<span style="font-size:.58rem;opacity:.7;">'+('①②③'[i])+'</span> ':' '}${name}</span>
      <div style="flex:1;height:12px;background:var(--bg);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${bg};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">
          ${pct>22?`<span style="font-size:.52rem;font-weight:600;color:#fff;">${cnt}권</span>`:''}
        </div>
      </div>
      ${pct<=22?`<span style="font-size:.58rem;color:var(--tx3);min-width:22px;">${cnt}권</span>`:''}`;
    const aTip=`${name}<br><b>${cnt}권</b> 완독`;
    row.addEventListener('mouseenter',e=>showTip(e,aTip));
    row.addEventListener('mousemove',moveTip);
    row.addEventListener('mouseleave',hideTip);
    sec1.appendChild(row);
  });
  if(aSorted.length>5){
    const btn=document.createElement('button');btn.className='add-quote-btn';btn.style.marginTop='.2rem';
    btn.textContent=authorExpanded?'접기 ▲':`+${aSorted.length-5}명 더 보기`;
    btn.onclick=()=>{authorExpanded=!authorExpanded;buildAuthorChart();};
    sec1.appendChild(btn);
  }
  wrap.appendChild(sec1);

  // ─ 출판사별 가로 바
  if(!pSorted.length) return;
  const sec2=document.createElement('div');
  const h2=document.createElement('div');h2.style.cssText='font-size:.68rem;font-weight:600;color:var(--acc2);margin-bottom:.5rem;';h2.textContent='출판사별 독서';sec2.appendChild(h2);
  const pList=pubExpanded?pSorted:pSorted.slice(0,5);
  const maxP=pSorted[0][1];
  const PCOLS=['#5a7a8a','#6b8f6b','#7a5a8a','#3a6858','#4a6888','#6a8a50'];
  pList.forEach(([name,cnt],i)=>{
    const pct=Math.round(cnt/maxP*100);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.5rem;margin-bottom:.38rem;';
    row.innerHTML=`<span style="font-size:.62rem;color:var(--tx2);min-width:72px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</span>
      <div style="flex:1;height:12px;background:var(--bg);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${PCOLS[i%5]};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">
          ${pct>22?`<span style="font-size:.52rem;font-weight:600;color:#fff;">${cnt}권</span>`:''}
        </div>
      </div>
      ${pct<=22?`<span style="font-size:.58rem;color:var(--tx3);min-width:22px;">${cnt}권</span>`:''}`;
    const pTip=`${name}<br><b>${cnt}권</b> 완독`;
    row.addEventListener('mouseenter',e=>showTip(e,pTip));
    row.addEventListener('mousemove',moveTip);
    row.addEventListener('mouseleave',hideTip);
    sec2.appendChild(row);
  });
  if(pSorted.length>5){
    const btn=document.createElement('button');btn.className='add-quote-btn';btn.style.marginTop='.2rem';
    btn.textContent=pubExpanded?'접기 ▲':`+${pSorted.length-5}개 더 보기`;
    btn.onclick=()=>{pubExpanded=!pubExpanded;buildAuthorChart();};
    sec2.appendChild(btn);
  }
  wrap.appendChild(sec2);
}
let curPY = 'all';
function buildPagesChart() {
  if(pagesChart){pagesChart.destroy();pagesChart=null;}
  const done = allBooks.filter(b=>b.status==='완독'&&b.date_finish&&b.pages);
  if(!done.length){
    document.getElementById('pages-stat').innerHTML='<div style="font-size:.75rem;color:var(--tx3);">완독된 책의 페이지 정보가 없어요.</div>';
    return;
  }

  // 연도 버튼
  const yrRow = document.getElementById('yr-row-pages');
  if(yrRow) {
    yrRow.innerHTML = '';
    const YEARS = [...new Set(done.map(b=>parseInt(b.date_finish.slice(0,4))))].sort();
    const allBtn = document.createElement('button');
    allBtn.className='yr-btn'+(curPY==='all'?' on':'');
    allBtn.textContent='전체'; allBtn.style.cssText=curPY==='all'?'background:var(--acc2);color:#fff;border-color:transparent;':'color:var(--tx3);';
    allBtn.onclick=()=>{curPY='all';buildPagesChart();};
    yrRow.appendChild(allBtn);
    YEARS.forEach(y=>{
      const btn=document.createElement('button');btn.className='yr-btn'+(curPY===y?' on':'');
      btn.textContent=y+'년';
      const c=YC[y]||{line:'#b07030'};
      btn.style.cssText=curPY===y?`background:${c.line};color:#fff;border-color:transparent;`:`color:${c.line};border-color:${c.line};`;
      btn.onclick=()=>{curPY=y;buildPagesChart();};
      yrRow.appendChild(btn);
    });
  }

  const viz = document.getElementById('pages-viz');
  viz.innerHTML = '';
  const BAR_DARK='#3a2a1a';
  const yc = curPY!=='all' ? (YC[curPY]||{line:'#8a7060'}) : {line:'#8a7060'};
  const BAR_HI = yc.line;

  // 섹션 레이블
  const secLabel=document.createElement('div');
  secLabel.style.cssText='font-size:.55rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);margin-bottom:.65rem;';
  secLabel.textContent='페이지 기록';
  viz.appendChild(secLabel);

  let labels, vals, bookCounts;
  if(curPY === 'all') {
    const YEARS = [...new Set(done.map(b=>b.date_finish.slice(0,4)))].sort();
    labels = YEARS.map(y=>y+'년');
    vals = YEARS.map(y=>done.filter(b=>b.date_finish.startsWith(y)).reduce((a,b)=>a+(b.pages||0),0));
    bookCounts = YEARS.map(y=>done.filter(b=>b.date_finish.startsWith(y)).length);
  } else {
    const yr = String(curPY);
    labels = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    vals = Array.from({length:12},(_,i)=>{
      const mk=yr+'-'+String(i+1).padStart(2,'0');
      return done.filter(b=>b.date_finish.startsWith(mk)).reduce((a,b)=>a+(b.pages||0),0);
    });
    bookCounts = Array.from({length:12},(_,i)=>{
      const mk=yr+'-'+String(i+1).padStart(2,'0');
      return done.filter(b=>b.date_finish.startsWith(mk)).length;
    });
  }

  const maxV = Math.max(...vals, 1);
  const isMonthly = curPY !== 'all';
  const barsWrap = document.createElement('div');
  barsWrap.style.cssText = `display:flex;align-items:flex-end;gap:${isMonthly?'4':'8'}px;height:130px;`;

  labels.forEach((lbl,i)=>{
    const isMax = vals[i]===maxV&&maxV>0;
    const barH = Math.max(vals[i]/maxV*108, vals[i]>0?4:0);
    const col = document.createElement('div');
    col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;';
    const bar = document.createElement('div');
    const barOpacity = isMax?'1':'.38';
    bar.style.cssText = `width:100%;height:${barH}px;background:${isMax?BAR_HI:BAR_DARK};opacity:${barOpacity};border-radius:2px 2px 0 0;cursor:default;`;
    const pTipTxt = `${lbl}<br><b>${vals[i].toLocaleString()}p</b>${bookCounts[i]?' · '+bookCounts[i]+'권':''}`;
    bar.addEventListener('mouseenter',e=>showTip(e,pTipTxt));
    bar.addEventListener('mousemove',moveTip);
    bar.addEventListener('mouseleave',hideTip);
    const base = document.createElement('div');
    base.style.cssText = 'width:100%;height:1px;background:var(--border);margin-bottom:4px;';
    const label = document.createElement('div');
    const showLabel = isMonthly ? i%2===0 : true;
    label.style.cssText = `font-size:.5rem;color:${isMax?BAR_HI:'var(--tx3)'};text-align:center;visibility:${showLabel?'visible':'hidden'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;`;
    label.textContent = lbl;
    col.appendChild(bar);col.appendChild(base);col.appendChild(label);
    barsWrap.appendChild(col);
  });
  viz.appendChild(barsWrap);

  const totalP = vals.reduce((a,b)=>a+b,0);
  const totalB = bookCounts.reduce((a,b)=>a+b,0);
  const avgP = totalB > 0 ? Math.round(totalP/totalB) : 0;
  const bestIdx = vals.indexOf(Math.max(...vals));
  document.getElementById('pages-stat').innerHTML =
    `<div class="si"><span class="sn">${totalP.toLocaleString()}p</span><span class="sl">${curPY==='all'?'전체 누적':curPY+'년 누적'}</span></div>
     <div class="si"><span class="sn">${avgP.toLocaleString()}p</span><span class="sl">권당 평균</span></div>
     <div class="si"><span class="sn">${labels[bestIdx]||'—'}</span><span class="sl">최다 독서</span></div>`;
}
function buildMilestone() {
  const done=allBooks.filter(b=>b.status==='완독');
  const total=done.length,years=new Set(done.map(b=>b.date_finish?.slice(0,4)).filter(Boolean));
  const yrs=years.size||1,totalMins=allBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const totalPages=done.reduce((a,b)=>a+(b.pages||0),0);
  const items=[
    {n:total,l:'총 완독',ic:'📖',c:'#c4714a',bg:'#fdf0ea',prog:Math.min(total/200,1),target:'200권'},
    {n:yrs+'년',l:'독서 기간',ic:'🌱',c:'#6b8f6b',bg:'#eef4ee',prog:Math.min(yrs/10,1),target:'10년'},
    {n:Math.round(total/yrs*10)/10+'권',l:'연평균',ic:'📅',c:'#5a7a8a',bg:'#eef2f5',prog:Math.min(total/yrs/20,1),target:'20권/년'},
    {n:Math.floor(totalMins/60)+'h',l:'독서 시간',ic:'⏱',c:'#8b6b8b',bg:'#f3eef3',prog:Math.min(totalMins/60/500,1),target:'500h'},
    {n:totalPages?totalPages.toLocaleString():'0',l:'누적 페이지',ic:'📄',c:'#7a5a3a',bg:'#f5f0e8',prog:Math.min(totalPages/50000,1),target:'50,000p'},
    {n:done.filter(b=>b.rating>=5).length+'권',l:'명작 수집',ic:'⭐',c:'#b07030',bg:'#fdf7e8',prog:Math.min(done.filter(b=>b.rating>=5).length/100,1),target:'100권'},
  ];
  const g=document.getElementById('ms-grid'); g.innerHTML='';
  items.forEach(it=>{
    const pct=Math.round(it.prog*100);
    const el=document.createElement('div');
    el.style.cssText=`background:${it.bg};border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:.5rem .45rem;text-align:center;position:relative;overflow:hidden;`;
    el.innerHTML=`
      <div style="position:absolute;top:-10px;right:-8px;font-size:2rem;opacity:.07;">${it.ic}</div>
      <div style="font-size:.75rem;margin-bottom:.1rem;">${it.ic}</div>
      <div style="font-family:var(--fs);font-size:.95rem;font-weight:700;color:${it.c};line-height:1.1;">${it.n}</div>
      <div style="font-size:.5rem;color:var(--tx3);margin:.1rem 0 .3rem;letter-spacing:.01em;">${it.l}</div>
      <div style="height:3px;background:rgba(0,0,0,.08);border-radius:2px;overflow:hidden;margin-bottom:.15rem;">
        <div style="width:${pct}%;height:100%;background:${it.c};border-radius:2px;transition:width .5s;opacity:.7;"></div>
      </div>
      <div style="font-size:.48rem;color:${it.c};opacity:.7;">목표 ${it.target}</div>`;
    g.appendChild(el);
  });
}

// ── 목표
async function loadGoals() {
  try {
    const { data } = await sb.from('user_goals').select('*').eq('user_id',currentUser.id).single();
    if(data) {
      goals = {books:data.books||0, minutes:data.minutes||0, pages:data.pages||0};
      // localStorage도 동기화
      localStorage.setItem('bl_goals_'+currentUser.id, JSON.stringify(goals));
      return;
    }
  } catch(e) { console.warn('loadGoals DB error:', e); }
  // DB에 없으면 기본값 (localStorage 폴백 제거 - 오래된 값 방지)
  goals = { books:0, minutes:0, pages:0 };
}
function openGoalModal() {
  document.getElementById('goal-books').value = goals.books||'';
  document.getElementById('goal-minutes').value = goals.minutes||'';
  document.getElementById('goal-pages').value = goals.pages||'';
  openModal('modal-goal');
}
async function saveGoal() {
  goals.books   = parseInt(document.getElementById('goal-books').value)||0;
  goals.minutes = parseInt(document.getElementById('goal-minutes').value)||0;
  goals.pages   = parseInt(document.getElementById('goal-pages').value)||0;
  try {
    // 기존 행 있으면 UPDATE, 없으면 INSERT
    const { data: existing } = await sb.from('user_goals').select('id').eq('user_id', currentUser.id).single();
    if(existing) {
      const { error } = await sb.from('user_goals').update({
        books:goals.books, minutes:goals.minutes, pages:goals.pages,
        updated_at:new Date().toISOString()
      }).eq('user_id', currentUser.id);
      if(error) throw error;
    } else {
      const { error } = await sb.from('user_goals').insert({
        user_id:currentUser.id, books:goals.books, minutes:goals.minutes, pages:goals.pages,
        updated_at:new Date().toISOString()
      });
      if(error) throw error;
    }
    goals.year = new Date().getFullYear();
  } catch(e) {
    await showAlert('목표 저장 오류: '+(e.message||'다시 시도해주세요'));
    return;
  }
  closeModal('modal-goal');
  buildGoalDisplay();
}
function buildGoalDisplay() {
  const wrap=document.getElementById('goal-display'); if(!wrap) return;
  // goals가 비어있으면 DB에서 다시 로드
  if(!goals.books && !goals.minutes && !goals.pages) {
    loadGoals().then(()=>{
      if(goals.books||goals.minutes||goals.pages) buildGoalDisplay();
    });
  }
  const cy = new Date().getFullYear();
  const goalYear = goals.year || cy;
  const done=allBooks.filter(b=>b.status==='완독');
  const thisYear=done.filter(b=>b.date_finish?.startsWith(String(cy)));
  const thisYearMins=allBooks.reduce((sum,b)=>{
    const _cyS=String(cy);
    if(b.reading_time_log&&typeof b.reading_time_log==='object'){
      const ls=Object.entries(b.reading_time_log).filter(([d])=>d.startsWith(_cyS)).reduce((s,[,m])=>s+(m||0),0);
      if(ls>0) return sum+ls;
    }
    const _yrV=b.reading_time_year?.[_cyS]??b.reading_time_year?.[cy];
    if(_yrV>0) return sum+_yrV;
    return sum;  // 폴백 제거 — last_read 기반은 과다 집계 유발
  },0);
  const thisYearPages=thisYear.reduce((a,b)=>a+(b.pages||0),0);

  // 연도가 바뀐 경우 안내
  if((goals.books||goals.minutes||goals.pages) && goalYear < cy) {
    wrap.style.cssText='padding:.5rem 1rem;';
    wrap.innerHTML=`<div style="font-size:.7rem;color:var(--acc2);display:flex;align-items:center;justify-content:space-between;">
      <span>🎉 ${goalYear}년 목표 완료! ${cy}년 새 목표를 설정해주세요.</span>
      <button onclick="openGoalModal()" style="font-size:.62rem;padding:.18rem .55rem;border:1px solid var(--acc);border-radius:8px;background:none;cursor:pointer;color:var(--acc);font-family:var(--ff);">설정</button>
    </div>`;
    return;
  }

  const items=[];
  if(goals.books>0){const pct=Math.min(Math.round(thisYear.length/goals.books*100),100);items.push({label:'완독',cur:thisYear.length,goal:goals.books,pct,unit:'권',color:'var(--sage)'});}
  if(goals.minutes>0){const pct=Math.min(Math.round(thisYearMins/goals.minutes*100),100);items.push({label:'독서 시간',cur:Math.floor(thisYearMins/60)+'h',goal:Math.floor(goals.minutes/60)+'h',pct,unit:'',color:'var(--slate)'});}
  if(goals.pages>0){const pct=Math.min(Math.round(thisYearPages/goals.pages*100),100);items.push({label:'페이지',cur:thisYearPages.toLocaleString(),goal:goals.pages.toLocaleString(),pct,unit:'p',color:'var(--mauve)'});}
  if(!items.length){
    wrap.style.cssText='padding:.5rem 1rem;';
    wrap.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;">
      <div style="font-size:.7rem;color:var(--tx3);">목표를 설정하면 진행률을 볼 수 있어요.</div>
      <button onclick="openGoalModal()" style="font-size:.62rem;padding:.18rem .6rem;border:1px solid var(--border2);border-radius:10px;background:none;cursor:pointer;color:var(--acc);font-family:var(--ff);white-space:nowrap;flex-shrink:0;">목표 설정</button>
    </div>`;
    return;
  }
  // 대표 목표 1개 (완독 우선)
  const main = items[0];
  const rest = items.slice(1);
  wrap.style.cssText = 'padding:.6rem .85rem .7rem;';
  wrap.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.55rem;">
      <div style="font-size:.58rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);">${cy} 목표</div>
      <button onclick="openGoalModal()" style="font-size:.62rem;padding:.15rem .55rem;border:1px solid var(--border2);border-radius:10px;background:none;cursor:pointer;color:var(--acc);font-family:var(--ff);">편집</button>
    </div>
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.5rem;">
      <div style="font-family:var(--fs);font-size:2rem;color:var(--tx1);line-height:1;letter-spacing:-.02em;">
        ${main.cur}<span style="font-size:1.1rem;color:var(--tx3);font-weight:300;"> / ${main.goal}${main.unit}</span>
      </div>
      <div style="font-family:var(--fs);font-size:.9rem;font-style:italic;color:${main.pct>=100?'var(--sage)':'var(--rust)'};">${main.pct>=100?'완료':main.pct+'%'}</div>
    </div>
    <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:${rest.length?'.55rem':'0'};">
      <div style="width:${main.pct}%;height:100%;background:${main.pct>=100?'var(--sage)':'var(--rust)'};border-radius:2px;transition:width .6s;"></div>
    </div>
    ${rest.map(it=>`
    <div style="display:flex;align-items:center;gap:.55rem;padding-top:.35rem;border-top:1px solid var(--border);">
      <div style="font-size:.62rem;color:var(--tx3);width:52px;flex-shrink:0;">${it.label}</div>
      <div style="flex:1;height:3px;background:var(--border);border-radius:2px;overflow:hidden;">
        <div style="width:${it.pct}%;height:100%;background:${it.pct>=100?'var(--sage)':it.color};border-radius:2px;"></div>
      </div>
      <div style="font-size:.6rem;color:var(--tx3);min-width:70px;text-align:right;font-family:var(--fs);font-style:italic;">${it.cur}/${it.goal}${it.unit} ${it.pct>=100?'✓':it.pct+'%'}</div>
    </div>`).join('')}`;
}

// ── 카테고리
function openCategories() {
  buildCatList();
  buildCatFilterList();
  openModal('modal-cat');
}
function buildCatList() {
  const wrap=document.getElementById('cat-list'); wrap.innerHTML='';
  if(!allCategories.length){wrap.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.3rem 0;">카테고리가 없어요.</div>';return;}
  allCategories.forEach((cat,i)=>{
    const cnt=allBooks.filter(b=>b.category===cat).length;
    const el=document.createElement('div');el.className='cat-item';
    el.innerHTML=`<span class="cat-item-name">${cat}</span><span class="cat-item-count">${cnt}권</span><button class="cat-item-del" onclick="deleteCategory(${i})">✕</button>`;
    wrap.appendChild(el);
  });
}
function buildCatFilterList() {
  const wrap=document.getElementById('cat-filter-list');wrap.innerHTML='';
  const allBtn=document.createElement('button');allBtn.className='cat-filter-btn'+(curCatFilter.size===0?' on':'');
  allBtn.textContent='전체 보기';allBtn.onclick=()=>{curCatFilter=new Set();document.querySelectorAll('.cat-filter-btn').forEach(b=>b.classList.remove('on'));allBtn.classList.add('on');buildBooks();};
  wrap.appendChild(allBtn);
  allCategories.forEach(cat=>{
    const btn=document.createElement('button');btn.className='cat-filter-btn'+(curCatFilter.has(cat)?' on':'');
    btn.textContent=`📁 ${cat}`;btn.onclick=()=>{
      if(curCatFilter.has(cat)) curCatFilter.delete(cat); else curCatFilter.add(cat);
      allBtn.classList.toggle('on', curCatFilter.size===0);
      btn.classList.toggle('on', curCatFilter.has(cat));
      buildBooks();
    };
    wrap.appendChild(btn);
  });
}
function addCategory() {
  const input=document.getElementById('new-cat-input');
  const name=input.value.trim();
  if(!name){alert('카테고리 이름을 입력해주세요.');return;}
  if(allCategories.includes(name)){alert('이미 있는 카테고리예요.');return;}
  allCategories.push(name);
  localStorage.setItem('bl_cats_'+currentUser.id,JSON.stringify(allCategories));
  sb.from('profiles').update({categories:allCategories}).eq('id',currentUser.id).then().catch(e=>console.warn('cats save:',e));
  input.value='';buildCatList();buildCatFilterList();
  updateBookCategorySelect();
}
async function deleteCategory(idx) {
  if(!await showConfirm(`'${allCategories[idx]}' 카테고리를 삭제할까요?`))return;
  allCategories.splice(idx,1);
  localStorage.setItem('bl_cats_'+currentUser.id,JSON.stringify(allCategories));
  sb.from('profiles').update({categories:allCategories}).eq('id',currentUser.id).then().catch(e=>console.warn('cats save:',e));
  buildCatList();buildCatFilterList();updateBookCategorySelect();
}
function updateBookCategorySelect() {
  const sel=document.getElementById('book-category');if(!sel)return;
  const cur=sel.value;sel.innerHTML='<option value="">선택 안함</option>';
  allCategories.forEach(cat=>{const o=document.createElement('option');o.value=cat;o.textContent=cat;sel.appendChild(o);});
  sel.value=cur;
}

// ── 책 추가/수정
function openAddBook() {
  editingBookId=null;selectedBook=null;curRating=0;curStatus='완독';
  setTimeout(()=>renderStars(0), 50);
  document.getElementById('modal-book-title').textContent='책 추가';
  document.getElementById('search-section').style.display='';
  document.getElementById('book-form').style.display='none';
  document.getElementById('search-results').innerHTML='';
  document.getElementById('book-search-input').value='';
  document.getElementById('book-review').value='';
  document.getElementById('book-review-shared').checked=false;
  const rsw=document.getElementById('review-share-wrap'); if(rsw) rsw.style.display='none';
  document.getElementById('book-genre').value='';
  document.getElementById('book-start').value='';
  document.getElementById('book-finish').value=new Date().toISOString().slice(0,10);
  document.getElementById('book-reread').checked=false;
  document.getElementById('book-pages').value='';
  document.getElementById('book-source').value='';
  document.getElementById('quotes-list').innerHTML='';
  updateStars(0);
  document.querySelectorAll('.status-btn').forEach(b=>b.classList.toggle('on',b.textContent==='완독'));
  updateBookCategorySelect();
  openModal('modal-book');
}
// 네이버 검색 결과를 UI에 렌더링
// 검색 결과 아이템 렌더링 (네이버/알라딘/Google Books 공통)
function _renderSearchItems(res, items) {
  items.forEach(item=>{
    const el=document.createElement('div');el.className='search-item';
    const raw = s => (s||'').replace(/<[^>]+>/g,'').trim();
    const cover = item.image||item.cover||item.volumeInfo?.imageLinks?.thumbnail?.replace('http:','https:') || '';
    const title = raw(item.title);
    const author = raw(item.author || (item.volumeInfo?.authors||[]).join(', '));
    const publisher = raw(item.publisher||item.volumeInfo?.publisher||'');
    const desc = raw(item.description||item.volumeInfo?.description||'');
    // 페이지 수: 알라딘 subInfo > 네이버 itemPage > Google Books pageCount > 설명 파싱
    let pages = null;
    const p1 = item.subInfo?.itemPage || item.itemPage || item.sub_info?.itemPage;
    if(p1 && parseInt(p1)>=10) pages = parseInt(p1);
    else if(item.volumeInfo?.pageCount >= 10) pages = item.volumeInfo.pageCount;
    else {
      const m = (item.description||'').match(/(\d{2,4})\s*(?:쪽|페이지|p\b)/i);
      if(m && parseInt(m[1])>=10) pages = parseInt(m[1]);
    }
    // ISBN13 추출
    const isbn = (item.isbn13||'').replace(/\s.*$/,'') ||
      item.isbn?.match(/97[89]\d{10}/)?.[0] ||
      item.volumeInfo?.industryIdentifiers?.find(x=>x.type==='ISBN_13')?.identifier || '';
    const pagesLabel = pages ? `<span style="font-size:.62rem;color:var(--acc);">${pages}p</span>` : '';
    const ebookBadge = item.isEbook ? `<span style="font-size:.55rem;color:var(--slate);border:1px solid var(--slate);border-radius:3px;padding:0 .25rem;margin-left:.3rem;line-height:1.4;">e북</span>` : '';
    const metaRow = (pagesLabel || ebookBadge) ? `<div style="display:flex;align-items:center;margin-top:.1rem;">${pagesLabel}${ebookBadge}</div>` : '';
    el.innerHTML=`${cover?`<img class="search-item-cover" src="${cover}" alt="">`:'<div class="search-item-cover"></div>'}<div class="search-item-info"><div class="search-item-title">${title}</div><div class="search-item-author">${author}</div><div class="search-item-pub">${publisher}</div>${metaRow}</div>`;
    el.onclick=()=>selectBook({title,author,publisher,cover,description:desc,isbn,pages});
    res.appendChild(el);
  });
}

// 네이버 + 알라딘 결과 병합: 알라딘 페이지 수로 네이버 항목 보충, 알라딘 단독 항목 추가
function _mergeSearchResults(naverItems, aladinItems) {
  if(!naverItems.length && !aladinItems.length) return [];
  if(!naverItems.length) return aladinItems;
  if(!aladinItems.length) return naverItems;
  const toIsbn = item => item.isbn13 || item.isbn?.match(/97[89]\d{10}/)?.[0] || '';
  const aladinByIsbn = new Map();
  aladinItems.forEach(ai => { const k = toIsbn(ai); if(k) aladinByIsbn.set(k, ai); });
  const naverIsbns = new Set();
  const merged = naverItems.map(ni => {
    const k = toIsbn(ni); if(k) naverIsbns.add(k);
    const ai = aladinByIsbn.get(k);
    if(ai && !ni.subInfo?.itemPage && !ni.itemPage) {
      return { ...ni, subInfo: ai.subInfo, itemPage: ai.itemPage };
    }
    return ni;
  });
  aladinItems.forEach(ai => {
    const k = toIsbn(ai);
    if(!k || !naverIsbns.has(k)) merged.push(ai);
  });
  return merged;
}

// 알라딘 아이템 배열을 공통 포맷으로 변환
function _aladinToItems(aladinData, isEbook = false) {
  return (aladinData?.item||[]).map(it=>({
    title: it.title||'',
    author: it.author||'',
    publisher: it.publisher||'',
    cover: it.cover||'',
    description: it.description||'',
    isbn: it.isbn13||it.isbn||'',
    isbn13: it.isbn13||'',
    subInfo: it.subInfo,
    itemPage: it.subInfo?.itemPage,
    isEbook: isEbook || it.categoryName?.includes('eBook') || it.mallType === 'ebook' || false
  }));
}

// Google Books API fallback 검색
async function _searchGoogleBooks(q) {
  try {
    const d = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=40&langRestrict=ko`).then(r=>r.json());
    if(!d.items?.length) return [];
    return d.items.map(it=>({
      title: it.volumeInfo?.title||'',
      author: (it.volumeInfo?.authors||[]).join(', '),
      publisher: it.volumeInfo?.publisher||'',
      image: it.volumeInfo?.imageLinks?.thumbnail?.replace('http:','https:')||'',
      description: it.volumeInfo?.description||'',
      isbn: it.volumeInfo?.industryIdentifiers?.find(x=>x.type==='ISBN_13')?.identifier||'',
      volumeInfo: it.volumeInfo
    }));
  } catch(e){ return []; }
}

async function searchBook() {
  const rawQ=document.getElementById('book-search-input').value.trim();if(!rawQ)return;
  const q = rawQ.replace(/[<>]/g,'').trim();
  const res=document.getElementById('search-results');
  res.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 중...</div>';
  const q2 = q.replace(/[(\[（【].*?[)\]）】]/g,'').replace(/\d+권|\d+편|\d+부/g,'').replace(/\s+/g,' ').trim();
  try {
    // 1단계: 네이버 + 알라딘(단행본+eBook) 병렬 검색
    const [naverResp, aladinResp, aladinEbResp] = await Promise.allSettled([
      fetch(`${NAVER_PROXY}?query=${encodeURIComponent(q)}&display=100`,{headers:{Authorization:`Bearer ${SUPABASE_KEY}`}}).then(r=>r.json()),
      fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(q)}`).then(r=>r.json()),
      fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(q)}&target=eBook`).then(r=>r.json())
    ]);
    res.innerHTML='';

    const naverItems    = naverResp.status==='fulfilled'    ? (naverResp.value?.items||[])          : [];
    const aladinItems   = aladinResp.status==='fulfilled'   ? _aladinToItems(aladinResp.value, false)  : [];
    const aladinEbItems = aladinEbResp.status==='fulfilled' ? _aladinToItems(aladinEbResp.value, true) : [];
    const allAladinItems = _mergeSearchResults(aladinItems, aladinEbItems);

    const merged = _mergeSearchResults(naverItems, allAladinItems);
    if(merged.length) { _renderSearchItems(res, merged); return; }

    // 2단계: 괄호·권수 제거 후 재시도
    if(q2 && q2 !== q) {
      const [n2, a2, ae2] = await Promise.allSettled([
        fetch(`${NAVER_PROXY}?query=${encodeURIComponent(q2)}&display=100`,{headers:{Authorization:`Bearer ${SUPABASE_KEY}`}}).then(r=>r.json()),
        fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(q2)}`).then(r=>r.json()),
        fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(q2)}&target=eBook`).then(r=>r.json())
      ]);
      const ni2  = n2.status==='fulfilled'  ? (n2.value?.items||[])             : [];
      const ai2  = a2.status==='fulfilled'  ? _aladinToItems(a2.value, false)    : [];
      const ae2i = ae2.status==='fulfilled' ? _aladinToItems(ae2.value, true)    : [];
      const merged2 = _mergeSearchResults(ni2, _mergeSearchResults(ai2, ae2i));
      if(merged2.length) { _renderSearchItems(res, merged2); return; }
    }

    // 3단계: 핵심 단어만
    const words = q.trim().split(/\s+/);
    if(words.length > 1) {
      const qCore = words.slice(0,2).join(' ');
      const [n3, a3, ae3] = await Promise.allSettled([
        fetch(`${NAVER_PROXY}?query=${encodeURIComponent(qCore)}&display=100`,{headers:{Authorization:`Bearer ${SUPABASE_KEY}`}}).then(r=>r.json()),
        fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(qCore)}`).then(r=>r.json()),
        fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(qCore)}&target=eBook`).then(r=>r.json())
      ]);
      const ni3  = n3.status==='fulfilled'  ? (n3.value?.items||[])             : [];
      const ai3  = a3.status==='fulfilled'  ? _aladinToItems(a3.value, false)    : [];
      const ae3i = ae3.status==='fulfilled' ? _aladinToItems(ae3.value, true)    : [];
      const merged3 = _mergeSearchResults(ni3, _mergeSearchResults(ai3, ae3i));
      if(merged3.length) { _renderSearchItems(res, merged3); return; }
    }

    // 4단계: Google Books fallback
    const gbItems = await _searchGoogleBooks(q);
    if(gbItems.length) { _renderSearchItems(res, gbItems); return; }
    const gbItems2 = await _searchGoogleBooks(q2||q);
    if(gbItems2.length) { _renderSearchItems(res, gbItems2); return; }

    res.innerHTML=`<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 결과가 없어요. 제목이나 저자명을 달리 입력하거나, 위 '직접 입력'을 이용해보세요.</div>`;
  } catch(e){res.innerHTML='<div style="font-size:.75rem;color:#c0392b;padding:.5rem;">검색 실패. 잠시 후 다시 시도해주세요.</div>';}
}

function showManualBookEntry() {
  const res = document.getElementById('search-results');
  res.innerHTML = `
    <div style="padding:.5rem;border:1px solid var(--border);border-radius:8px;background:var(--card);margin-top:.3rem;">
      <div style="font-size:.62rem;color:var(--tx3);margin-bottom:.5rem;">웹소설·직접 입력</div>
      <div style="display:flex;gap:.6rem;margin-bottom:.45rem;">
        <div id="manual-cover-preview"
          onclick="document.getElementById('manual-cover-input').click()"
          style="width:52px;height:70px;flex-shrink:0;border:1.5px dashed var(--border2);border-radius:5px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:var(--bg);overflow:hidden;">
          <span style="font-size:.95rem;">📷</span>
          <span style="font-size:.52rem;color:var(--tx3);text-align:center;line-height:1.2;">표지<br>추가</span>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:.35rem;">
          <input type="text" id="manual-book-title" placeholder="제목 (필수)" class="form-input" style="font-size:.78rem;margin-bottom:0;">
          <input type="text" id="manual-book-author" placeholder="저자 (선택)" class="form-input" style="font-size:.78rem;margin-bottom:0;">
        </div>
      </div>
      <input type="file" id="manual-cover-input" accept="image/*" style="display:none;" onchange="pickManualCover(this)">
      <div style="display:flex;gap:.4rem;">
        <button onclick="submitManualBook()" style="background:var(--acc);color:#fff;border:none;border-radius:8px;padding:.28rem .8rem;font-size:.72rem;cursor:pointer;font-family:var(--ff);line-height:1.2;">추가</button>
        <button onclick="document.getElementById('search-results').innerHTML=''" style="background:none;border:1px solid var(--border2);border-radius:8px;padding:.28rem .7rem;font-size:.72rem;cursor:pointer;font-family:var(--ff);color:var(--tx3);line-height:1.2;">취소</button>
      </div>
    </div>`;
  window._manualCoverB64 = '';
  setTimeout(() => document.getElementById('manual-book-title')?.focus(), 50);
}

function pickManualCover(input) {
  const file = input.files?.[0];
  if(!file) return;
  const preview = document.getElementById('manual-cover-preview');
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const W = 180, H = 240;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      // 비율 유지 center-crop
      const imgRatio = img.width / img.height;
      const tgtRatio = W / H;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if(imgRatio > tgtRatio) { sw = img.height * tgtRatio; sx = (img.width - sw) / 2; }
      else { sh = img.width / tgtRatio; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      const b64 = canvas.toDataURL('image/jpeg', 0.78);
      window._manualCoverB64 = b64;
      if(preview) {
        preview.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function submitManualBook() {
  const title = document.getElementById('manual-book-title')?.value.trim();
  if(!title) { alert('제목을 입력해주세요.'); return; }
  const author = document.getElementById('manual-book-author')?.value.trim() || '';
  const cover = window._manualCoverB64 || '';
  selectBook({ title, author, publisher: '', cover, description: '', isbn: '', pages: null });
}

// 알라딘 아이템 배열에서 페이지 수 추출
function _aladinItemPage(items) {
  for(const it of (items||[])) {
    const p = it.subInfo?.itemPage || it.itemPage;
    if(p && parseInt(p) >= 10) return parseInt(p);
  }
  return null;
}

// ISBN/제목으로 페이지 수 순차 조회 (알라딘 우선)
async function fetchPageCount(isbn, title, author) {
  const clean = isbn?.match(/97[89]\d{10}/)?.[0] || isbn?.trim().split(/[\s,]+/)[0] || isbn;

  // 1순위: 알라딘 ISBN 조회 (한국 도서 DB 최고 품질)
  if(clean) {
    try {
      const d = await fetch(`${ALADIN_PROXY}?isbn=${clean}`).then(r=>r.json());
      const pg = _aladinItemPage(d.item);
      if(pg) return pg;
    } catch(e){}
  }

  // 2순위: 알라딘 제목 검색
  if(title) {
    try {
      const d = await fetch(`${ALADIN_PROXY}?query=${encodeURIComponent(title)}`).then(r=>r.json());
      const pg = _aladinItemPage(d.item);
      if(pg) return pg;
    } catch(e){}
  }

  // 3순위: 네이버 ISBN 검색
  if(clean) {
    try {
      const d = await fetch(`${NAVER_PROXY}?query=${encodeURIComponent(clean)}&display=5`, {
        headers: {Authorization:`Bearer ${SUPABASE_KEY}`}
      }).then(r=>r.json());
      const it = (d.items||[])[0];
      if(it?.itemPage && parseInt(it.itemPage) >= 10) return parseInt(it.itemPage);
      if(it?.sub_info?.itemPage) return parseInt(it.sub_info.itemPage);
      const hay = [it?.description, it?.title].filter(Boolean).join(' ');
      const m = hay.match(/(\d{2,4})\s*(?:쪽|페이지|p\b)/i);
      if(m && parseInt(m[1]) >= 10) return parseInt(m[1]);
    } catch(e){}
  }

  // 4순위: Google Books ISBN
  if(clean) {
    try {
      const d = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`).then(r=>r.json());
      const pc = d.items?.[0]?.volumeInfo?.pageCount;
      if(pc && pc >= 10) return parseInt(pc);
    } catch(e){}
  }

  // 5순위: Google Books 제목+저자
  if(title) {
    try {
      const gq = `intitle:${encodeURIComponent(title)}${author?'+inauthor:'+encodeURIComponent(author.split(/\s/)[0]):''}`;
      const d = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${gq}&maxResults=5`).then(r=>r.json());
      for(const it of (d.items||[])) {
        const pc = it.volumeInfo?.pageCount;
        if(pc && pc >= 10) return parseInt(pc);
      }
    } catch(e){}
  }

  // 6순위: Open Library ISBN
  if(clean) {
    try {
      const d = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`).then(r=>r.json());
      const pg = d[`ISBN:${clean}`]?.number_of_pages;
      if(pg && pg >= 10) return parseInt(pg);
    } catch(e){}
    try {
      const d = await fetch(`https://openlibrary.org/isbn/${clean}.json`).then(r=>r.json());
      if(d?.number_of_pages >= 10) return parseInt(d.number_of_pages);
    } catch(e){}
  }
  return null;
}
function selectBook(book) {
  selectedBook=book;
  document.getElementById('search-section').style.display='none';
  document.getElementById('book-form').style.display='';
  const coverHTML=book.cover?`<img class="selected-cover" src="${book.cover}" alt="${book.title}">`:`<div class="selected-cover" style="background:linear-gradient(150deg,#a07040,#5c3010);"></div>`;
  const pagesInfo = book.pages ? `<span style="font-size:.65rem;color:var(--acc);margin-left:.3rem;">${book.pages}p</span>` : '';
  document.getElementById('selected-book-info').innerHTML=`${coverHTML}<div class="selected-info"><div class="selected-title">${book.title}${pagesInfo}</div><div class="selected-author">${book.author}</div><div class="selected-desc">${book.description||''}</div><span class="selected-change" onclick="changeBook()">다른 책 선택</span></div>`;
  // 페이지 수 채우기
  const pagesEl = document.getElementById('book-pages');
  if(pagesEl) {
    if(book.pages) {
      pagesEl.value = book.pages;
    } else {
      pagesEl.value = '';
      pagesEl.placeholder = '검색 중...';
      fetchPageCount(book.isbn, book.title, book.author).then(pg => {
        const pe = document.getElementById('book-pages');
        if(!pe) return;
        if(pg && !pe.value) {
          pe.value = pg;
          if(selectedBook) selectedBook.pages = pg;
          const titleEl = document.querySelector('.selected-title');
          if(titleEl && !titleEl.querySelector('span')) {
            titleEl.insertAdjacentHTML('beforeend',`<span style="font-size:.65rem;color:var(--acc);margin-left:.3rem;">${pg}p</span>`);
          }
        }
        pe.placeholder = '예: 320';
      });
    }
  }
}
function changeBook() {
  selectedBook=null;document.getElementById('search-section').style.display='';
  document.getElementById('book-form').style.display='none';document.getElementById('search-results').innerHTML='';document.getElementById('book-search-input').value='';
}
function setStar(n) {
  curRating = n;
  renderStars(n);
}
function renderStars(rating) {
  const wrap = document.querySelector('.star-input');
  if(!wrap) return;
  wrap.innerHTML = '';
  for(let i=1; i<=5; i++) {
    const full = document.createElement('span');
    full.className = 'star' + (rating >= i ? ' on' : rating >= i-0.5 ? ' half' : '');
    full.style.cssText = 'position:relative;cursor:pointer;font-size:1.4rem;';
    // 왼쪽 절반 클릭 = i-0.5, 오른쪽 절반 클릭 = i
    full.innerHTML = `
      <span style="position:absolute;left:0;top:0;width:50%;height:100%;z-index:2;" onclick="setStar(${i-0.5})"></span>
      <span style="position:absolute;right:0;top:0;width:50%;height:100%;z-index:2;" onclick="setStar(${i})"></span>
      ${rating >= i ? '★' : rating >= i-0.5 ? '★' : '☆'}`;
    wrap.appendChild(full);
  }
  // 현재 점수 표시
  let label = wrap.nextElementSibling;
  if(!label || !label.classList.contains('star-label')) {
    label = document.createElement('span');
    label.className = 'star-label';
    label.style.cssText = 'font-size:.68rem;color:var(--tx3);margin-left:.3rem;';
    wrap.after(label);
  }
  label.textContent = rating > 0 ? `${rating}점` : '';
}
function updateStars(n) { renderStars(n); }
function setStatus(s,btn){
  curStatus=s;
  document.querySelectorAll('.status-btn').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
}
function addQuoteField(text='',page='',comment='') {
  const list=document.getElementById('quotes-list');
  const el=document.createElement('div');
  el.className='quote-field';
  el.style.cssText='background:#faf6ef;border:1px solid var(--border);border-radius:8px;padding:.6rem .7rem;margin-bottom:.4rem;position:relative;';
  const qid = 'qe-'+Date.now()+Math.random().toString(36).slice(2,6);
  el.innerHTML=`
    <button onclick="this.parentElement.remove()" style="position:absolute;top:.45rem;right:.5rem;background:none;border:none;font-size:.75rem;color:var(--tx3);cursor:pointer;line-height:1;z-index:2;">✕</button>
    <!-- 에디터 툴바 -->
    <div class="qeditor-toolbar" data-for="${qid}" onmousedown="event.preventDefault()">
      <button type="button" title="굵게" onmousedown="event.preventDefault()" onclick="qfmt('bold')"><b>B</b></button>
      <button type="button" title="기울임" onmousedown="event.preventDefault()" onclick="qfmt('italic')"><i>I</i></button>
      <button type="button" title="밑줄" onmousedown="event.preventDefault()" onclick="qfmt('underline')"><u>U</u></button>
      <span class="qeditor-sep"></span>
      <button type="button" title="작게" onmousedown="event.preventDefault()" onclick="qfmtSize('small')">A<sub>↓</sub></button>
      <button type="button" title="크게" onmousedown="event.preventDefault()" onclick="qfmtSize('large')">A<sup>↑</sup></button>
      <span class="qeditor-sep"></span>
      <button type="button" title="형광펜 (노랑)" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5e27a')" style="background:#f5e27a;width:18px;height:14px;border-radius:3px;border:1px solid #e0c840;"></button>
      <button type="button" title="형광펜 (민트)" onmousedown="event.preventDefault()" onclick="qfmtHL('#b8e8d4')" style="background:#b8e8d4;width:18px;height:14px;border-radius:3px;border:1px solid #7acaaa;"></button>
      <button type="button" title="형광펜 (살구)" onmousedown="event.preventDefault()" onclick="qfmtHL('#f5c4a0')" style="background:#f5c4a0;width:18px;height:14px;border-radius:3px;border:1px solid #d8906a;"></button>
      <button type="button" title="형광펜 해제" onmousedown="event.preventDefault()" onclick="qfmtHL('transparent')" style="font-size:.55rem;color:var(--tx3);padding:0 4px;">✕HL</button>
      <span class="qeditor-sep"></span>
      <button type="button" title="서식 초기화" onmousedown="event.preventDefault()" onclick="qfmt('removeFormat')" style="font-size:.6rem;color:var(--tx3);">초기화</button>
      <span class="qeditor-sep"></span>
      <button type="button" title="사진에서 텍스트 추출" onmousedown="event.preventDefault()" onclick="openImageOCR('${qid}')" style="font-size:.75rem;">📷</button>
    </div>
    <!-- contenteditable 에디터 -->
    <div id="${qid}" class="qeditor-body" contenteditable="true" data-qtext
      data-placeholder="인상 깊은 문장이나 문단을 입력해주세요...">${text ? (/<[a-z]/i.test(text) ? text.replace(/<div><br\s*\/?><\/div>/gi,'<br>').replace(/<\/div>\s*<div>/gi,'<br>').replace(/<div>/gi,'').replace(/<\/div>/gi,'<br>').replace(/<p>/gi,'').replace(/<\/p>/gi,'<br>').replace(/\n/g,'<br>') : text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')) : ''}</div>
    <div style="display:flex;gap:.35rem;margin-top:.4rem;">
      <input type="text" class="form-input" placeholder="💬 코멘트" data-qtag value="${comment}" style="flex:1;font-size:.72rem;background:#fff;border-radius:5px;">
      <input type="text" class="form-input" placeholder="p.42" data-qpage value="${page}" style="width:58px;font-size:.72rem;background:#fff;border-radius:5px;text-align:center;">
    </div>`;
  list.appendChild(el);
  // 붙여넣기 시 서식 제거 (순수 텍스트로)
  const editorEl = el.querySelector('.qeditor-body');
  if(editorEl) {
    editorEl.addEventListener('paste', e => {
      e.preventDefault();
      const plain = (e.clipboardData||window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, plain);
    });
  }
}


// ── 이미지에서 텍스트 추출
async function openImageOCR(targetEditorId) {
  // 카메라/갤러리 선택 모달
  const choiceOv = document.createElement('div');
  choiceOv.className = 'modal-overlay';
  choiceOv.style.display = 'flex';
  choiceOv.innerHTML = `
    <div class="modal" style="max-width:280px;padding:1.1rem;text-align:center;">
      <div style="font-size:.85rem;font-weight:600;color:var(--tx1);margin-bottom:.8rem;">📷 이미지 불러오기</div>
      <div style="display:flex;flex-direction:column;gap:.4rem;">
        <button id="ocr-camera-btn" class="btn-save" style="font-size:.8rem;">📸 카메라로 촬영</button>
        <button id="ocr-gallery-btn" class="btn-cancel" style="font-size:.8rem;">🖼️ 갤러리에서 선택</button>
        <button onclick="this.closest('.modal-overlay').remove()" style="font-size:.72rem;color:var(--tx3);background:none;border:none;cursor:pointer;margin-top:.2rem;">취소</button>
      </div>
    </div>`;
  document.body.appendChild(choiceOv);

  const runOcr = (capture) => {
    choiceOv.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if(capture) input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files?.[0];
      if(!file) return;
      const loadOv = document.createElement('div');
      loadOv.className = 'modal-overlay';
      loadOv.style.display = 'flex';
      loadOv.innerHTML = `<div class="modal" style="max-width:260px;padding:1.2rem;text-align:center;">
        <div style="font-size:1.6rem;margin-bottom:.5rem;">🔍</div>
        <div style="font-size:.82rem;font-weight:600;color:var(--tx1);margin-bottom:.25rem;">텍스트 추출 중...</div>
        <div style="font-size:.68rem;color:var(--tx3);">잠시만 기다려주세요</div>
      </div>`;
      document.body.appendChild(loadOv);
      try {
        // 이미지 리사이즈 (큰 이미지 최적화)
        const resized = await new Promise((res) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const max = 1600;
            let w = img.width, h = img.height;
            if(w > max || h > max) { if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;} }
            const canvas = document.createElement('canvas');
            canvas.width=w; canvas.height=h;
            canvas.getContext('2d').drawImage(img,0,0,w,h);
            URL.revokeObjectURL(url);
            res(canvas.toDataURL('image/jpeg',0.85).split(',')[1]);
          };
          img.src = url;
        });

        // Vercel API Route로 Google Vision 호출
        let extracted = '';
        try {
          const resp = await fetch('/api/vision-ocr', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({image: resized})
          });
          if(resp.ok) {
            const data = await resp.json();
            if(data.error) throw new Error(data.error);
            extracted = (data.text||'').trim();
          } else {
            const err = await resp.json().catch(()=>({error:'서버 오류'}));
            throw new Error(err.error||'OCR 오류 '+resp.status);
          }
        } catch(e) {
          loadOv.remove();
          await showAlert('OCR 오류: '+e.message);
          return;
        }

        loadOv.remove();
        if(!extracted) { await showAlert('텍스트를 찾지 못했어요.\n더 선명하거나 텍스트가 잘 보이는 이미지를 사용해주세요.'); return; }
        const editor = document.getElementById(targetEditorId);
        if(editor && editor.isContentEditable) {
          editor.focus();
          const ins = extracted.replace(/\n/g,'<br>');
          if(editor.innerHTML.trim() && editor.innerHTML !== '<br>') {
            document.execCommand('insertHTML', false, '<br><br>'+ins);
          } else { editor.innerHTML = ins; }
        }
      } catch(e) {
        loadOv.remove();
        await showAlert('오류: '+e.message);
      }
    };
    input.click();
  };

  choiceOv.querySelector('#ocr-camera-btn').onclick = () => runOcr(true);
  choiceOv.querySelector('#ocr-gallery-btn').onclick = () => runOcr(false);
  let mdT = null;
  choiceOv.addEventListener('mousedown', e => { mdT = e.target; });
  choiceOv.addEventListener('click', e => { if(e.target===choiceOv && mdT===choiceOv) choiceOv.remove(); });
}

function qfmt(cmd) {
  document.execCommand(cmd, false, null);
}
function qfmtSize(size) {
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const tag = size==='large' ? 'big' : 'small';
  document.execCommand('insertHTML', false, `<${tag}>${sel.toString()}</${tag}>`);
}
function qfmtHL(color) {
  if(color==='transparent') { document.execCommand('removeFormat', false, null); return; }
  document.execCommand('hiliteColor', false, color);
}
async function saveBook() {
  localStorage.setItem('bl_edit_count', String((parseInt(localStorage.getItem('bl_edit_count')||'0')+1)));
  if(!selectedBook&&!editingBookId){alert('책을 검색해서 선택해주세요.');return;}
  const genre=document.getElementById('book-genre').value,review=document.getElementById('book-review').value.trim();
  const dateStart=document.getElementById('book-start').value,dateFinish=document.getElementById('book-finish').value;
  const reread=document.getElementById('book-reread').checked,pages=parseInt(document.getElementById('book-pages').value)||null;
  const source=document.getElementById('book-source').value,category=document.getElementById('book-category').value;
  const qf=document.getElementById('quotes-list')?.querySelectorAll('.quote-field')||[];
  const newQuotes=[...qf].map(f=>{
    const ed = f.querySelector('[data-qtext]');
    const raw = ed.isContentEditable ? ed.innerHTML : ed.value;
    const cleaned = ed.isContentEditable ? cleanEditorHtml(raw) : raw.trim();
    return {text: cleaned, tag:f.querySelector('[data-qtag]').value.trim(), page:f.querySelector('[data-qpage]').value.trim()};
  }).filter(q=>q.text);
  const existing=editingBookId?allBooks.find(b=>b.id===editingBookId):null;
  if(existing?.rating && existing.rating <= 2 && curRating && curRating >= 4) localStorage.setItem('bl_rating_revised_up', '1');
  const reviewShared=document.getElementById('book-review-shared')?.checked||false;
  const bookData={user_id:currentUser.id,title:selectedBook?.title||existing?.title||'',author:selectedBook?.author||existing?.author||'',publisher:selectedBook?.publisher||existing?.publisher||'',cover:selectedBook?.cover||existing?.cover||'',description:selectedBook?.description||existing?.description||'',isbn:selectedBook?.isbn||existing?.isbn||'',genre:genre?[genre]:[],rating:curRating||null,status:curStatus,date_start:dateStart||null,date_finish:dateFinish||null,review,reread,pages,source:source||null,category:category||null,review_shared:review?reviewShared:false};
  try {
    let bookId=editingBookId;
    if(editingBookId){const{error}=await sb.from('books').update(bookData).eq('id',editingBookId);if(error)throw error;await sb.from('quotes').delete().eq('book_id',editingBookId);}
    else{const{data,error}=await sb.from('books').insert(bookData).select().single();if(error)throw error;bookId=data?.id;}
    if(bookId&&newQuotes.length){const{error:qErr}=await sb.from('quotes').insert(newQuotes.map(q=>({...q,user_id:currentUser.id,book_id:bookId})));if(qErr)throw qErr;}
    closeModal('modal-book');await loadData();buildBooks();if(document.getElementById('q-feed'))renderQuotes();
  } catch(e){alert('저장 중 오류: '+(e.message||JSON.stringify(e)));}
}

// ── 책 상세
function openDetail(bookId) {
  curBookId=bookId;
  const b=allBooks.find(b=>b.id===bookId);if(!b)return;
  const quotes=allQuotes.filter(q=>q.book_id===bookId);
  const genre=Array.isArray(b.genre)?b.genre.join(', '):(b.genre||'');
  const starStr=r=>{let s='';for(let i=1;i<=5;i++)s+=r>=i?'★':r>=i-.5?'<span class="gi-hstar">★</span>':'☆';return s;};
  const pct=b.pages&&b.current_page?Math.min(100,Math.round(b.current_page/b.pages*100)):0;
  const statusColor={완독:'#2e7d32',읽는중:'#1565c0',읽고싶음:'#7b1fa2',중단:'#c62828'}[b.status]||'var(--tx3)';
  const statusBg={완독:'#e8f5e9',읽는중:'#e3f2fd',읽고싶음:'#f3e5f5',중단:'#ffebee'}[b.status]||'#f5f5f5';
  // BOOK NO.
  const sortedAll=[...allBooks].sort((a,c)=>new Date(a.created_at||0)-new Date(c.created_at||0));
  const bookNo=String(sortedAll.findIndex(x=>x.id===bookId)+1).padStart(3,'0');

  let html=`
  <div style="font-size:.48rem;letter-spacing:.22em;text-transform:uppercase;color:var(--tx3);margin-bottom:.35rem;">BOOK NO. ${bookNo}</div>
  <div style="font-family:var(--ff-disp);font-size:1.3rem;font-style:italic;color:var(--tx1);line-height:1.2;margin-bottom:.2rem;letter-spacing:-.01em;">${b.title||''}</div>
  ${b.author?`<div style="font-size:.6rem;color:var(--tx3);letter-spacing:.04em;margin-bottom:.65rem;">${b.author}${b.publisher?' · '+b.publisher:''}</div>`:'<div style="margin-bottom:.65rem;"></div>'}
  <div style="display:flex;gap:.8rem;margin-bottom:.75rem;padding-bottom:.75rem;border-bottom:1px solid var(--border);">
    ${b.cover?`<img src="${b.cover}" alt="" style="width:68px;height:102px;object-fit:cover;border-radius:3px;flex-shrink:0;box-shadow:0 3px 10px rgba(0,0,0,.14);">`:`<div style="width:68px;height:102px;background:var(--bg);border:1px solid var(--border);border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.5rem;color:var(--tx3);">표지</div>`}
    <div style="flex:1;min-width:0;">
      ${b.rating?`<div style="display:flex;align-items:baseline;gap:.28rem;margin-bottom:.45rem;"><span style="font-size:.82rem;color:#c8a050;letter-spacing:.02em;">${starStr(b.rating)}</span><span style="font-family:var(--ff-disp);font-style:italic;font-size:.78rem;color:var(--tx2);">${b.rating}</span></div>`:''}
      <div style="display:flex;flex-wrap:wrap;gap:.22rem;align-items:center;">
        ${b.status?`<span style="font-size:.57rem;font-weight:600;padding:.18rem .48rem;border-radius:9px;background:${statusBg};color:${statusColor};display:inline-flex;align-items:center;line-height:1;">${b.status}</span>`:''}
        ${genre?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">${genre}</span>`:''}
        ${b.pages?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">${b.pages}p</span>`:''}
        ${b.date_start?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">${b.date_start}</span>`:''}
        ${b.date_finish?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">${b.date_finish}</span>`:''}
        ${b.reading_time?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">⏱ ${Math.floor(b.reading_time/60)}h ${b.reading_time%60}m</span>`:''}
        ${b.source?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">${b.source}</span>`:''}
        ${b.reread?`<span style="font-size:.57rem;padding:.18rem .42rem;border-radius:9px;background:var(--bg);color:var(--tx2);border:1px solid var(--border);display:inline-flex;align-items:center;line-height:1;">🔁 재독</span>`:''}
      </div>
      ${b.status==='읽는중'&&pct?`<div style="margin-top:.55rem;"><div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--acc);border-radius:2px;"></div></div><div style="font-size:.52rem;color:var(--tx3);margin-top:.12rem;">${b.current_page}p / ${b.pages}p · ${pct}%</div></div>`:''}
    </div>
  </div>`;

  // 줄거리
  const MAX_DESC=150;
  if(b.description){
    html+=`<div style="margin-bottom:.7rem;padding-bottom:.7rem;border-bottom:1px solid var(--border);">
      <div style="font-size:.46rem;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);margin-bottom:.32rem;">줄거리</div>
      <div style="font-size:.7rem;color:var(--tx2);line-height:1.72;">
        ${b.description.length>MAX_DESC?`<span class="desc-short">${b.description.slice(0,MAX_DESC)}...</span><span class="desc-full" style="display:none;">${b.description}</span><span class="desc-toggle" onclick="toggleDesc(this)" style="cursor:pointer;color:var(--acc);font-size:.62rem;margin-left:.22rem;">더 보기</span>`:b.description}
      </div>
    </div>`;
  }

  // 감상 (내 감상 + 다른 산책자 통합)
  if(b.review || b.isbn){
    html+=`<div id="reviews-section" style="margin-bottom:.7rem;padding-bottom:.7rem;border-bottom:1px solid var(--border);">
      <div style="font-size:.46rem;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);margin-bottom:.5rem;">감상</div>`;
    if(b.review){
      const rv=b.review.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const MAX_REVIEW=120;
      html+=`<div style="margin-bottom:.45rem;">
        <span style="display:inline-block;font-size:.52rem;font-weight:600;padding:.08rem .38rem;border-radius:4px;background:var(--acc);color:#fff;letter-spacing:.02em;margin-bottom:.28rem;">내 감상</span>
        <div style="font-size:.7rem;color:var(--tx2);line-height:1.72;">
          ${b.review.length>MAX_REVIEW?`<span class="review-short">${b.review.slice(0,MAX_REVIEW).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}...</span><span class="review-full" style="display:none;">${rv}</span><span class="desc-toggle" onclick="this.previousElementSibling.style.display='inline';this.previousElementSibling.previousElementSibling.style.display='none';this.style.display='none';" style="cursor:pointer;color:var(--acc);font-size:.62rem;margin-left:.22rem;">더 보기</span>`:rv}
        </div>
      </div>`;
    }
    html+=`<div id="shared-reviews-inner"></div></div>`;
  }

  // 독서 진행 (읽는중)
  if(b.status==='읽는중'){
    const cp=b.current_page||0,tp=b.pages||0;
    const pct2=tp&&cp?Math.min(100,Math.round(cp/tp*100)):0;
    html+=`<div style="margin-bottom:.7rem;padding-bottom:.7rem;border-bottom:1px solid var(--border);">
      <div style="font-size:.46rem;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);margin-bottom:.38rem;">독서 진행</div>
      <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;">
        <input type="number" id="current-page-input" value="${b.current_page||''}" min="1" max="${b.pages||9999}" placeholder="현재 쪽" style="width:68px;padding:.28rem .4rem;border:1px solid var(--border2);border-radius:5px;font-size:.76rem;font-family:var(--ff);text-align:center;">
        ${tp?`<span style="font-size:.62rem;color:var(--tx3);">/ ${tp}p</span>`:''}
        <button onclick="saveReadingProgress('${b.id}')" style="background:var(--acc);color:#fff;border:none;border-radius:7px;padding:.26rem .6rem;font-size:.68rem;line-height:1.2;cursor:pointer;font-family:var(--ff);">저장</button>
      </div>
      ${tp&&cp?`<div style="margin-top:.4rem;"><div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="width:${pct2}%;height:100%;background:var(--acc);border-radius:2px;transition:width .3s;"></div></div><div style="font-size:.51rem;color:var(--tx3);margin-top:.1rem;">${cp}p · ${pct2}% · ${tp-cp}p 남음</div></div>`:''}
    </div>`;
  }

  // 밑줄 · UNDERLINES
  const QCOLORS=['#c4714a','#7a9e7e','#5a8a8a','#c8a87a','#9a7090','#8a8aaa','#b06040'];
  html+=`<div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
      <div style="font-size:.46rem;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);">밑줄 · UNDERLINES</div>
      <button onclick="openAddQuoteFromDetail('${b.id}')" style="font-size:.68rem;padding:.2rem .5rem;border:1px solid var(--acc);border-radius:7px;background:none;color:var(--acc);cursor:pointer;font-family:var(--ff);line-height:1.2;">＋ 추가</button>
    </div>`;
  quotes.forEach((q,i)=>{
    const color=QCOLORS[i%QCOLORS.length];
    const hasHtml=/<[a-z]/i.test(q.text||'');
    let txt=q.text||'';
    if(hasHtml){txt=txt.replace(/<div><br\s*\/?><\/div>/gi,'<br>').replace(/<\/div>\s*<div>/gi,'<br>').replace(/<div>/gi,'<br>').replace(/<\/div>/gi,'').replace(/<p>/gi,'').replace(/<\/p>/gi,'<br>').replace(/\n/g,'<br>').replace(/(<br\s*\/?>[\s]*){3,}/gi,'<br><br>').replace(/^(<br\s*\/?>\s*)+/,'').replace(/(<br\s*\/?>\s*)+$/,'');}
    else{txt=txt.replace(/&(?!amp;|lt;|gt;)/g,'&amp;').replace(/\n/g,'<br>');}
    const qp=q.page&&String(q.page)!=='null'?q.page:null;
    const qt_=q.tag&&String(q.tag)!=='null'?q.tag:null;
    html+=`<div onclick="openEditQuote(${JSON.stringify(q).replace(/"/g,'&quot;')})" style="border-left:3px solid ${color};padding:.38rem 0 .48rem .65rem;margin-bottom:.38rem;cursor:pointer;position:relative;" onmouseenter="this.querySelector('.q-eh').style.opacity='1'" onmouseleave="this.querySelector('.q-eh').style.opacity='0'">
      <span class="q-eh" style="position:absolute;top:.3rem;right:0;font-size:.52rem;color:var(--tx3);opacity:0;transition:opacity .13s;">✏️</span>
      <div style="font-size:.7rem;font-family:var(--ff-disp);font-style:normal;line-height:1.78;color:var(--tx1);padding-right:1rem;">${txt}</div>
      ${(qp||qt_)?`<div style="display:flex;gap:.22rem;margin-top:.28rem;flex-wrap:wrap;">${qp?`<span style="font-size:.53rem;color:var(--tx3);">p.${qp}</span>`:''}${qt_?`<span style="font-size:.53rem;color:var(--acc2);">#${qt_}</span>`:''}</div>`:''}
    </div>`;
  });
  if(!quotes.length) html+=`<div style="font-size:.68rem;color:var(--tx3);text-align:center;padding:.65rem 0;font-style:italic;">아직 수집된 문장이 없어요.</div>`;
  html+='</div>';

  document.getElementById('detail-body').innerHTML=html;
  openModal('modal-detail');

  // 비동기로 공유 감상 로드
  if(b.isbn) loadSharedReviews(b.isbn, b.id, !!b.review);
}

async function loadSharedReviews(isbn, currentBookId, hasMyReview) {
  const inner = document.getElementById('shared-reviews-inner');
  if(!inner) return;
  try {
    const { data } = await sb.from('books')
      .select('review, user_id, profiles(display_name, username)')
      .eq('isbn', isbn)
      .eq('review_shared', true)
      .neq('user_id', currentUser.id)
      .not('review', 'is', null)
      .limit(10);
    const reviews = (data||[]).filter(r=>r.review?.trim());
    if(!reviews.length) {
      inner.innerHTML=`<div style="margin-top:${hasMyReview?'.45rem':'0'};padding-top:${hasMyReview?'.45rem;border-top:1px solid var(--border)':'0'}">
        <div style="font-size:.68rem;color:var(--tx3);line-height:1.7;font-style:italic;text-align:center;padding:.4rem 0;">아무도 감상을 적지 않았어요.<br>감상을 공유하는 첫 산책자가 되어보세요.</div>
      </div>`;
      return;
    }
    const cards = reviews.map(r=>{
      const name = r.profiles?.display_name || r.profiles?.username || '산책자';
      const rv = r.review.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return `<div style="background:#faf6ef;border:1px solid var(--border);border-radius:8px;padding:.6rem .72rem;">
        <div style="font-size:.55rem;font-weight:600;color:var(--tx3);letter-spacing:.03em;margin-bottom:.25rem;">${name}</div>
        <div style="font-size:.7rem;color:var(--tx2);line-height:1.75;font-family:var(--ff-disp);font-style:italic;">${rv}</div>
      </div>`;
    }).join('');
    inner.innerHTML=`<div style="margin-top:${hasMyReview?'.45rem':'0'};${hasMyReview?'padding-top:.45rem;border-top:1px solid var(--border);':''}display:flex;flex-direction:column;gap:.4rem;">${cards}</div>`;
  } catch(_) {}
}

async function saveReadingProgress(bookId, showOnly=false) {
  const showChk = document.getElementById('show-progress-chk');
  const showProgress = showChk ? showChk.checked : true;
  let updateData = { show_progress: showProgress };
  if(!showOnly) {
    const pageInput = document.getElementById('current-page-input');
    const currentPage = parseInt(pageInput?.value) || null;
    const book = allBooks.find(b=>b.id===bookId);
    // 페이지 수 초과 체크
    if(currentPage && book?.pages && currentPage > book.pages) {
      alert(`총 ${book.pages}p를 초과할 수 없어요.`); return;
    }
    updateData.current_page = currentPage;
  }
  try {
    const { error } = await sb.from('books').update(updateData).eq('id', bookId);
    if(error) throw error;
    await loadData();
    if(!showOnly) {
      // 저장 완료 표시
      const btn = document.querySelector('[onclick*="saveReadingProgress"]');
      if(btn) { const orig=btn.textContent; btn.textContent='✓ 저장됨'; setTimeout(()=>btn.textContent=orig,1500); }
    }
    // 칩 업데이트 (모달 열린 채로)
    openDetail(bookId);
  } catch(e) { alert('저장 오류: '+e.message); }
}

function toggleReviewShareWrap() {
  const wrap = document.getElementById('review-share-wrap');
  const ta = document.getElementById('book-review');
  if(wrap && ta) wrap.style.display = ta.value.trim() ? 'flex' : 'none';
}

function toggleDesc(el) {
  const p=el.parentElement;
  const short=p.querySelector('.desc-short'),full=p.querySelector('.desc-full');
  if(full.style.display==='none'){short.style.display='none';full.style.display='';el.textContent='접기';}
  else{short.style.display='';full.style.display='none';el.textContent='더 보기';}
}
async function deleteBook() {
  const id = curBookId;
  if(!id){alert('삭제할 책을 찾을 수 없어요.');return;}
  if(!confirm('이 책 기록을 삭제할까요?'))return;
  try{
    await sb.from('quotes').delete().eq('book_id',id);
    const{error}=await sb.from('books').delete().eq('id',id);
    if(error)throw error;
    curBookId=null;
    closeModal('modal-detail');
    await loadData();buildBooks();if(document.getElementById('q-feed'))renderQuotes();
  }catch(e){alert('삭제 오류: '+(e.message||'알 수 없는 오류'));}
}
function editBook() {
  const id = curBookId;
  const b = allBooks.find(b=>b.id===id);
  if(!b){alert('수정할 책을 찾을 수 없어요.');return;}
  editingBookId = id;
  selectedBook = {title:b.title,author:b.author,publisher:b.publisher,cover:b.cover,description:b.description,isbn:b.isbn};
  closeModal('modal-detail');
  setTimeout(()=>{
    document.getElementById('modal-book-title').textContent='책 수정';
    document.getElementById('search-section').style.display='none';
    document.getElementById('book-form').style.display='';
    selectBook(selectedBook);
    curRating=b.rating||0; curStatus=b.status||'완독'; setTimeout(()=>renderStars(curRating),50);
    document.querySelectorAll('.status-btn').forEach(btn=>btn.classList.toggle('on',btn.textContent===curStatus));
    document.getElementById('book-genre').value=Array.isArray(b.genre)?b.genre[0]:(b.genre||'');
    document.getElementById('book-review').value=b.review||'';
    const rsw=document.getElementById('review-share-wrap');
    if(rsw){ rsw.style.display=b.review?'flex':'none'; }
    const rsc=document.getElementById('book-review-shared');
    if(rsc) rsc.checked=b.review_shared||false;
    document.getElementById('book-start').value=b.date_start||'';
    document.getElementById('book-finish').value=b.date_finish||'';
    document.getElementById('book-reread').checked=b.reread||false;
    document.getElementById('book-pages').value=b.pages||'';
    document.getElementById('book-source').value=b.source||'';
    updateBookCategorySelect();
    document.getElementById('book-category').value=b.category||'';
    const list=document.getElementById('quotes-list'); list.innerHTML='';
    allQuotes.filter(q=>q.book_id===b.id).forEach(q=>addQuoteField(q.text,q.page,q.tag));
    openModal('modal-book');
  },150);
}

// ── 프로필 사진
let _pendingAvatarBlob = null;
let _avatarPickerActive = false; // 파일 선택기 열려있는 동안 모달 닫힘 방지

// 아바타 파일 선택기 열기 (flag 설정 후 input 클릭)
function triggerAvatarPicker() {
  _avatarPickerActive = true;
  document.getElementById('avatar-file-input').click();
}

function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const SIZE = 96; // 96×96px — base64 약 5~8KB
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('압축 실패')), 'image/jpeg', 0.72);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function previewAvatar(input) {
  _avatarPickerActive = false; // 파일 선택기 닫힘
  if(!input.files?.[0]) return;
  const hint = document.getElementById('avatar-hint');
  if(hint) hint.textContent = '처리 중...';
  compressAvatar(input.files[0]).then(blob => {
    _pendingAvatarBlob = blob;
    const url = URL.createObjectURL(blob);
    applyAvatarToEl(document.getElementById('profile-avatar'), url);
    if(hint) hint.textContent = '✅ 저장 버튼을 눌러 적용하세요';
  }).catch(() => {
    _avatarPickerActive = false;
    if(hint) hint.textContent = '이미지 처리 실패. 다시 시도해주세요.';
  });
  input.value = '';
}

function applyAvatarToEl(el, src) {
  if(!el) return;
  if(src) {
    el.style.backgroundImage = `url('${src.replace(/'/g,'%27')}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
  }
}

// ⭐ 수정 및 보강된 프로필 저장 함수
async function doSaveAvatar(blob) {
  if(!blob || !currentUser) throw new Error('저장할 이미지가 없어요.');
  const hint = document.getElementById('avatar-hint');
  let avatarUrl = null;

  // 1차: Supabase Storage 업로드 — userId/userId.jpg 폴더 구조 (RLS 정책 호환)
  try {
    if(hint) hint.textContent = 'Storage 업로드 중...';
    const path = `${currentUser.id}/${currentUser.id}.jpg`;
    const { error: upErr } = await sb.storage.from('avatars').upload(path, blob, {
      contentType: 'image/jpeg', upsert: true
    });
    if(!upErr) {
      const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
      if(urlData?.publicUrl) {
        avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        if(hint) hint.textContent = 'Storage 저장 완료';
      }
    } else {
      console.warn('[avatar] Storage 업로드 오류:', upErr.message, upErr);
      if(hint) hint.textContent = `Storage 오류: ${upErr.message}`;
    }
  } catch(e) {
    console.warn('[avatar] Storage 연결 실패:', e.message);
    if(hint) hint.textContent = 'Storage 연결 실패, 대체 저장 중...';
  }

  // 2차 폴백: base64 직접 저장 (Storage 버킷 없거나 권한 없을 때)
  if(!avatarUrl) {
    avatarUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onerror = rej;
      reader.onload = e => res(e.target.result);
      reader.readAsDataURL(blob);
    });
  }

  const { error } = await sb.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
  if(error) throw new Error('DB 저장 실패: ' + error.message);
  try { localStorage.setItem(`bl_avatar_${currentUser.id}`, avatarUrl); } catch(e) {}
}

function loadAvatarForProfile(profile) {
  const el = document.getElementById('profile-avatar');
  if(!el || !currentUser) return;
  // 미저장 프리뷰가 있으면 그것을 우선 표시 (모달이 닫혔다 다시 열려도 유지)
  if(_pendingAvatarBlob) {
    const hint = document.getElementById('avatar-hint');
    if(hint && hint.textContent !== '✅ 저장 버튼을 눌러 적용하세요') {
      hint.textContent = '✅ 저장 버튼을 눌러 적용하세요';
    }
    return;
  }
  // DB 값 → localStorage 동기화
  const dbSrc = profile?.avatar_url;
  if(dbSrc) {
    try { localStorage.setItem(`bl_avatar_${currentUser.id}`, dbSrc); } catch(e){}
  } else {
    localStorage.removeItem(`bl_avatar_${currentUser.id}`);
  }
  const src = dbSrc || null;
  if(src) {
    applyAvatarToEl(el, src);
  } else {
    el.style.backgroundImage = '';
    const name = profile?.display_name || profile?.username || currentUser.email?.split('@')[0] || '?';
    el.textContent = name.slice(0,1).toUpperCase();
  }
}

// ── 프로필
function saveGVisionKey() {
  const key = document.getElementById('gvision-key-input')?.value.trim();
  if(!key) { localStorage.removeItem('bl_gvision_key'); showAlert('API Key가 삭제됐어요.'); return; }
  localStorage.setItem('bl_gvision_key', key);
  showAlert('✅ API Key가 저장됐어요!');
}
async function openProfile() {
  const tempName=currentUser.email?.split('@')[0]||'독서가';
  document.getElementById('profile-email').textContent=currentUser.email;
  openModal('modal-profile');

  // role 로드
  await loadUserRole();
  // 관리자 버튼 동적 처리
  const adminBtn = document.getElementById('profile-admin-btn');
  if(adminBtn) {
    adminBtn.style.display = '';  // 일단 보이게
    adminBtn.style.display = curUserRole === 'admin' ? '' : 'none';
    // 혹시 display가 안먹히면 visibility로도 처리
    adminBtn.hidden = curUserRole !== 'admin';
  }
  // 관리자 뱃지
  const adminBadge = document.getElementById('profile-admin-badge');
  if(adminBadge) adminBadge.style.display = curUserRole === 'admin' ? '' : 'none';

  // 프로필 + 코드 로드
  const [{data:profile},{data:myCodes}]=await Promise.all([
    sb.from('profiles').select('*').eq('id',currentUser.id).single(),
    sb.from('invite_codes').select('*').eq('owner_id',currentUser.id)
  ]);

  // 닉네임 (DB에서 가져온 값 우선)
  const name = profile?.display_name||profile?.username||tempName;
  // _pendingAvatarBlob은 여기서 초기화하지 않음 — 파일 선택 후 모달이 닫혔다 다시 열려도 blob 유지
  // loadAvatarForProfile이 textContent/backgroundImage를 모두 담당
  loadAvatarForProfile(profile);
  document.getElementById('profile-name').textContent=name;
  document.getElementById('profile-display-name').value=name;
  // 칭호 선택 드롭다운
  const titleSel = document.getElementById('profile-title-select');
  if(titleSel) {
    const completed = profile?.completed_quests || [];
    const earned = QUESTS.filter(q => completed.includes(q.id));
    titleSel.innerHTML = '<option value="">산책자 (기본)</option>' +
      earned.map(q => `<option value="${q.reward.title}" ${profile?.user_title===q.reward.title?'selected':''}>${q.reward.title}</option>`).join('');
    const titleWrap = document.getElementById('profile-title-wrap');
    if(titleWrap) titleWrap.style.display = earned.length ? '' : 'none';
  }
  // 폰트 크기
  const savedSize = localStorage.getItem('bl_font_size') || '100';
  const slider = document.getElementById('font-size-slider');
  const label = document.getElementById('font-size-label');
  if(slider) slider.value = savedSize;
  if(label) label.textContent = savedSize + '%';
  // 공개 설정 현재값 반영
  if(profile) {
    const libSel = document.getElementById('library-public-sel');
    const catSel = document.getElementById('category-vis-sel');
    if(libSel) {
      const vis = profile.library_visibility || (profile.library_public === false ? 'private' : 'public');
      libSel.value = vis;
    }
    if(catSel) catSel.value = profile.category_visibility || 'public';
  }
  // 초대코드 표시 (공통 함수 사용)
  if(document.getElementById('profile-invite-codes')) _refreshProfileCodes();
}
function openContact() {
  closeModal('modal-profile');
  const subj = document.getElementById('contact-subject');
  const body = document.getElementById('contact-body');
  if(subj) subj.value = '';
  if(body) body.value = '';
  openModal('modal-contact');
}

async function submitContactMsg() {
  const subj = (document.getElementById('contact-subject')?.value||'').trim();
  const body = (document.getElementById('contact-body')?.value||'').trim();
  if(!body){showAlert('내용을 입력해주세요.');return;}
  try {
    const { data: admins } = await sb.from('profiles').select('id').eq('role','admin');
    if(!admins?.length){showAlert('관리자를 찾을 수 없어요. 이메일로 보내주세요.');return;}
    const senderName = (await sb.from('profiles').select('display_name,username').eq('id',currentUser.id).single())?.data;
    const name = senderName?.display_name || senderName?.username || currentUser.email?.split('@')[0] || '익명';
    const msgText = `📩 문의 — ${subj?'['+subj+'] ':''}${body}\n\n— ${name} (${currentUser.email})`;
    await sb.from('notifications').insert(
      admins.map(a => ({
        user_id: a.id, sender_id: currentUser.id,
        type: 'inquiry',
        message: msgText,
        is_read: false,
        created_at: new Date().toISOString()
      }))
    );
    closeModal('modal-contact');
    showAlert('문의가 전송됐어요. 빠르게 확인할게요!');
  } catch(e) { showAlert('전송 오류: '+(e.message||'잠시 후 다시 시도해주세요.')); }
}

function submitContact() {
  const subj = (document.getElementById('contact-subject')?.value||'').trim();
  const body = (document.getElementById('contact-body')?.value||'').trim();
  if(!body){showAlert('내용을 입력해주세요.');return;}
  const from = currentUser?.email ? `\n\n— ${currentUser.email}` : '';
  const mailto = `mailto:booklog.help@gmail.com?subject=${encodeURIComponent(subj||'북로그 문의')}&body=${encodeURIComponent(body+from)}`;
  window.open(mailto, '_blank');
  closeModal('modal-contact');
  showAlert('이메일 앱이 열립니다. 전송 후 문의가 완료돼요.');
}

async function saveProfile() {
  const name = document.getElementById('profile-display-name')?.value.trim();
  if(!name){alert('닉네임을 입력해주세요.');return;}
  const saveBtn = document.querySelector('#modal-profile .btn-save, #modal-profile [onclick*="saveProfile"]');
  if(saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
  try {
    let avatarSaved = false;
    if(_pendingAvatarBlob) {
      await doSaveAvatar(_pendingAvatarBlob);
      _pendingAvatarBlob = null;
      avatarSaved = true;
      const hint = document.getElementById('avatar-hint');
      if(hint) hint.textContent = '탭해서 사진 변경';
      // DB에 실제로 저장됐는지 재확인
      const { data: check } = await sb.from('profiles').select('avatar_url').eq('id', currentUser.id).single();
      if(!check?.avatar_url) {
        throw new Error('프사가 DB에 저장되지 않았어요. 다시 시도해주세요.');
      }
    }
    const titleEl = document.getElementById('profile-title-select');
    const updateData = {display_name:name, username:name};
    if(titleEl) updateData.user_title = titleEl.value || null;
    const {error} = await sb.from('profiles').update(updateData).eq('id',currentUser.id);
    if(error) throw error;
    localStorage.setItem('bl_profile_save_count', String((parseInt(localStorage.getItem('bl_profile_save_count')||'0')+1)));
    if(saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
    closeModal('modal-profile');
    await showAlert(avatarSaved ? '저장되었어요! 프로필 사진도 적용됐어요.' : '저장되었어요!');
  } catch(e){
    if(saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
    alert('저장 오류: '+(e.message||JSON.stringify(e)));
  }
}



// ── 신고 & 알림
function openReportModal(postId, postTitle) {
  document.getElementById('report-post-id').value = postId;
  document.getElementById('report-post-title').textContent = postTitle;
  document.getElementById('report-reason').value = '';
  openModal('modal-report');
}

async function submitReport() {
  const postId = document.getElementById('report-post-id').value;
  const reason = document.getElementById('report-reason').value.trim();
  const postTitle = document.getElementById('report-post-title').textContent;
  if(!reason) { alert('신고 사유를 입력해주세요.'); return; }
  try {
    await sb.from('reports').insert({
      post_id:postId, reporter_id:currentUser.id,
      reason, created_at:new Date().toISOString()
    });
    const { data: admins } = await sb.from('profiles').select('id').eq('role','admin');
    if(admins?.length) {
      await sb.from('notifications').insert(
        admins.map(a => ({
          user_id:a.id, sender_id:currentUser.id,
          type:'report',
          message:`🚨 신고 접수: "${postTitle}" — ${reason}`,
          post_id:postId, is_read:false,
          created_at:new Date().toISOString()
        }))
      );
    }
    closeModal('modal-report');
    alert('신고가 접수됐어요.');
    await loadNotifications();
  } catch(e){ alert('신고 오류: '+(e.message||'알 수 없는 오류')); }
}

// 관리자: 게시글 블라인드
async function toggleBlindPost(postId, authorId, hide) {
  try {
    const { data, error } = await sb.from('posts')
      .update({is_hidden:hide})
      .eq('id',postId)
      .select();
    if(error) throw error;
    if(!data?.length) throw new Error('업데이트 권한이 없어요. Supabase RLS 정책을 확인해주세요.');
    if(authorId) {
      await sb.from('notifications').insert({
        user_id:authorId, type:'blind',
        message: hide ? '🚫 회원님의 게시글이 관리자에 의해 블라인드 처리되었습니다.' : '✅ 회원님의 게시글 블라인드가 해제되었습니다.',
        is_read:false, created_at:new Date().toISOString()
      });
    }
    closeModal('modal-post-detail');
    await showAlert(hide ? '블라인드 처리됐어요.' : '블라인드가 해제됐어요.');
    safeBoardRefresh();
  } catch(e) { alert('처리 오류: '+(e.message||JSON.stringify(e))); }
}

// 관리자: 사용자 제한/해제
async function banUser(userId, ban) {
  try {
    const { data, error } = await sb.from('profiles')
      .update({is_banned:ban})
      .eq('id',userId)
      .select();
    if(error) throw error;
    if(!data?.length) throw new Error('업데이트 권한이 없어요. Supabase profiles UPDATE 정책 필요');
    await sb.from('notifications').insert({
      user_id:userId, type:'ban',
      message: ban ? '⛔ 관리자에 의해 계정이 제한되었습니다.' : '✅ 계정 제한이 해제되었습니다.',
      is_read:false, created_at:new Date().toISOString()
    });
    closeModal('modal-post-detail');
    await showAlert(ban ? '사용자를 제한했어요.' : '제한을 해제했어요.');
    safeBoardRefresh();
  } catch(e) { alert('처리 오류: '+(e.message||JSON.stringify(e))); }
}

// 게시판 안전 새로고침 (패널 활성 여부 체크)
function safeBoardRefresh() {
  try {
    const list = document.getElementById('board-list');
    const pg = document.getElementById('board-pagination');
    if(list && pg) renderBoardList();
  } catch(e) { console.warn('board refresh error:', e); }
}

async function loadNotifications() {
  if(!currentUser) return;
  // 30일 이상 된 내 알림 자동 삭제 (읽은 것만)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  sb.from('notifications').delete()
    .eq('user_id', currentUser.id).eq('is_read', true).lt('created_at', cutoff)
    .then(null, () => {});
  // 내 가입일 (created_at) 기준 - 가입 전 broadcast는 안 보이게
  const userCreatedAt = currentUser.created_at || new Date(0).toISOString();
  const [{ data: myNotifs }, { data: broadcasts }] = await Promise.all([
    sb.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', {ascending:false}).limit(50),
    sb.from('notifications').select('*').eq('type', 'admin_broadcast').eq('target_type','all').gte('created_at', userCreatedAt).order('created_at', {ascending:false}).limit(10)
  ]);
  const myIds = new Set((myNotifs||[]).map(n=>n.id));
  const data = [
    ...(myNotifs||[]),
    ...(broadcasts||[]).filter(b => !myIds.has(b.id) && b.sender_id !== currentUser.id)
  ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  const unread = data.filter(n=>!n.is_read).length;
  const badge = document.getElementById('notif-badge');
  if(badge) {
    badge.textContent = unread;
    badge.style.cssText = unread > 0
      ? 'display:flex;position:absolute;top:-2px;right:-2px;background:#c0392b;color:#fff;font-size:.45rem;border-radius:50%;width:14px;height:14px;align-items:center;justify-content:center;font-weight:700;'
      : 'display:none;';
  }
  const adminBar = document.getElementById('notif-admin-bar');
  if(adminBar) adminBar.style.display = curUserRole==='admin' ? '' : 'none';
  const list = document.getElementById('notif-list');
  if(list) {
    if(!data?.length) {
      list.innerHTML = '<div style="padding:.8rem;font-size:.75rem;color:var(--tx3);text-align:center;">알림이 없어요.</div>';
    } else {
      // 알림 데이터를 window에 캐시 (onclick에서 참조)
      window._notifCache = {};
      data.forEach(n => { window._notifCache[n.id] = n; });
      list.innerHTML = data.map(n => `
        <div style="padding:.55rem .8rem;border-bottom:1px solid var(--border);font-size:.75rem;display:flex;align-items:flex-start;gap:.5rem;background:${n.is_read?'':'#fdf8f0'};">
          <div style="flex:1;cursor:pointer;" onclick="goToNotif('${n.id}')">
            <div style="color:var(--tx1);margin-bottom:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${(()=>{const first=(n.message||'').split('\n').find(l=>l.trim())||n.message||'';return first.length>40?first.slice(0,40)+'…':first;})()}
            </div>
            <div style="color:var(--tx3);font-size:.63rem;">${toKSTDateTime(n.created_at)} ${n.is_read?'':'· 새 알림'}</div>
          </div>
          <button onclick="event.stopPropagation();deleteNotif('${n.id}')" style="border:none;background:none;color:var(--tx3);cursor:pointer;font-size:.7rem;flex-shrink:0;padding:.1rem .3rem;" title="삭제">✕</button>
        </div>`).join('');
    }
  }
}

async function goToNotif(notifId) {
  const n = window._notifCache?.[notifId];
  if(!n) return;
  const detailEl = document.getElementById('notif-detail-body');
  if(detailEl) {
    const postId = n.post_id || null;
    const msgHtml = (n.message||'').split('\n').map(l=>l===''?'<br>':l).join('<br>');
    const isInquiry = curUserRole === 'admin' && n.sender_id && (n.message||'').startsWith('📩 문의');
    detailEl.innerHTML = `
      <div style="font-size:.85rem;line-height:1.85;color:var(--tx1);padding-bottom:.8rem;">${msgHtml}</div>
      <div style="font-size:.65rem;color:var(--tx3);">${toKSTDateTime(n.created_at)}</div>
      ${postId ? `<div style="margin-top:1rem;border-top:1px solid var(--border);padding-top:.7rem;">
        <button class="btn-save" style="width:100%;padding:.5rem;" onclick="goToPost('${postId}')">📖 게시글 보러가기</button>
      </div>` : ''}
      ${isInquiry ? `
      <div style="margin-top:.9rem;border-top:1px solid var(--border);padding-top:.75rem;">
        <div style="font-size:.7rem;font-weight:600;color:var(--tx2);margin-bottom:.4rem;">답변 보내기</div>
        <textarea id="inquiry-reply-input" style="width:100%;box-sizing:border-box;border:1px solid var(--border2);border-radius:var(--rs);padding:.5rem .6rem;font-size:.78rem;font-family:var(--ff);color:var(--tx1);background:var(--bg);resize:vertical;min-height:80px;outline:none;" placeholder="답변 내용을 입력하세요…"></textarea>
        <div id="inquiry-reply-msg" style="font-size:.67rem;margin:.25rem 0;display:none;"></div>
        <button onclick="sendInquiryReply('${n.sender_id}')" class="btn-save" style="width:100%;margin-top:.3rem;padding:.42rem;">답변 보내기</button>
      </div>` : ''}`;
    openModal('modal-notif-detail');
  }
  sb.from('notifications').update({is_read:true}).eq('id', notifId).then(()=>loadNotifications());
}

async function sendInquiryReply(receiverId) {
  const content = document.getElementById('inquiry-reply-input')?.value.trim();
  const msg = document.getElementById('inquiry-reply-msg');
  const showMsg = (text, ok=false) => {
    if(!msg) return;
    msg.textContent = text; msg.style.color = ok ? '#2a7a3a' : '#c0392b'; msg.style.display = 'block';
  };
  if(!content) { showMsg('답변 내용을 입력해주세요.'); return; }
  try {
    const { error } = await sb.from('notifications').insert({
      user_id: receiverId,
      sender_id: currentUser.id,
      type: 'admin_dm',
      message: `📩 관리자 답변: ${content}`,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    showMsg('답변을 보냈어요!', true);
    if(document.getElementById('inquiry-reply-input')) document.getElementById('inquiry-reply-input').value = '';
    setTimeout(() => closeModal('modal-notif-detail'), 1500);
  } catch(e) { showMsg('전송 오류: ' + (e.message || '잠시 후 다시 시도해주세요.')); }
}
async function goToPost(postId) {
  closeModal('modal-notif-detail');
  closeModal('modal-notif');
  if(!postId) return;
  // 게시판 탭 활성화
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
  const boardTab = document.querySelector('.tab[onclick*="board"]');
  if(boardTab) boardTab.classList.add('on');
  const boardPanel = document.getElementById('p-board');
  if(boardPanel) boardPanel.classList.add('on');
  // 게시글 목록 로드 후 해당 게시글 모달 바로 열기
  await renderBoardList();
  await openPostDetail(postId);
}
async function deleteNotif(notifId) {
  event?.stopPropagation();
  try {
    // user_id 조건 추가해서 RLS 통과
    const { error } = await sb.from('notifications')
      .delete()
      .eq('id', notifId)
      .eq('user_id', currentUser.id);
    if(error) {
      // user_id가 다른 경우(broadcast) - is_read만 true로 처리
      await sb.from('notifications').update({is_read:true}).eq('id', notifId);
    }
  } catch(e) {
    console.warn('notif delete error:', e.message);
  }
  // 캐시에서 제거 후 화면 갱신
  if(window._notifCache) delete window._notifCache[notifId];
  loadNotifications();
}

function openNotifModal() {
  localStorage.setItem('bl_notif_click', String((parseInt(localStorage.getItem('bl_notif_click')||'0')+1)));
  openModal('modal-notif');
  loadNotifications();
  // 관리자 전용 버튼 표시
  const adminBar = document.getElementById('notif-admin-bar');
  if(adminBar) adminBar.style.display = curUserRole==='admin' ? '' : 'none';
}


// 관리자 전체 쪽지 발송
async function sendBroadcastFromPanel() {
  const msg = document.getElementById('admin-broadcast-input')?.value.trim();
  if(!msg) { alert('내용을 입력해주세요.'); return; }
  try {
    const { error } = await sb.from('notifications').insert({
      user_id: currentUser.id,
      sender_id: currentUser.id,
      type: 'admin_broadcast',
      target_type: 'all',
      message: `📢 관리자 공지: ${msg}`,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    document.getElementById('admin-broadcast-input').value = '';
    alert('전체 공지를 발송했어요!');
  } catch(e) { alert('발송 오류: '+e.message); }
}

async function sendAdminMessage() {
  const msg = document.getElementById('admin-msg-input')?.value.trim();
  if(!msg) { alert('메시지를 입력해주세요.'); return; }
  try {
    // admin 자신에게 broadcast로 저장 (target_type='all')
    // 다른 사용자들은 loadNotifications에서 type='admin_broadcast' 쿼리로 읽음
    const { error } = await sb.from('notifications').insert({
      user_id: currentUser.id,
      sender_id: currentUser.id,
      type: 'admin_broadcast',
      target_type: 'all',
      message: `📢 관리자 공지: ${msg}`,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    document.getElementById('admin-msg-input').value = '';
    closeModal('modal-admin-msg');
    alert('전체 공지를 발송했어요!');
  } catch(e) { alert('전송 오류: '+(e.message||'알 수 없는 오류')); }
}

// 관리자 개인 메시지 (회원 검색 후 발송)
async function openDirectMsgModal() {
  if(curUserRole !== 'admin') return;
  document.getElementById('dm-search-input').value = '';
  document.getElementById('dm-user-list').innerHTML = '';
  document.getElementById('dm-content').value = '';
  openModal('modal-dm');
}
async function searchDmUser() {
  const q = document.getElementById('dm-search-input')?.value.trim();
  const listEl = document.getElementById('dm-user-list');
  if(!q) { listEl.innerHTML='<div style="padding:.5rem .8rem;font-size:.75rem;color:var(--tx3);">닉네임을 입력해주세요.</div>'; return; }
  listEl.innerHTML='<div style="padding:.5rem .8rem;font-size:.75rem;color:var(--tx3);">검색 중...</div>';
  try {
    // display_name 검색만 (username은 내부식별자라 제외)
    const { data: byDisplay } = await sb.from('profiles').select('id,display_name,username,role').ilike('display_name', `%${q}%`).neq('id', currentUser.id).limit(10);
    const results = (byDisplay||[]);
    listEl.innerHTML = '';
    if(!results.length) { listEl.innerHTML='<div style="padding:.5rem .8rem;font-size:.75rem;color:var(--tx3);">검색 결과가 없어요.</div>'; return; }
    results.slice(0,10).forEach(u => {
      const el=document.createElement('div');
      el.style.cssText='padding:.45rem .7rem;cursor:pointer;border-radius:4px;font-size:.78rem;display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--border);';
      el.innerHTML=`<span style="flex:1;font-weight:500;">${u.display_name||u.username}</span><span style="font-size:.62rem;color:var(--tx3);background:#ede4d0;padding:1px 5px;border-radius:3px;">${u.role==='admin'?'관리자':'산책자'}</span>`;
      el.onmouseenter=()=>el.style.background='#ede4d0';
      el.onmouseleave=()=>el.style.background='';
      el.onclick=()=>{ window._dmReceiver={id:u.id,name:u.display_name||u.username}; document.getElementById('dm-receiver-label').textContent=`받는 사람: ${u.display_name||u.username}`; listEl.innerHTML=''; document.getElementById('dm-search-input').value=''; };
      listEl.appendChild(el);
    });
  } catch(e) {
    console.error('DM search error:', e);
    listEl.innerHTML=`<div style="padding:.5rem .8rem;font-size:.75rem;color:#c0392b;">검색 오류: ${e.message||JSON.stringify(e)}<br><span style="font-size:.65rem;">Supabase RLS 정책을 확인해주세요.</span></div>`;
  }
}
async function sendDm() {
  const receiver = window._dmReceiver;
  if(!receiver) { alert('받는 사람을 선택해주세요.'); return; }
  const content = document.getElementById('dm-content')?.value.trim();
  if(!content) { alert('메시지를 입력해주세요.'); return; }
  try {
    const { error } = await sb.from('notifications').insert({
      user_id: receiver.id,
      sender_id: currentUser.id,
      type: 'admin_dm',
      message: `📩 관리자 쪽지: ${content}`,
      is_read: false,
      created_at: new Date().toISOString()
    });
    if(error) throw error;
    document.getElementById('dm-content').value='';
    document.getElementById('dm-receiver-label').textContent='';
    window._dmReceiver = null;
    closeModal('modal-dm');
    alert(`${receiver.name}님에게 쪽지를 보냈어요.`);
  } catch(e) { alert('전송 오류: '+(e.message||'알 수 없는 오류')); }
}

function openAdminMsgModal() {
  if(curUserRole !== 'admin') { alert('관리자만 사용할 수 있어요.'); return; }
  document.getElementById('admin-msg-input').value = '';
  openModal('modal-admin-msg');
}


// ── 리치 텍스트 에디터
function editorCmd(cmd) {
  document.getElementById('post-editor')?.focus();
  document.execCommand(cmd, false, null);
}
function editorFontSize(size) {
  if(!size) return;
  document.getElementById('post-editor')?.focus();
  document.execCommand('fontSize', false, size);
}
function editorInsertLink() {
  const url = prompt('링크 URL을 입력하세요:');
  if(url) {
    document.getElementById('post-editor')?.focus();
    document.execCommand('createLink', false, url);
  }
}
function editorInsertImage() {
  const url = prompt('이미지 URL을 입력하세요:');
  if(url) {
    document.getElementById('post-editor')?.focus();
    document.execCommand('insertImage', false, url);
  }
}


// ══════════════════════════════════════
// 관리자 회원 관리
// ══════════════════════════════════════
let allMembers = [], selectedMemberIds = new Set();

async function openAdminPanel() {
  if(curUserRole !== 'admin') return;
  selectedMemberIds.clear();
  await loadAllMembers();
  openModal('modal-admin-panel');
}

async function loadAllMembers() {
  try {
    const { data, error } = await sb.from('profiles')
      .select('id,display_name,username,role,is_banned,created_at')
      .order('created_at', {ascending:false})
      .not('display_name', 'is', null); // 닉네임 없는 고아 계정 제외
    if(error) {
      console.error('members load error:', error);
      const wrap = document.getElementById('admin-member-list');
      if(wrap) wrap.innerHTML = `<div style="padding:.8rem;font-size:.75rem;color:#c0392b;">
        회원 목록 로드 오류: ${error.message}<br>
        <span style="font-size:.65rem;">Supabase RLS 정책을 확인해주세요 (profiles SELECT 허용 필요)</span>
      </div>`;
      return;
    }
    allMembers = data || [];
    // admin-total-count에 통합 표시 (실제 가입자 기준)
    const totalCountEl = document.getElementById('admin-total-count');
    if(totalCountEl) totalCountEl.textContent = `전체 가입자 ${allMembers.length}명`;
    renderMemberList();
  } catch(e) {
    console.error('loadAllMembers exception:', e);
  }
}

function renderMemberList(filter='') {
  const wrap = document.getElementById('admin-member-list');
  if(!wrap) return;
  const q = filter.toLowerCase();
  const list = q ? allMembers.filter(m=>(m.display_name||m.username||'').toLowerCase().includes(q)) : allMembers;
  wrap.innerHTML = '';
  if(!list.length) { wrap.innerHTML='<div style="padding:.8rem;font-size:.75rem;color:var(--tx3);">회원이 없어요.</div>'; return; }
  list.forEach(m => {
    const name = m.display_name || m.username || '이름없음';
    const checked = selectedMemberIds.has(m.id);
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:.6rem;padding:.45rem .7rem;border-bottom:1px solid var(--border);background:${m.is_banned?'#fff5f5':checked?'#f0faf0':''};cursor:pointer;`;
    row.onclick = () => {
      if(selectedMemberIds.has(m.id)) selectedMemberIds.delete(m.id);
      else selectedMemberIds.add(m.id);
      renderMemberList(document.getElementById('admin-member-search')?.value||'');
    };
    row.innerHTML = `
      <div style="width:16px;height:16px;border:2px solid ${checked?'var(--acc)':'var(--border2)'};border-radius:3px;background:${checked?'var(--acc)':'transparent'};flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        ${checked?'<span style="color:#fff;font-size:.6rem;">✓</span>':''}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.78rem;font-weight:600;color:${m.is_banned?'#c0392b':'var(--tx1)'};">${name} ${m.role==='admin'?'<span style="font-size:.6rem;color:var(--acc);background:#ede4d0;padding:1px 4px;border-radius:2px;">관리자</span>':''} ${m.is_banned?'<span style="font-size:.6rem;color:#c0392b;">⛔제한됨</span>':''}</div>
        <div style="font-size:.62rem;color:var(--tx3);">${toKSTDate(m.created_at)}</div>
      </div>
      <button onclick="event.stopPropagation();toggleMemberBan('${m.id}',${!m.is_banned})" style="font-size:.62rem;padding:2px 6px;border:1px solid ${m.is_banned?'#a8d8a8':'#f5c6cb'};border-radius:3px;background:none;cursor:pointer;color:${m.is_banned?'#2e7d32':'#c0392b'};">
        ${m.is_banned?'해제':'제한'}
      </button>
      <button onclick="event.stopPropagation();deleteMember('${m.id}','${(m.display_name||m.username||'').replace(/'/g,'')}')" style="font-size:.62rem;padding:2px 6px;border:1px solid #f5c6cb;border-radius:3px;background:none;cursor:pointer;color:#8b0000;" title="계정 삭제">
        🗑
      </button>`;
    wrap.appendChild(row);
  });
  // 선택 인원 표시
  const countEl = document.getElementById('admin-selected-count');
  if(countEl) countEl.textContent = selectedMemberIds.size > 0 ? `${selectedMemberIds.size}명 선택됨` : '';
}

async function deleteMember(userId, userName) {
  if(userId === currentUser.id) { alert('자기 자신은 삭제할 수 없어요.'); return; }
  if(!await showConfirm(`"${userName}" 계정을 삭제할까요?

⚠️ 해당 계정의 모든 데이터(책, 문장, 댓글 등)가 삭제됩니다.
이 작업은 되돌릴 수 없어요.`)) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if(!token) throw new Error('로그인 세션이 없어요. 다시 로그인해주세요.');

    const resp = await fetch('/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ targetUserId: userId })
    });
    const result = await resp.json();
    if(!resp.ok) throw new Error(result.error || '삭제 실패');

    await loadAllMembers();
    alert(`"${userName}" 계정을 삭제했어요.`);
  } catch(e) {
    alert('삭제 오류: '+(e.message||'서버 오류'));
    console.error('deleteMember error:', e);
  }
}

async function toggleMemberBan(userId, ban) {
  try {
    const { data, error } = await sb.from('profiles')
      .update({is_banned:ban})
      .eq('id',userId)
      .select();
    if(error) throw error;
    if(!data?.length) throw new Error('업데이트 권한이 없어요. Supabase profiles UPDATE 정책 필요');
    await sb.from('notifications').insert({
      user_id:userId, type:'ban',
      message: ban ? '⛔ 관리자에 의해 계정이 제한되었습니다.' : '✅ 계정 제한이 해제되었습니다.',
      is_read:false, created_at:new Date().toISOString()
    });
    await loadAllMembers();
  } catch(e) {
    alert('처리 오류: '+(e.message||'RLS 정책 확인 필요'));
    console.error('toggleMemberBan error:', e);
  }
}

async function sendMsgToSelected() {
  if(selectedMemberIds.size === 0) { alert('받는 사람을 선택해주세요.'); return; }
  const msg = document.getElementById('admin-bulk-msg')?.value.trim();
  if(!msg) { alert('메시지를 입력해주세요.'); return; }
  try {
    const notifs = [...selectedMemberIds].map(uid => ({
      user_id: uid,
      sender_id: currentUser.id,
      type: 'admin_dm',
      message: `📩 관리자 쪽지: ${msg}`,
      is_read: false,
      created_at: new Date().toISOString()
    }));
    const { error } = await sb.from('notifications').insert(notifs);
    if(error) throw error;
    document.getElementById('admin-bulk-msg').value = '';
    selectedMemberIds.clear();
    renderMemberList();
    alert(`${notifs.length}명에게 쪽지를 보냈어요.`);
  } catch(e) { alert('전송 오류: '+e.message); }
}




// ══════════════════════════════════════
// 북적북적 CSV 가져오기
// ══════════════════════════════════════
async function importFromBookit(file) {
  if(!file) return;
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2) { await showAlert('파일이 비어있어요.'); return; }

    // BOM 제거 및 CSV 헤더 파싱
    const cleanText = text.replace(/^\uFEFF/, ''); // UTF-8 BOM 제거
    const cleanLines = cleanText.split(/\r?\n/).filter(l => l.trim());
    if(cleanLines.length < 2) { await showAlert('파일이 비어있어요.'); return; }
    const headers = parseCSVLine(cleanLines[0]).map(h => h.trim().replace(/"/g,''));
    console.log('북적북적 헤더:', headers);
    const getIdx = (...keys) => headers.findIndex(h => keys.some(k => h.includes(k)));
    const rows2 = cleanLines.slice(1);

    const C = {
      title:   getIdx('제목','title'),
      author:  getIdx('저자','author'),
      publisher: getIdx('출판사','publisher'),
      status:  getIdx('독서상태','상태','status'),
      rating:  getIdx('별점','평점','rating','score'),
      start:   getIdx('시작일','start'),
      finish:  getIdx('읽은 날짜','완료','finish','읽은날'),
      stop:    getIdx('중단일','중단'),
    };

    const statusConv = s => {
      const v = String(s||'').trim();
      if(/읽은|완독|read/i.test(v)) return '완독';
      if(/읽는\s*중|reading/i.test(v)) return '읽는중';
      if(/중단/i.test(v)) return '중단';
      if(/읽고\s*싶|want/i.test(v)) return '읽고싶음';
      return '읽고싶음';
    };

    const rows = rows2.map(l => parseCSVLine(l));
    const books = rows.filter(r => r.length > 1 && C.title >= 0 && r[C.title]?.trim()).map(r => {
      const status = statusConv(C.status >= 0 ? r[C.status] : '');
      // 중단일이 있으면 중단으로 오버라이드
      const stopDate = C.stop >= 0 ? r[C.stop]?.trim() : '';
      return {
        title:      r[C.title]?.trim() || '',
        author:     C.author >= 0 ? r[C.author]?.trim() : '',
        publisher:  C.publisher >= 0 ? r[C.publisher]?.trim() : '',
        status:     stopDate ? '중단' : status,
        rating:     C.rating >= 0 ? (v=>{const n=parseFloat(String(v||'').replace(/[^0-9.]/g,''));return n&&n>=0&&n<=5?Math.round(n*2)/2:null;})(r[C.rating]) : null,
        date_start: C.start >= 0 ? formatDate(r[C.start]) : null,
        date_finish:status === '완독' && C.finish >= 0 ? formatDate(r[C.finish]) : null,
        source:     'import',
        user_id:    currentUser.id,
        created_at: new Date().toISOString(),
      };
    }).filter(b => b.title);

    if(!books.length) { await showAlert('가져올 책이 없어요.'); return; }

    const upsertMode = document.getElementById('bookit-upsert-mode')?.checked;
    // 제목 정규화: 공백/특수문자 제거 후 소문자 비교 (중복 방지 강화)
    const normT = s => String(s||'').trim().replace(/\s+/g,' ').replace(/[\s·:：,]/g,'').toLowerCase();
    const existingNormMap = {};
    allBooks.forEach(b => { existingNormMap[normT(b.title)] = b.id; });
    const toInsert = books.filter(b => !existingNormMap[normT(b.title)]);
    const toUpdate = upsertMode ? books.filter(b => existingNormMap[normT(b.title)]) : [];
    // 실제 bookId 찾기용
    const getExistingId = title => existingNormMap[normT(title)];

    if(!toInsert.length && !toUpdate.length) { await showAlert('모든 책이 이미 서재에 있어요!'); return; }

    const confirmed = await showConfirm(`북적북적에서 ${books.length}권을 가져올까요?\n신규 ${toInsert.length}권${toUpdate.length>0?' / 업데이트 '+toUpdate.length+'권':''}`);
    if(!confirmed) return;

    // 신규 삽입
    let insertedIds = [];
    for(let i=0; i<toInsert.length; i+=50) {
      const { data: inserted, error } = await sb.from('books').insert(toInsert.slice(i,i+50)).select('id,title');
      if(error) throw error;
      if(inserted) insertedIds.push(...inserted);
    }

    // 업데이트
    for(const book of toUpdate) {
      const bookId = getExistingId(book.title);
      if(!bookId) continue;
      await sb.from('books').update({
        status: book.status,
        date_start: book.date_start||undefined,
        date_finish: book.date_finish||undefined,
      }).eq('id', bookId);
      insertedIds.push({id: bookId, title: book.title});
    }

    // 표지 자동 검색
    if(insertedIds.length > 0) {
      const prog = document.getElementById('cover-search-progress');
      if(prog) prog.style.display = '';
      for(let i=0; i<insertedIds.length; i++) {
        const book = insertedIds[i];
        if(prog) prog.textContent = `표지 검색 ${i+1}/${insertedIds.length}...`;
        try {
          const bk2 = toInsert.find(b=>b.title===book.title)||toUpdate.find(b=>b.title===book.title);
          const cover2 = await fetchBookCover(book.title, bk2?.author, bk2?.publisher);
          if(cover2) await sb.from('books').update({cover: cover2}).eq('id', book.id);
        } catch(e) {}
        await new Promise(r => setTimeout(r, 150));
      }
      if(prog) prog.style.display = 'none';
    }

    await loadData(); buildBooks(); if(document.getElementById('q-feed'))renderQuotes();
    closeModal('modal-backup');
    await showAlert(`✅ 완료!\n신규: ${toInsert.length}권${toUpdate.length>0?' / 업데이트: '+toUpdate.length+'권':''}`);
  } catch(e) {
    await showAlert('가져오기 오류: '+e.message);
    console.error('bookit import error:', e);
  }
}

// ══════════════════════════════════════
// 엑셀 가져오기 (북모리 등)
// ══════════════════════════════════════
async function importFromBookmori(file) {
  if(!file) return;
  try {
    // SheetJS 동적 로드
    if(!window.XLSX) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array', cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval:''});

    if(!rows.length) { await showAlert('파일이 비어있거나 읽을 수 없어요.'); return; }

    const allCols = Object.keys(rows[0]);
    console.log('1행(섹션헤더):', allCols.slice(0,5));

    // 북모리는 1행=섹션명, 2행=실제컬럼명, 3행~=데이터
    // SheetJS가 1행을 헤더로 읽으면 __EMPTY가 됨
    // → 2행을 헤더로 재파싱
    let dataRows = rows;
    let realCols = allCols;

    // __EMPTY가 많으면 1행이 섹션헤더 → 2행이 실제 헤더
    const emptyCount = allCols.filter(c => c.startsWith('__EMPTY')).length;
    if(emptyCount > 3) {
      // 1행(현재 헤더)을 버리고 2행을 헤더로 사용
      const headerRow = rows[0]; // 현재 rows[0]은 실제 2행 데이터
      realCols = Object.values(headerRow).map(v => String(v||'').trim()).filter(v=>v);
      // rows[1]부터 실제 데이터
      dataRows = rows.slice(1);
      console.log('실제 컬럼명(2행):', realCols.slice(0,10));
    }

    // 컬럼 인덱스 매핑
    const findColIdx = (keys) => {
      const idx = realCols.findIndex(c => {
        const lc = c.replace(/\s/g,'').toLowerCase();
        return keys.some(k => lc.includes(k.replace(/\s/g,'').toLowerCase()));
      });
      return idx >= 0 ? idx : -1;
    };

    const CI = {
      title:    findColIdx(['책제목','제목','title','도서명']),
      author:   findColIdx(['저자','작가','author','글쓴이']),
      publisher:findColIdx(['출판사','출판','publisher']),
      status:   findColIdx(['읽기상태','상태','status','읽기']),
      rating:   findColIdx(['별점','평점','rating']),
      period:   findColIdx(['읽은기간','읽은기록','기간']),
      pages:    findColIdx(['전체페이지수','페이지수','페이지','쪽수','pages']),
      review:   findColIdx(['의견','리뷰','감상','메모','review']),
      isbn:     findColIdx(['isbn']),
      tags:     findColIdx(['사용중인태그','태그들','태그','컬렉션','collection','tag']),
    };
    console.log('컬럼 인덱스:', CI);

    // 행을 배열로 변환하는 함수
    const getVal = (row, idx) => {
      if(idx < 0) return '';
      const vals = Object.values(row);
      return vals[idx] !== undefined ? vals[idx] : '';
    };

    const statusConv = (s, row) => {
      const v = String(s||'').trim();
      // 북모리: "다 읽었어요!", "읽고 있어요", "읽고 싶어요", "잠시 중단"
      if(/다읽었|읽었어|완독|read/i.test(v.replace(/\s/g,''))) return '완독';
      if(/읽고있|읽는중|reading/i.test(v.replace(/\s/g,''))) return '읽는중';
      if(/중단|포기|stop/i.test(v.replace(/\s/g,''))) return '중단';
      if(/읽고싶|읽을예정|want/i.test(v.replace(/\s/g,''))) return '읽고싶음';
      // 상태 없으면 읽은기간으로 판단
      if(!v) {
        const period = String(getVal(row, CI.period)||'').trim();
        if(period) return '완독';
      }
      return '읽고싶음';
    };
    const dateConv = v => {
      if(!v) return null;
      if(v instanceof Date) return v.toISOString().slice(0,10);
      const s = String(v).trim();
      // "2023. 1. 14" 또는 "2023.1.14" 또는 "2023-1-14"
      const m = s.match(/(\d{4})[.\-\s]+(\d{1,2})[.\-\s]+(\d{1,2})/);
      return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : null;
    };
    // 북모리 "읽은 기간" 파싱 (예: "2023. 1. 14 ~ 2023. 1. 17")
    const parsePeriodDate = (v, which) => {
      if(!v) return null;
      const s = String(v);
      const parts = s.split(/[~\-]+/);
      const part = which==='start' ? parts[0] : (parts[1]||parts[0]);
      return dateConv(part.trim());
    };

    const books = dataRows.map(r => {
      const title = String(getVal(r, CI.title)||'').trim();
      if(!title || title === '책 제목') return null;
      const period = String(getVal(r, CI.period)||'').trim();
      let dateStart = null, dateFinish = null;
      if(period) {
        const parts = period.split('~');
        dateStart = dateConv(parts[0]?.trim());
        dateFinish = dateConv((parts[1]||parts[0])?.trim());
      }
      return {
        title,
        author:     String(getVal(r,CI.author)||'').trim(),
        publisher:  String(getVal(r,CI.publisher)||'').trim(),
        status:     statusConv(getVal(r,CI.status), r),
        rating:     CI.rating>=0?(v=>{const n=parseFloat(String(v||'').replace(/[^0-9.]/g,''));return n&&n>=0&&n<=5?Math.round(n*2)/2:null;})(getVal(r,CI.rating)):null,
        date_start: dateStart,
        date_finish:dateFinish,
        pages:      CI.pages>=0?(parseInt(String(getVal(r,CI.pages)||'').replace(/[^0-9]/g,''))||null):null,
        review:     String(getVal(r,CI.review)||'').trim(),
        isbn:       String(getVal(r,CI.isbn)||'').trim(),
        source:     'import',
        genre:      (() => {
          // 북모리 태그에서 장르 추출 (#SF/판타지 → SF/판타지)
          const tagVal = String(getVal(r, CI.tags)||'').trim();
          if(!tagVal) return [];
          // # 으로 시작하는 태그들 분리
          const tags = tagVal.split(/[,，\s]+/).map(t=>t.replace(/^#/,'').trim()).filter(t=>t);
          // 장르 키워드 목록
          const genreKeywords = ['소설','한국소설','외국소설','SF','판타지','추리','스릴러','에세이','시','인문','철학','역사','사회','정치','자기계발','경제','경영','과학','수학','기술','공학','예술','디자인','여행','요리','아동','청소년','만화','그래픽','문학'];
          const matched = tags.find(t => genreKeywords.some(g => t.includes(g)));
          return matched ? [matched] : (tags.length ? [tags[0]] : []);
        })(),
        user_id:    currentUser.id,
        created_at: new Date().toISOString(),
      };
    }).filter(b => b && b.title);

    if(!books.length) {
      await showAlert(`컬럼 인식 결과: ${realCols.slice(0,6).join(', ')}\n\n책을 찾지 못했어요. Console(F12)에서 로그를 확인해주세요.`);
      return;
    }

    const confirmed = await showConfirm(`${books.length}권을 가져올까요?\n(제목 기준 중복 제외 후 추가)`);
    if(!confirmed) return;

    const upsertMode = document.getElementById('excel-upsert-mode')?.checked;
    const existingBooks = allBooks;
    const normT2 = s => String(s||'').trim().replace(/\s+/g,' ').replace(/[\s·:：,]/g,'').toLowerCase();
    const existingNormMap2 = {};
    existingBooks.forEach(b => { existingNormMap2[normT2(b.title)] = b.id; });
    const toInsert = books.filter(b => !existingNormMap2[normT2(b.title)]);
    const toUpdate = upsertMode ? books.filter(b => existingNormMap2[normT2(b.title)]) : [];
    const getBmExistingId = title => existingNormMap2[normT2(title)];
    const dup = books.length - toInsert.length;

    if(!toInsert.length && !toUpdate.length) {
      await showAlert('가져올 책이 없어요.'); return;
    }

    // 신규 책 업로드
    let insertedIds = [];
    for(let i=0; i<toInsert.length; i+=50) {
      const { data: inserted, error } = await sb.from('books').insert(toInsert.slice(i,i+50)).select('id,title');
      if(error) throw error;
      if(inserted) insertedIds.push(...inserted);
    }

    // 기존 책 업데이트 (덮어쓰기 모드)
    for(const book of toUpdate) {
      const bookId = getBmExistingId(book.title);
      if(!bookId) continue;
      const safeRating = book.rating!=null ? (v=>{const n=parseFloat(v);return n>=0&&n<=5?Math.round(n*2)/2:null;})(book.rating) : null;
      const { error } = await sb.from('books').update({
        author: book.author||undefined,
        publisher: book.publisher||undefined,
        status: book.status,
        rating: safeRating,
        date_start: book.date_start||undefined,
        date_finish: book.date_finish||undefined,
        pages: book.pages||undefined,
        review: book.review||undefined,
      }).eq('id', bookId);
      if(!error) insertedIds.push({id: bookId, title: book.title});
    }

    // 표지 자동 검색
    if(insertedIds.length > 0) {
      const updatePromises = insertedIds.map(async (book) => {
        try {
          const bk = newBooks.find(b=>b.title===book.title)||toUpdate.find(b=>b.title===book.title);
          const cover = await fetchBookCover(book.title, bk?.author, bk?.publisher);
          if(cover) await sb.from('books').update({cover}).eq('id', book.id);
        } catch(e) { /* 표지 검색 실패는 무시 */ }
      });
      // 5개씩 처리 (API 부하 방지)
      for(let i=0; i<updatePromises.length; i+=5) {
        await Promise.all(updatePromises.slice(i,i+5));
        await new Promise(r=>setTimeout(r,200));
      }
    }

    // 문장(노트) 가져오기 - 북모리 노트 시트 파싱
    let quoteCount = 0;
    // 신규 + 업데이트 책 모두 포함
    const allImportedIds = Object.fromEntries([
      ...insertedIds.map(b=>[b.title, b.id]),
      ...toUpdate.map(b=>[b.title, getBmExistingId(b.title)]).filter(([,id])=>id)
    ]);
    // 북모리 노트 시트: "노트 (책제목)" 형식
    for(const sheetName of wb.SheetNames.slice(1)) {
      const match = sheetName.match(/노트\s*\((.+)\)/);
      if(!match) continue;
      const bookTitle = match[1].trim();
      const bookId = allImportedIds[bookTitle] ||
        Object.entries(allImportedIds).find(([t])=>t.includes(bookTitle)||bookTitle.includes(t))?.[1];
      if(!bookId) continue;
      const noteWs = wb.Sheets[sheetName];
      // header:1 → 배열 배열 형태로 파싱
      const noteRows = XLSX.utils.sheet_to_json(noteWs, {defval:'', header:1});
      // 북모리 노트 구조:
      // 행0: ['노트 정보', '', '', '']  ← 섹션헤더
      // 행1: ['날짜', '페이지', '노트 타입', '내용']  ← 컬럼명
      // 행2~: ['날짜값', '페이지값', '책 속 문장', '실제문장내용']  ← 데이터

      // "내용" 컬럼 인덱스 찾기 (2행에서)
      let contentIdx = 3; // 기본값: 4번째 컬럼
      if(noteRows.length >= 2) {
        const headerRow = noteRows[1];
        const found = headerRow.findIndex(v => String(v).trim() === '내용');
        if(found >= 0) contentIdx = found;
      }

      // 3행(index 2)부터 데이터
      const quoteTexts = [];
      for(const row of noteRows.slice(2)) {
        const text = String(row[contentIdx]||'').trim();
        if(!text || text.length < 3) continue;
        // 헤더 값이나 타입명이 들어오면 스킵
        if(['내용','날짜','페이지','노트 타입','책 속 문장','하이라이트','메모'].includes(text)) continue;
        if(text && text !== 'null' && text !== 'undefined') quoteTexts.push({book_id:bookId, user_id:currentUser.id, text, created_at:new Date().toISOString()});
      }
      if(quoteTexts.length) {
        // 기존 문장 중복 방지
        const {data: existing} = await sb.from('quotes').select('text').eq('book_id', bookId);
        const existingTexts = new Set((existing||[]).map(q=>q.text.trim()));
        const newQuotes = quoteTexts.filter(q=>!existingTexts.has(q.text.trim()));
        if(newQuotes.length) {
          await sb.from('quotes').insert(newQuotes);
          quoteCount += newQuotes.length;
        }
      }
    }

    await loadData(); buildBooks(); if(document.getElementById('q-feed'))renderQuotes();
    closeModal('modal-backup');
    await showAlert(`✅ 완료!\n신규: ${toInsert.length}권${toUpdate.length>0?` / 업데이트: ${toUpdate.length}권`:''}\n표지 자동 검색 완료\n${quoteCount>0?`문장 ${quoteCount}개 가져옴`:''}`);
  } catch(e) {
    await showAlert('가져오기 오류: '+e.message);
    console.error('excel import error:', e);
  }
}


// ── HTML → 순수 텍스트 정리 (모든 에디터에서 공통 사용)
function cleanEditorHtml(h) {
  let s = String(h||'');
  // 1. div/br 줄바꿈 처리
  s = s.replace(/<div><br\s*\/?><\/div>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/div>\s*<div>/gi, '\n');
  s = s.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '');
  s = s.replace(/<p>/gi, '\n').replace(/<\/p>/gi, '');
  // 2. 서식 없는 span 제거
  s = s.replace(/<span(?![^>]*(?:background|color|font))[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  // 3. 유지 태그(b,strong,i,em,u,small,big,sub,sup,span) 외 제거
  s = s.replace(/<(?!\/?(?:b|strong|i|em|u|small|big|sub|sup|span)(\s[^>]*)?>)[^>]+>/gi, '');
  // 4. 엔티티 복원
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/gi, '&');
  s = s.replace(/&lt;/gi, '<');
  s = s.replace(/&gt;/gi, '>');
  // 5. 줄바꿈 정리
  s = s.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  return s.trim();
}

// UTC ISO 문자열을 KST(UTC+9) 날짜 문자열(YYYY-MM-DD)로 변환
function toKSTDate(utcStr) {
  if (!utcStr) return '';
  const kst = new Date(new Date(utcStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
// 로컬 기준 오늘 날짜 (YYYY-MM-DD) - 브라우저 로컬 시간 = 사용자 기기 시간대
function kstToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// UTC ISO 문자열을 KST 날짜+시간 문자열(YYYY-MM-DD HH:MM)로 변환
function toKSTDateTime(utcStr) {
  if (!utcStr) return '';
  const kst = new Date(new Date(utcStr).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 16).replace('T', ' ');
}

function formatDate(s) {
  if(!s) return null;
  if(s instanceof Date) return s.toISOString().slice(0,10);
  const v = String(s).trim().replace(/[./]/g,'-');
  const m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : null;
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let inQuote = false;
  for(let i = 0; i < line.length; i++) {
    const c = line[i];
    if(c === '"') {
      if(inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if(c === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else cur += c;
  }
  result.push(cur);
  return result;
}


// ── 표지 없는 책 일괄 검색
async function bulkFetchCovers() {
  const noCoverBooks = allBooks.filter(b => !b.cover || b.cover.trim() === '');
  if(!noCoverBooks.length) { await showAlert('모든 책에 표지가 있어요! 🎉'); return; }

  const progressEl = document.getElementById('cover-search-progress');
  if(progressEl) progressEl.style.display = '';

  let success = 0, fail = 0;
  for(let i = 0; i < noCoverBooks.length; i++) {
    const book = noCoverBooks[i];
    if(progressEl) progressEl.textContent = `검색 중... ${i+1}/${noCoverBooks.length} (성공 ${success}개)`;
    try {
      const cover = await fetchBookCover(book.title, book.author, book.publisher);
      if(cover) {
        await sb.from('books').update({cover}).eq('id', book.id);
        success++;
      } else fail++;
    } catch(e) { fail++; }
    await new Promise(r => setTimeout(r, 200));
  }

  await loadData();
  buildBooks();
  if(progressEl) progressEl.style.display = 'none';
  await showAlert(`✅ 표지 검색 완료!\n성공: ${success}권 / 실패: ${fail}권`);
}

// ══════════════════════════════════════
// 백업 & 복원
// ══════════════════════════════════════
async function downloadBackup() {
  try {
    const { data: books } = await sb.from('books').select('*').eq('user_id', currentUser.id);
    const { data: quotes } = await sb.from('quotes').select('*').eq('user_id', currentUser.id);
    const { data: goals } = await sb.from('user_goals').select('*').eq('user_id', currentUser.id);
    const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
    const backup = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      user: { email: currentUser.email, display_name: profile?.display_name },
      books: books || [],
      quotes: quotes || [],
      goals: goals?.[0] || {},
      categories: profile?.categories || []
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `booklog_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert('백업 파일이 다운로드됐어요!');
  } catch(e) { alert('백업 오류: '+e.message); }
}

async function restoreBackup(file) {
  if(!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data.version || !data.books) { alert('올바른 백업 파일이 아니에요.'); return; }
    if(!await showConfirm(`백업 파일을 복원할까요?
책 ${data.books.length}권, 문장 ${data.quotes.length}개
⚠️ 기존 데이터와 병합됩니다.`)) return;
    // 책 복원 (isbn 기준 중복 제외)
    const { data: existingBooks } = await sb.from('books').select('isbn').eq('user_id', currentUser.id);
    const existingIsbns = new Set((existingBooks||[]).map(b=>b.isbn).filter(Boolean));
    const newBooks = data.books
      .filter(b => !b.isbn || !existingIsbns.has(b.isbn))
      .map(b => ({...b, id: undefined, user_id: currentUser.id, created_at: b.created_at||new Date().toISOString()}));
    if(newBooks.length) await sb.from('books').insert(newBooks);
    // 목표 복원
    if(data.goals?.books || data.goals?.minutes || data.goals?.pages) {
      await sb.from('user_goals').upsert({
        user_id: currentUser.id,
        books: data.goals.books||0, minutes: data.goals.minutes||0, pages: data.goals.pages||0
      });
    }
    await loadData(); await loadGoals(); buildBooks(); if(document.getElementById('q-feed'))renderQuotes();
    alert(`복원 완료! 책 ${newBooks.length}권을 추가했어요.`);
    closeModal('modal-backup');
  } catch(e) { alert('복원 오류: '+e.message); }
}

// ══════════════════════════════════════
// 친구 & 파도타기 (서재 구경)
// ══════════════════════════════════════

// 아바타 HTML 생성 (사진 있으면 사진, 없으면 이니셜 원)
function makeAvatarHtml(name, avatarUrl, size=32) {
  const n = name || '?';
  const initial = n.slice(0,1).toUpperCase();
  const colors = ['#c4714a','#6b8f6b','#5a7a8a','#8b6b8b','#c8a050'];
  const color = colors[n.charCodeAt(0) % colors.length];
  const base = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;overflow:hidden;`;
  if(avatarUrl) {
    // CSS url()에 single-quote 사용 → HTML double-quote 충돌 없음
    const sUrl = avatarUrl.replace(/'/g, '%27');
    return `<div style="${base}background:${color};background-image:url('${sUrl}');background-size:cover;background-position:center;"></div>`;
  }
  return `<div style="${base}background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:700;">${initial}</div>`;
}
async function openSocialModal() {
  openModal('modal-social');
  // 이전 검색 결과 초기화
  const searchInput = document.getElementById('friend-search-input');
  const searchResult = document.getElementById('friend-search-result');
  if(searchInput) searchInput.value = '';
  if(searchResult) searchResult.innerHTML = '';
  loadFriends();
}

async function loadFriends() {
  const wrap = document.getElementById('friend-list');
  if(!wrap) return;
  wrap.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">불러오는 중...</div>';
  const { data } = await sb.from('friendships').select(`
    id, status, requester_id, receiver_id,
    requester:profiles!friendships_requester_id_fkey(id,display_name,username,user_title),
    receiver:profiles!friendships_receiver_id_fkey(id,display_name,username,user_title)
  `).or(`requester_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);
  // avatar_url은 JOIN이 아닌 직접 쿼리로 별도 조회 (스키마 캐시 문제 우회)
  const friendIds = (data||[]).map(f => f.requester_id===currentUser.id ? f.receiver_id : f.requester_id).filter(Boolean);
  const avatarMap = new Map();
  if(friendIds.length) {
    const {data:av} = await sb.from('profiles').select('id,avatar_url').in('id', friendIds);
    (av||[]).forEach(p => avatarMap.set(p.id, p.avatar_url));
  }

  wrap.innerHTML = '';
  if(!data?.length) {
    wrap.innerHTML=`<div style="text-align:center;padding:1.5rem .5rem;color:var(--tx3);">
      <div style="font-size:1.5rem;margin-bottom:.4rem;">👋</div>
      <div style="font-size:.78rem;">아직 친구가 없어요</div>
      <div style="font-size:.7rem;margin-top:.2rem;opacity:.7;">위에서 닉네임으로 검색해보세요</div>
    </div>`;
    return;
  }
  data.forEach(f => {
    const isMine = f.requester_id === currentUser.id;
    const other = isMine ? f.receiver : f.requester;
    const name = other?.display_name || other?.username || '산책자';
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:.7rem;padding:.55rem .2rem;border-bottom:1px solid var(--border);';
    const avatar = makeAvatarHtml(name, avatarMap.get(other?.id)||other?.avatar_url, 36);
    if(f.status === 'accepted') {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
          <div style="font-size:.65rem;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${other?.user_title||'산책자'}</div>
        </div>
        <button onclick="openLibrary('${other.id}','${name}')" style="font-size:.7rem;padding:.25rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--acc);font-family:var(--ff);">서재 보기</button>
        <button onclick="removeFriend('${f.id}')" style="width:28px;height:28px;border:none;background:#f5f0e8;border-radius:50%;cursor:pointer;color:var(--tx3);font-size:.75rem;display:flex;align-items:center;justify-content:center;" title="친구 삭제">✕</button>`;
    } else if(f.status === 'pending' && !isMine) {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
          <div style="font-size:.65rem;color:var(--acc);">친구 요청이 왔어요</div>
        </div>
        <button onclick="acceptFriend('${f.id}')" style="font-size:.7rem;padding:.25rem .6rem;border:none;border-radius:12px;background:var(--acc);cursor:pointer;color:#fff;font-family:var(--ff);">수락</button>
        <button onclick="removeFriend('${f.id}')" style="font-size:.7rem;padding:.25rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--tx3);font-family:var(--ff);">거절</button>`;
    } else {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
          <div style="font-size:.65rem;color:var(--tx3);">요청 대기 중...</div>
        </div>
        <button onclick="removeFriend('${f.id}')" style="font-size:.7rem;padding:.25rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--tx3);font-family:var(--ff);">취소</button>`;
    }
    wrap.appendChild(el);
  });
}

async function searchFriend() {
  const q = document.getElementById('friend-search-input')?.value.trim();
  const resultEl = document.getElementById('friend-search-result');
  if(!resultEl) return;
  if(!q) { resultEl.innerHTML = ''; return; }
  const [_r1] = await Promise.all([
    sb.from('profiles').select('id,display_name,username,avatar_url,role').ilike('display_name',`%${q}%`).neq('id',currentUser.id).limit(5),
  ]);
  const _seen=new Set();
  const data=(_r1.data||[]).filter(u=>{if(_seen.has(u.id))return false;_seen.add(u.id);return true;}).slice(0,5);
  resultEl.innerHTML = '';
  if(!data?.length) {
    resultEl.innerHTML='<div style="padding:.6rem .8rem;font-size:.75rem;color:var(--tx3);text-align:center;">검색 결과가 없어요.</div>';
    return;
  }
  data.forEach(u => {
    const name = u.display_name || u.username;
    const adminBadge = u.role==='admin' ? '<span style="font-size:.55rem;background:var(--acc);color:#fff;border-radius:3px;padding:1px 5px;font-weight:600;margin-left:.25rem;vertical-align:middle;">관리자</span>' : '';
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.55rem .8rem;border-bottom:1px solid var(--border);background:#fff;';
    el.onmouseenter = () => el.style.background = '#faf6ef';
    el.onmouseleave = () => el.style.background = '#fff';
    el.innerHTML = `
      ${makeAvatarHtml(name, u.avatar_url, 32)}
      <span style="flex:1;min-width:0;font-size:.82rem;font-weight:500;color:var(--tx1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}${adminBadge}</span>
      <button onclick="sendFriendRequest('${u.id}','${name}')" style="font-size:.7rem;padding:.22rem .6rem;border:none;border-radius:12px;background:var(--acc);cursor:pointer;color:#fff;font-family:var(--ff);flex-shrink:0;">+ 친구</button>
      <button onclick="openLibrary('${u.id}','${name}')" style="font-size:.7rem;padding:.22rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--tx2);font-family:var(--ff);flex-shrink:0;">서재</button>`;
    resultEl.appendChild(el);
  });
}

async function sendFriendRequest(receiverId, name) {
  const { error } = await sb.from('friendships').insert({requester_id: currentUser.id, receiver_id: receiverId});
  if(error) { alert(error.message.includes('unique') ? '이미 친구 요청을 보냈어요.' : error.message); return; }
  // 알림
  await sb.from('notifications').insert({
    user_id: receiverId, type: 'friend_request',
    message: `📬 친구 요청이 왔어요!`,
    is_read: false, created_at: new Date().toISOString()
  });
  alert(`${name}님에게 친구 요청을 보냈어요!`);
  loadFriends();
}

async function acceptFriend(friendshipId) {
  await sb.from('friendships').update({status:'accepted'}).eq('id', friendshipId);
  loadFriends();
  alert('친구 요청을 수락했어요!');
}

async function removeFriend(friendshipId) {
  if(!await showConfirm('친구를 삭제할까요?')) return;
  await sb.from('friendships').delete().eq('id', friendshipId);
  loadFriends();
}

// 파도타기 - 관리자 서재 구경 (k_tenten@naver.com)
async function surfLibrary() {
  // 파도타기 - 공개 서재 완전 랜덤 (k_tenten 우선 제거)
  try {
    const { data: allP } = await sb.from('profiles')
      .select('id,display_name,username,library_public,library_visibility')
      .neq('id', currentUser.id).limit(500);
    const pub = (allP||[]).filter(p =>
      p.library_public === true || p.library_visibility === 'public' ||
      (!p.library_visibility && p.library_public !== false)
    );
    if(!pub.length) { await showAlert('아직 공개된 서재가 없어요.'); return; }
    const r = pub[Math.floor(Math.random() * pub.length)];
    localStorage.setItem('bl_surf_count', String((parseInt(localStorage.getItem('bl_surf_count')||'0')+1)));
    openLibrary(r.id, r.display_name || r.username || '산책자');
  } catch(e) {
    console.error('surfLibrary:', e);
    await showAlert('서재를 불러오는 중 오류가 발생했어요.');
  }
}

// 서재 구경 상태
let _libBooks = [], _libFilter = '전체', _libCatFilter = new Set(), _libUserId = null, _libUserName = '';
let _libCalY = new Date().getFullYear(), _libCalM = new Date().getMonth();

async function openLibrary(userId, userName) {
  closeModal('modal-social');

  // 1단계: 프로필 먼저 확인 (공개 범위 체크)
  const { data: targetProfile } = await sb.from('profiles')
    .select('library_public,library_visibility,category_visibility,categories,user_title,avatar_url')
    .eq('id',userId).single();
  const visibility = targetProfile?.library_visibility ||
    (targetProfile?.library_public === false ? 'private' : 'public');

  if(visibility === 'private') { await showAlert(`${userName}님의 서재는 비공개예요.`); return; }

  // 친구 여부 확인
  const { data: fData } = await sb.from('friendships').select('id').eq('status','accepted')
    .or(`and(requester_id.eq.${currentUser.id},receiver_id.eq.${userId}),and(requester_id.eq.${userId},receiver_id.eq.${currentUser.id})`)
    .limit(1);
  const isFriend = !!fData?.length;

  if(visibility === 'friends' && !isFriend) {
    await showAlert(`${userName}님의 서재는 친구에게만 공개돼 있어요.`); return;
  }

  // 2단계: 공개 확인 후 books 로드
  const { data: books, error: booksErr } = await sb.from('books')
    .select('*').eq('user_id', userId).order('created_at',{ascending:false});

  if(booksErr || !books) {
    await showAlert('서재를 불러올 수 없어요. 잠시 후 다시 시도해주세요.');
    return;
  }
  const canSeeCat = !targetProfile?.category_visibility ||
    targetProfile.category_visibility === 'public' ||
    (targetProfile.category_visibility === 'friends' && isFriend);
  _libBooks = books || [];
  _libFilter = '전체';
  _libCatFilter = new Set();
  _libUserId = userId;
  _libUserName = userName;
  _libCalY = new Date().getFullYear();
  _libCalM = new Date().getMonth();

  const header = document.getElementById('library-modal-header');
  const body = document.getElementById('library-modal-body');
  if(!header || !body) return;

  const totalDone = _libBooks.filter(b=>b.status==='완독').length;
  const totalDoneLib = _libBooks.filter(b=>b.status==='완독').length;
  const totalReading = _libBooks.filter(b=>b.status==='읽는중').length;
  const cats = canSeeCat ? (targetProfile.categories||[]) : [];

  header.innerHTML = `
    <div style="padding:1.1rem 1.2rem .9rem;border-bottom:1px solid var(--border);position:relative;background:var(--card);">
      <button onclick="closeModal('modal-library')" style="position:absolute;top:.8rem;right:.9rem;width:28px;height:28px;border:none;border-radius:50%;background:var(--border);color:var(--tx2);cursor:pointer;font-size:.8rem;display:flex;align-items:center;justify-content:center;">✕</button>
      <div style="display:flex;align-items:center;gap:.85rem;padding-right:2rem;">
        ${makeAvatarHtml(userName, targetProfile?.avatar_url, 44)}
        <div>
          <div style="font-family:var(--fs);font-size:1.15rem;color:var(--tx1);line-height:1.2;">${userName}님의 서재</div>
          <div style="font-size:.58rem;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3);margin-top:.25rem;">${targetProfile?.user_title||'함께 읽는 산책자'}</div>
        </div>
      </div>
      <div style="display:flex;gap:1.6rem;margin-top:.85rem;padding-top:.7rem;border-top:1px solid var(--border);">
        <div><span style="font-family:var(--fs);font-style:italic;font-size:1.05rem;color:var(--rust);">${totalDoneLib}</span>&ensp;<span style="font-size:.6rem;color:var(--tx3);">완독</span></div>
        <div><span style="font-family:var(--fs);font-style:italic;font-size:1.05rem;color:var(--rust);">${totalReading}</span>&ensp;<span style="font-size:.6rem;color:var(--tx3);">읽는중</span></div>
        <div><span style="font-family:var(--fs);font-style:italic;font-size:1.05rem;color:var(--rust);">${_libBooks.length}</span>&ensp;<span style="font-size:.6rem;color:var(--tx3);">전체</span></div>
      </div>
    </div>
    <!-- 필터 탭 -->
    <div style="padding:.7rem 1rem .3rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--card);">
      <button class="filter-btn on" id="lib-f-전체" onclick="libFilter('전체',this)">전체</button>
      <button class="filter-btn" id="lib-f-완독" onclick="libFilter('완독',this)">완독</button>
      <button class="filter-btn" id="lib-f-읽는중" onclick="libFilter('읽는중',this)">읽는중</button>
      <button class="filter-btn" id="lib-f-읽고싶음" onclick="libFilter('읽고싶음',this)">읽고싶음</button>
      ${cats.length ? `<span style="font-size:.6rem;color:var(--border2);margin:0 .1rem;">│</span>
        <button class="filter-btn${_libCatFilter.size===0?' on':''}" id="lib-cat-all" onclick="libCatFilter(null,this)">전체</button>
        ${cats.map(c=>`<button class="filter-btn${_libCatFilter.has(c)?' on':''}" id="lib-cat-${c.replace(/\s/g,'_')}" onclick="libCatFilter('${c}',this)">${c}</button>`).join('')}` : ''}
    </div>`;

  body.innerHTML = `
    <!-- 달력 -->
    <div id="lib-cal-wrap" style="padding:.8rem 1rem .4rem;border-bottom:1px solid var(--border);"></div>
    <!-- 갤러리 -->
    <div id="lib-gallery" class="gallery" style="padding:.8rem 1rem 1.2rem;"></div>`;

  renderLibCal();
  renderLibGallery();
  openModal('modal-library');
}

function libFilter(f, btn) {
  _libFilter = f;
  _libCatFilter = new Set(); // 상태 필터 바꾸면 카테고리 필터도 초기화
  document.querySelectorAll('[id^="lib-f-"]').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('[id^="lib-cat-"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  // lib-cat-all도 on으로
  document.getElementById('lib-cat-all')?.classList.add('on');
  renderLibGallery();
}

function libCatFilter(cat, btn) {
  if(cat === null) {
    _libCatFilter = new Set();
    document.querySelectorAll('[id^="lib-cat-"]').forEach(b=>b.classList.remove('on'));
    document.getElementById('lib-cat-all')?.classList.add('on');
  } else {
    if(_libCatFilter.has(cat)) _libCatFilter.delete(cat); else _libCatFilter.add(cat);
    document.getElementById('lib-cat-all')?.classList.toggle('on', _libCatFilter.size===0);
    btn.classList.toggle('on', _libCatFilter.has(cat));
  }
  renderLibGallery();
}

function renderLibGallery() {
  const g = document.getElementById('lib-gallery');
  if(!g) return;
  let list = _libBooks;
  if(_libFilter !== '전체') list = list.filter(b=>b.status===_libFilter);
  if(_libCatFilter.size) list = list.filter(b=>_libCatFilter.has(b.category||''));
  g.innerHTML = '';
  if(!list.length) { g.innerHTML='<div class="empty-state">책이 없어요.</div>'; return; }
  list.forEach(b => {
    const el = document.createElement('div');
    el.className = 'gi';
    el.style.cursor = 'default';
    const img = b.cover
      ? `<img src="${b.cover}" alt="${b.title}" style="width:100%;height:100%;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.42rem;color:rgba(255,255,255,.8);text-align:center;padding:.2rem;font-style:italic;line-height:1.3;">${b.title}</div>`;
    const lMins = b.reading_time || 0;
    let lTimeStr;
    if(lMins===0) lTimeStr='독서 기록 없음';
    else if(lMins<60) lTimeStr=`${lMins}분 독서`;
    else { const h=Math.floor(lMins/60),m=lMins%60; lTimeStr=m>0?`${h}시간 ${m}분 독서`:`${h}시간 독서`; }
    const lCover = b.cover ? `<img src="${b.cover}" class="gi-thought-cover" alt="">` : `<div class="gi-thought-cover"></div>`;
    el.innerHTML = `<div class="gi-thought">${lCover}<div class="gi-thought-info"><div class="gi-thought-ttl">${b.title}</div><div class="gi-thought-time">⏱ ${lTimeStr}</div></div></div>
      <div class="gi-cover">${img}</div>
      <div class="gi-title">${b.title}</div>
      <div class="gi-author">${b.author||''}</div>
      <div class="gi-stars">${Array.from({length:5},(_,i)=>(parseFloat(b.rating)||0)>=i+1?'★':(parseFloat(b.rating)||0)>=i+0.5?'<span class="gi-hstar">★</span>':'☆').join('')}</div>
      <span class="gi-status">${b.status||''}</span>`;
    g.appendChild(el);
  });
}

function moveLibCal(dir) {
  _libCalM += dir;
  if(_libCalM > 11) { _libCalM = 0; _libCalY++; }
  if(_libCalM < 0) { _libCalM = 11; _libCalY--; }
  renderLibCal();
}

function renderLibCal() {
  const wrap = document.getElementById('lib-cal-wrap');
  if(!wrap) return;
  const y = _libCalY, m = _libCalM;
  const MN=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const daysInMonth = new Date(y,m+1,0).getDate();
  const firstDay = new Date(y,m,1).getDay();
  const totalDoneLib = _libBooks.filter(b=>b.status==='완독').length;
  const totalReading = _libBooks.filter(b=>b.status==='읽는중').length;
  // 해당 월 완독 맵
  const finishMap = {};
  _libBooks.filter(b=>b.status==='완독' && b.date_finish?.startsWith(`${y}-${String(m+1).padStart(2,'0')}`))
    .forEach(b=>{ const d=parseInt(b.date_finish.slice(8,10)); finishMap[d]=(finishMap[d]||0)+1; });
  const thisMonthDone = Object.values(finishMap).reduce((a,b)=>a+b,0);
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
      <button onclick="moveLibCal(-1)" style="background:none;border:1px solid var(--border2);border-radius:4px;padding:.1rem .4rem;cursor:pointer;font-size:.7rem;color:var(--tx3);">◀</button>
      <div style="text-align:center;">
        <div style="font-size:.7rem;font-weight:600;color:var(--tx2);">📅 ${y}년 ${MN[m]}</div>
        <div style="font-size:.62rem;color:var(--acc);">${thisMonthDone > 0 ? `이달 ${thisMonthDone}권 완독 🎉` : '완독 없음'}</div>
      </div>
      <button onclick="moveLibCal(1)" style="background:none;border:1px solid var(--border2);border-radius:4px;padding:.1rem .4rem;cursor:pointer;font-size:.7rem;color:var(--tx3);">▶</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
      ${['일','월','화','수','목','금','토'].map(d=>`<div style="font-size:.52rem;color:var(--tx3);text-align:center;padding:.08rem 0;">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}
      ${Array.from({length:daysInMonth},(_,i)=>{
        const d=i+1, cnt=finishMap[d]||0;
        // 해당 날 완독 책 중 표지 있는 첫 번째
        const finishedBook = cnt ? _libBooks.find(b=>{
          const fd = b.date_finish;
          return fd && parseInt(fd.slice(8,10))===d &&
            fd.startsWith(`${y}-${String(m+1).padStart(2,'0')}`);
        }) : null;
        const coverImg = finishedBook?.cover
          ? `<img src="${finishedBook.cover}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;" title="${finishedBook.title}">`
          : '';
        return `<div style="aspect-ratio:1;border-radius:3px;background:${cnt?'var(--acc)':'var(--border)'};display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;" title="${d}일${cnt?' 완독'+cnt+'권':''}">
          ${coverImg || `<span style="font-size:.48rem;color:${cnt?'#fff':'var(--tx3)'};">${d}</span>`}
          ${cnt>1?`<span style="position:absolute;bottom:0;right:0;background:rgba(0,0,0,.5);color:#fff;font-size:.38rem;padding:0 2px;border-radius:2px 0 3px 0;">+${cnt}</span>`:''}
        </div>`;
      }).join('')}
    </div>`;
}

// 카테고리 공개 설정
async function saveCategoryVisibility(val) {
  await sb.from('profiles').update({category_visibility: val}).eq('id', currentUser.id);
}
async function saveLibraryPublic(val) {
  // val: 'public'(전체), 'friends'(친구만), 'private'(비공개)
  const isPublic = val === 'public';
  await sb.from('profiles').update({
    library_public: isPublic,
    library_visibility: val  // 상세 설정 저장
  }).eq('id', currentUser.id);
}

// ── 모달 유틸
function openModal(id){const el=document.getElementById(id);if(el){el.style.display='flex';history.pushState({modal:id},'',location.href);}}
function closeModal(id){document.getElementById(id).style.display='none';}
// modal overlay click-outside: init에서 등록

// ══════════════════════════════════════
// 게시판
// ══════════════════════════════════════
let boardFilter = 'all', boardPage = 1, boardEditId = null;
const BOARD_PER_PAGE = 10;
let curUserRole = 'user';

async function loadUserRole() {
  if(!currentUser) return;
  // 관리자 ID 직접 체크 (DB 오류 대비)
  if(currentUser.id === '191744c3-0cdd-4c15-b08c-6ec82e9ab3f8') { curUserRole = 'admin'; return; }
  try {
    const { data } = await sb.from('profiles').select('role').eq('id', currentUser.id).single();
    curUserRole = data?.role || 'user';
  } catch(e) { curUserRole = 'user'; }
}

// ── 산책 게시판 새 글 알림 (3일 이내)
async function checkBoardNew() {
  try {
    const lastSeen = localStorage.getItem('bl_board_last_seen') || new Date(0).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await sb.from('posts')
      .select('id', {count:'exact', head:true})
      .eq('is_notice', false)
      .gt('created_at', lastSeen)
      .gte('created_at', threeDaysAgo);
    const dot = document.getElementById('board-new-dot');
    if(dot) dot.style.display = (count && count > 0) ? 'block' : 'none';
  } catch(e) {}
}
function markBoardSeen() {
  localStorage.setItem('bl_board_last_seen', new Date().toISOString());
  const dot = document.getElementById('board-new-dot');
  if(dot) dot.style.display = 'none';
}

async function buildBoard() {
  markBoardSeen();
  if(curUserRole === 'user') await loadUserRole();
  // 공지 표시
  const nWrap = document.getElementById('board-notice-wrap');
  if(!nWrap) return; // 게시판 패널이 없으면 완전히 중단
  const { data: notices } = await sb.from('posts')
    .select('*').eq('is_notice', true).order('created_at', {ascending:false});
  nWrap.innerHTML = '';
  (notices||[]).forEach(n => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;background:#fffbe6;border:1px solid #f0d060;border-radius:5px;margin-bottom:.35rem;cursor:pointer;';
    el.onclick = () => openPostDetail(n.id);
    el.innerHTML = `<span style="font-size:.65rem;background:#e0a020;color:#fff;border-radius:3px;padding:1px 5px;flex-shrink:0;">공지</span>
      <span style="font-size:.78rem;font-weight:600;color:#2e1f0e;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.title}</span>
      <span style="font-size:.62rem;color:#a08c72;">${toKSTDate(n.created_at)}</span>`;
    nWrap.appendChild(el);
  });

  // 게시글 목록
  await renderBoardList();
}

async function renderBoardList() {
  const list = document.getElementById('board-list');
  if(!list) return;
  list.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.8rem;text-align:center;">불러오는 중...</div>';

  const searchQ = (document.getElementById('board-search')?.value||'').trim();
  const catLabel = {free:'💭 자유', book:'📖 책 이야기', review:'✨ 감상 공유'};

  // 공지 필터
  if(boardFilter === 'notice') {
    let q = sb.from('posts').select('*',{count:'exact'}).eq('is_notice',true).order('created_at',{ascending:false});
    if(searchQ) q = q.ilike('title', `%${searchQ}%`);
    const { data: posts, count } = await q;
    renderPostItems(list, posts||[], count||0, catLabel);
    return;
  }

  // 일반 목록 (전체/카테고리 + 검색)
  let query = sb.from('posts').select('*',{count:'exact'})
    .eq('is_notice', false).order('created_at',{ascending:false});
  if(boardFilter !== 'all') query = query.eq('category', boardFilter);
  if(searchQ) query = query.ilike('title', `%${searchQ}%`);
  const from = (boardPage-1)*BOARD_PER_PAGE, to = from+BOARD_PER_PAGE-1;
  query = query.range(from, to);
  const { data: posts, count } = await query;
  renderPostItems(list, posts||[], count||0, catLabel);
}

function renderPostItems(list, posts, count, catLabel) {
  list.innerHTML = '';
  if(!posts.length) {
    list.innerHTML = '<div class="empty-state" style="padding:2rem;">게시글이 없어요.</div>';
  } else {
    posts.forEach(p => {
      const el = document.createElement('div');
      el.className = 'board-item' + (p.is_notice ? ' post-notice' : '');
      el.onclick = () => openPostDetail(p.id);
      const isBlind = p.is_hidden;
      const cat = catLabel[p.category]||'';
      const excerpt = isBlind ? '' : (()=>{
        const txt=(p.content||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
        return txt.length>80?txt.slice(0,80)+'…':txt;
      })();
      el.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:.5rem;">
          <div style="flex:1;min-width:0;">
            ${(p.is_notice||cat)?`<div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.22rem;">
              ${p.is_notice?'<span class="post-badge-notice">📌 공지</span>':''}
              ${cat?`<span class="board-cat">${cat}</span>`:''}
            </div>`:''}
            <div class="board-title" style="${isBlind?'color:var(--tx3);font-style:italic;':''}">${isBlind?'🚫 신고 게시글로 분류되었습니다.':p.title}</div>
            ${excerpt?`<div style="font-size:.7rem;color:var(--tx3);margin-top:.18rem;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${excerpt}</div>`:''}
          </div>
          <div style="flex-shrink:0;text-align:right;padding-left:.3rem;">
            <div class="board-meta" style="margin-bottom:.15rem;">${toKSTDate(p.created_at).slice(5,10).replace('-','.')}</div>
            <div class="board-meta" style="color:var(--acc);font-size:.63rem;">❤ ${p.likes||0}</div>
          </div>
        </div>`;
      list.appendChild(el);
    });
  }
  // 페이지네이션 (공지 필터 시 숨김)
  const pg = document.getElementById('board-pagination');
  if(!pg) return;
  pg.innerHTML = '';
  if(boardFilter !== 'notice' && count > BOARD_PER_PAGE) {
    const totalPages = Math.ceil(count/BOARD_PER_PAGE);
    let html = `<button class="yr-btn" onclick="boardGoPage(${boardPage-1})" ${boardPage===1?'disabled ':''}style="font-size:.72rem;">‹</button>`;
    for(let i=1;i<=totalPages;i++){
      if(totalPages>7 && i>2 && i<totalPages-1 && Math.abs(i-boardPage)>1){
        if(i===3||i===totalPages-2) html+=`<span style="padding:0 .2rem;color:var(--tx3);">…</span>`;
        continue;
      }
      html+=`<button class="yr-btn${i===boardPage?' on':''}" onclick="boardGoPage(${i})" style="${i===boardPage?'background:var(--acc);color:#fff;border-color:transparent;':''}">${i}</button>`;
    }
    html+=`<button class="yr-btn" onclick="boardGoPage(${boardPage+1})" ${boardPage===totalPages?'disabled ':''}style="font-size:.72rem;">›</button>`;
    html+=`<span style="font-size:.7rem;color:var(--tx3);margin-left:.3rem;">${boardPage}/${totalPages}</span>`;
    pg.innerHTML = html;
  }
}

function boardGoPage(p) {
  boardPage = p;
  renderBoardList();
  document.getElementById('board-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


async function showMyPosts() {
  // 이미 내 글 필터면 전체로 돌아가기 (토글)
  if(boardFilter === 'mine') {
    filterBoard('all', document.getElementById('board-all-btn'));
    return;
  }
  const { data: posts } = await sb.from('posts')
    .select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false});
  const wrap = document.getElementById('board-list');
  if(!wrap) return;
  document.querySelectorAll('#board-all-btn,#board-notice-btn,#board-mine-btn').forEach(b=>b.classList.remove('on'));
  const myBtn = document.getElementById('board-mine-btn');
  if(myBtn) myBtn.classList.add('on');
  boardFilter = 'mine'; boardPage = 1;
  wrap.innerHTML = '';
  if(!posts?.length) { wrap.innerHTML='<div class="empty-state">작성한 글이 없어요.</div>'; return; }
  const catLabel = {free:'💭 자유', book:'📖 책 이야기', review:'✨ 감상 공유'};
  posts.forEach(p => {
    const el = document.createElement('div');
    el.className = 'board-item' + (p.is_notice?' post-notice':'');
    el.onclick = () => openPostDetail(p.id);
    const cat = catLabel[p.category]||'';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:.22rem;flex-wrap:wrap;">
        ${p.is_notice?'<span class="post-badge-notice">📌 공지</span>':''}
        ${cat?`<span class="board-cat">${cat}</span>`:''}
        <span class="board-title">${p.is_hidden?'🚫 블라인드 처리됨':p.title}</span>
      </div>
      <div style="display:flex;align-items:center;gap:.6rem;">
        <span class="board-meta">${toKSTDate(p.created_at)}</span>
        <span class="board-meta" style="margin-left:auto;">❤️ ${p.likes||0}</span>
      </div>`;
    wrap.appendChild(el);
  });
  const pg = document.getElementById('board-pagination');
  if(pg) pg.innerHTML = '';
}

function filterBoard(f, btn) {
  boardFilter=f; boardPage=1;
  document.querySelectorAll('#board-all-btn,#board-notice-btn,#board-mine-btn').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderBoardList();
}

function openPostWrite(editId=null) {
  boardEditId = editId;
  // post-write-title은 modal-post 안에 있음
  const titleLabel = document.getElementById('post-write-title');
  if(titleLabel) titleLabel.textContent = editId ? '글 수정' : '글쓰기';
  const titleInput = document.getElementById('post-title');
  if(titleInput) titleInput.value = '';
  const editor = document.getElementById('post-editor');
  if(editor) editor.innerHTML = '';
  const catSel = document.getElementById('post-category');
  if(catSel) catSel.value = 'free';
  const noticeWrap = document.getElementById('post-notice-wrap');
  if(noticeWrap) noticeWrap.style.display = curUserRole==='admin' ? '' : 'none';
  const noticeChk = document.getElementById('post-is-notice');
  if(noticeChk) noticeChk.checked = false;
  if(editId) {
    sb.from('posts').select('*').eq('id', editId).single().then(({data:p})=>{
      if(!p) return;
      if(titleInput) titleInput.value = p.title;
      if(editor) editor.innerHTML = p.content || '';
      if(catSel) catSel.value = p.category||'free';
      if(noticeChk) noticeChk.checked = p.is_notice;
    });
  }
  openModal('modal-post');
}

async function submitPost() {
  // 제한된 사용자 차단
  const { data: myProfile } = await sb.from('profiles').select('is_banned').eq('id',currentUser.id).single();
  if(myProfile?.is_banned) { alert('계정이 제한되어 글을 작성할 수 없어요.'); closeModal('modal-post'); return; }
  const titleEl = document.getElementById('post-title');
  if(!titleEl) { alert('폼을 찾을 수 없어요.'); return; }
  const title = titleEl.value.trim();
  if(!title) { alert('제목을 입력해주세요.'); titleEl.focus(); return; }
  // 에디터 또는 textarea 중 있는 것 사용
  const editor  = document.getElementById('post-editor');
  const textarea = document.getElementById('post-content');
  const content = editor ? editor.innerHTML : (textarea?.value || '');
  const textOnly = editor ? editor.innerText.trim() : (textarea?.value.trim() || '');
  if(!textOnly) { alert('내용을 입력해주세요.'); (editor||textarea)?.focus(); return; }
  const cat = document.getElementById('post-category')?.value || 'free';
  const notice = curUserRole==='admin' && document.getElementById('post-is-notice')?.checked;
  const payload = {
    user_id: currentUser.id, title, content,
    is_anonymous: true, category: cat, is_notice: notice,
    updated_at: new Date().toISOString()
  };
  try {
    if(boardEditId) {
      await sb.from('posts').update(payload).eq('id', boardEditId);
    } else {
      await sb.from('posts').insert({...payload, created_at: new Date().toISOString()});
    }
    closeModal('modal-post');
    boardEditId = null;
    await buildBoard();
  } catch(e) { alert('등록 오류: '+(e.message||'알 수 없는 오류')); }
}

async function openPostDetail(postId) {
  const { data: post } = await sb.from('posts').select('*').eq('id', postId).single();
  if(!post) return;
  const { data: comms } = await sb.from('comments').select('*').eq('post_id', postId).order('created_at');
  const isMine = post.user_id === currentUser.id;
  const isAdmin = curUserRole === 'admin';

  // 댓글 작성자 번호 매핑 (익명 → 산책자1,2,3...)
  const authorMap = {};
  let authorCount = 0;
  (comms||[]).forEach(c => {
    if(!authorMap[c.user_id]) {
      if(c.user_id === post.user_id) authorMap[c.user_id] = '__author__';
      else { authorCount++; authorMap[c.user_id] = `산책자${authorCount}`; }
    }
  });
  function getCommentAuthor(userId) {
    if(userId === post.user_id) return '<span style="color:#2e7d32;font-weight:700;font-size:.65rem;">[작성자]</span>';
    return `<span style="font-size:.65rem;color:var(--tx3);">${authorMap[userId]||'산책자'}</span>`;
  }

  const detailBody = document.getElementById('post-detail-body');
  if(!detailBody) { openModal('modal-post-detail'); return; }
  // 제목 설정
  const titleEl = document.getElementById('post-detail-title');
  if(titleEl) titleEl.textContent = (post.is_notice ? '📌 ' : '') + post.title;
  const catLabel = {free:'💭 자유', book:'📖 책 이야기', review:'✨ 감상 공유'}[post.category]||'';

  // 좋아요 중복 방지 - localStorage 기반
  const { data: likedRow } = await sb.from('post_likes')
    .select('post_id').eq('post_id', postId).eq('user_id', currentUser.id).single();
  const alreadyLiked = !!likedRow;

  const commentsHtml = (comms||[]).filter(c=>!c.parent_id).map(c => {
    const replies = (comms||[]).filter(r=>r.parent_id===c.id);
    const canDelete = c.user_id===currentUser.id || isAdmin;
    const replyHtml = replies.map(r => {
      const rCanDelete = r.user_id===currentUser.id || isAdmin;
      return `<div style="margin-left:1.2rem;padding:.35rem 0 .35rem .7rem;border-left:2px solid var(--border2);margin-top:.3rem;">
        <div style="font-size:.65rem;color:var(--tx3);margin-bottom:.1rem;">${getCommentAuthor(r.user_id)} · ${toKSTDate(r.created_at)}</div>
        <div style="font-size:.75rem;color:var(--tx1);line-height:1.6;word-break:break-word;">${r.content}</div>
        ${rCanDelete?`<button onclick="deleteComment('${r.id}','${postId}')" style="font-size:.6rem;color:var(--tx3);border:none;background:none;cursor:pointer;margin-top:.1rem;">삭제</button>`:''}
      </div>`;
    }).join('');
    return `<div style="padding:.5rem 0;border-bottom:1px solid #ede4d0;">
      <div style="display:flex;align-items:flex-start;gap:.5rem;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:.68rem;margin-bottom:.18rem;">${getCommentAuthor(c.user_id)} · ${toKSTDate(c.created_at)}</div>
          <div style="font-size:.78rem;color:var(--tx1);line-height:1.7;white-space:pre-wrap;word-break:break-word;">${c.content}</div>
        </div>
        <div style="display:flex;gap:.3rem;flex-shrink:0;">
          <button onclick="showReplyInput('${c.id}')" style="font-size:.6rem;color:var(--acc);border:1px solid var(--border2);border-radius:3px;padding:1px 5px;background:none;cursor:pointer;">답글</button>
          ${canDelete?`<button onclick="deleteComment('${c.id}','${postId}')" style="font-size:.6rem;color:var(--tx3);border:none;background:none;cursor:pointer;">삭제</button>`:''}
        </div>
      </div>
      ${replyHtml}
      <div id="reply-box-${c.id}" style="display:none;margin-top:.5rem;margin-left:1.2rem;">
        <div style="background:var(--bg);border:1.5px solid var(--border2);border-radius:10px;overflow:hidden;">
          <textarea id="reply-input-${c.id}" placeholder="답글을 입력해주세요..." rows="2"
            style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border:none;outline:none;font-size:.78rem;font-family:var(--ff);color:var(--tx1);background:transparent;resize:none;line-height:1.6;"
            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
          <div style="display:flex;justify-content:flex-end;padding:.3rem .45rem;border-top:1px solid var(--border);">
            <button onclick="submitReply('${postId}','${c.id}')" class="btn-save" style="padding:.3rem .9rem;font-size:.72rem;border-radius:6px;">등록</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  detailBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;flex-wrap:wrap;">
      ${catLabel?`<span class="board-cat">${catLabel}</span>`:''}
      ${post.is_notice?'<span style="background:#e0a020;color:#fff;font-size:.63rem;border-radius:3px;padding:1px 6px;">공지</span>':''}
      <span class="board-meta">산책자</span>
      <span class="board-meta">${toKSTDate(post.created_at)}</span>
    </div>
    <div style="font-size:.85rem;line-height:1.9;color:${post.is_hidden?'var(--tx3)':'var(--tx1)'};border-top:1px solid var(--border);padding-top:.8rem;margin-bottom:1rem;">
      ${post.is_hidden
        ? '🚫 이 게시글은 신고 게시글로 분류되었습니다.'
        : (post.content||'').replace(/\n/g,'<br>')}
    </div>
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;">
      <button id="post-like-btn-${postId}" onclick="likePost('${postId}')" title="${alreadyLiked?'공감 취소':'공감하기'}" style="font-size:.75rem;padding:.28rem .7rem;border:1px solid var(--border2);border-radius:4px;background:${alreadyLiked?'#ede4d0':'none'};cursor:pointer;color:var(--tx2);" data-liked="${alreadyLiked?'1':'0'}" data-count="${post.likes||0}">
        ${alreadyLiked?'🩷':'❤️'} ${post.likes||0}${alreadyLiked?' ✓':''}
      </button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:.75rem;">
      <div style="font-size:.72rem;font-weight:600;color:var(--acc2);margin-bottom:.55rem;">댓글 ${(comms||[]).length}개</div>
      <div id="comment-list">${commentsHtml}</div>
      <div style="margin-top:.6rem;">
        <textarea id="new-comment" class="form-input" rows="2" placeholder="댓글을 입력해주세요..." style="width:100%;resize:none;font-size:.78rem;margin-bottom:.3rem;"></textarea>
        <div style="display:flex;justify-content:flex-end;">
          <button onclick="submitComment('${postId}')" class="btn-save" style="padding:.3rem .8rem;font-size:.72rem;">등록</button>
        </div>
      </div>
    </div>`;

  const footer = document.getElementById('post-detail-footer');
  if(!footer) { openModal('modal-post-detail'); return; }
  footer.innerHTML = '';
  if(!isMine) {
    const rpBtn=document.createElement('button');rpBtn.className='btn-cancel';rpBtn.textContent='🚨 신고';
    rpBtn.style.cssText='color:#c0392b;border-color:#e8b8a8;font-size:.75rem;';
    rpBtn.onclick=()=>openReportModal(postId, post.title);
    footer.appendChild(rpBtn);
  }
  if(isAdmin) {
    const noticeBtn=document.createElement('button');noticeBtn.className='btn-cancel';
    noticeBtn.textContent=post.is_notice?'📌 공지 해제':'📌 공지 지정';
    noticeBtn.onclick=async()=>{
      await sb.from('posts').update({is_notice:!post.is_notice}).eq('id',postId);
      closeModal('modal-post-detail'); await buildBoard();
    };
    footer.appendChild(noticeBtn);
    const blindBtn=document.createElement('button');blindBtn.className='btn-cancel';
    blindBtn.style.cssText='color:#c0392b;border-color:#e8b8a8;';
    blindBtn.textContent=post.is_hidden?'🔓 블라인드 해제':'🚫 블라인드';
    blindBtn.onclick=()=>toggleBlindPost(postId, post.user_id, !post.is_hidden);
    footer.appendChild(blindBtn);
    // 작성자 제한 상태 비동기 확인
    sb.from('profiles').select('is_banned').eq('id',post.user_id).single().then(({data:pf})=>{
      const isBanned = pf?.is_banned;
      const banBtn=document.createElement('button');banBtn.className='btn-cancel';
      banBtn.style.cssText=isBanned?'color:#2e7d32;border-color:#a8d8a8;':'color:#8b0000;border-color:#f5c6cb;';
      banBtn.textContent=isBanned?'✅ 제한 해제':'⛔ 작성자 제한';
      banBtn.onclick=()=>openBanModal(post.user_id);
      footer.insertBefore(banBtn, closeBtn);
    });
  }
  if(isMine||isAdmin) {
    const editBtn=document.createElement('button');editBtn.className='btn-cancel';editBtn.textContent='수정';
    editBtn.onclick=()=>{closeModal('modal-post-detail');openPostWrite(postId);};
    const delBtn=document.createElement('button');delBtn.className='btn-cancel btn-delete';delBtn.textContent='삭제';
    delBtn.onclick=()=>deletePost(postId);
    footer.appendChild(editBtn);footer.appendChild(delBtn);
  }
  const closeBtn=document.createElement('button');closeBtn.className='btn-save';closeBtn.textContent='닫기';
  closeBtn.onclick=()=>closeModal('modal-post-detail');
  footer.appendChild(closeBtn);
  openModal('modal-post-detail');
}

// 작성자 제한 관리
async function openBanModal(userId) {
  const { data: profile } = await sb.from('profiles').select('display_name,username,is_banned').eq('id',userId).single();
  const isBanned = profile?.is_banned;
  const name = profile?.display_name || profile?.username || '산책자';
  const action = isBanned ? '제한 해제' : '계정 제한';
  if(await showConfirm(`${name}님을 ${action}할까요?`)) {
    await banUser(userId, !isBanned);
  }
}


async function likePost(postId) {
  // 낙관적 업데이트 — DB 응답 전에 즉시 UI 반영
  const likeBtn = document.getElementById(`post-like-btn-${postId}`);
  if(likeBtn) {
    const wasLiked = likeBtn.dataset.liked === '1';
    const newLiked = !wasLiked;
    const newCount = parseInt(likeBtn.dataset.count||'0') + (newLiked ? 1 : -1);
    likeBtn.dataset.liked = newLiked ? '1' : '0';
    likeBtn.dataset.count = newCount;
    likeBtn.style.background = newLiked ? '#ede4d0' : 'none';
    likeBtn.innerHTML = `${newLiked?'🩷':'❤️'} ${newCount}${newLiked?' ✓':''}`;
    likeBtn.disabled = true;
  }

  const { data: myProfile } = await sb.from('profiles').select('is_banned').eq('id',currentUser.id).single();
  if(myProfile?.is_banned) { if(likeBtn){likeBtn.disabled=false;} alert('계정이 제한되어 공감할 수 없어요.'); return; }

  const { data: existing } = await sb.from('post_likes')
    .select('post_id').eq('post_id', postId).eq('user_id', currentUser.id).single();

  if(existing) {
    // 공감 취소
    await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
    const { count } = await sb.from('post_likes').select('*', {count:'exact', head:true}).eq('post_id', postId);
    await sb.from('posts').update({likes: count ?? 0}).eq('id', postId);
    // 아직 안 읽은 공감 알림 회수
    const { data: postOwner } = await sb.from('posts').select('user_id').eq('id', postId).single();
    if(postOwner?.user_id && postOwner.user_id !== currentUser.id) {
      await sb.from('notifications').delete()
        .eq('user_id', postOwner.user_id).eq('sender_id', currentUser.id)
        .eq('type', 'like').eq('post_id', postId).eq('is_read', false);
    }
    openPostDetail(postId);
    return;
  }

  // 공감 등록
  const { error: insertErr } = await sb.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
  if(insertErr) { console.error('[likePost] insert error:', insertErr); return; }

  // 실제 공감 수로 카운터 업데이트 (동시 클릭 시 race condition 방지)
  const [{ data: p }, { count }] = await Promise.all([
    sb.from('posts').select('user_id').eq('id', postId).single(),
    sb.from('post_likes').select('*', {count:'exact', head:true}).eq('post_id', postId)
  ]);
  await sb.from('posts').update({likes: count ?? 0}).eq('id', postId);

  if(p?.user_id && p.user_id !== currentUser.id) {
    await sb.from('notifications').insert({
      user_id: p.user_id, sender_id: currentUser.id, type: 'like',
      message: '내 글에 공감이 달렸어요.', post_id: postId,
      is_read: false, created_at: new Date().toISOString()
    });
  }
  openPostDetail(postId);
}

async function submitComment(postId) {
  const { data: myProfile } = await sb.from('profiles').select('is_banned').eq('id',currentUser.id).single();
  if(myProfile?.is_banned) { alert('계정이 제한되어 댓글을 달 수 없어요.'); return; }
  const content = document.getElementById('new-comment')?.value.trim();
  if(!content){alert('댓글을 입력해주세요.');return;}
  await sb.from('comments').insert({post_id:postId,user_id:currentUser.id,content,is_anonymous:true,created_at:new Date().toISOString()});
  // 게시글 작성자에게 알림 (본인 제외)
  const { data: post } = await sb.from('posts').select('user_id').eq('id',postId).single();
  if(post?.user_id && post.user_id !== currentUser.id) {
    await sb.from('notifications').insert({
      user_id: post.user_id, type:'comment',
      message:'내 글에 댓글이 달렸어요.', post_id:postId,
      is_read:false, created_at:new Date().toISOString()
    });
  }
  await openPostDetail(postId);
  await loadNotifications();
}
function showReplyInput(commentId) {
  const box = document.getElementById(`reply-box-${commentId}`);
  if(box) { box.style.display = box.style.display==='none'?'':'none'; }
}
async function submitReply(postId, parentId) {
  const { data: myProfile } = await sb.from('profiles').select('is_banned').eq('id',currentUser.id).single();
  if(myProfile?.is_banned) { alert('계정이 제한되어 답글을 달 수 없어요.'); return; }
  const input = document.getElementById(`reply-input-${parentId}`);
  const content = input?.value.trim();
  if(!content){alert('답글을 입력해주세요.');return;}
  await sb.from('comments').insert({
    post_id:postId, user_id:currentUser.id,
    content, is_anonymous:true, parent_id:parentId,
    created_at:new Date().toISOString()
  });
  // 원댓글 작성자에게 알림
  const { data: parentC } = await sb.from('comments').select('user_id').eq('id',parentId).single();
  if(parentC?.user_id && parentC.user_id !== currentUser.id) {
    await sb.from('notifications').insert({
      user_id:parentC.user_id, type:'reply',
      message:'내 댓글에 답글이 달렸어요.', post_id:postId,
      is_read:false, created_at:new Date().toISOString()
    });
  }
  await openPostDetail(postId);
}

async function deleteComment(commentId, postId) {
  if(!await showConfirm('댓글을 삭제할까요?'))return;
  await sb.from('comments').delete().eq('id',commentId);
  openPostDetail(postId);
}

async function deletePost(postId) {
  if(!await showConfirm('게시글을 삭제할까요?'))return;
  closeModal('modal-post-detail');
  try {
    await sb.from('comments').delete().eq('post_id',postId);
    await sb.from('reports').delete().eq('post_id',postId);
    const { error } = await sb.from('posts').delete().eq('id',postId);
    if(error) throw error;
    safeBoardRefresh();
  } catch(e) { console.error('delete error:', e); }
}

// ── 실시간 접속자 수 (Supabase Realtime Presence)
let _presenceChannel = null;

function joinPresence() {
  if(!currentUser || _presenceChannel) return;
  _presenceChannel = sb.channel('bl_presence', {
    config: { presence: { key: currentUser.id } }
  });
  _presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = _presenceChannel.presenceState();
      const count = Object.keys(state).length;
      const badge = document.getElementById('online-badge');
      const countEl = document.getElementById('online-count');
      if(badge && countEl) {
        countEl.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
    })
    .subscribe(async status => {
      if(status === 'SUBSCRIBED') {
        try {
          await _presenceChannel.track({ user_id: currentUser.id });
          // 구독 직후 강제 카운트 업데이트 (sync 이벤트 지연 대비)
          setTimeout(() => {
            const state = _presenceChannel.presenceState();
            const count = Object.keys(state).length;
            const badge = document.getElementById('online-badge');
            const countEl = document.getElementById('online-count');
            if(badge && countEl && count > 0) {
              countEl.textContent = count;
              badge.style.display = 'flex';
            }
          }, 800);
        } catch(_) {}
      }
    });
}

// ══════════════════════════════════════════════════════════════
// 독서 도서관 — Supabase Realtime Presence 기반
// ══════════════════════════════════════════════════════════════

// 전역 상태 (옵저버 채널만 유지 — 실제 입장은 library.html 팝업이 담당)
let _libChannel = null;

// ── 입장 팝업 열기 (책 목록 채우기)
function toggleLibGhost() {
  const cb = document.getElementById('library-ghost-toggle');
  const track = document.getElementById('lib-ghost-track');
  if(!cb) return;
  cb.checked = !cb.checked;
  if(track) track.classList.toggle('on', cb.checked);
}

function openLibraryEntry() {
  const sel = document.getElementById('lib-book-select');
  if(sel) {
    // 읽는중 우선, 없으면 완독 제외 전체 목록 (읽고싶음·중단·다시읽기 포함)
    const reading = (allBooks||[]).filter(b => b.status === '읽는중');
    const candidates = reading.length > 0
      ? reading
      : (allBooks||[]).filter(b => b.status !== '완독').sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
    sel.innerHTML = '<option value="">표시 안함</option>';
    candidates.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      const statusTag = b.status !== '읽는중' ? ` (${b.status})` : '';
      opt.textContent = (b.title.length > 20 ? b.title.slice(0,20)+'…' : b.title) + statusTag;
      sel.appendChild(opt);
    });
    if(candidates.length > 0) sel.value = candidates[0].id;
    const wrap = document.getElementById('lib-book-select-wrap');
    if(wrap) wrap.style.display = (allBooks||[]).length > 0 ? '' : 'none';
  }
  const toggle = document.getElementById('library-ghost-toggle');
  const track  = document.getElementById('lib-ghost-track');
  if(toggle) toggle.checked = false;
  if(track)  track.classList.remove('on');
  openModal('modal-library-entry');
}

// ── 팝업 창으로 도서관 입장
async function joinLibraryRoom() {
  if(!currentUser) { showAlert('로그인이 필요해요.'); return; }

  const ghostToggle = document.getElementById('library-ghost-toggle');
  const isGhost = ghostToggle ? ghostToggle.checked : false;
  const bookSel = document.getElementById('lib-book-select');
  const selectedBookId = bookSel?.value || null;
  const selectedBook = selectedBookId ? (allBooks||[]).find(b => b.id === selectedBookId) : null;

  let profile = null;
  try {
    const { data } = await Promise.race([
      sb.from('profiles').select('display_name,username,avatar_url').eq('id',currentUser.id).single(),
      new Promise(res => setTimeout(() => res({data:null}), 3000))
    ]);
    profile = data;
  } catch(e) {}

  closeModal('modal-library-entry');

  localStorage.setItem('bl_lib_params', JSON.stringify({
    isGhost,
    displayName: profile?.display_name || profile?.username || '독자',
    avatarUrl: profile?.avatar_url || null,
    bookId: selectedBook?.id || null,
    bookTitle: selectedBook?.title || null,
    bookCover: selectedBook?.cover || null,
    bookAuthor: selectedBook?.author || null,
  }));

  const w=640, h=520, left=Math.round((screen.width-w)/2), top=Math.round((screen.height-h)/2);
  const popup = window.open('library.html','bl_library',`width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  // 팝업 차단이거나 모바일에서 같은 탭으로 열리면 직접 이동
  if(!popup || popup.closed || typeof popup.closed === 'undefined') {
    localStorage.setItem('bl_lib_from_app', '1');
    location.href = 'library.html';
  }
}

// ── 도서관 체류 시간 통계 저장 (library.html이 localStorage에 기록 → 여기서 DB 저장)
window.addEventListener('storage', async e => {
  if(e.key !== 'bl_lib_session_done' || !e.newValue) return;
  try {
    const { bookId, minutes, date } = JSON.parse(e.newValue);
    localStorage.removeItem('bl_lib_session_done');
    if(bookId && minutes >= 1 && currentUser) {
      await _addLibraryTime(bookId, minutes, date);
    }
  } catch(err) { console.warn('library stats:', err); }
});

async function _addLibraryTime(bookId, minutes, date) {
  const book = (allBooks||[]).find(b => b.id === bookId);
  if(!book) return;
  const cy = String(new Date().getFullYear());
  const yearData = { ...(book.reading_time_year||{}) };
  yearData[cy] = (yearData[cy] ?? 0) + minutes;
  const timeLog = { ...(book.reading_time_log||{}) };
  timeLog[date] = (timeLog[date]||0) + minutes;
  try {
    await sb.from('books').update({
      reading_time: (book.reading_time||0) + minutes,
      reading_time_year: yearData,
      reading_time_log: timeLog,
      last_read: date
    }).eq('id', bookId).eq('user_id', currentUser.id);
    await loadData();
    // 트래커·목표·통계 UI 갱신
    if(typeof buildTrackerGrid === 'function') buildTrackerGrid();
    if(typeof buildGoalDisplay === 'function') buildGoalDisplay();
    if(typeof buildWeeklyStats === 'function') buildWeeklyStats();
  } catch(e) { console.warn('library time save:', e); }
}

// ── 앱 시작 시 옵저버 구독 (입장 카드 카운트 표시 전용)
function joinLibraryObserver() {
  if(!currentUser || _libChannel) return;
  _libChannel = sb.channel('bl_library', {
    config: { presence: { key: currentUser.id + '_obs' } }
  });
  _libChannel
    .on('presence', { event: 'sync' }, () => {
      const count = Object.values(_libChannel.presenceState()).flat().filter(m=>!m.is_observer).length;
      const badge = document.getElementById('library-entry-count');
      const num   = document.getElementById('library-entry-num');
      if(badge) {
        badge.style.display = count > 0 ? '' : 'none';
        badge.title = count > 0 ? `현재 ${count}명이 도서관에서 읽고 있어요` : '';
      }
      if(num) num.textContent = count;
    })
    .subscribe(async status => {
      if(status === 'SUBSCRIBED') try { await _libChannel.track({ is_observer: true }); } catch(_) {}
    });
}

// ═══════════════════════════════════════════
// 결제 시스템
// ═══════════════════════════════════════════

let _selectedPlan = null;

function _getTodayKST() {
  const kst = new Date(Date.now() + 9 * 3600000);
  return kst.toISOString().slice(0, 10);
}

function initPaymentSection() {
  const section = document.getElementById('payment-section');
  if (!section) return;
  const today = _getTodayKST();
  section.style.display = 'block';
  if (today < PAYMENT_OPEN) {
    document.getElementById('payment-upcoming').style.display = 'block';
  } else if (today > PAYMENT_CLOSE) {
    document.getElementById('payment-closed').style.display = 'block';
  } else {
    document.getElementById('payment-available').style.display = 'block';
  }
}

function selectPayPlan(el) {
  document.querySelectorAll('.pay-plan').forEach(p => p.classList.remove('on'));
  el.classList.add('on');
  _selectedPlan = {
    id: el.dataset.plan,
    amount: parseInt(el.dataset.amount),
    invites: parseInt(el.dataset.invites)
  };
}

async function submitPaymentRequest() {
  if (!_selectedPlan) {
    _payMsg('플랜을 선택해주세요.', 'warn'); return;
  }
  const email = (document.getElementById('payment-email')?.value || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    _payMsg('유효한 이메일 주소를 입력해주세요.', 'warn'); return;
  }
  const btn = document.getElementById('btn-pay');
  if (btn) { btn.disabled = true; btn.textContent = '신청 중…'; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/payment-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ email, plan: _selectedPlan.id })
    });
    const data = await res.json();
    if (res.ok && data.transfer_code) {
      _showTransferInfo({ ...data, email, plan: _selectedPlan.id });
    } else {
      _payMsg('오류가 발생했습니다. 잠시 후 다시 시도해주세요. (' + (data.error || 'ERR') + ')', 'error');
    }
  } catch(e) {
    _payMsg('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error');
  } finally {
    if (btn && btn.textContent === '신청 중…') { btn.disabled = false; btn.textContent = '신청하기'; }
  }
}

function _showTransferInfo(info) {
  const step1 = document.getElementById('pay-step1');
  const step2 = document.getElementById('pay-step2');
  if (!step1 || !step2) return;
  step1.style.display = 'none';
  const plan = PAYMENT_PLANS[info.plan] || {};
  const amt = (info.amount || plan.amount || 0).toLocaleString();
  step2.innerHTML = `
    <div style="text-align:center;margin-bottom:.9rem;">
      <div style="font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--tx3);font-weight:600;margin-bottom:.18rem;">입금 안내</div>
      <div style="font-size:.73rem;color:var(--tx3);">아래 계좌로 <b style="color:var(--tx1);">${amt}원</b>을 이체해주세요</div>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.75rem .85rem;margin-bottom:.7rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;">
        <span style="font-size:.67rem;color:var(--tx3);">은행</span>
        <span style="font-size:.82rem;font-weight:600;color:var(--tx1);">${BANK_INFO.bank}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;">
        <span style="font-size:.67rem;color:var(--tx3);">계좌번호</span>
        <span style="font-size:.82rem;font-weight:600;color:var(--tx1);letter-spacing:.04em;">${BANK_INFO.account}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;">
        <span style="font-size:.67rem;color:var(--tx3);">예금주</span>
        <span style="font-size:.82rem;font-weight:600;color:var(--tx1);">${BANK_INFO.holder}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:.67rem;color:var(--tx3);">입금자명 (필수)</span>
        <span style="font-size:.88rem;font-weight:700;color:var(--acc);letter-spacing:.06em;background:#fff8f0;border:1.5px solid var(--acc);border-radius:5px;padding:.1rem .45rem;">${info.transfer_code}</span>
      </div>
    </div>
    <div style="font-size:.67rem;color:var(--tx3);line-height:1.8;margin-bottom:.75rem;">
      • 입금자명을 반드시 <b style="color:var(--tx2);">${info.transfer_code}</b>으로 입력해주세요.<br>
      • 입금 확인 후 <b style="color:var(--tx2);">${info.email}</b>으로 초대코드가 발송됩니다.<br>
      • 확인까지 최대 24시간 소요될 수 있습니다.
    </div>
    <button onclick="_resetPaymentForm()" style="width:100%;padding:.5rem;background:none;border:1px solid var(--border2);border-radius:8px;font-size:.73rem;color:var(--tx3);cursor:pointer;font-family:var(--ff);">← 처음으로</button>`;
  step2.style.display = 'block';
}

function _resetPaymentForm() {
  const step1 = document.getElementById('pay-step1');
  const step2 = document.getElementById('pay-step2');
  if (step1) step1.style.display = 'block';
  if (step2) { step2.style.display = 'none'; step2.innerHTML = ''; }
  const btn = document.getElementById('btn-pay');
  if (btn) { btn.disabled = false; btn.textContent = '신청하기'; }
}

function _payMsg(msg, type='warn') {
  const step1 = document.getElementById('pay-step1');
  if (!step1) return;
  let el = step1.querySelector('.pay-msg');
  if (!el) {
    el = document.createElement('div');
    el.className = 'pay-msg';
    const btn = document.getElementById('btn-pay');
    if (btn && btn.parentNode === step1) {
      step1.insertBefore(el, btn);
    } else {
      step1.appendChild(el);
    }
  }
  const colors = { warn: '#9e3a1e', error: '#b8001f' };
  el.style.cssText = `font-size:.72rem;color:${colors[type]||'#9e3a1e'};background:#fdf0ee;border:1px solid #e8b8a8;border-radius:6px;padding:.45rem .7rem;margin-bottom:.5rem;`;
  el.textContent = msg;
  setTimeout(() => el?.remove(), 5000);
}

// ── 추가 후원 (계좌이체 안내)
function openDonation() {
  const area = document.getElementById('donation-area');
  if (!area) return;
  area.innerHTML = `
    <div style="margin-top:.5rem;padding:.65rem .8rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;text-align:left;">
      <div style="font-size:.67rem;color:var(--tx3);margin-bottom:.4rem;text-align:center;">계좌로 후원해주세요</div>
      <div style="font-size:.75rem;color:var(--tx2);line-height:1.9;">
        ${BANK_INFO.bank} ${BANK_INFO.account}<br>
        <span style="color:var(--tx3);">예금주</span> ${BANK_INFO.holder}
      </div>
      <button onclick="document.getElementById('donation-area').innerHTML='<div style=\\'text-align:center\\'><button onclick=\\'openDonation()\\' style=\\'background:none;border:none;font-size:.72rem;color:var(--tx3);cursor:pointer;font-family:var(--ff);text-decoration:underline;text-underline-offset:2px;\\'>+ 추가 후원하기</button></div>'"
        style="margin-top:.45rem;width:100%;background:none;border:1px solid var(--border2);border-radius:6px;padding:.28rem .6rem;font-size:.67rem;cursor:pointer;font-family:var(--ff);color:var(--tx3);">닫기</button>
    </div>`;
}

// 결제 섹션 초기화 (DOMContentLoaded)
document.addEventListener('DOMContentLoaded', initPaymentSection);
