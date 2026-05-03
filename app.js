
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
    try { await loadUserRole(); } catch(e) {}
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
  let _mdTarget = null;
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('mousedown', e => { _mdTarget = e.target; });
    el.addEventListener('click', e => {
      // 드래그(mousedown과 click target이 다름) 시 닫지 않음
      if(e.target === el && _mdTarget === el) el.style.display='none';
    });
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
  // 모바일 뒤로가기 → 열린 모달 닫기
  window.addEventListener('popstate', () => {
    const open = [...document.querySelectorAll('.modal-overlay')].find(m => m.style.display !== 'none');
    if(open) {
      open.style.display = 'none';
      history.pushState(null, '', location.href); // 스택 유지
    }
  });
  history.pushState(null, '', location.href);
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
    sb.from('quotes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}).limit(5000),
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

let booksSearchQ = '';
function filterBooksSearch(q) {
  booksSearchQ = q.trim().toLowerCase();
  buildBooks();
}
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
  if (curFilter === '다시읽기') list = list.filter(b=>b.reread);
  else if (curFilter !== '전체') list = list.filter(b=>b.status===curFilter);
  if (curCatFilter) list = list.filter(b=>(b.category||'')=== curCatFilter);
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
      <div class="gi-stars">${Array.from({length:5},(_,i)=>(parseFloat(b.rating)||0)>=i+1?'★':(parseFloat(b.rating)||0)>=i+0.5?'⯨':'☆').join('')}</div>
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
let quoteHlFilter = null;
let selectedQuoteIds = new Set();

function buildQuotes() {
  const filterEl = document.getElementById('q-filter');
  filterEl.innerHTML = '';
  // 검색 + 선택 삭제 툴바
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.6rem;align-items:center;';
  // 형광펜 필터 상태
  toolbar.innerHTML = `
    <!-- 형광펜 필터 버튼 -->
    <button id="hl-btn-yellow" onclick="toggleHlFilter('#f5e27a',this)" title="노란 형광펜"
      style="width:20px;height:20px;border-radius:50%;background:#f5e27a;border:2px solid ${quoteHlFilter==='#f5e27a'?'#8a6a00':'#e0c840'};cursor:pointer;flex-shrink:0;transition:all .15s;box-shadow:${quoteHlFilter==='#f5e27a'?'0 0 0 2px #f5e27a':'none'};"></button>
    <button id="hl-btn-mint" onclick="toggleHlFilter('#b8e8d4',this)" title="민트 형광펜"
      style="width:20px;height:20px;border-radius:50%;background:#b8e8d4;border:2px solid ${quoteHlFilter==='#b8e8d4'?'#2a7a5a':'#7acaaa'};cursor:pointer;flex-shrink:0;transition:all .15s;box-shadow:${quoteHlFilter==='#b8e8d4'?'0 0 0 2px #b8e8d4':'none'};"></button>
    <button id="hl-btn-peach" onclick="toggleHlFilter('#f5c4a0',this)" title="살구 형광펜"
      style="width:20px;height:20px;border-radius:50%;background:#f5c4a0;border:2px solid ${quoteHlFilter==='#f5c4a0'?'#8a4a1a':'#d8906a'};cursor:pointer;flex-shrink:0;transition:all .15s;box-shadow:${quoteHlFilter==='#f5c4a0'?'0 0 0 2px #f5c4a0':'none'};"></button>
    <div style="position:relative;flex:1;min-width:80px;">
      <span style="position:absolute;left:.65rem;top:50%;transform:translateY(-50%);font-size:.68rem;color:var(--tx3);">🔍</span>
      <input id="quote-search-input" type="text" class="search-input" placeholder="검색..."
        style="padding-left:1.7rem;font-size:.73rem;width:100%;border-radius:20px;background:#f5f0e8;border-color:transparent;" value="${quoteSearchQ}">
    </div>
    <button id="quote-select-btn" class="cat-btn" onclick="toggleQuoteSelect()" style="font-size:.7rem;border-radius:12px;">${quoteSelectMode?'✕':'☑ 선택'}</button>
    <button id="quote-delete-btn" class="cat-btn" onclick="bulkDeleteQuotes()" style="display:${quoteSelectMode?'':'none'};color:#c0392b;border-color:#e8b8a8;font-size:.7rem;border-radius:12px;">🗑</button>
    <button class="cat-btn" onclick="deleteAllQuotes()" style="font-size:.7rem;border-radius:12px;color:#c0392b;border-color:#e8b8a8;" title="전체 삭제">🗑 전체</button>`;
  filterEl.appendChild(toolbar);
  const inp = document.getElementById('quote-search-input');
  if(inp) inp.oninput = (e) => { quoteSearchQ = e.target.value; renderQuotes(); };
  renderQuotes();
}

function toggleHlFilter(color, btn) {
  quoteHlFilter = quoteHlFilter === color ? null : color;
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
  const richText = rawText
    .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
    .replace(/<\/div>\s*<div>/gi, '<br>')
    .replace(/<div>/gi, '').replace(/<\/div>/gi, '<br>')
    .replace(/<p>/gi, '').replace(/<\/p>/gi, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/(<br>){3,}/gi, '<br><br>');
  const plainText = rawText.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
  const lines = richText.split(/<br>/i);

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
  const lineCount = lines.length;
  const fontSize = pLen > 400 || lineCount > 20 ? 9
                 : pLen > 250 || lineCount > 14 ? 10
                 : pLen > 150 || lineCount > 9  ? 11
                 : pLen > 80  || lineCount > 5  ? 12 : 13;
  // 줄 간격도 조정
  const lineH = fontSize <= 10 ? 1.75 : 1.9;
  const chunks = [lines.join('<br>')];
  const total = 1;

  // 카드 생성 및 캡처
  const dataUrls = [];
  for(let i = 0; i < total; i++) {
    const card = document.createElement('div');
    card.style.cssText = `position:fixed;left:-9999px;top:0;width:320px;min-width:320px;max-width:320px;background:${bg};padding:24px 26px 18px;font-family:'Nanum Myeongjo','Georgia',serif;box-sizing:border-box;border-radius:12px;`;
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
    </style>
  </defs>
  <g id="_레이어_1" data-name="레이어_1" class="st7">
    <path class="st3" d="M420.41,177.82c-2.3.85-3.6,1.18-5.32,1.4l-7.68.98c-1.84.24-7.75,1.86-8.88,2.63-1.26.86-3.45-.24-5.11.62l-3.48,1.82c-1.58.83-3.66,1.83-3.72,3.73l-.61,18.07c-.1,2.91-4.82,15.04-3.65,14.51-5.32,2.44-1.77,4.88-4.51,8.96-2.6,3.87-4.63,7.69-4.75,7.81l-11.24,11.37-3.7,1.77c-1.18.57-3.45,1.02-4.37.09l-7.4-7.52c-2.97-3.01-3.2-12.99-1.94-21.11-.07.47,2.9-6.9,5.67-12.87l1.78-3.84,4.5-4.86c1.01-1.09.93-3.18.16-4.86l-3.18,1.6c-1.7.85-2.99,1.15-4.59,1.51l-4.15.92c-1.61.36-2.87.7-4.51,1.48l-3.54,1.69c-1.61.77-2.84.56-4.52,1.37l-3.7,1.8c-4.36,2.12-7.23,2.73-9.28,3.76l-3.67,1.84-3.71,1.85-3.71,1.85-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.86-3.71,1.85-3.69,1.82c-1.76.87-3.11,1.21-4.45,2.96-1.9,2.49-8.37,1.9-9.2-1.16-1.79-6.67.05-13.13,3.11-19.48l1.91-3.96,1.87-3.72,1.92-3.96c1.62-3.35,1.97-5.62,3.07-7.88l1.73-3.57c1.15-2.38,2.81-3.43,3.84-5.6l1.82-3.8,1.88-3.7,1.85-3.71,1.86-3.71,1.85-3.71,1.83-3.71c1.53-3.1,3.27-4.66,4.79-7.76l1.9-3.89,6.39-6.86c1.55-1.67,1.87-6.76,3.84-6.18.77.23,2.09,1.79,2.73,2.44,2.11,2.13,1.08,4.35-.28,6.14l-3.39,4.48c-1.29,1.7-3.77,5.63-4.88,7.96l-1.83,3.85c-.74,1.56-2.15,2.31-3.17,4.35l-1.8,3.6-1.84,3.7-1.85,3.71-1.85,3.71-1.86,3.71-1.86,3.71-1.87,3.71-1.93,4.02c-2.03,4.24-1.96,6.73-3.12,7.57-1.81,1.31-2.12,2.7-2.98,4.44l-1.82,3.69-1.85,3.71-1.9,3.78c-.64,1.28-1.79,2.44-1.28,4.65.97,4.15,6.13-1.4,12.27-4.53l3.78-1.93,4.15-2c.89-.43,1.82-2.98,4.12-2.91,1.72.05,2.63-.53,4.28-1.36l3.68-1.85,3.7-1.85,3.79-1.98,4.04-.92,3.79-1.98,3.71-1.85,3.68-1.84c2.08-1.04,4.65-1.62,8.08-2.97,3.65-1.44-2.53-11.19.6-14.53l2.61-2.78,1.87-4.08c4.23-9.23,15.02-2.29,18.52-5.47l6.81-6.2,7.78-.99c.61-.08,5.64-1.38,8.54-2.56,9.02-3.67,3.11,20.14,17.14,12.89l3.75-1.94,7.71-1c1.73-.22,7.33-3.25,19.45-3.15l3.45-1.89,15.15-.04,3.48-1.83,23.69-.6c1.01-.03,1.29-1.11,3.2-.14s3.38,1.43,2.98,4.46c-.24,1.83-2.12,2-2.94,2.38l-4.04,1.89-.99,4.45c-.52,2.32-7.01-3.08-8.78-3.09l-22.43-.06-3.51,1.78-9.47.15-4.64,1.73ZM369.04,182.84l4-3.67-1.61-3.09c-1.02-1.95-2.02-3.37-3.09-3.65-2.84-.72-8.72,2.31-9.54,4.25-.68,1.6-.75,4.39.03,6.18,1.15,2.66,3.66,1.66,5.84,1.11l4.38-1.12ZM349.33,183.36c.18-2.79-1.18-3.95-3.66-3.89-6.26.16-9.13,8.59-6.06,9.57.95.3,9.42-1.11,9.71-5.68ZM358.13,241.92l9.28-8.88c0-1.47.28-2.72,1.92-3.77-.09-1.39.2-2.7,1.86-3.69-.1-1.43.29-2.73,1.74-3.67.23-2,.99-3.41,2.56-4.97-1.03-1.91-.4-3.42,1.26-4.3-.11-1.48.26-2.82,1.91-3.77l.15-17.59c-2.02-.82-3.46-.12-4.26.88l-12.18,12.13c.03,3.83-4.39,5.03-5.85,8.86l-1.88,3.65-1.8,3.77-2.15,3.71c.73,1.74.21,3.23-1.35,4.14-.4,2.25-.38,4.3,0,6.4,1.59,1.26,1.68,2.36,1.74,4.24.1,3.2,4.52,5.28,7.04,2.87Z"/>
    <path class="st2" d="M20.86,255.79c-5.02.17-7.57,20.21-15.71,18.31-1.34-.31-4.39-3.39-4.65-4.64-.2-.92.83-2.07,1.12-3.3l.98-4.08,1.98-3.74c1.08-2.04,1.37-4.34,3.07-7.91l1.99-4.17c1.65-3.45,2-5.75,3.08-7.91l1.85-3.69,1.85-3.71,2-3.89c1.6-3.11,3.29-4.76,4.76-7.72l1.83-3.71,1.85-3.71,1.86-3.71,1.85-3.71,1.86-3.7,1.88-3.91c.75-1.56,2.11-2.28,3.17-4.39l1.8-3.55,1.83-3.68,1.79-3.63c.93-1.88,3.04-2.87,3.33-4.33l.9-4.46,4.58-4.87,1.82-3.82,1.86-3.71,1.97-3.85c.36-.71.49-2.55,1.83-3.39,3.31-2.07,3.58-7.4,4.3-8.86l1.73-3.5c1.8-3.64,5.72-7.72,8.05-12.41l1.85-3.72,1.79-3.73,5.62-5.79c.79-.82,3.89-.89,4.34-.15,1.24,2.01-.49,3.87-1.05,5.04l-1.98,4.16-3.13,4.07c-1.18,1.53-1,3.3-3.16,4.49-.91.5-1.7,2.55-.5,3.92.58.67,3.4.71,4.32-.16l4.89-4.63,6.17-.91,3.1-2.73c4.41-3.89,21.98-3.26,24.74.07,1.12,1.35.88,4.66.13,6.08l-1.97,3.75-1.68,3.81-26.86,27.07-3.54,1.85-5.01,4.36c-.96.83-1.48,4-.72,4.03l19.34.87c2.35.11,5.82,5.88,3.76,13.93l-2.72,2.8c-1.06,1.09-2.14,2.94-2.96,4.6l-1.74,3.52-7.69,7.5c-1.06,1.04-3.1,1-4.52,2.88-3.9,5.18-7.69,5.6-8.36,6.51-.89,1.21-2.04,2.8-3.67,3.58l-3.78,1.81c-5.05,2.42-12.62,10.23-20.91,14.21l-3.77,1.81c-2.07,1-3.32,2.96-4.7,4.55-1.49,1.73-3.17,1.51-4.73,2.95l-4.69,4.31c-2.05,1.88-5.84.54-8.61.63ZM42.76,236.96c1.74-3.72,5.26-3.34,6.29-4.86,1.1-1.63,2.51-2.52,4.58-2.52.94-1.55,2.26-1.92,3.72-1.83l4.6-5.14c3.55.11,5.47-4.56,11.19-7.46,2.1-.02,3.29-.97,4.67-2.46l4.56-4.92c3.11,0,5.36-2.26,5.36-5.36l6.96-6.48c-.02-1.48.41-2.74,1.7-3.75,1.25-3.05-.05-5.76-2.67-6.8-2.38,3.23-7.2.77-9.28,2.29-3.31,2.42-6.9.15-8.58,2.97l-10.22.02c-3.37-3.5-5.46-5.39-2.78-7.81l4.96-4.47c.82-.74,2.43-.79,3.51-1.89l18.49-18.75c1.54-.12,2.71-.64,3.75-1.67l18.62-18.51c1.38-1.37,1.48-3.24.47-4.48-.8-.98-2.68-2.66-4.81-1.61l-3.52,1.74c-1.61.79-3.11.17-4.38,1.65-1.39.16-2.41,1.37-3.85,1.69l-4.17.92c-1.48.33-2.38,1.54-3.94,1.67-.96,1.44-2.14,1.93-3.92,1.7-1.66,3.9-6.17,3.26-7.96,7.13-3.39-.11-5.48,2.17-5.54,5.35l-6.69,6.65c-.53.53-.31,2.68-1.93,3.6s-2.54,2.52-2.45,4.5c-1.63.92-1.95,2.3-1.8,3.64-1.77,1.2-1.29,2.74-2.26,3.78l-2.64,2.83c-.97,1.04-.49,2.57-2.26,3.78.13,1.33-.12,2.68-1.84,3.67.26,3.67-4.18,4.5-4.07,8.29-1.56.93-1.92,2.25-1.8,3.67-1.67,1-1.95,2.3-1.86,3.71-1.66,1.01-1.95,2.3-1.86,3.71-1.66,1.01-1.95,2.29-1.86,3.72-1.61,1.01-2.01,2.19-1.79,3.94-1.95.95-3.08,2.08-3.63,4l-1.8,3.95c-1.03.99-2.06,3.15-1.67,4.16.25.65,1.5,1.59,1.54,2.99l.25,8.78c1.68,1.01,1.94,2.34,1.9,3.83,5.32,2.07,6.24-3.38,10.73-3.57Z"/>
    <path class="st4" d="M180.15,229.78l-3.43-1.78c-.85-.44-5.16-1.5-8.79-2.12-1.41-2.25-3.65-1.67-4.91-.42l-6.67,6.62c.06,1.49-.25,2.76-1.89,3.79.09,1.41-.24,2.71-1.81,3.69l-.45,4.57c-1.57.98-1.9,2.28-1.8,3.69-1.67,1-1.93,2.35-1.89,3.65-1.67,1.25-1.02,2.93-1.71,4.33l-1.75,3.55c-.91,1.85-.69,4.32-2.48,5.26-.59.31-2.26-.72-2.83-1.9l-.12-10.15c1.58-.95,1.94-2.3,1.82-3.7,1.68-1,1.93-2.35,1.89-3.65,1.66-1.29.88-2.83,1.71-4.44l1.76-3.41c.83-1.61.04-3.15,1.71-4.44-.05-1.3.21-2.65,1.89-3.65-.09-1.4.19-2.7,1.85-3.71-.09-1.41.19-2.71,1.85-3.71-.1-1.42.23-2.71,1.8-3.7l.45-4.57c1.57-.98,1.9-2.28,1.8-3.7,1.65-1.01,1.95-2.27,1.86-3.74,1.7-.92,2.15-2.42,1.42-4.14l2.16-3.71,1.76-3.81,2.16-3.71c-.73-1.72-.28-3.22,1.42-4.15-.06-1.45.11-2.7,1.95-3.79.26-3.19,1.37-7.53,2.01-8.81l1.72-3.45c.82-1.65.08-3.18,1.72-4.42l.39-6.35c1.59-1.02,1.91-2.3,1.95-3.74,1.3-1.88,2.65-2.69,5.32-1.97l-.07,9.07-1.79,3.47-.29,6.96c-1.54,1.19-.89,2.84-1.65,4.35l-1.75,3.45c-.82,1.63-.04,3.15-1.7,4.44.05,1.3-.21,2.65-1.89,3.65.1,1.4-.19,2.7-1.85,3.7.1,1.42-.24,2.71-1.79,3.7l-.48,4.53c-1.52,1.18-1.9,2.35-1.77,4.41.19,1.55,1.82,2.03,2.72,1.5l2.87-1.7c2.09-.41,3.2-1.59,4.11-3.58,3.85.52,4.68-4.09,8.55-4.03.93-1.55,2.24-1.92,3.67-1.81,1.01-1.62,2.18-2.02,3.95-1.79.92-1.95,2.07-3.1,4.01-3.6l3.72-1.83,3.72-2.13c1.73.73,3.23.21,4.13-1.35,2.29-.37,4.24-.42,6.62,0,.69,1.56.72,3.75-.18,4.7l-5.57,5.9c-1.38.05-2.67.32-3.73,1.96-1.39-.11-2.72.24-3.65,1.81-3.89-.06-4.7,4.55-8.46,3.97-1.4,2.86-3.09,3.28-5.32,4.34-3.07,1.45-5.09,6.96-9.5,6.97-1.23,1.72-2.19,2.64-3.92,4.01.28,1.41,1.74,3.13,3.58,3.14l36.55.17c1.89,1.51,2.65,2.77,2.07,5.46l-5.45.02-3.4,1.81h-29.9Z"/>
    <path class="st3" d="M107.86,253.01c-1.86,1.21-3.46,1.37-5.73.5-.83,1-2.26,2.18-3.46,2.19l-16.87.04-3.51-1.76c-.81-.41-7.46-1.48-7.45-5.66l.03-14.59c1.96.03,3.04-.32,4.19-1.88,1.35.05,2.67-.22,3.68-1.88,1.4.09,2.7-.19,3.71-1.86,1.41.09,2.7-.19,3.71-1.86,1.41.09,2.71-.19,3.71-1.86,1.42.11,2.73-.25,3.67-1.8,2.04-.06,3.43-.85,4.7-2.55,1.03-1.39,2.26-2.81,4.14-3.23,1.75-.39,3.17,0,4.18,1.67,1.41-.1,2.77.23,3.71,1.9l10.26.26c1.7,3.12,3.71,4.03,7.23,3.68,1.06,1.81,2.37,1.99,3.71,1.95,1.14,1.59,2.22,1.94,4.17,1.84l.05,10.96c0,1.41-1.13,2.61-2.38,3.04-.95,2-2.54,2.76-4.51,2.7-.96,1.64-2.33,1.93-3.62,1.87-1.24,1.68-2.9,1.01-4.35,1.72l-3.59,1.75c-1.45.7-3.1-.04-4.37,1.79-1.3-.11-3.12-.24-5,1.06ZM98.26,246.96l8.89-1c7.61-.86,20.54-6.04,21.2-10.58.9-6.23-8.56-4.46-11.92-6.88-5.11-3.67-13.66-3.52-20.76,0l-3.77,1.87-3.7,1.86-3.73,1.81c-2.54,1.23-4.4,3.21-5.69,5.68l-1.87,3.57c-.77,1.46-.2,2.58,1.33,3.32l3.61,1.74c2.66,1.28,6.17-.61,8.76.71,2.93,1.49,4.8-1.78,7.66-2.1Z"/>
    <path class="st1" d="M143.77,218.9c-1.21,2.09-3.74,2.02-4.9.06-1.91-.12-3.44-.87-4.45-2.75-1.89-.78-2.76-2.39-2.07-4.74,1.45-1.07,2.6-2.04,3.77-3.7,2.34-.36,4.36-.35,6.5.02,1.18,1.6,2.38,1.78,4.21,1.62s2.75,2.14,1.66,3.54c.96,3.76-1.82,5.91-4.72,5.96Z"/>
  </g>
  <g id="_레이어_2" data-name="레이어_2" class="st7">
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
  <g id="_레이어_3" data-name="레이어_3">
    <path d="M95.7,357.41l-7.21,3.26-6.12,3.09c-7.31,3.7-13.67,2.99-15.77-2.06-2.71-6.52.73-16.94,5.22-26.16l3.2-6.57,3.2-6.57c2.84-5.83,3.24-9.59,5.07-13.08l3.29-6.24,1.5-6.69,3.29-6.28,3.06-6.15,3.09-6.15,3.02-6.33,7.63-8.11,1.45-7.44c.42-2.15,5.24-3.58,5.19-7.27-.08-5.8,4.21-6.94,7.38-13.95l2.98-6.59,4.28-4.33c2.43-2.46,8.8-18.92,17.33-23.05l6.22-3.02c4.94-2.39,7.64-5.25,12.87-7.93l6.46-3.31,6.16-3.07,6.16-3.09,6.35-3.04,8.04-7.39c2.37-2.18,7.59-1.33,10.22.01l6.17,3.15c6.59,3.36,20.78,2.22,28.8,8.1l7.42,5.43c1.78,1.3,5.72,1.25,7.25,5.19,3.46,8.95-1.84,18.6-9.57,22.42l-6.25,3.09-6.18,3.01c-17.85,8.7-27.4,7.55-26.7,7.22l-5.99,2.8-7.14,2.37c-9.88,3.28-22.08,3.57-31.81.03l-6.79-2.47c-4.51-1.64-7.6-6.41-9.91-7.85-4.28-2.64-6.48.72-7.03,3.85-1.14,6.52-10.65,15.34-13.08,20.32l-3.24,6.66-3.08,6.14-3.07,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.07,6.15-3.32,6.2-1.48,7.16c-.5,2.43-5.22,3.72-5.18,7.2.06,6.28-4.86,6.67-6.84,15.3-1.02,4.45,2.32,7.56,5.81,5.06,2.9-2.08,5.19-4.36,9.17-6.29l5.87-2.86,6.18-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.15-3.08,6.14-3.07,6.11-3.06c14.85-7.43,34.62-9.79,35.01-17.82.32-6.66-1.86-14.36,1.04-20.16l3.03-6.06,3.1-6.36c3.17-6.51,11.71-9.31,16.27-6.23,5.57,3.76,11.2,3.32,15.96-1.45,3.85-3.86,2.15-6.78,10.73-10.66,3.65-1.65,8.22.64,11.55-1.07l5.84-3c4.94-2.54,9.84-3.23,9.69-9.28,0,.09,7.78-19.01,8.22-19.32,5.57-3.94,2.4-8.64,5.95-15.72l3.08-6.14,3.07-6.14,3.08-6.15,3.07-6.17,3.28-6.32,1.53-9.69,3.28-6.32,3.07-6.16,3.07-6.15,3.06-6.11c4.11-8.22,6.82-20.22,10.42-26.99l3.29-6.2,1.59-6.9c1.56-6.78,4.35-13.49,4.53-14.74l1.43-9.94c.55-3.8,4.62-4.16,6.68-3.75,2.39.47,4.23,2.25,4.74,4.69-.46-2.2-4.02,28.52-8.03,36.12l-3.31,6.27-1.49,6.69-3.3,6.27-3.04,6.11c-4.21,8.46-8.25,20.89-7.31,21.88,2.09,2.19,6.25-1.18,7.92-1.97l6.85-3.25,6.5-5.02c3.52-2.72,5.78-4.69,9.57-6.48l6.26-2.96,6.14-3.11,6.14-3.07,6.15-3.08,6.17-3.08,6.29-3.12c3.1-1.54,10.04-1.88,12.85-.12,2.12,1.33.73,4.97-.77,6.37l-14.46,13.53-6.24,3.14-7.08,1.56-11.16,10.77-7.35,1.54-14.3,13.75-6.25,2.91c-2.7,1.26-.7,4.47.09,4.25,4.7-1.51,6.9,2.16,8.33,2.18l53.99.8c2.94.04,7.43,4.24,9.2,9.12l-15.36.08-5.7,3.02-48.45-.7c2.69.04-9.55-3.96-18.22-8.16-6.68-3.24-15,11.93-14.37,11.3l-4.33,4.34-3.06,6.71-3.28,6.26-1.5,6.69-3.29,6.23c-1.43,2.72-.99,4.84-2.25,7.47l-2.82,5.88c-7.22,15.05.47,33.47,4.07,30.65,3.71-2.9,7.54-2.49,12.36-4.93l6.04-3.05c3.15-1.59,8.18.71,11.36-.97l5.75-3.04,12.92-.1,5.52-2.95,12.94-.13,5.58-2.96,25.12-.1,5.75-2.98,39.24.61c2.57.04,3.44,3.25,3.74,4.4,1.38,5.36-9.23,4.13-8.74,10.59.32,4.24-3.08,8.99-6.54,6.2l-7.06-5.69-38.94-.71-5.87,2.96-12.87.08-5.79,3.07c-3.01,1.59-8.34-.79-11.29.98-2.18,1.31-10.92,3.78-14.65,4.37l-9.82,1.57c-3.98.64-11.84,4.14-14.8,4.6l-10.1,1.57-1.85,7.49c-.89,3.6-3.13,7.54,0,11.4,2.48,3.05-5.66,36.74-13.53,52.25l-3.2,6.3c-2.81,5.53-8,12.92-7.79,12.71l-12.65,12.86-6.14,2.85-6.1,3.27c-1.82.98-5.61,1.64-7.26,0l-12.39-12.37-1.61-7.26c-1.16-5.24-4.82-14.54-1.26-21.48,5.78-11.26,8.95-28.38,13.49-32.79l16.15-15.64c-1.43-3.15-7.38-2.99-13.4.19l-6.21,3.29-6.8,1.52c-3.66.82-21.56,7.72-26.99,10.57l-6.24,3.28-6.69,1.5-6.28,3.29-6.15,3.06-6.11,3.06c-3.58,1.79-7.44,2.36-13.34,5.23l-8.76,4.27c-2.06,1-3.62,3.31-7.1,5.07l-5.87,2.98-6.13,3.05-6.21,3.08-6.95,3.81ZM210.41,216.32c4.14-1.73,7.94-1.45,11.44-1.31,1.58-3.11,4.19-3.68,6.99-2.59l8.78-4.69c1.47-.78,2.94-5.06,7.14-4.46,2.2-.68,2.86-3.04,2.26-4.69-3.57-9.75-14.21-6.45-19.05-10.85-2.24.17-4.56-.37-6.11-3.15h-25.98c-1.55,2.77-3.84,3.33-6.15,3.13-1.67,2.78-3.82,3.24-6.16,3.09-1.67,2.76-3.82,3.23-6.15,3.08-1.69,2.73-3.8,3.25-6.3,3.09l-9.56,9.6-.07,11.48c3-.38,5.05.29,6.71,3h25.96c1.72-2.78,3.98-3.41,7.06-2.96,3.02.63,6.1.84,9.2-1.78ZM243.27,278.86l6.61-6.04c.74-3.77.82-6.89.16-11.27l-14.25.21-5.99,6.59c-3.53,3.89-.12,10.44,5.25,11.33,2.87.47,6.47.77,8.21-.82ZM213.41,284.66c3.29-1.38,3.17-4.99,2.79-6.12-.98-2.89-6.4-7.68-8.94-8.08-7.71-1.24-6.22,6.82-10.56,11.48-4.52,4.85,8.93,5.99,16.71,2.73ZM247.04,355.8c-.14-2.31.32-4.47,3.08-6.14-.15-2.34.32-4.49,3.08-6.15-.15-2.34.32-4.49,3.07-6.15-.16-2.35.39-4.5,2.98-6.13l.77-7.56c4.92-3.65.44-10.38,5.38-13.98v-13.72c-2.62-1.75-3.25-3.68-2.74-6.75-3.1.34-4.06,1.85-5.3,3.57l-23.22,23.05c-1.71,1.69-2.73,3.47-2.44,6.58-3.15,1.47-5.12,3.39-5.92,6.61l-3.03,6.16-3.55,6.18c1.22,2.83.41,5.4-2.38,6.87v19.87c2.65,1.71,3.16,3.83,3.42,6.16,2.06,4.33,6.7,4.63,9.51,1.84l14.11-14.05c-.04-2.44.45-4.54,3.17-6.26Z"/>
    <path d="M53.73,256.94c-1.56,2.81-9.36,7.35-13.56,5.63-3.94-1.61-5.63-2.5-5.4-7.51.13-2.89,1.99-4.67,2.57-7.28l1.53-6.88c.53-2.36,3.01-8.33,5.27-13.08l3.3-6.92c2.73-5.73,3.31-9.54,5.1-13.12l3.06-6.11,3.07-6.14,3.08-6.15,3.07-6.16,3.32-6.46c2.64-5.15,5.46-7.88,7.89-12.8l3.03-6.14,3.07-6.16,3.08-6.15,3.07-6.14,3.08-6.13,3.16-6.52c1.19-2.47,3.45-3.77,5.21-7.24l2.89-5.68c1.59-3.13,4.92-4.84,5.44-7.19l1.58-7.24,3.24-6.33,7.37-8.09,3.02-6.32,3.31-6.42c.57-1.11.78-4.19,3.01-5.58,5.51-3.44,5.95-12.35,7.14-14.74l2.86-5.74c1.64-3.29,3.98-4.79,5.12-7.14l3.2-6.6c2.6-5.36,5.69-7.86,8.17-13.13l2.9-6.16,10.42-11.27c2.45-2.65,6.73-2.29,7.27.34,1.87,9.22-17.26,24.79-15.69,31.86.67,3.01,5.36,3.66,7.41.5,1.39-2.14,3.29-5.88,6.23-6.25l13.47-1.68,7.83-7.51c10.28-1.6,21.67-1.25,32.07-.2,1.55.16,3.94,3.73,4.84,4.55,3.01,2.77.84,6.38-.9,10.13l-3.85,8.3-60,60.15c-1.49,1.5-3.39,2.22-3.44,5.37l21.25-.15c2.18-.01,3.83-2.05,4.87-2.53,1.6-.74,10.04,2.03,13.56,9.02l2.89,5.73c1.63,3.24-.77,5.09-1.96,7.51l-3.03,6.16c-1.39,2.83-3.85,4.61-5.14,7.36l-2.81,5.99-25.06,24.78c-1.34,1.32-5.76.99-7.36,4.88-.78,1.89-4.69,1.74-5.87,2.86l-4.67,4.43c-1.4,1.33-10.86,5.33-13.56,7.8l-8.38,7.67c-1.01.92-4.89.69-5.9,3.04-.29.67-10.05,8.13-16.78,11.28l-6.07,2.85-11.16,10.13-9.69,6.51-15.81,1.83c-2.2.25-3.26,9.83-6.56,15.77l-3.67,6.62ZM89.22,208.66c2.41.38,4.91-.73,7.29-2.49l7.17-5.31c2.53-1.87,4.84-3.82,7.46-5.14l5.98-3.01c3.67-1.85,6.34-3.47,9.54-6.44l7.49-6.92c3.2-2.96,5.88-4.65,9.53-6.43l5.93-2.9c3.26-1.6,11.2-7.7,15.14-12.58,2.86-3.53,11.25-4.94,16.92-14.23s13.98-16.17,13-21.59c-.4-2.24-2.23-4.32-4.7-4.72-1.72-.28-4.7,2.41-7.08,2.5l-12.73.47-5.81,2.79c-9.56,4.59-22.03,5.86-25.99-1.68-1.62-3.09-2.27-5.73.39-8.34l29.59-29.06,5.96-2.96,44.63-44.85c1.39-1.4,1.36-6.37-.16-7.39-3.05-2.05-12.29-.35-17.72,2.25l-5.9,2.83c-2.66,1.27-4.75.83-7.48,2.25l-6.4,3.31c-1.09.57-4.07.75-5.57,3.01-3.21,4.8-11.74,5.96-13.52,7.76l-21.66,21.85c.39-.39-5.27,7.59-7.88,12.92l-3.26,6.66c-1.25,2.55-3.54,3.83-5.23,7.2l-2.98,5.96-3.03,6.11-2.98,5.89c-1.77,3.5-4.02,4.69-5.26,7.28l-3.13,6.48-3.08,6.13-3.07,6.15-3.18,6.23c-2.73,5.33-5.6,8.13-8.03,13.04l-3.03,6.13-3.03,6.12-3.44,6.43c-2.98,5.57,3.3,4.84,4.01,8.96-.11-.63-4.74,17.72,5.31,19.32Z"/>
    <path class="st6" d="M278.35,167.56c-3.02,3.39-5.39,4.54-8.55,5.11-1.93,3.04-6.09,3.23-8.09-.2-4.96-.09-9.12-3.89-8.17-9.64-.57-3.86.74-6.48,3.84-8.78,4.66-.72,9.06-.68,13.7-.08,1.74,2.51,3.79,3.06,6.2,3.31,4.17,2.1,5.17,7.09,1.06,10.28Z"/>
  </g>
</svg>
        ${coverB64 ? `<img src="${coverB64}" style="width:20px;height:28px;object-fit:cover;border-radius:2px;box-shadow:1px 1px 4px rgba(0,0,0,.15);">` : ''}
      </div>` : pageLabel}
      <div style="font-size:${fontSize}px;line-height:${lineH};color:#2e1f0e;margin-bottom:18px;">${chunks[i]}</div>
      ${isLast ? `<div style="border-top:1px solid ${acc}33;padding-top:10px;display:flex;align-items:center;gap:8px;">
        ${coverB64 ? `<img src="${coverB64}" style="width:24px;height:34px;object-fit:cover;border-radius:2px;flex-shrink:0;">` : ''}
        <div>
          <div style="font-size:10px;font-weight:700;color:#2e1f0e;font-family:sans-serif;">${book?.title||''}</div>
          ${book?.author ? `<div style="font-size:9px;color:#7a6a5a;font-family:sans-serif;margin-top:1px;">${book.author}</div>` : ''}
        </div>
      </div>` : `<div style="text-align:right;font-size:9px;color:${acc};opacity:.4;font-family:sans-serif;">계속 →</div>`}
    `;
    document.body.appendChild(card);
    try {
      const canvas = await html2canvas(card, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: bg,
        width: 320,
        windowWidth: 390,
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
      <div style="background:linear-gradient(135deg,var(--acc2),var(--acc));padding:.7rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
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
function renderQuotes() {
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

  list.forEach(qt => {
    const book = allBooks.find(b=>b.id===qt.book_id);
    const color = randomQuoteColor(qt.book_id);
    const isSelected = selectedQuoteIds.has(qt.id);

    // 텍스트 처리 - 줄바꿈 + HTML 서식 유지
    let text = qt.text || '';
    // 서식 태그 유무를 원본에서 먼저 확인
    const hasHtml = /<(b|strong|i|em|u|span|small|big|sub|sup|mark)/i.test(text);
    if (hasHtml) {
      // 서식 있는 경우: DOM 파싱으로 정확하게 줄바꿈 추출
      const tmp = document.createElement('div');
      tmp.innerHTML = text;
      // block 요소(div, p)들 사이에 줄바꿈 마커 삽입
      tmp.querySelectorAll('div, p').forEach(el => {
        // 빈 div(줄바꿈 전용)는 <br>로 교체
        if (!el.textContent.trim() || el.innerHTML === '<br>' || el.innerHTML === '<br/>') {
          el.replaceWith(document.createElement('br'));
        } else {
          // 내용 있는 블록 앞에 줄바꿈 삽입
          el.insertAdjacentHTML('afterend', '');
          el.outerHTML = el.innerHTML + '<br>';
        }
      });
      text = tmp.innerHTML
        .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
        .replace(/^(<br\s*\/?>)+/i, '')
        .replace(/(<br\s*\/?>)+$/i, '');
    } else {
      // 순수 텍스트: 줄바꿈 태그 → \n → <br>
      text = text
        .replace(/<div><br\s*\/?><\/div>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div>/gi, '\n')
        .replace(/<div>/gi, '').replace(/<\/div>/gi, '\n')
        .replace(/<p>/gi, '').replace(/<\/p>/gi, '\n')
        .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '').trim();
      text = text.replace(/&(?!amp;|lt;|gt;|nbsp;)/g,'&amp;').replace(/\n/g,'<br>');
    }
    if(q) {
      const re = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
      text = hasHtml
        ? text.replace(/>([^<]*)</g, (_,t) => '>'+t.replace(re,'<mark style="background:#f5d87a;border-radius:2px;padding:0 1px;">$1</mark>')+'<')
        : text.replace(re,'<mark style="background:#f5d87a;border-radius:2px;padding:0 1px;">$1</mark>');
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
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding-top:.35rem;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:.35rem;min-width:0;flex:1;">
            ${book?.cover ? `<img src="${book.cover}" style="width:14px;height:20px;object-fit:cover;border-radius:2px;flex-shrink:0;box-shadow:1px 1px 3px rgba(0,0,0,.12);">` : ''}
            <div style="min-width:0;">
              <span class="qcard-book">${book?.title||''}</span>
              ${book?.author ? `<span class="qcard-author" style="margin-left:.3rem;">— ${book.author}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:.2rem;flex-shrink:0;">
            ${qt.page ? `<span class="qcard-chip">p.${qt.page}</span>` : ''}
            ${qt.tag ? `<span class="qcard-chip qcard-tag">${qt.tag}</span>` : ''}
          </div>
        </div>
      </div>`;

    el.style.position = 'relative';
    feed.appendChild(el);
  });
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
      <div style="background:linear-gradient(135deg,var(--acc2),var(--acc));padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-size:.82rem;font-weight:700;color:#fff;font-family:var(--fs);">문장 수정</div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:26px;height:26px;color:#fff;cursor:pointer;font-size:.8rem;">✕</button>
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
            // 이미 HTML이면 그대로, 순수 텍스트면 줄바꿈→<br>
            return /<[a-z]/i.test(t) ? t : t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
          })()
        }</div>
        <div style="display:flex;gap:.35rem;margin-bottom:.6rem;">
          <input id="eq-tag" type="text" class="form-input" placeholder="💬 코멘트" value="${qt.tag||''}" style="flex:1;font-size:.75rem;">
          <input id="eq-page" type="text" class="form-input" placeholder="p.42" value="${qt.page||''}" style="width:60px;font-size:.75rem;text-align:center;">
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
      <div style="background:linear-gradient(135deg,var(--acc2),var(--acc));padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-size:.82rem;font-weight:700;color:#fff;font-family:var(--fs);">문장 추가</div>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:rgba(255,255,255,.2);border:none;border-radius:50%;width:26px;height:26px;color:#fff;cursor:pointer;font-size:.8rem;">✕</button>
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
    await sb.from('quotes').insert({book_id:bookId, user_id:currentUser.id, text, tag:tag||null, page:page||null, created_at:new Date().toISOString()});
    await loadData();
    overlay.remove();
    // 책 상세 모달 새로고침
    openDetail(bookId);
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
  const cy = new Date().getFullYear();
  try {
    // 연도별 독서 시간 누적 (키를 string으로 통일 — Supabase jsonb 왕복 후 키가 string이 됨)
    const cyStr = String(cy);
    const yearData = book.reading_time_year || {};
    yearData[cyStr] = (yearData[cyStr] || yearData[cy] || 0) + mins;
    if(typeof yearData[cy] === 'number' && cy !== cyStr) delete yearData[cy];
    // 날짜별 독서 시간 로그 (트래커 정확도 핵심)
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
    // reading_time_log(날짜별 정확한 기록) 우선 사용
    if(b.reading_time_log && typeof b.reading_time_log === 'object') {
      Object.entries(b.reading_time_log).forEach(([date, mins]) => {
        if(date && mins > 0) dayMap[date] = (dayMap[date]||0) + mins;
      });
    } else if(b.last_read && b.reading_time) {
      // 구버전 폴백: last_read 날짜에 전체 시간 표시
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
  // 올해 기준 통계 - dayMap에서 올해 날짜만 합산 (정확한 날짜별 기록 기반)
  // 올해 독서 시간: reading_time_log(날짜별) > reading_time_year(연별) > last_read 폴백
  const thisYearMins = allBooks.reduce((sum, b) => {
    // 1순위: 날짜별 로그에서 올해 합산
    if(b.reading_time_log && typeof b.reading_time_log === 'object') {
      const logSum = Object.entries(b.reading_time_log)
        .filter(([d]) => d.startsWith(String(cy)))
        .reduce((s, [, m]) => s + (m||0), 0);
      if(logSum > 0) return sum + logSum;
    }
    // 2순위: 연도별 컬럼
    const cyStr2=String(cy); if(b.reading_time_year?.[cyStr2]||b.reading_time_year?.[cy]) return sum+(b.reading_time_year[cyStr2]||b.reading_time_year[cy]);
    // 3순위: 올해 마지막으로 읽은 책이면 전체 시간 반영
    if(b.last_read?.startsWith(String(cy)) && b.reading_time) return sum + b.reading_time;
    return sum;
  }, 0);
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
  const thisYearMins=allBooks.reduce((sum,b)=>{
    if(b.reading_time_log && typeof b.reading_time_log==='object'){
      const ls=Object.entries(b.reading_time_log).filter(([d])=>d.startsWith(String(cy))).reduce((s,[,m])=>s+(m||0),0);
      if(ls>0) return sum+ls;
    }
    const cyS=String(cy); if(b.reading_time_year?.[cyS]||b.reading_time_year?.[cy]) return sum+(b.reading_time_year[cyS]||b.reading_time_year[cy]);
    if(b.last_read?.startsWith(String(cy))&&b.reading_time) return sum+b.reading_time;
    return sum;
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
      data-placeholder="인상 깊은 문장이나 문단을 입력해주세요...">${text ? text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') : ''}</div>
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
  if(b.review) {
    const MAX_REVIEW = 120;
    const reviewText = b.review.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const reviewPlain = b.review;
    if(reviewPlain.length > MAX_REVIEW) {
      const shortReview = b.review.slice(0, MAX_REVIEW).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      html += `<div class="detail-sec">감상</div>
        <div class="detail-body">
          <span class="review-short">${shortReview}...</span>
          <span class="review-full" style="display:none;">${reviewText}</span>
          <span class="desc-toggle" onclick="this.previousElementSibling.style.display='inline';this.previousElementSibling.previousElementSibling.style.display='none';this.style.display='none';" style="cursor:pointer;color:var(--acc);font-size:.7rem;margin-left:.3rem;">더 보기</span>
        </div>`;
    } else {
      html += `<div class="detail-sec">감상</div><div class="detail-body">${reviewText}</div>`;
    }
  }
  if(quotes.length || true) { // 항상 문장 섹션 표시 (추가 버튼 위해)
    html+=`<div class="detail-divhr"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">
      <div class="detail-sec" style="margin:0;">인상 깊은 문장</div>
      <button onclick="openAddQuoteFromDetail('${b.id}')" style="font-size:.65rem;padding:.2rem .55rem;border:1px solid var(--acc);border-radius:10px;background:none;color:var(--acc);cursor:pointer;font-family:var(--ff);">＋ 문장 추가</button>
    </div>`;
    const QCOLORS=['#c4714a','#7a9e7e','#5a8a8a','#c8a87a','#9a7090','#8a8aaa','#b06040'];
    quotes.forEach((q,i)=>{
      const color = QCOLORS[i % QCOLORS.length];
      const hasHtml = /<[a-z]/i.test(q.text||'');
      const txt = hasHtml ? q.text : (q.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      html+=`<div onclick="openEditQuote(${JSON.stringify(q).replace(/"/g,'&quot;')})" style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:.55rem .75rem .5rem 1rem;position:relative;margin-bottom:.4rem;cursor:pointer;transition:box-shadow .15s;" onmouseenter="this.style.boxShadow='0 2px 10px rgba(0,0,0,.08)'" onmouseleave="this.style.boxShadow='none'">
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;background:${color};"></div>
        <div style="position:absolute;top:.45rem;right:.55rem;font-size:.6rem;color:var(--tx3);opacity:.5;">✏️</div>
        <div style="padding-left:.5rem;padding-right:1rem;">
          <div style="font-size:1.3rem;color:${color};opacity:.22;line-height:1;font-family:Georgia,serif;margin-top:-.1rem;">"</div>
          <div style="font-size:.72rem;font-family:var(--fs);line-height:1.78;color:var(--tx1);">${txt}</div>
          ${(q.page||q.tag)?`<div style="display:flex;gap:.3rem;margin-top:.35rem;flex-wrap:wrap;">
            ${q.page?`<span style="font-size:.57rem;color:var(--tx3);background:#f0ebe0;padding:.1rem .45rem;border-radius:8px;">p.${q.page}</span>`:''}
            ${q.tag?`<span style="font-size:.57rem;color:var(--acc2);background:#f5f0e8;padding:.1rem .45rem;border-radius:8px;">${q.tag}</span>`:''}
          </div>`:''}
        </div>
      </div>`;
    });
    if(!quotes.length) html+=`<div style="font-size:.72rem;color:var(--tx3);text-align:center;padding:.6rem 0;">아직 수집된 문장이 없어요.</div>`;
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

  // 프로필 + 코드 로드
  const [{data:profile},{data:myCodes}]=await Promise.all([
    sb.from('profiles').select('*').eq('id',currentUser.id).single(),
    sb.from('invite_codes').select('*').eq('owner_id',currentUser.id)
  ]);

  // 닉네임 (DB에서 가져온 값 우선)
  const name = profile?.display_name||profile?.username||tempName;
  document.getElementById('profile-avatar').textContent=name.slice(0,1).toUpperCase();
  document.getElementById('profile-name').textContent=name;
  document.getElementById('profile-display-name').value=name;
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

    await loadData(); buildBooks();
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

// 파도타기 - 관리자 서재 구경 (k_tenten@naver.com)
async function surfLibrary() {
  // 관리 계정의 서재만 표시
  const ADMIN_EMAIL = 'k_tenten@naver.com';
  const { data: adminUser } = await sb.from('profiles')
    .select('id,display_name,username')
    .eq('email', ADMIN_EMAIL)
    .single()
    .catch(() => ({ data: null }));
  // profiles에 email이 없을 수 있으므로 auth.users 경유
  if(!adminUser) {
    // email로 직접 조회가 안 되면 username/display_name 기반 고정 표시
    const { data: allP } = await sb.from('profiles')
      .select('id,display_name,username,library_public,library_visibility')
      .neq('id', currentUser.id)
      .limit(200);
    // 관리 계정 이메일로 등록된 유저 찾기 (Supabase auth uid 기반)
    const target = (allP||[]).find(p =>
      p.username === 'k_tenten' || p.display_name === 'k_tenten'
    ) || (allP||[])[0];
    if(!target) { await showAlert('서재를 불러올 수 없어요.'); return; }
    openLibrary(target.id, target.display_name || target.username || '북로그');
    return;
  }
  openLibrary(adminUser.id, adminUser.display_name || adminUser.username || '북로그');
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
      <div class="gi-stars">${Array.from({length:5},(_,i)=>(parseFloat(b.rating)||0)>=i+1?'★':(parseFloat(b.rating)||0)>=i+0.5?'⯨':'☆').join('')}</div>
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
