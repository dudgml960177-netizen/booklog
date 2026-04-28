
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
const SUPABASE_URL = 'https://xowlwzpoxrudgaoavkbr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';
const NAVER_PROXY = `${SUPABASE_URL}/functions/v1/naver-book`;
const NAVER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';

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
let curFilter = '전체', curCatFilter = null, curView = 'gallery', curSort = 'recent';
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
const GCOLS = ['#c4714a','#6b8f6b','#5a7a8a','#c8a050','#8b6b8b','#4a7a6a','#c8704a','#7a8a6a','#7a6aaa','#5a8a7a'];
const RCOLS = ['#c4714a','#b07030','#c8a87a','#7a9e7e','#8a8aaa'];
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
function showScreen(name) {
  ['loading','auth','app'].forEach(n => {
    const el = document.getElementById('screen-'+n);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('screen-'+name);
  if (el) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
}


// ── localStorage 정리 (좋아요 기록 오래된 것 제거)
function cleanupLocalStorage() {
  try {
    const keys = Object.keys(localStorage);
    
    // 허용 키 목록 (이것만 남기고 나머지 삭제)
    const ALLOWED = new Set([
      'bl_font_size',
      'bl_saved_email',
    ]);
    // booklog-auth로 시작하는 Supabase 세션 키는 항상 유지
    
    keys.forEach(k => {
      // Supabase 세션 키 - 절대 건드리지 않음
      if(k.startsWith('booklog-auth')) return;
      if(k.startsWith('sb-')) return;
      // bl_ 접두사 허용 키
      if(ALLOWED.has(k)) return;
      // liked_ 키는 50개까지만
      if(k.startsWith('liked_')) return; // 아래서 별도 처리
      // 나머지 전부 삭제 (오염 방지)
      localStorage.removeItem(k);
    });

    // 좋아요 키 50개 초과 시 정리
    const likedKeys = Object.keys(localStorage).filter(k => k.startsWith('liked_'));
    if(likedKeys.length > 50) {
      likedKeys.slice(0, likedKeys.length - 30).forEach(k => localStorage.removeItem(k));
    }

    // Supabase 내부 상태 검증 - 세션 데이터 손상 체크
    try {
      const sessionKey = Object.keys(localStorage).find(k => k.startsWith('booklog-auth'));
      if(sessionKey) {
        const raw = localStorage.getItem(sessionKey);
        if(raw) JSON.parse(raw); // 파싱 실패하면 catch로
      }
    } catch(e) {
      // 세션 데이터 손상 - 전체 localStorage 초기화 후 reload
      console.warn('Corrupted session data - clearing all and reloading');
      localStorage.clear();
      location.reload();
      return;
    }
  } catch(e) {}
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
let _appState = 'idle'; // idle | starting | running | auth

async function startApp(user) {
  if(_appState === 'running' || _appState === 'starting') return;
  _appState = 'starting';
  try {
    currentUser = user;
    try { await loadData(); } catch(e) { console.warn('loadData:', e); }
    try { await loadGoals(); } catch(e) { console.warn('loadGoals:', e); }
    try { loadUserRole(); } catch(e) {}
    try {
      const { data: pf } = await sb.from('profiles').select('font_size').eq('id', user.id).single();
      if(pf?.font_size) initFontSize(String(pf.font_size));
    } catch(e) {}
    _appState = 'running';
    showScreen('app');
    buildBooks();
    setTimeout(loadNotifications, 500);
  } catch(e) {
    // 어떤 에러든 상태 복구 - 로그인 버튼이 다시 작동하게
    console.error('startApp error:', e);
    _appState = 'idle';
    currentUser = null;
    showScreen('auth');
    loadSavedEmail();
  }
}

function resetToAuth() {
  _appState = 'auth';
  currentUser = null; allBooks = []; allQuotes = [];
  showScreen('auth');
  loadSavedEmail();
}

// onAuthStateChange - sb 생성 직후 등록
sb.auth.onAuthStateChange(async (event, session) => {
  try {
    if(event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      if(session?.user) {
        if(_appState === 'running') {
          currentUser = session.user; // 세션 갱신만
        } else if(_appState !== 'starting') {
          // idle 또는 auth 상태일 때만 startApp 호출
          await startApp(session.user);
        }
        // starting 상태면 무시 (이미 진행 중)
      } else if(event === 'INITIAL_SESSION') {
        _appState = 'auth';
      }
    }
    if(event === 'SIGNED_OUT') {
      // doLogout에서 직접 resetToAuth 호출하므로 여기선 상태만 리셋
      _appState = 'idle';
    }
    if(event === 'TOKEN_REFRESHED' && session) currentUser = session.user;
    if(event === 'PASSWORD_RECOVERY') {
      showScreen('auth');
      authSwitch('newpw', null);
      showAuthError('새 비밀번호를 입력해주세요.', true);
    }
  } catch(e) { console.warn('authStateChange error:', e); }
});

function init() {
  initFontSize();
  cleanupLocalStorage();
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if(e.target===el) el.style.display='none'; });
  });
  // Supabase 응답 타임아웃 감지 - 5초 안에 INITIAL_SESSION 안 오면 강제 auth 화면
  const initTimeout = setTimeout(() => {
    if(_appState === 'idle' || _appState === 'starting') {
      console.warn('Supabase timeout - clearing localStorage and reloading');
      // Supabase가 멈춘 경우 세션 캐시 제거 후 새로고침
      const savedEmail = localStorage.getItem('bl_saved_email');
      const savedFont = localStorage.getItem('bl_font_size');
      localStorage.clear();
      if(savedEmail) localStorage.setItem('bl_saved_email', savedEmail);
      if(savedFont) localStorage.setItem('bl_font_size', savedFont);
      location.reload();
    }
  }, 5000);
  // INITIAL_SESSION 오면 타임아웃 취소
  const unsub = sb.auth.onAuthStateChange((event) => {
    if(event === 'INITIAL_SESSION') { clearTimeout(initTimeout); unsub.data?.subscription?.unsubscribe(); }
  });
  // URL 해시 토큰 처리 (비밀번호 재설정)
  const hash = window.location.hash;
  if(hash.includes('type=recovery') || hash.includes('access_token')) {
    try {
      const params = new URLSearchParams(hash.replace('#',''));
      const accessToken = params.get('access_token');
      if(accessToken) {
        sb.auth.setSession({ access_token: accessToken, refresh_token: params.get('refresh_token')||'' })
          .then(() => { window.history.replaceState(null,'',window.location.pathname); showScreen('auth'); authSwitch('newpw',null); showAuthError('새 비밀번호를 입력해주세요.',true); })
          .catch(() => { showScreen('auth'); loadSavedEmail(); });
        return;
      }
    } catch(e) {}
  }
  showScreen('auth');
  loadSavedEmail();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

async function loadData() {
  const [bR, qR] = await Promise.all([
    sb.from('books').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
    sb.from('quotes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
  ]);
  allBooks = bR.data || []; allQuotes = qR.data || [];
  // 카테고리 로컬 스토리지에서 로드
  try {
    const { data: pf } = await sb.from('profiles').select('categories').eq('id',currentUser.id).single();
    allCategories = pf?.categories || JSON.parse(localStorage.getItem('bl_cats_'+currentUser.id)||'[]');
  } catch(e) { try { allCategories = JSON.parse(localStorage.getItem('bl_cats_'+currentUser.id)||'[]'); } catch(e2){ allCategories=[]; } }
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
    // 로그인 성공 - onAuthStateChange가 자동으로 startApp 호출
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
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error) { showAuthError(error.message); return; }
  showAuthError('재설정 링크를 보냈어요! 이메일을 확인해주세요.', true);
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
  }
  // 신규 가입자에게 초대코드 1개 자동 발급
  if(data.user) {
    const newCode = Math.random().toString(36).substring(2,8).toUpperCase()+Math.random().toString(36).substring(2,5).toUpperCase();
    await sb.from('invite_codes').insert({code:newCode, owner_id:data.user.id, created_at:new Date().toISOString()});
  }
  showAuthError('가입 완료! 이메일 인증 후 로그인해주세요.', true);
}
async function doLogout() {
  closeModal('modal-profile');
  try {
    await sb.auth.signOut();
  } catch(e) {
    console.warn('signOut error:', e);
    localStorage.removeItem('booklog-auth');
  }
  resetToAuth();
}
function showAuthError(msg, success=false) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = '';
  el.style.color = success?'#2e7d32':'#9e3a1e';
  el.style.background = success?'#f0f8f0':'#fdf0ee';
  el.style.borderColor = success?'#a8d8a8':'#e8b8a8';
}

// ── 탭
function sw(name, btn) {
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
function filterStatus(status, btn) {
  curFilter = status; curCatFilter = null;
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
  if (curFilter !== '전체') list = list.filter(b=>b.status===curFilter);
  if (curCatFilter) list = list.filter(b=>(b.category||'')=== curCatFilter);
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

function setSort(s) {
  curSort = s;
  const sel = document.getElementById('sort-select');
  if(sel) sel.value = s;
  buildBooks();
}
function buildBooks() {
  document.getElementById('view-gallery').style.display = curView==='gallery'?'':'none';
  document.getElementById('view-list').style.display = curView==='list'?'':'none';
  const list = getFilteredBooks();
  if (curView==='gallery') buildGallery(list);
  else buildList(list);
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
    await loadData(); buildBooks();
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
    const img = b.cover ? `<img src="${b.cover}" alt="${b.title}" style="width:100%;height:100%;object-fit:cover;display:block;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.48rem;color:rgba(255,255,255,.8);text-align:center;padding:.2rem;font-style:italic;line-height:1.3;">${b.title}</div>`;
    el.innerHTML = `<div class="gi-cover">${img}</div>
      <div class="gi-title">${b.title}</div>
      <div class="gi-author">${b.author||''}</div>
      <div class="gi-stars">${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</div>
      <span class="gi-status">${b.status||''}</span>`;
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
let selectedQuoteIds = new Set();

function buildQuotes() {
  const filterEl = document.getElementById('q-filter');
  filterEl.innerHTML = '';
  // 검색 + 선택 삭제 툴바
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.6rem;align-items:center;';
  toolbar.innerHTML = `
    <div style="position:relative;flex:1;">
      <span style="position:absolute;left:.65rem;top:50%;transform:translateY(-50%);font-size:.72rem;color:var(--tx3);">🔍</span>
      <input id="quote-search-input" type="text" class="search-input" placeholder="책 제목 또는 작가로 검색..."
        style="padding-left:1.8rem;font-size:.75rem;width:100%;border-radius:20px;background:#f5f0e8;border-color:transparent;" value="${quoteSearchQ}">
    </div>
    <button id="quote-select-btn" class="cat-btn" onclick="toggleQuoteSelect()" style="font-size:.7rem;border-radius:12px;">${quoteSelectMode?'✕':'☑ 선택'}</button>
    <button id="quote-delete-btn" class="cat-btn" onclick="bulkDeleteQuotes()" style="display:${quoteSelectMode?'':'none'};color:#c0392b;border-color:#e8b8a8;font-size:.7rem;border-radius:12px;">🗑</button>
    <button class="cat-btn" onclick="deleteAllQuotes()" style="font-size:.7rem;border-radius:12px;color:#c0392b;border-color:#e8b8a8;" title="전체 삭제">🗑 전체</button>`;
  filterEl.appendChild(toolbar);
  const inp = document.getElementById('quote-search-input');
  if(inp) inp.oninput = (e) => { quoteSearchQ = e.target.value; renderQuotes(); };
  renderQuotes();
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
function renderQuotes() {
  const feed = document.getElementById('q-feed'); feed.innerHTML = '';
  if (!allQuotes.length) { feed.innerHTML='<div class="empty-state">수집된 문장이 없어요.</div>'; return; }
  const q = quoteSearchQ.trim().toLowerCase();
  const list = q ? allQuotes.filter(qt => {
    const book = allBooks.find(b=>b.id===qt.book_id);
    return (book?.title||'').toLowerCase().includes(q) ||
           (book?.author||'').toLowerCase().includes(q) ||
           qt.text.toLowerCase().includes(q);
  }) : allQuotes;
  if (!list.length) {
    feed.innerHTML=`<div class="empty-state">"${quoteSearchQ}" 검색 결과가 없어요.</div>`;
    return;
  }
  list.forEach(qt => {
    const book = allBooks.find(b=>b.id===qt.book_id);
    const color = randomQuoteColor(qt.book_id);
    const isSelected = selectedQuoteIds.has(qt.id);
    const el = document.createElement('div');
    el.className='qcard';
    if(quoteSelectMode) {
      el.style.outline = isSelected ? '2px solid var(--acc)' : '2px solid transparent';
      el.style.cursor = 'pointer';
      el.onclick = () => {
        if(selectedQuoteIds.has(qt.id)) selectedQuoteIds.delete(qt.id);
        else selectedQuoteIds.add(qt.id);
        renderQuotes();
      };
    }
    let text = qt.text;
    if(q) {
      const re = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
      text = text.replace(re,'<mark style="background:#f5d87a;border-radius:2px;padding:0 1px;">$1</mark>');
    }
    el.innerHTML = `
      ${quoteSelectMode ? `<div style="position:absolute;top:.5rem;right:.5rem;width:15px;height:15px;border:2px solid ${isSelected?'var(--acc)':'var(--border2)'};border-radius:3px;background:${isSelected?'var(--acc)':'#fff'};display:flex;align-items:center;justify-content:center;z-index:1;"><span style="color:#fff;font-size:.55rem;">${isSelected?'✓':''}</span></div>` : ''}
      <div class="qcard-bar" style="background:${color}"></div>
      <div style="padding-left:.65rem;">
        <div style="font-size:1.1rem;color:${color};opacity:.35;line-height:1;margin-bottom:.05rem;font-family:Georgia,serif;">"</div>
        <div class="qcard-text" style="margin-top:0;">${text}</div>
      </div>
      <div class="qcard-meta">
        <span class="qcard-book">${book?.title||''}</span>
        ${book?.author?`<span style="font-size:.58rem;color:var(--tx3);">— ${book.author}</span>`:''}
        ${qt.page?`<span class="qcard-page">p.${qt.page}</span>`:''}
        ${qt.tag?`<span class="qcard-comment">${qt.tag}</span>`:''}
      </div>`;
    el.style.position = 'relative';
    feed.appendChild(el);
  });
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
function renderCal() {
  const mn=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('cal-ttl').textContent = calY+'년 '+mn[calM];
  const grid = document.getElementById('cal-grid');
  const dows = [...grid.querySelectorAll('.dow')]; grid.innerHTML=''; dows.forEach(d=>grid.appendChild(d));
  const first=new Date(calY,calM,1).getDay(), days=new Date(calY,calM+1,0).getDate(), prev=new Date(calY,calM,0).getDate(), today=new Date();
  for(let i=0;i<first;i++){const d=document.createElement('div');d.className='day other';d.textContent=prev-first+1+i;grid.appendChild(d);}
  for(let d=1;d<=days;d++){
    const ds=calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const book=allBooks.find(b=>b.date_finish===ds&&b.status==='완독');
    const el=document.createElement('div');
    const isT=today.getFullYear()===calY&&today.getMonth()===calM&&today.getDate()===d;
    if(book){
      el.className='day hbook'; el.title=book.title; el.onclick=()=>openDetail(book.id);
      if(book.cover){const img=document.createElement('img');img.className='bthumb';img.src=book.cover;img.alt=book.title;el.appendChild(img);}
      else{const ph=document.createElement('div');ph.className='bthumb-ph';ph.textContent=book.title;el.appendChild(ph);}
      const dn=document.createElement('span');dn.className='dnum';dn.textContent=d;el.appendChild(dn);
    } else {el.className='day'+(isT?' today':'');el.textContent=d;}
    grid.appendChild(el);
  }
  const rem=42-first-days; for(let i=1;i<=rem;i++){const d=document.createElement('div');d.className='day other';d.textContent=i;grid.appendChild(d);}
  const list=document.getElementById('cal-list'); list.innerHTML='';
  const mk=calY+'-'+String(calM+1).padStart(2,'0');
  const mb=allBooks.filter(b=>b.date_finish?.startsWith(mk)&&b.status==='완독');
  if(!mb.length) list.innerHTML='<div style="font-size:.7rem;color:var(--tx3);padding:.25rem 0;">이 달에 완독한 책이 없습니다.</div>';
  else mb.forEach(b=>{const r=document.createElement('div');r.className='cli';r.onclick=()=>openDetail(b.id);r.innerHTML=`<span class="cldot"></span><span style="flex:1;">${b.title}</span><span style="color:var(--tx3);font-size:.63rem;">${b.date_finish}</span>`;list.appendChild(r);});
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
  // 책 선택 시 독서 현황 표시
  sel.onchange = () => showTimerBookDetail(sel.value);
  updateTimerDisplay();
  updateTrackerPeriodBtns();
  buildTrackerGrid();
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
}
function toggleTimer() {
  const sel=document.getElementById('timer-book-select');
  if(!timerRunning&&sel&&!sel.value){alert('읽는 중인 책을 먼저 선택해주세요.');return;}
  if(timerRunning){clearInterval(timerInterval);timerRunning=false;}
  else{timerBookId=sel?.value||null;timerRunning=true;timerInterval=setInterval(()=>{timerSeconds++;updateTimerDisplay();},1000);}
  updateTimerDisplay();
}
function resetTimer() {
  if(!confirm('타이머를 초기화할까요?'))return;
  clearInterval(timerInterval);timerRunning=false;timerSeconds=0;updateTimerDisplay();
}
async function saveTimer() {
  if(timerSeconds<60){alert('최소 1분 이상 읽어야 저장할 수 있어요.');return;}
  const sel=document.getElementById('timer-book-select');
  const bookId=sel?.value||timerBookId;
  if(!bookId){alert('책을 선택해주세요.');return;}
  const book=allBooks.find(b=>b.id===bookId);
  if(!book){alert('책을 찾을 수 없어요.');return;}
  const mins=Math.round(timerSeconds/60);
  const today=new Date().toISOString().slice(0,10);
  try {
    const updateData = {
      reading_time:(book.reading_time||0)+mins,
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
    clearInterval(timerInterval);timerRunning=false;timerSeconds=0;
    if(timerPageInput) timerPageInput.value='';
    await loadData(); updateTimerDisplay(); buildTimer();
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
    if(!b.last_read || !b.reading_time) return;
    dayMap[b.last_read] = (dayMap[b.last_read]||0) + b.reading_time;
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

// ── 통계
function buildStats() {
  const sg=document.getElementById('stat-grid'); sg.innerHTML='';
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
  // 올해 기준 통계
  const thisYearBooks = allBooks.filter(b => b.date_finish?.startsWith(String(cy)) || b.last_read?.startsWith(String(cy)));
  const thisYearMins = thisYearBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const thisYearPages = thisYear.reduce((a,b)=>a+(b.pages||0),0);
  // 올해 등록된 문장
  const thisYearQuotes = allQuotes.filter(q=>q.created_at?.startsWith(String(cy)));
  const items=[
    {n:total, l:'누적 완독', sub:years.size?[...years].sort()[0]+'–현재':'전체', ic:'📖'},
    {n:avg,   l:'평균 평점', sub:avg+' / 5.0', ic:'⭐'},
    {n:Math.floor(thisYearMins/60)+'h', l:'올해 독서 시간', sub:thisYearMins+'분', ic:'⏱'},
    {n:thisYear.length, l:'올해 완독', sub:cy+'년', ic:'🌿'},
    {n:allBooks.filter(b=>b.status==='읽는중').length, l:'읽는 중', sub:'권', ic:'📌'},
    {n:thisYearQuotes.length, l:'올해 문장', sub:'인상 깊은 구절', ic:'✍️'},
    {n:topA?topA[0]:'—', l:'최애 작가', sub:topA?topA[1]+'권':'', ic:'👑'},
    {n:topP?topP[0]:'—', l:'최애 출판사', sub:topP?topP[1]+'권':'', ic:'📚'},
    {n:thisYearPages>0?thisYearPages.toLocaleString()+'p':'—', l:'올해 페이지', sub:'완독 기준', ic:'📄'},
  ];
  items.forEach(it=>{
    const el=document.createElement('div');
    el.style.cssText='flex-shrink:0;width:72px;background:var(--card);border:1px solid var(--border);border-radius:var(--rs);padding:.4rem .45rem;position:relative;overflow:hidden;';
    const isLong=(it.l.includes('작가')||it.l.includes('출판사'));
    el.innerHTML=`
      <div style="font-size:.75rem;opacity:.6;margin-bottom:.1rem;">${it.ic||''}</div>
      <div style="font-family:var(--fs);font-size:${isLong?'.65rem':'.85rem'};color:var(--tx1);line-height:1.15;word-break:break-all;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${it.n}</div>
      <div style="font-size:.55rem;color:var(--tx3);margin-top:.08rem;">${it.l}</div>`;
    sg.appendChild(el);
  });
}

function showGraph(name, btn) {
  if(btn){document.querySelectorAll('.gst').forEach(t=>t.classList.remove('on'));btn.classList.add('on');}
  ['monthly','genre','rating','author','pages'].forEach(n=>document.getElementById('g-'+n).style.display=n===name?'':'none');
  if(name==='monthly') buildMonthly();
  if(name==='genre')   buildGenre();
  if(name==='rating')  buildRating();
  if(name==='author')  buildAuthorChart();
  if(name==='pages')   buildPagesChart();
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
  const labels=['1','2','3','4','5','6','7','8','9','10','11','12'].map(l=>l+'월');
  const ctx=document.getElementById('chart-monthly').getContext('2d');
  if(curYM==='all'){
    const datasets=YEARS.map(y=>{
      const c=YC[y]||{line:'#b07030',rgb:'176,112,48'};
      const vals=Array(12).fill(0);
      done.filter(b=>parseInt(b.date_finish.slice(0,4))===y).forEach(b=>vals[parseInt(b.date_finish.slice(5,7))-1]++);
      return{label:y+'년',data:vals,backgroundColor:`rgba(${c.rgb},0.75)`,borderColor:c.line,borderWidth:1,borderRadius:3,borderSkipped:false};
    });
    monthChart=new Chart(ctx,{type:'bar',data:{labels,datasets},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'top',align:'end',labels:{font:{family:'Pretendard',size:10},color:'#5c3d1e',boxWidth:10,boxHeight:10,padding:10,usePointStyle:true}},tooltip:{backgroundColor:'#faf6ef',borderColor:'#cfc3ac',borderWidth:1,titleColor:'#2e1f0e',bodyColor:'#5c3d1e',titleFont:{family:'Pretendard',size:11},bodyFont:{family:'Pretendard',size:11},callbacks:{label:c=>' '+c.dataset.label+' '+c.parsed.y+'권'}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72'}},y:{stacked:true,grid:{color:'rgba(207,195,172,0.32)'},border:{dash:[3,3]},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72',stepSize:1},min:0}}}});
  } else {
    const c=YC[curYM]||{line:'#b07030',rgb:'176,112,48'};
    const vals=Array(12).fill(0);
    done.filter(b=>parseInt(b.date_finish.slice(0,4))===curYM).forEach(b=>vals[parseInt(b.date_finish.slice(5,7))-1]++);
    monthChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:curYM+'년',data:vals,borderColor:c.line,borderWidth:2,pointBackgroundColor:c.line,pointBorderColor:'#faf6ef',pointBorderWidth:1.5,pointRadius:3.5,pointHoverRadius:6,fill:true,backgroundColor:(ct)=>{const g=ct.chart.ctx.createLinearGradient(0,0,0,130);g.addColorStop(0,`rgba(${c.rgb},0.28)`);g.addColorStop(1,`rgba(${c.rgb},0.02)`);return g;},tension:0.42}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'#faf6ef',borderColor:c.line,borderWidth:1,titleColor:'#2e1f0e',bodyColor:'#5c3d1e',titleFont:{family:'Pretendard',size:11},bodyFont:{family:'Pretendard',size:11},callbacks:{label:ct=>' '+ct.parsed.y+'권'}}},scales:{x:{grid:{display:false},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72'}},y:{grid:{color:'rgba(207,195,172,0.32)'},border:{dash:[3,3]},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72',stepSize:1},min:0}}}});
  }
  const filtered=curYM==='all'?done:done.filter(b=>parseInt(b.date_finish.slice(0,4))===curYM);
  const total=filtered.length,cnt=Array(12).fill(0);filtered.forEach(b=>cnt[parseInt(b.date_finish.slice(5,7))-1]++);
  const mx=Math.max(...cnt),bestM=mx===0?'-':(cnt.indexOf(mx)+1)+'월 ('+mx+'권)';
  const yrs=new Set(done.map(b=>b.date_finish.slice(0,4))).size||1;
  document.getElementById('monthly-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">${curYM==='all'?'누적 완독':curYM+'년 완독'}</span></div><div class="si"><span class="sn">${curYM==='all'?Math.round(total/yrs*10)/10:Math.round(total/12*10)/10}</span><span class="sl">${curYM==='all'?'연평균':'월평균'}</span></div><div class="si"><span class="sn">${bestM}</span><span class="sl">최다 독서월</span></div>`;
}

function buildGenre() {
  if(donutChart){donutChart.destroy();donutChart=null;}
  const done=allBooks.filter(b=>b.status==='완독');
  const genreMap={};
  done.forEach(b=>{const g=Array.isArray(b.genre)?b.genre[0]:(b.genre||'미분류');genreMap[g]=(genreMap[g]||0)+1;});
  const genres=Object.keys(genreMap),vals=genres.map(g=>genreMap[g]);
  const total=vals.reduce((a,b)=>a+b,0)||1,maxV=Math.max(...vals)||1;
  const dl=document.getElementById('donut-layout');dl.innerHTML='';
  const db=document.createElement('div');db.className='donut-box';
  const dc=document.createElement('canvas');dc.width=120;dc.height=120;
  const ctr=document.createElement('div');ctr.className='dcenter';
  ctr.innerHTML=`<div class="dcenter-n">${total}</div><div class="dcenter-l">총 권수</div>`;
  db.appendChild(dc);db.appendChild(ctr);
  const lc=document.createElement('div');lc.className='leg-col';
  genres.forEach((g,i)=>{const pct=Math.round(vals[i]/total*100);const r=document.createElement('div');r.className='lrow';r.innerHTML=`<div class="lsw" style="background:${GCOLS[i%GCOLS.length]}"></div><div class="lbar-wrap"><div class="lname">${g}</div><div class="ltrack"><div class="lfill" style="width:${Math.round(vals[i]/maxV*100)}%;background:${GCOLS[i%GCOLS.length]}"></div></div></div><div class="lright"><span class="lpct">${pct}%</span><span class="lcnt">${vals[i]}권</span></div>`;lc.appendChild(r);});
  dl.appendChild(db);dl.appendChild(lc);
  document.getElementById('genre-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">총 권수</span></div><div class="si"><span class="sn">${genres.length}</span><span class="sl">장르 수</span></div>`;
  donutChart=new Chart(dc.getContext('2d'),{type:'doughnut',data:{labels:genres,datasets:[{data:vals,backgroundColor:GCOLS.slice(0,genres.length),borderColor:'#faf6ef',borderWidth:3,hoverOffset:5}]},options:{responsive:false,cutout:'68%',animation:{animateRotate:true,duration:600},plugins:{legend:{display:false},tooltip:{backgroundColor:'#faf6ef',borderColor:'#cfc3ac',borderWidth:1,titleColor:'#2e1f0e',bodyColor:'#5c3d1e',titleFont:{family:'Pretendard',size:11},bodyFont:{family:'Pretendard',size:11},callbacks:{label:c=>' '+c.label+' '+c.parsed+'권'}}}}});
}

function buildRating() {
  buildYrRow('yr-row-r',curYR,yr=>{curYR=yr;buildRating();});
  const done=allBooks.filter(b=>b.status==='완독');
  const filtered=curYR==='all'?done:done.filter(b=>parseInt(b.date_finish?.slice(0,4))===curYR);
  const total=filtered.length,dist=[5,4,3,2,1].map(s=>filtered.filter(b=>b.rating===s).length);
  const maxD=Math.max(...dist)||1,avg=total>0?(filtered.reduce((a,b)=>a+(b.rating||0),0)/total).toFixed(2):'—';
  const stars=s=>'★'.repeat(s)+'☆'.repeat(5-s);
  const layout=document.getElementById('rating-layout');layout.innerHTML='';
  const barsEl=document.createElement('div');barsEl.className='rating-bars';
  [5,4,3,2,1].forEach((s,i)=>{
    const cnt=dist[i],pct=total>0?Math.round(cnt/total*100):0,wpct=Math.round(cnt/maxD*100);const inside=wpct>=22;
    const row=document.createElement('div');row.className='rbar-row';
    row.innerHTML=`<span class="rbar-label">${stars(s)}</span><div class="rbar-outer"><div class="rbar-fill" style="width:${wpct}%;background:${RCOLS[i]}">${inside?`<span class="rbar-val">${cnt}권</span>`:''}</div>${!inside&&cnt>0?`<span class="rbar-val-out" style="left:${wpct}%;">${cnt}권</span>`:''}</div><span style="font-size:.62rem;color:var(--tx3);min-width:24px;text-align:right;">${pct}%</span>`;
    barsEl.appendChild(row);
  });
  layout.appendChild(barsEl);
  const sumEl=document.createElement('div');sumEl.className='rating-summary';
  sumEl.innerHTML=`<div class="rs-avg">${avg}</div><div class="rs-lbl">평균 평점</div>`;
  const distEl=document.createElement('div');distEl.className='rs-dist';
  [5,4,3,2,1].forEach((s,i)=>{const r=document.createElement('div');r.className='rs-star-row';r.innerHTML=`<span class="rs-star" style="font-size:10px;">${'★'.repeat(s)}</span><div class="rs-mini"><div class="rs-mini-fill" style="width:${Math.round(dist[i]/maxD*100)}%;background:${RCOLS[i]}"></div></div>`;distEl.appendChild(r);});
  sumEl.appendChild(distEl);layout.appendChild(sumEl);
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

  // ─ 명예의 전당
  const hallEl=document.createElement('div');
  hallEl.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:1rem;';
  const topA=aSorted[0], topP=pSorted[0];
  hallEl.innerHTML=`
    <div style="background:#ede4d0;border:1px solid var(--border2);border-radius:6px;padding:.65rem .8rem;text-align:center;">
      <div style="font-size:.6rem;color:var(--tx3);margin-bottom:.25rem;">👑 최애 작가</div>
      <div style="font-family:var(--fs);font-size:.95rem;color:var(--tx1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topA[0]}">${topA[0]}</div>
      <div style="font-size:.65rem;color:var(--acc);margin-top:.15rem;">${topA[1]}권 완독</div>
    </div>
    <div style="background:#ede4d0;border:1px solid var(--border2);border-radius:6px;padding:.65rem .8rem;text-align:center;">
      <div style="font-size:.6rem;color:var(--tx3);margin-bottom:.25rem;">📚 최애 출판사</div>
      <div style="font-family:var(--fs);font-size:.95rem;color:var(--tx1);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topP?topP[0]:'—'}">${topP?topP[0]:'—'}</div>
      <div style="font-size:.65rem;color:var(--acc);margin-top:.15rem;">${topP?topP[1]+'권 완독':''}</div>
    </div>`;
  wrap.appendChild(hallEl);

  // ─ 작가별 가로 바
  const sec1=document.createElement('div');sec1.style.marginBottom='.9rem';
  const h1=document.createElement('div');h1.style.cssText='font-size:.68rem;font-weight:600;color:var(--acc2);margin-bottom:.5rem;';h1.textContent='작가별 독서';sec1.appendChild(h1);
  const aList=authorExpanded?aSorted:aSorted.slice(0,5);
  const maxA=aSorted[0][1];
  const MEDAL=['🥇','🥈','🥉'];
  aList.forEach(([name,cnt],i)=>{
    const pct=Math.round(cnt/maxA*100);
    const ratingColors=['#3a6a4a','#6b8f6b','#c8a050','#c4714a','#8b4a8b'];
    const bg=ratingColors[i]||'#c8a87a';
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.5rem;margin-bottom:.38rem;';
    row.innerHTML=`<span style="font-size:.64rem;color:var(--tx2);min-width:72px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${MEDAL[i]||''} ${name}</span>
      <div style="flex:1;height:14px;background:#ede4d0;border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${bg};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">
          ${pct>18?`<span style="font-size:.55rem;font-weight:600;color:#fff;">${cnt}권</span>`:''}
        </div>
      </div>
      ${pct<=18?`<span style="font-size:.6rem;color:var(--tx3);min-width:22px;">${cnt}권</span>`:''}`;
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
  const PCOLS=['#5a8a8a','#7a9e7e','#8a8aaa','#c8a87a','#9a7090'];
  pList.forEach(([name,cnt],i)=>{
    const pct=Math.round(cnt/maxP*100);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:.5rem;margin-bottom:.38rem;';
    row.innerHTML=`<span style="font-size:.64rem;color:var(--tx2);min-width:72px;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</span>
      <div style="flex:1;height:14px;background:#ede4d0;border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${PCOLS[i%5]};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;">
          ${pct>18?`<span style="font-size:.55rem;font-weight:600;color:#fff;">${cnt}권</span>`:''}
        </div>
      </div>
      ${pct<=18?`<span style="font-size:.6rem;color:var(--tx3);min-width:22px;">${cnt}권</span>`:''}`;
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

  const ctx = document.getElementById('chart-pages').getContext('2d');
  let labels, vals, bookCounts;

  if(curPY === 'all') {
    // 연도별
    const YEARS = [...new Set(done.map(b=>b.date_finish.slice(0,4)))].sort();
    labels = YEARS.map(y=>y+'년');
    vals = YEARS.map(y=>done.filter(b=>b.date_finish.startsWith(y)).reduce((a,b)=>a+(b.pages||0),0));
    bookCounts = YEARS.map(y=>done.filter(b=>b.date_finish.startsWith(y)).length);
  } else {
    // 선택 연도의 월별
    const yr = String(curPY);
    labels = ['1','2','3','4','5','6','7','8','9','10','11','12'].map(m=>m+'월');
    vals = Array.from({length:12},(_,i)=>{
      const mk = yr+'-'+String(i+1).padStart(2,'0');
      return done.filter(b=>b.date_finish.startsWith(mk)).reduce((a,b)=>a+(b.pages||0),0);
    });
    bookCounts = Array.from({length:12},(_,i)=>{
      const mk = yr+'-'+String(i+1).padStart(2,'0');
      return done.filter(b=>b.date_finish.startsWith(mk)).length;
    });
  }

  const maxV = Math.max(...vals, 1);
  pagesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '페이지',
        data: vals,
        backgroundColor: vals.map((v,i) => {
          const ratio = v/maxV;
          const palettes = [
            ['rgba(196,113,74,.9)','rgba(196,113,74,.65)','rgba(196,113,74,.35)'],
            ['rgba(107,143,107,.9)','rgba(107,143,107,.65)','rgba(107,143,107,.35)'],
            ['rgba(90,122,138,.9)','rgba(90,122,138,.65)','rgba(90,122,138,.35)'],
            ['rgba(200,160,80,.9)','rgba(200,160,80,.65)','rgba(200,160,80,.35)'],
            ['rgba(139,107,139,.9)','rgba(139,107,139,.65)','rgba(139,107,139,.35)'],
          ];
          const pal = palettes[i % palettes.length];
          return ratio > 0.6 ? pal[0] : ratio > 0.2 ? pal[1] : ratio > 0 ? pal[2] : 'rgba(220,210,195,.4)';
        }),
        borderColor: 'transparent',
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#faf6ef', borderColor: '#cfc3ac', borderWidth: 1,
          titleColor: '#2e1f0e', bodyColor: '#5c3d1e',
          titleFont: {family:'Pretendard',size:11}, bodyFont: {family:'Pretendard',size:11},
          callbacks: {
            label: c => ` ${c.parsed.y.toLocaleString()}p`,
            afterLabel: (c) => bookCounts[c.dataIndex] ? ` (${bookCounts[c.dataIndex]}권)` : '',
          }
        }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{family:'Pretendard',size:10},color:'#a08c72'} },
        y: {
          grid: {color:'rgba(207,195,172,0.3)'}, border:{dash:[3,3]},
          ticks: {font:{family:'Pretendard',size:10},color:'#a08c72',callback:v=>v>=1000?(v/1000).toFixed(1)+'k':v},
          min: 0
        }
      }
    }
  });

  const totalP = vals.reduce((a,b)=>a+b,0);
  const totalB = bookCounts.reduce((a,b)=>a+b,0);
  const avgP = totalB > 0 ? Math.round(totalP/totalB) : 0;
  const bestIdx = vals.indexOf(Math.max(...vals));
  document.getElementById('pages-stat').innerHTML =
    `<div class="si"><span class="sn">${totalP.toLocaleString()}p</span><span class="sl">${curPY==='all'?'전체 누적 페이지':curPY+'년 누적 페이지'}</span></div>
     <div class="si"><span class="sn">${avgP.toLocaleString()}p</span><span class="sl">권당 평균</span></div>
     <div class="si"><span class="sn">${labels[bestIdx]||'—'}</span><span class="sl">최다 독서 기간</span></div>`;
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
    {n:done.filter(b=>b.rating>=4).length+'권',l:'명작 수집',ic:'⭐',c:'#b07030',bg:'#fdf7e8',prog:Math.min(done.filter(b=>b.rating>=4).length/100,1),target:'100권'},
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
  const thisYearMins=allBooks.filter(b=>b.last_read?.startsWith(String(cy))).reduce((a,b)=>a+(b.reading_time||0),0);
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
    wrap.innerHTML='<div style="font-size:.7rem;color:var(--tx3);">목표를 설정하면 진행률을 볼 수 있어요.</div>';
    return;
  }
  wrap.style.cssText='padding:.5rem 1rem .55rem;';
  wrap.innerHTML=`<div style="font-size:.58rem;color:var(--tx3);margin-bottom:.35rem;letter-spacing:.03em;">${cy}년 독서 목표</div>`+items.map(it=>`
    <div style="margin-bottom:.3rem;display:flex;align-items:center;gap:.55rem;">
      <div style="font-size:.62rem;color:var(--tx3);width:52px;flex-shrink:0;">${it.label}</div>
      <div style="flex:1;height:4px;background:#ede4d0;border-radius:2px;overflow:hidden;">
        <div style="width:${it.pct}%;height:100%;background:${it.pct>=100?'var(--sage)':it.color};border-radius:2px;transition:width .5s;"></div>
      </div>
      <div style="font-size:.6rem;color:var(--tx3);min-width:78px;text-align:right;">${it.cur}/${it.goal}${it.unit} ${it.pct>=100?'🏅':it.pct+'%'}</div>
    </div>`).join('');
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
  const allBtn=document.createElement('button');allBtn.className='cat-filter-btn'+(curCatFilter===null?' on':'');
  allBtn.textContent='전체 보기';allBtn.onclick=()=>{curCatFilter=null;document.querySelectorAll('.cat-filter-btn').forEach(b=>b.classList.remove('on'));allBtn.classList.add('on');buildBooks();};
  wrap.appendChild(allBtn);
  allCategories.forEach(cat=>{
    const btn=document.createElement('button');btn.className='cat-filter-btn'+(curCatFilter===cat?' on':'');
    btn.textContent=`📁 ${cat}`;btn.onclick=()=>{curCatFilter=cat;document.querySelectorAll('.cat-filter-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');buildBooks();};
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
async function searchBook() {
  const q=document.getElementById('book-search-input').value.trim();if(!q)return;
  const res=document.getElementById('search-results');res.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 중...</div>';
  try {
    const resp=await fetch(`${NAVER_PROXY}?query=${encodeURIComponent(q)}`,{headers:{Authorization:`Bearer ${SUPABASE_KEY}`}});
    const data=await resp.json();res.innerHTML='';
    if(!data.items?.length){res.innerHTML='<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 결과가 없어요.</div>';return;}
    data.items.forEach(item=>{
      const el=document.createElement('div');el.className='search-item';
      const cover=item.image||'',title=item.title.replace(/<[^>]+>/g,''),author=item.author.replace(/<[^>]+>/g,''),publisher=item.publisher||'',desc=item.description.replace(/<[^>]+>/g,'');
      // 페이지 수: itemPage(네이버 상세검색), description 파싱, sub 필드 등 다양한 곳 시도
      let pages = null;
      if(item.itemPage && parseInt(item.itemPage)) pages = parseInt(item.itemPage);
      else if(item.sub_info?.itemPage) pages = parseInt(item.sub_info.itemPage);
      else {
        const pageMatch = (item.description||'').match(/(\d{2,4})\s*p/i) || (item.description||'').match(/(\d{2,4})쪽/);
        if(pageMatch) pages = parseInt(pageMatch[1]);
      }
      const pagesLabel = pages ? `<div style="font-size:.62rem;color:var(--acc);">${pages}p</div>` : '';
      el.innerHTML=`${cover?`<img class="search-item-cover" src="${cover}" alt="${title}">`:'<div class="search-item-cover"></div>'}<div class="search-item-info"><div class="search-item-title">${title}</div><div class="search-item-author">${author}</div><div class="search-item-pub">${publisher}</div>${pagesLabel}</div>`;
      el.onclick=()=>selectBook({title,author,publisher,cover,description:desc,isbn:item.isbn,pages});
      res.appendChild(el);
    });
  } catch(e){res.innerHTML='<div style="font-size:.75rem;color:#c0392b;padding:.5rem;">검색 실패. 잠시 후 다시 시도해주세요.</div>';}
}
function selectBook(book) {
  selectedBook=book;
  document.getElementById('search-section').style.display='none';
  document.getElementById('book-form').style.display='';
  const coverHTML=book.cover?`<img class="selected-cover" src="${book.cover}" alt="${book.title}">`:`<div class="selected-cover" style="background:linear-gradient(150deg,#a07040,#5c3010);"></div>`;
  const pagesInfo = book.pages ? `<span style="font-size:.65rem;color:var(--acc);margin-left:.3rem;">${book.pages}p</span>` : '';
  document.getElementById('selected-book-info').innerHTML=`${coverHTML}<div class="selected-info"><div class="selected-title">${book.title}${pagesInfo}</div><div class="selected-author">${book.author}</div><div class="selected-desc">${book.description||''}</div><span class="selected-change" onclick="changeBook()">다른 책 선택</span></div>`;
  // 페이지 수 무조건 채우기 (있으면)
  const pagesEl = document.getElementById('book-pages');
  if(pagesEl) {
    if(book.pages) { pagesEl.value = book.pages; }
    else { pagesEl.value = ''; }
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
    full.className = 'star' + (rating >= i ? ' on' : '');
    full.style.cssText = 'position:relative;cursor:pointer;font-size:1.4rem;';
    // 왼쪽 절반 클릭 = i-0.5, 오른쪽 절반 클릭 = i
    full.innerHTML = `
      <span style="position:absolute;left:0;top:0;width:50%;height:100%;z-index:2;" onclick="setStar(${i-0.5})"></span>
      <span style="position:absolute;right:0;top:0;width:50%;height:100%;z-index:2;" onclick="setStar(${i})"></span>
      ${rating >= i ? '★' : rating >= i-0.5 ? '⯨' : '☆'}`;
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
  el.style.cssText='background:#faf6ef;border:1px solid var(--border);border-radius:8px;padding:.6rem .7rem;margin-bottom:.4rem;position:relative;';
  el.innerHTML=`
    <button onclick="this.parentElement.remove()" style="position:absolute;top:.4rem;right:.5rem;background:none;border:none;font-size:.75rem;color:var(--tx3);cursor:pointer;line-height:1;">✕</button>
    <div style="font-size:.58rem;color:var(--acc);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.3rem;">✍️ 문장</div>
    <textarea class="form-input" placeholder="인상 깊은 문장..." rows="2" data-qtext style="font-size:.78rem;font-style:italic;font-family:var(--fs);background:#fff;border-radius:5px;margin-bottom:.35rem;resize:vertical;">${text}</textarea>
    <div style="display:flex;gap:.35rem;">
      <input type="text" class="form-input" placeholder="💬 코멘트 (느낀 점, 메모...)" data-qtag value="${comment}" style="flex:1;font-size:.73rem;background:#fff;border-radius:5px;">
      <input type="text" class="form-input" placeholder="p.42" data-qpage value="${page}" style="width:60px;font-size:.73rem;background:#fff;border-radius:5px;text-align:center;">
    </div>`;
  list.appendChild(el);
}
async function saveBook() {
  if(!selectedBook&&!editingBookId){alert('책을 검색해서 선택해주세요.');return;}
  const genre=document.getElementById('book-genre').value,review=document.getElementById('book-review').value.trim();
  const dateStart=document.getElementById('book-start').value,dateFinish=document.getElementById('book-finish').value;
  const reread=document.getElementById('book-reread').checked,pages=parseInt(document.getElementById('book-pages').value)||null;
  const source=document.getElementById('book-source').value,category=document.getElementById('book-category').value;
  const qf=document.querySelectorAll('.quote-field');
  const newQuotes=[...qf].map(f=>({text:f.querySelector('[data-qtext]').value.trim(),tag:f.querySelector('[data-qtag]').value.trim(),page:f.querySelector('[data-qpage]').value.trim()})).filter(q=>q.text);
  const existing=editingBookId?allBooks.find(b=>b.id===editingBookId):null;
  const bookData={user_id:currentUser.id,title:selectedBook?.title||existing?.title||'',author:selectedBook?.author||existing?.author||'',publisher:selectedBook?.publisher||existing?.publisher||'',cover:selectedBook?.cover||existing?.cover||'',description:selectedBook?.description||existing?.description||'',isbn:selectedBook?.isbn||existing?.isbn||'',genre:genre?[genre]:[],rating:curRating||null,status:curStatus,date_start:dateStart||null,date_finish:dateFinish||null,review,reread,pages,source:source||null,category:category||null};
  try {
    let bookId=editingBookId;
    if(editingBookId){const{error}=await sb.from('books').update(bookData).eq('id',editingBookId);if(error)throw error;await sb.from('quotes').delete().eq('book_id',editingBookId);}
    else{const{data,error}=await sb.from('books').insert(bookData).select().single();if(error)throw error;bookId=data?.id;}
    if(bookId&&newQuotes.length)await sb.from('quotes').insert(newQuotes.map(q=>({...q,user_id:currentUser.id,book_id:bookId})));
    closeModal('modal-book');await loadData();buildBooks();
  } catch(e){alert('저장 중 오류: '+(e.message||JSON.stringify(e)));}
}

// ── 책 상세
function openDetail(bookId) {
  curBookId=bookId;
  const b=allBooks.find(b=>b.id===bookId);if(!b)return;
  // detail-title은 숨겨진 요소 - 오류 방지를 위해 제거
  const quotes=allQuotes.filter(q=>q.book_id===bookId);
  const genre=Array.isArray(b.genre)?b.genre.join(', '):(b.genre||'');
  const coverHTML=b.cover?`<img class="detail-cover" src="${b.cover}" alt="${b.title}">`:`<div class="detail-cover-ph">${b.title}</div>`;
  const readingTime=b.reading_time?`<span class="detail-chip">📖 ${Math.floor(b.reading_time/60)}h ${b.reading_time%60}m</span>`:'';
  // 줄거리 더보기
  const MAX_DESC=150;let descHTML='';
  if(b.description){
    if(b.description.length>MAX_DESC){
      descHTML=`<div class="detail-sec">줄거리</div><div class="detail-body"><span class="desc-short">${b.description.slice(0,MAX_DESC)}...</span><span class="desc-full" style="display:none;">${b.description}</span><span class="desc-toggle" onclick="toggleDesc(this)">더 보기</span></div><div class="detail-divhr"></div>`;
    } else {
      descHTML=`<div class="detail-sec">줄거리</div><div class="detail-body">${b.description}</div><div class="detail-divhr"></div>`;
    }
  }
  // 상태 색상
  const statusColor = {완독:'#2e7d32',읽는중:'#1565c0',읽고싶음:'#7b1fa2',중단:'#c62828'}[b.status]||'var(--tx3)';
  const statusBg = {완독:'#e8f5e9',읽는중:'#e3f2fd',읽고싶음:'#f3e5f5',중단:'#ffebee'}[b.status]||'#f5f5f5';
  // 반별점
  const starStr = r => { let s=''; for(let i=1;i<=5;i++) s+=r>=i?'★':r>=i-.5?'⯨':'☆'; return s; };
  // 진행률
  const pct = b.pages&&b.current_page ? Math.min(100,Math.round(b.current_page/b.pages*100)) : 0;

  let html = `
  <div style="display:flex;gap:.8rem;align-items:flex-start;padding-bottom:.8rem;border-bottom:1px solid var(--border);margin-bottom:.75rem;">
    <div style="flex-shrink:0;">${coverHTML}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:.82rem;font-weight:700;color:var(--tx1);line-height:1.35;margin-bottom:.2rem;">${b.title}</div>
      ${b.author?`<div style="font-size:.65rem;color:var(--tx3);margin-bottom:.3rem;">${b.author}${b.publisher?' · '+b.publisher:''}</div>`:''}
      <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.4rem;">
        <span style="font-size:.82rem;color:#c8a050;letter-spacing:.02rem;">${starStr(b.rating||0)}</span>
        ${b.rating?`<span style="font-size:.6rem;color:var(--tx3);">${b.rating}점</span>`:''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:.25rem;align-items:center;">
        ${b.status?`<span style="font-size:.6rem;font-weight:600;padding:.12rem .5rem;border-radius:10px;background:${statusBg};color:${statusColor};">${b.status}</span>`:''}
        ${genre?`<span class="detail-chip">${genre}</span>`:''}
        ${b.pages?`<span class="detail-chip">${b.pages}p</span>`:''}
        ${b.date_finish?`<span class="detail-chip">📅 ${b.date_finish}</span>`:''}
        ${b.source?`<span class="detail-chip">${b.source}</span>`:''}
        ${b.category?`<span class="detail-chip">📁 ${b.category}</span>`:''}
        ${b.reread?`<span class="detail-chip">🔁 다시 읽고 싶음</span>`:''}
        ${readingTime?`<span class="detail-chip">⏱ ${readingTime.replace(/<[^>]+>/g,'')}</span>`:''}
      </div>
      ${b.status==='읽는중'&&pct?`
      <div style="margin-top:.45rem;">
        <div style="height:4px;background:#e0d8cc;border-radius:2px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--acc),#c8a050);border-radius:2px;"></div>
        </div>
        <div style="font-size:.55rem;color:var(--tx3);margin-top:.15rem;">${b.current_page}p / ${b.pages}p · ${pct}%</div>
      </div>`:''}
    </div>
  </div>`;
    html+=descHTML;
  if(b.review)html+=`<div class="detail-sec">감상</div><div class="detail-body">${b.review}</div>`;
  if(quotes.length){
    html+=`<div class="detail-divhr"></div><div class="detail-sec">인상 깊은 문장</div>`;
    quotes.forEach(q=>{html+=`<div class="detail-quote">${q.text}<div class="detail-qsrc">${q.page?'p.'+q.page+' ':''}${q.tag?'💬 '+q.tag:''}</div></div>`;});
  }
  // 읽는중 책: 페이지 진행 업데이트 섹션
  if(b.status === '읽는중') {
    const cp = b.current_page||0, tp = b.pages||0;
    const pct2 = tp&&cp ? Math.min(100,Math.round(cp/tp*100)) : 0;
    html += `<div class="detail-divhr"></div>
    <div style="background:linear-gradient(135deg,#fdf8f0,#f5ece0);border:1px solid var(--border);border-radius:10px;padding:.7rem .85rem;margin-top:.2rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
        <div style="font-size:.65rem;font-weight:600;color:var(--acc2);letter-spacing:.05em;">📖 독서 진행</div>
        <label style="display:flex;align-items:center;gap:.3rem;font-size:.65rem;color:var(--tx3);cursor:pointer;">
          <input type="checkbox" id="show-progress-chk" ${b.show_progress!==false?'checked':''} style="accent-color:var(--acc);width:11px;height:11px;">
          <span>표시</span>
        </label>
      </div>
      <div id="progress-input-wrap" style="${b.show_progress===false?'display:none;':''}">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">
          <input type="number" id="current-page-input" value="${b.current_page||''}" min="1" max="${b.pages||9999}"
            placeholder="현재 쪽" style="flex:1;padding:.35rem .55rem;border:1px solid var(--border2);border-radius:8px;font-size:.8rem;font-family:var(--ff);background:#fff;text-align:center;">
          ${tp?`<span style="font-size:.68rem;color:var(--tx3);">/ ${tp}p</span>`:''}
          <button onclick="saveReadingProgress('${b.id}')" style="background:var(--acc);color:#fff;border:none;border-radius:8px;padding:.32rem .75rem;font-size:.7rem;cursor:pointer;font-family:var(--ff);">저장</button>
        </div>
        ${tp&&cp?`
        <div style="height:5px;background:rgba(0,0,0,.08);border-radius:3px;overflow:hidden;margin-bottom:.25rem;">
          <div style="width:${pct2}%;height:100%;background:linear-gradient(90deg,var(--acc),var(--gold));border-radius:3px;transition:width .4s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--tx3);">
          <span>${cp}p 읽음</span>
          <span>${pct2}% · ${tp-cp}p 남음</span>
        </div>`:''}
      </div>
    </div>`;
    // 체크박스 이벤트는 html 삽입 후 연결
  }
  document.getElementById('detail-body').innerHTML=html;
  // 페이지 표시 체크박스 이벤트 연결
  const showChk = document.getElementById('show-progress-chk');
  if(showChk) {
    showChk.onchange = () => {
      const wrap = document.getElementById('progress-input-wrap');
      if(wrap) wrap.style.display = showChk.checked ? 'flex' : 'none';
      saveReadingProgress(b.id, true); // 표시 여부만 저장
    };
  }
  openModal('modal-detail');
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
    await loadData();buildBooks();
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

// ── 프로필
async function openProfile() {
  const tempName=currentUser.email?.split('@')[0]||'독서가';
  document.getElementById('profile-avatar').textContent=tempName.slice(0,1).toUpperCase();
  document.getElementById('profile-name').textContent=tempName;
  document.getElementById('profile-email').textContent=currentUser.email;
  document.getElementById('profile-display-name').value=tempName;
  openModal('modal-profile');
  // 관리자 버튼 표시
  const adminBtn = document.getElementById('profile-admin-btn');
  if(adminBtn) adminBtn.style.display = curUserRole==='admin' ? '' : 'none';
  // 폰트 크기 슬라이더 현재값 반영
  const savedSize = localStorage.getItem('bl_font_size') || '100';
  const slider = document.getElementById('font-size-slider');
  const label = document.getElementById('font-size-label');
  if(slider) slider.value = savedSize;
  if(label) label.textContent = savedSize + '%';
  const[{data:profile},{data:myCodes}]=await Promise.all([
    sb.from('profiles').select('*').eq('id',currentUser.id).single(),
    sb.from('invite_codes').select('*').eq('owner_id',currentUser.id)
  ]);
  if(profile){
    const name=profile.display_name||profile.username||tempName;
    document.getElementById('profile-avatar').textContent=name.slice(0,1).toUpperCase();
    document.getElementById('profile-name').textContent=name;
    document.getElementById('profile-display-name').value=name;
  }
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
  // 초대코드 표시
  const codeWrap=document.getElementById('profile-invite-codes');
  if(codeWrap && myCodes) {
    const available=myCodes.filter(c=>!c.used_by);
    const used=myCodes.filter(c=>c.used_by);
    codeWrap.innerHTML=`<div style="font-size:.68rem;font-weight:600;color:var(--acc2);margin-bottom:.3rem;">내 초대코드</div>`
      +available.map(c=>`<div style="font-family:monospace;font-size:.78rem;background:#ede4d0;border:1px solid var(--border2);border-radius:4px;padding:.25rem .6rem;margin-bottom:.25rem;display:flex;justify-content:space-between;">
        <span>${c.code}</span><span style="font-size:.65rem;color:var(--acc);">사용 가능</span></div>`).join('')
      +(available.length===0?'<div style="font-size:.72rem;color:var(--tx3);">사용 가능한 코드가 없어요.</div>':'')
      +(used.length?`<div style="font-size:.65rem;color:var(--tx3);margin-top:.3rem;">${used.length}개 사용됨</div>`:'');
  }
}
async function saveProfile() {
  const name = document.getElementById('profile-display-name')?.value.trim();
  if(!name){alert('닉네임을 입력해주세요.');return;}
  try {
    const {error} = await sb.from('profiles').update({display_name:name}).eq('id',currentUser.id);
    if(error) throw error;
    closeModal('modal-profile');
    alert('닉네임이 변경됐어요!');
  } catch(e){ alert('저장 오류: '+(e.message||JSON.stringify(e))); }
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
            <div style="color:var(--tx3);font-size:.63rem;">${n.created_at?.slice(0,16).replace('T',' ')} ${n.is_read?'':'· 새 알림'}</div>
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
    detailEl.innerHTML = `
      <div style="font-size:.85rem;line-height:1.85;color:var(--tx1);padding-bottom:.8rem;">${msgHtml}</div>
      <div style="font-size:.65rem;color:var(--tx3);">${(n.created_at||'').slice(0,16).replace('T',' ')}</div>
      ${postId ? `<div style="margin-top:1rem;border-top:1px solid var(--border);padding-top:.7rem;">
        <button class="btn-save" style="width:100%;padding:.5rem;" onclick="goToPost('${postId}')">📖 게시글 보러가기</button>
      </div>` : ''}`;
    openModal('modal-notif-detail');
  }
  sb.from('notifications').update({is_read:true}).eq('id', notifId).then(()=>loadNotifications());
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
    // display_name 검색
    const { data: byDisplay } = await sb.from('profiles').select('id,display_name,username,role').ilike('display_name', `%${q}%`).neq('id', currentUser.id).limit(10);
    // username 검색
    const { data: byUser } = await sb.from('profiles').select('id,display_name,username,role').ilike('username', `%${q}%`).neq('id', currentUser.id).limit(10);
    // 합치고 중복 제거
    const seen = new Set();
    const results = [...(byDisplay||[]), ...(byUser||[])].filter(u => { if(seen.has(u.id)) return false; seen.add(u.id); return true; });
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
        <div style="font-size:.62rem;color:var(--tx3);">${m.created_at?.slice(0,10)}</div>
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
    // profiles 삭제 (cascade로 관련 데이터 삭제)
    const { error } = await sb.from('profiles').delete().eq('id', userId);
    if(error) throw error;
    await loadAllMembers();
    alert(`"${userName}" 계정을 삭제했어요.`);
  } catch(e) {
    alert('삭제 오류: '+(e.message||'관리자 권한을 확인해주세요'));
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
        date_start: C.start >= 0 ? formatDate(r[C.start]) : null,
        date_finish:status === '완독' && C.finish >= 0 ? formatDate(r[C.finish]) : null,
        user_id:    currentUser.id,
        created_at: new Date().toISOString(),
      };
    }).filter(b => b.title);

    if(!books.length) { await showAlert('가져올 책이 없어요.'); return; }

    const upsertMode = document.getElementById('bookit-upsert-mode')?.checked;
    const existingTitleMap = Object.fromEntries(allBooks.map(b=>[b.title.trim(), b.id]));
    const toInsert = books.filter(b => !existingTitleMap[b.title]);
    const toUpdate = upsertMode ? books.filter(b => existingTitleMap[b.title]) : [];

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
      const bookId = existingTitleMap[book.title];
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

    await loadData(); buildBooks();
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
      tags:     findColIdx(['태그','컬렉션','collection']),
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
        rating:     CI.rating>=0?(parseFloat(String(getVal(r,CI.rating)||'').replace(/[^0-9.]/g,''))||null):null,
        date_start: dateStart,
        date_finish:dateFinish,
        pages:      CI.pages>=0?(parseInt(String(getVal(r,CI.pages)||'').replace(/[^0-9]/g,''))||null):null,
        review:     String(getVal(r,CI.review)||'').trim(),
        isbn:       String(getVal(r,CI.isbn)||'').trim(),
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
    const existingTitleMap = Object.fromEntries(existingBooks.map(b=>[b.title.trim(), b.id]));

    const toInsert = books.filter(b => !existingTitleMap[b.title]);
    const toUpdate = upsertMode ? books.filter(b => existingTitleMap[b.title]) : [];
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
      const bookId = existingTitleMap[book.title];
      const { error } = await sb.from('books').update({
        author: book.author||undefined,
        publisher: book.publisher||undefined,
        status: book.status,
        rating: book.rating,
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
      ...toUpdate.map(b=>[b.title, existingTitleMap[b.title]]).filter(([,id])=>id)
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
        quoteTexts.push({book_id:bookId, user_id:currentUser.id, text, created_at:new Date().toISOString()});
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

    await loadData(); buildBooks();
    closeModal('modal-backup');
    await showAlert(`✅ 완료!\n신규: ${toInsert.length}권${toUpdate.length>0?` / 업데이트: ${toUpdate.length}권`:''}\n표지 자동 검색 완료\n${quoteCount>0?`문장 ${quoteCount}개 가져옴`:''}`);
  } catch(e) {
    await showAlert('가져오기 오류: '+e.message);
    console.error('excel import error:', e);
  }
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
    await loadData(); await loadGoals(); buildBooks();
    alert(`복원 완료! 책 ${newBooks.length}권을 추가했어요.`);
    closeModal('modal-backup');
  } catch(e) { alert('복원 오류: '+e.message); }
}

// ══════════════════════════════════════
// 친구 & 파도타기 (서재 구경)
// ══════════════════════════════════════
async function openSocialModal() {
  openModal('modal-social');
  loadFriends();
}

async function loadFriends() {
  const wrap = document.getElementById('friend-list');
  if(!wrap) return;
  wrap.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">불러오는 중...</div>';
  const { data } = await sb.from('friendships').select(`
    id, status, requester_id, receiver_id,
    requester:profiles!friendships_requester_id_fkey(id,display_name,username),
    receiver:profiles!friendships_receiver_id_fkey(id,display_name,username)
  `).or(`requester_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);

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
    const initial = name.slice(0,1).toUpperCase();
    const colors = ['#c4714a','#6b8f6b','#5a7a8a','#8b6b8b','#c8a050'];
    const color = colors[name.charCodeAt(0) % colors.length];
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:.7rem;padding:.55rem .2rem;border-bottom:1px solid var(--border);';
    // 아바타
    const avatar = `<div style="width:32px;height:32px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0;">${initial}</div>`;
    if(f.status === 'accepted') {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx1);">${name}</div>
          <div style="font-size:.65rem;color:var(--tx3);">산책 친구</div>
        </div>
        <button onclick="openLibrary('${other.id}','${name}')" style="font-size:.7rem;padding:.25rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--acc);font-family:var(--ff);">서재 보기</button>
        <button onclick="removeFriend('${f.id}')" style="width:28px;height:28px;border:none;background:#f5f0e8;border-radius:50%;cursor:pointer;color:var(--tx3);font-size:.75rem;display:flex;align-items:center;justify-content:center;" title="친구 삭제">✕</button>`;
    } else if(f.status === 'pending' && !isMine) {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx1);">${name}</div>
          <div style="font-size:.65rem;color:var(--acc);">친구 요청이 왔어요</div>
        </div>
        <button onclick="acceptFriend('${f.id}')" style="font-size:.7rem;padding:.25rem .6rem;border:none;border-radius:12px;background:var(--acc);cursor:pointer;color:#fff;font-family:var(--ff);">수락</button>
        <button onclick="removeFriend('${f.id}')" style="font-size:.7rem;padding:.25rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--tx3);font-family:var(--ff);">거절</button>`;
    } else {
      el.innerHTML = `${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;color:var(--tx3);">${name}</div>
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
  if(!q || !resultEl) return;
  const { data } = await sb.from('profiles').select('id,display_name,username')
    .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
    .neq('id', currentUser.id).limit(5);
  resultEl.innerHTML = '';
  if(!data?.length) {
    resultEl.innerHTML='<div style="padding:.6rem .8rem;font-size:.75rem;color:var(--tx3);text-align:center;">검색 결과가 없어요.</div>';
    return;
  }
  data.forEach(u => {
    const name = u.display_name || u.username;
    const initial = name.slice(0,1).toUpperCase();
    const colors = ['#c4714a','#6b8f6b','#5a7a8a','#8b6b8b','#c8a050'];
    const color = colors[name.charCodeAt(0) % colors.length];
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.55rem .8rem;border-bottom:1px solid var(--border);background:#fff;';
    el.onmouseenter = () => el.style.background = '#faf6ef';
    el.onmouseleave = () => el.style.background = '#fff';
    el.innerHTML = `
      <div style="width:30px;height:30px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0;">${initial}</div>
      <span style="flex:1;font-size:.82rem;font-weight:500;color:var(--tx1);">${name}</span>
      <button onclick="sendFriendRequest('${u.id}','${name}')" style="font-size:.7rem;padding:.22rem .6rem;border:none;border-radius:12px;background:var(--acc);cursor:pointer;color:#fff;font-family:var(--ff);">+ 친구</button>
      <button onclick="openLibrary('${u.id}','${name}')" style="font-size:.7rem;padding:.22rem .6rem;border:1px solid var(--border2);border-radius:12px;background:none;cursor:pointer;color:var(--tx2);font-family:var(--ff);">서재</button>`;
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

// 파도타기 - 랜덤 서재 구경
async function surfLibrary() {
  const { data } = await sb.from('profiles')
    .select('id,display_name,username,library_public')
    .eq('library_public', true)
    .neq('id', currentUser.id)
    .limit(50);
  if(!data?.length) { alert('공개된 서재가 없어요.'); return; }
  const random = data[Math.floor(Math.random()*data.length)];
  const name = random.display_name || random.username || '산책자';
  openLibrary(random.id, name);
}

// 서재 구경 상태
let _libBooks = [], _libFilter = '전체', _libCatFilter = null, _libUserId = null, _libUserName = '';
let _libCalY = new Date().getFullYear(), _libCalM = new Date().getMonth();

async function openLibrary(userId, userName) {
  closeModal('modal-social');

  // 1단계: 프로필 먼저 확인 (공개 범위 체크)
  const { data: targetProfile } = await sb.from('profiles')
    .select('library_public,library_visibility,category_visibility,categories')
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
  _libCatFilter = null;
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

  // 헤더 - 감성적 배경
  const headerColors = [
    'linear-gradient(135deg,#4a3520 0%,#7a5030 50%,#5a3a20 100%)',
    'linear-gradient(135deg,#2a4a3a 0%,#3a6a50 50%,#2a4a3a 100%)',
    'linear-gradient(135deg,#3a3a5a 0%,#5a4a7a 50%,#3a3a5a 100%)',
    'linear-gradient(135deg,#4a3a2a 0%,#7a6a4a 50%,#4a3a2a 100%)',
  ];
  const hColor = headerColors[userName.charCodeAt(0) % headerColors.length];
  const initial = userName.slice(0,1).toUpperCase();

  header.innerHTML = `
    <div style="background:${hColor};padding:1.4rem 1.4rem 1rem;position:relative;overflow:hidden;">
      <!-- 배경 장식 -->
      <div style="position:absolute;top:-30px;right:-20px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.04);"></div>
      <div style="position:absolute;bottom:-40px;right:40px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.03);"></div>
      <!-- 닫기 -->
      <button onclick="closeModal('modal-library')" style="position:absolute;top:.9rem;right:.9rem;width:28px;height:28px;border:none;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:.8rem;display:flex;align-items:center;justify-content:center;">✕</button>
      <!-- 프로필 -->
      <div style="display:flex;align-items:center;gap:.9rem;margin-bottom:1rem;">
        <div style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:#fff;font-family:var(--fs);">${initial}</div>
        <div>
          <div style="font-size:1rem;font-weight:700;color:#fff;font-family:var(--fs);">${userName}님의 서재</div>
          <div style="font-size:.7rem;color:rgba(255,255,255,.65);margin-top:.1rem;">📚 함께 읽는 산책자</div>
        </div>
      </div>
      <!-- 통계 칩 -->
      <div style="display:flex;gap:.5rem;">
        <div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:.3rem .8rem;text-align:center;">
          <div style="font-size:.95rem;font-weight:700;color:#fff;">${totalDoneLib}</div>
          <div style="font-size:.58rem;color:rgba(255,255,255,.7);">완독</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:.3rem .8rem;text-align:center;">
          <div style="font-size:.95rem;font-weight:700;color:#fff;">${totalReading}</div>
          <div style="font-size:.58rem;color:rgba(255,255,255,.7);">읽는중</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:.3rem .8rem;text-align:center;">
          <div style="font-size:.95rem;font-weight:700;color:#fff;">${_libBooks.length}</div>
          <div style="font-size:.58rem;color:rgba(255,255,255,.7);">전체</div>
        </div>
      </div>
    </div>
    <!-- 필터 탭 -->
    <div style="padding:.7rem 1rem .3rem;display:flex;gap:.3rem;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--card);">
      <button class="filter-btn on" id="lib-f-전체" onclick="libFilter('전체',this)">전체</button>
      <button class="filter-btn" id="lib-f-완독" onclick="libFilter('완독',this)">완독</button>
      <button class="filter-btn" id="lib-f-읽는중" onclick="libFilter('읽는중',this)">읽는중</button>
      <button class="filter-btn" id="lib-f-읽고싶음" onclick="libFilter('읽고싶음',this)">읽고싶음</button>
      ${cats.length ? `<span style="font-size:.6rem;color:var(--border2);margin:0 .1rem;">│</span>
        <button class="filter-btn on" id="lib-cat-all" onclick="libCatFilter(null,this)">📂 전체</button>
        ${cats.map(c=>`<button class="filter-btn" id="lib-cat-${c.replace(/\s/g,'_')}" onclick="libCatFilter('${c}',this)">📁 ${c}</button>`).join('')}` : ''}
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
  _libCatFilter = null; // 상태 필터 바꾸면 카테고리 필터도 초기화
  document.querySelectorAll('[id^="lib-f-"]').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('[id^="lib-cat-"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  // lib-cat-all도 on으로
  document.getElementById('lib-cat-all')?.classList.add('on');
  renderLibGallery();
}

function libCatFilter(cat, btn) {
  // 토글: 이미 선택된 카테고리면 해제
  if(_libCatFilter === cat) {
    _libCatFilter = null;
    document.querySelectorAll('[id^="lib-cat-"]').forEach(b=>b.classList.remove('on'));
    document.getElementById('lib-cat-all')?.classList.add('on');
  } else {
    _libCatFilter = cat;
    document.querySelectorAll('[id^="lib-cat-"]').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
  }
  renderLibGallery();
}

function renderLibGallery() {
  const g = document.getElementById('lib-gallery');
  if(!g) return;
  let list = _libBooks;
  if(_libFilter !== '전체') list = list.filter(b=>b.status===_libFilter);
  if(_libCatFilter) list = list.filter(b=>b.category===_libCatFilter);
  g.innerHTML = '';
  if(!list.length) { g.innerHTML='<div class="empty-state">책이 없어요.</div>'; return; }
  list.forEach(b => {
    const el = document.createElement('div');
    el.className = 'gi';
    el.style.cursor = 'default';
    const img = b.cover
      ? `<img src="${b.cover}" alt="${b.title}" style="width:100%;height:100%;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.42rem;color:rgba(255,255,255,.8);text-align:center;padding:.2rem;font-style:italic;line-height:1.3;">${b.title}</div>`;
    el.innerHTML = `<div class="gi-cover">${img}</div>
      <div class="gi-title">${b.title}</div>
      <div class="gi-author">${b.author||''}</div>
      <div class="gi-stars">${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</div>
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
function openModal(id){document.getElementById(id).style.display='flex';}
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
  const { data } = await sb.from('profiles').select('role').eq('id', currentUser.id).single();
  curUserRole = data?.role || 'user';
}

async function buildBoard() {
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
      <span style="font-size:.62rem;color:#a08c72;">${n.created_at?.slice(0,10)}</span>`;
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
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:.22rem;flex-wrap:wrap;">
          ${p.is_notice?'<span class="post-badge-notice">📌 공지</span>':''}
          ${cat?`<span class="board-cat">${cat}</span>`:''}
          <span class="board-title" style="${isBlind?'color:var(--tx3);font-style:italic;':''}">
            ${isBlind?'🚫 신고 게시글로 분류되었습니다.':p.title}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:.6rem;">
          <span class="board-meta">산책자</span>
          <span class="board-meta">${p.created_at?.slice(0,10)}</span>
          <span class="board-meta" style="margin-left:auto;">❤️ ${p.likes||0}</span>
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
    for(let i=1;i<=totalPages;i++){
      const btn=document.createElement('button');
      btn.className='yr-btn'+(i===boardPage?' on':'');
      btn.style.cssText=i===boardPage?'background:var(--acc);color:#fff;border-color:transparent;':'';
      btn.textContent=i; btn.onclick=()=>{boardPage=i;renderBoardList();};
      pg.appendChild(btn);
    }
  }
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
        <span class="board-meta">${p.created_at?.slice(0,10)}</span>
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
        <div style="font-size:.65rem;color:var(--tx3);margin-bottom:.1rem;">${getCommentAuthor(r.user_id)} · ${r.created_at?.slice(0,10)}</div>
        <div style="font-size:.75rem;color:var(--tx1);line-height:1.6;">${r.content}</div>
        ${rCanDelete?`<button onclick="deleteComment('${r.id}','${postId}')" style="font-size:.6rem;color:var(--tx3);border:none;background:none;cursor:pointer;margin-top:.1rem;">삭제</button>`:''}
      </div>`;
    }).join('');
    return `<div style="padding:.5rem 0;border-bottom:1px solid #ede4d0;">
      <div style="display:flex;align-items:flex-start;gap:.5rem;">
        <div style="flex:1;">
          <div style="font-size:.68rem;margin-bottom:.18rem;">${getCommentAuthor(c.user_id)} · ${c.created_at?.slice(0,10)}</div>
          <div style="font-size:.78rem;color:var(--tx1);line-height:1.7;white-space:pre-wrap;">${c.content}</div>
        </div>
        <div style="display:flex;gap:.3rem;flex-shrink:0;">
          <button onclick="showReplyInput('${c.id}')" style="font-size:.6rem;color:var(--acc);border:1px solid var(--border2);border-radius:3px;padding:1px 5px;background:none;cursor:pointer;">답글</button>
          ${canDelete?`<button onclick="deleteComment('${c.id}','${postId}')" style="font-size:.6rem;color:var(--tx3);border:none;background:none;cursor:pointer;">삭제</button>`:''}
        </div>
      </div>
      ${replyHtml}
      <div id="reply-box-${c.id}" style="display:none;margin-top:.4rem;margin-left:1rem;">
        <div style="display:flex;gap:.3rem;">
          <input type="text" placeholder="답글 입력..." style="flex:1;padding:.3rem .6rem;border:1px solid var(--border2);border-radius:4px;font-size:.75rem;font-family:var(--ff);" id="reply-input-${c.id}">
          <button onclick="submitReply('${postId}','${c.id}')" class="btn-save" style="padding:.3rem .6rem;font-size:.72rem;">등록</button>
        </div>
      </div>
    </div>`;
  }).join('');

  detailBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem;flex-wrap:wrap;">
      ${catLabel?`<span class="board-cat">${catLabel}</span>`:''}
      ${post.is_notice?'<span style="background:#e0a020;color:#fff;font-size:.63rem;border-radius:3px;padding:1px 6px;">공지</span>':''}
      <span class="board-meta">산책자</span>
      <span class="board-meta">${post.created_at?.slice(0,10)}</span>
    </div>
    <div style="font-size:.85rem;line-height:1.9;color:${post.is_hidden?'var(--tx3)':'var(--tx1)'};border-top:1px solid var(--border);padding-top:.8rem;margin-bottom:1rem;">
      ${post.is_hidden
        ? '🚫 이 게시글은 신고 게시글로 분류되었습니다.'
        : (post.content||'').replace(/\n/g,'<br>')}
    </div>
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;">
      <button onclick="likePost('${postId}')" style="font-size:.75rem;padding:.28rem .7rem;border:1px solid var(--border2);border-radius:4px;background:${alreadyLiked?'#ede4d0':'none'};cursor:pointer;color:var(--tx2);">
        ❤️ ${post.likes||0}${alreadyLiked?' ✓':''}
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
  const { data: myProfile } = await sb.from('profiles').select('is_banned').eq('id',currentUser.id).single();
  if(myProfile?.is_banned) { alert('계정이 제한되어 공감할 수 없어요.'); return; }
  // DB 기반 중복 방지 (post_likes 테이블)
  const { data: existing } = await sb.from('post_likes')
    .select('post_id').eq('post_id', postId).eq('user_id', currentUser.id).single();
  if(existing) { alert('이미 공감한 글이에요.'); return; }
  // 좋아요 기록 + 카운트 증가 동시 처리
  const [_, { data:p }] = await Promise.all([
    sb.from('post_likes').insert({ post_id: postId, user_id: currentUser.id }),
    sb.from('posts').select('likes,user_id').eq('id',postId).single()
  ]);
  await sb.from('posts').update({likes:(p?.likes||0)+1}).eq('id',postId);
  if(p?.user_id && p.user_id !== currentUser.id) {
    await sb.from('notifications').insert({
      user_id:p.user_id, type:'like',
      message:'내 글에 공감이 달렸어요.', post_id:postId,
      is_read:false, created_at:new Date().toISOString()
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
