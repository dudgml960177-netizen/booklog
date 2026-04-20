// ═══════════════════════════════════════════
// 북로그 — 메인 앱 로직 v2
// ═══════════════════════════════════════════

const SUPABASE_URL = 'https://xowlwzpoxrudgaoavkbr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';
const NAVER_PROXY  = `${SUPABASE_URL}/functions/v1/naver-book`;

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 상태 ──────────────────────────────────
let currentUser   = null;
let allBooks      = [];
let allQuotes     = [];
let curFilter     = '전체';
let curTagQ       = '전체';
let curBookId     = null;
let editingBookId = null;
let selectedBook  = null;
let curRating     = 0;
let curStatus     = '완독';
let calY          = new Date().getFullYear();
let calM          = new Date().getMonth();
let monthChart    = null;
let donutChart    = null;
let curYM         = 'all';
let curYR         = 'all';

// 타이머 상태
let timerInterval = null;
let timerSeconds  = 0;
let timerRunning  = false;
let timerBookId   = null;

const YC = {
  2022:{line:'#7a9e7e',rgb:'122,158,126'},
  2023:{line:'#5a8a8a',rgb:'90,138,138'},
  2024:{line:'#c4714a',rgb:'196,113,74'},
  2025:{line:'#9a7090',rgb:'154,112,144'},
  2026:{line:'#c8a87a',rgb:'200,168,122'},
  2027:{line:'#8a8aaa',rgb:'138,138,170'},
};
const GCOLS = ['#c4714a','#7a9e7e','#5a8a8a','#c8a87a','#9a7090','#8a8aaa','#b06040','#6a8a6a'];
const RCOLS = ['#c4714a','#b07030','#c8a87a','#7a9e7e','#8a8aaa'];

// ── 초기화 ────────────────────────────────
function showScreen(name) {
  ['loading','auth','app'].forEach(n => {
    const el = document.getElementById('screen-' + n);
    if (!el) return;
    el.style.display = 'none';
  });
  const el = document.getElementById('screen-' + name);
  if (el) el.style.display = (name === 'loading') ? 'flex' : 'flex';
  if (el) el.style.flexDirection = 'column';
}

async function init() {
  showScreen('loading');
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      currentUser = data.session.user;
      try {
        await loadData();
      } catch (dbError) {
        console.error("데이터 로드 실패:", dbError);
        // 데이터 로드 실패해도 일단 앱 화면은 보여줘야 함
      }
      showScreen('app');
      buildGallery();
    } else {
      showScreen('auth');
    }
  } catch(e) {
    console.error("인증 확인 실패:", e);
    showScreen('auth');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    currentUser = session.user;
    await loadData();
    showScreen('app');
    buildGallery();
  }
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    allBooks = []; allQuotes = [];
    showScreen('auth');
  }
  if (event === 'TOKEN_REFRESHED' && session) {
    currentUser = session.user;
  }
});

// ── 데이터 로드 ───────────────────────────
async function loadData() {
  const [booksRes, quotesRes] = await Promise.all([
    sb.from('books').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
    sb.from('quotes').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
  ]);
  allBooks  = booksRes.data  || [];
  allQuotes = quotesRes.data || [];
}

// ── 인증 ──────────────────────────────────
function authSwitch(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('form-login').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('form-signup').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('auth-error').style.display  = 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) showAuthError(error.message);
}

async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pw    = document.getElementById('signup-pw').value;
  const name  = document.getElementById('signup-name').value.trim();
  if (!name) { showAuthError('닉네임을 입력해주세요.'); return; }
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { showAuthError(error.message); return; }
  if (data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, username: name, display_name: name });
  }
  showAuthError('가입 완료! 이메일을 확인한 뒤 로그인해주세요.', true);
}

async function doLogout() {
  await sb.auth.signOut();
  closeModal('modal-profile');
}

function showAuthError(msg, success = false) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = '';
  el.style.color = success ? '#2e7d32' : '#9e3a1e';
  el.style.background = success ? '#f0f8f0' : '#fdf0ee';
  el.style.borderColor = success ? '#a8d8a8' : '#e8b8a8';
}

// ── 탭 전환 ───────────────────────────────
function sw(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('p-' + name).classList.add('on');
  if (name === 'gallery') buildGallery();
  if (name === 'table')   buildTable();
  if (name === 'quotes')  buildQuotes();
  if (name === 'cal')     renderCal();
  if (name === 'timer')   buildTimer();
  if (name === 'graph') {
    buildStats(); buildMilestone();
    document.querySelectorAll('.gst').forEach((t,i) => t.classList.toggle('on', i===0));
    showGraph('monthly');
  }
}

// ── 갤러리 ────────────────────────────────
function filterStatus(status, btn) {
  curFilter = status;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  buildGallery();
}

function buildGallery() {
  const g = document.getElementById('gal-grid'); g.innerHTML = '';
  let list = curFilter === '전체' ? allBooks : allBooks.filter(b => b.status === curFilter);
  if (!list.length) {
    g.innerHTML = '<div class="empty-state">아직 기록된 책이 없어요.<br>+ 버튼으로 첫 책을 추가해보세요!</div>';
    return;
  }
  list.forEach(b => {
    const el = document.createElement('div'); el.className = 'gi';
    el.onclick = () => openDetail(b.id);
    const coverHTML = b.cover
      ? `<img src="${b.cover}" alt="${b.title}" style="width:100%;height:100%;object-fit:cover;border-radius:3px;">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.5rem;color:rgba(255,255,255,.8);text-align:center;padding:.2rem;font-style:italic;line-height:1.4;">${b.title}</div>`;
    el.innerHTML = `<div class="gi-cover">${coverHTML}</div>
      <div class="gi-title">${b.title}</div>
      <div class="gi-author">${b.author || ''}</div>
      <div class="gi-stars">${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</div>
      <span class="gi-status">${b.status||''}</span>`;
    g.appendChild(el);
  });
}

// ── 테이블 ────────────────────────────────
function buildTable() {
  const tb = document.getElementById('tbl-body'); tb.innerHTML = '';
  allBooks.forEach(b => {
    const tr = document.createElement('tr');
    tr.onclick = () => openDetail(b.id);
    const genre = Array.isArray(b.genre) ? b.genre.join(', ') : (b.genre || '');
    tr.innerHTML = `<td>${b.title}</td><td>${b.author||''}</td>
      <td><span class="pill">${genre}</span></td>
      <td>${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</td>
      <td><span class="pill">${b.status||''}</span></td>
      <td>${b.date_finish||''}</td>`;
    tb.appendChild(tr);
  });
}

// ── 문장 수집 ─────────────────────────────
function buildQuotes() {
  const tags = ['전체', ...new Set(allQuotes.map(q => q.tag).filter(Boolean))];
  const fEl = document.getElementById('q-filter'); fEl.innerHTML = '';
  tags.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'qf-btn' + (t === curTagQ ? ' on' : '');
    btn.textContent = t;
    btn.onclick = () => { curTagQ = t; document.querySelectorAll('.qf-btn').forEach(b => b.classList.toggle('on', b.textContent === t)); renderQuotes(); };
    fEl.appendChild(btn);
  });
  renderQuotes();
}

function renderQuotes() {
  const feed = document.getElementById('q-feed'); feed.innerHTML = '';
  const list = curTagQ === '전체' ? allQuotes : allQuotes.filter(q => q.tag === curTagQ);
  if (!list.length) {
    feed.innerHTML = '<div class="empty-state">수집된 문장이 없어요.</div>';
    return;
  }
  list.forEach(q => {
    const book = allBooks.find(b => b.id === q.book_id);
    const color = book ? genreColor(book.genre) : '#b07030';
    const el = document.createElement('div'); el.className = 'qcard';
    el.innerHTML = `<div class="qcard-bar" style="background:${color}"></div>
      <div class="qcard-text">${q.text}</div>
      <div class="qcard-meta">
        <span class="qcard-book">${book?.title || ''}</span>
        ${q.page ? `<span class="qcard-page">p.${q.page}</span>` : ''}
        ${q.tag  ? `<span class="qcard-tag">${q.tag}</span>` : ''}
      </div>`;
    feed.appendChild(el);
  });
}

function genreColor(genre) {
  const g = Array.isArray(genre) ? genre[0] : genre;
  const map = { '소설':'#c4714a','에세이':'#7a9e7e','인문':'#5a8a8a','자기계발':'#c8a87a','과학':'#8a8aaa','시/시집':'#9a7090' };
  return map[g] || '#b07030';
}

// ── 타이머 ────────────────────────────────
function buildTimer() {
  const el = document.getElementById('timer-book-select');
  if (!el) return;
  el.innerHTML = '<option value="">책 선택...</option>';
  allBooks.filter(b => b.status === '읽는중').forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.title;
    el.appendChild(opt);
  });
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const h = Math.floor(timerSeconds / 3600);
  const m = Math.floor((timerSeconds % 3600) / 60);
  const s = timerSeconds % 60;
  const el = document.getElementById('timer-display');
  if (el) el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const btn = document.getElementById('timer-btn');
  if (btn) btn.textContent = timerRunning ? '⏸ 일시정지' : (timerSeconds > 0 ? '▶ 계속' : '▶ 시작');
}

function toggleTimer() {
  const bookSel = document.getElementById('timer-book-select');
  if (!timerRunning && bookSel && !bookSel.value) {
    alert('먼저 읽고 있는 책을 선택해주세요.');
    return;
  }
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
  } else {
    timerBookId = bookSel?.value || null;
    timerRunning = true;
    timerInterval = setInterval(() => {
      timerSeconds++;
      updateTimerDisplay();
    }, 1000);
  }
  updateTimerDisplay();
}

function resetTimer() {
  if (!confirm('타이머를 초기화할까요?')) return;
  clearInterval(timerInterval);
  timerRunning = false;
  timerSeconds = 0;
  updateTimerDisplay();
}

async function saveTimer() {
  if (timerSeconds < 60) { alert('최소 1분 이상 읽어야 저장할 수 있어요.'); return; }
  const bookSel = document.getElementById('timer-book-select');
  const bookId = bookSel?.value || timerBookId;
  if (!bookId) { alert('책을 선택해주세요.'); return; }
  const book = allBooks.find(b => b.id === bookId);
  const today = new Date().toISOString().slice(0,10);
  const mins = Math.round(timerSeconds / 60);
  const curReadingTime = book?.reading_time || 0;
  await sb.from('books').update({ reading_time: curReadingTime + mins, last_read: today }).eq('id', bookId);
  clearInterval(timerInterval);
  timerRunning = false;
  timerSeconds = 0;
  await loadData();
  updateTimerDisplay();
  buildTimer();
  alert(`${mins}분 저장됐어요!`);
}

// ── 달력 ──────────────────────────────────
function moveCal(dir) {
  calM += dir;
  if (calM > 11) { calM = 0; calY++; }
  if (calM < 0)  { calM = 11; calY--; }
  renderCal();
}

function renderCal() {
  const mn = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('cal-ttl').textContent = calY + '년 ' + mn[calM];
  const grid = document.getElementById('cal-grid');
  const dows = [...grid.querySelectorAll('.dow')]; grid.innerHTML = ''; dows.forEach(d => grid.appendChild(d));
  const first = new Date(calY, calM, 1).getDay();
  const days  = new Date(calY, calM+1, 0).getDate();
  const prev  = new Date(calY, calM, 0).getDate();
  const today = new Date();
  for (let i = 0; i < first; i++) {
    const d = document.createElement('div'); d.className='day other'; d.textContent=prev-first+1+i; grid.appendChild(d);
  }
  for (let d = 1; d <= days; d++) {
    const ds = calY+'-'+String(calM+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const book = allBooks.find(b => b.date_finish === ds && b.status === '완독');
    const el = document.createElement('div');
    const isT = today.getFullYear()===calY && today.getMonth()===calM && today.getDate()===d;
    if (book) {
      el.className = 'day hbook'; el.title = book.title;
      el.onclick = () => openDetail(book.id);
      if (book.cover) {
        const img = document.createElement('img'); img.className='bthumb'; img.src=book.cover; img.alt=book.title; el.appendChild(img);
      } else {
        const ph = document.createElement('div'); ph.className='bthumb-ph'; ph.textContent=book.title; el.appendChild(ph);
      }
      const dn = document.createElement('span'); dn.className='dnum'; dn.textContent=d; el.appendChild(dn);
    } else {
      el.className = 'day' + (isT ? ' today' : ''); el.textContent = d;
    }
    grid.appendChild(el);
  }
  const rem = 42-first-days;
  for (let i=1;i<=rem;i++){const d=document.createElement('div');d.className='day other';d.textContent=i;grid.appendChild(d);}
  const list = document.getElementById('cal-list'); list.innerHTML = '';
  const mk = calY+'-'+String(calM+1).padStart(2,'0');
  const mb = allBooks.filter(b => b.date_finish && b.date_finish.startsWith(mk) && b.status==='완독');
  if (!mb.length) {
    list.innerHTML = '<div style="font-size:.72rem;color:var(--tx3);padding:.25rem 0;">이 달에 완독한 책이 없습니다.</div>';
  } else {
    mb.forEach(b => {
      const r = document.createElement('div'); r.className='cli';
      r.onclick = () => openDetail(b.id);
      r.innerHTML = `<span class="cldot"></span><span style="flex:1;">${b.title}</span><span style="color:var(--tx3);font-size:.65rem;">${b.date_finish}</span>`;
      list.appendChild(r);
    });
  }
}

// ── 통계 ──────────────────────────────────
function buildStats() {
  const sg = document.getElementById('stat-grid'); sg.innerHTML = '';
  const done = allBooks.filter(b => b.status === '완독');
  const total = done.length;
  const avg = total > 0 ? (done.reduce((a,b) => a+(b.rating||0), 0) / total).toFixed(1) : '—';
  const years = new Set(done.map(b => b.date_finish?.slice(0,4)).filter(Boolean));
  const totalPages = done.reduce((a,b) => a+(b.pages||0), 0);
  const totalMins  = allBooks.reduce((a,b) => a+(b.reading_time||0), 0);
  const thisMonth  = done.filter(b => b.date_finish?.startsWith(new Date().toISOString().slice(0,7)));
  const thisYear   = done.filter(b => b.date_finish?.startsWith(String(new Date().getFullYear())));
  const monthPages = thisMonth.reduce((a,b) => a+(b.pages||0), 0);
  const yearPages  = thisYear.reduce((a,b) => a+(b.pages||0), 0);

  // 좋아하는 작가
  const authorMap = {};
  done.forEach(b => { if(b.author) authorMap[b.author] = (authorMap[b.author]||0)+1; });
  const topAuthor = Object.entries(authorMap).sort((a,b)=>b[1]-a[1])[0];

  // 좋아하는 출판사
  const pubMap = {};
  done.forEach(b => { if(b.publisher) pubMap[b.publisher] = (pubMap[b.publisher]||0)+1; });
  const topPub = Object.entries(pubMap).sort((a,b)=>b[1]-a[1])[0];

  const hrs = Math.floor(totalMins/60);
  const items = [
    {n:total,          l:'누적 완독',      sub:'전체 기간'},
    {n:avg,            l:'평균 평점',      sub:avg+' / 5.0'},
    {n:years.size+'년',l:'독서 기록',      sub:years.size?[...years].sort()[0]+'–현재':'—'},
    {n:allQuotes.length,l:'수집한 문장',   sub:'인상 깊은 구절'},
    {n:totalPages.toLocaleString()+'p', l:'누적 페이지', sub:'전체 기간'},
    {n:yearPages.toLocaleString()+'p',  l:'올해 페이지', sub:new Date().getFullYear()+'년'},
    {n:monthPages.toLocaleString()+'p', l:'이번달 페이지',sub:new Date().toISOString().slice(0,7)},
    {n:hrs+'h',        l:'총 독서 시간',   sub:totalMins+'분'},
    {n:topAuthor?topAuthor[0]:'—', l:'최애 작가', sub:topAuthor?topAuthor[1]+'권':''},
    {n:topPub?topPub[0]:'—',       l:'최애 출판사',sub:topPub?topPub[1]+'권':''},
    {n:done.length>0?Math.round(totalPages/done.length)+'p':'—', l:'권당 평균', sub:'페이지'},
    {n:allBooks.filter(b=>b.status==='읽는중').length, l:'읽는 중', sub:'권'},
  ];
  items.forEach(it => {
    const el = document.createElement('div'); el.className='scard';
    el.innerHTML = `<div class="scard-n">${it.n}</div><div class="scard-l">${it.l}</div><div class="scard-sub">${it.sub}</div>`;
    sg.appendChild(el);
  });
}

function showGraph(name, btn) {
  if (btn) { document.querySelectorAll('.gst').forEach(t=>t.classList.remove('on')); btn.classList.add('on'); }
  ['monthly','genre','rating'].forEach(n => document.getElementById('g-'+n).style.display = n===name?'':'none');
  if (name==='monthly') buildMonthly();
  if (name==='genre')   buildGenre();
  if (name==='rating')  buildRating();
}

function buildYrRow(elId, curYr, onChange) {
  const el = document.getElementById(elId); el.innerHTML='';
  const done = allBooks.filter(b=>b.status==='완독'&&b.date_finish);
  const YEARS = [...new Set(done.map(b=>parseInt(b.date_finish.slice(0,4))))].sort();
  const allBtn = document.createElement('button');
  allBtn.className='yr-btn'+(curYr==='all'?' on':'');
  allBtn.textContent='전체';
  allBtn.style.cssText=curYr==='all'?'background:var(--acc2);color:#fff;border-color:transparent;':'color:var(--tx3);';
  allBtn.onclick=()=>onChange('all'); el.appendChild(allBtn);
  YEARS.forEach(y=>{
    const c=YC[y]||{line:'#b07030'};
    const btn=document.createElement('button');btn.className='yr-btn'+(curYr===y?' on':'');
    btn.textContent=y+'년';
    btn.style.cssText=curYr===y?`background:${c.line};color:#fff;border-color:transparent;`:`color:${c.line};border-color:${c.line};`;
    btn.onclick=()=>onChange(y);el.appendChild(btn);
  });
  return YEARS;
}

function buildMonthly() {
  const YEARS = buildYrRow('yr-row-m', curYM, yr=>{curYM=yr;buildMonthly();});
  if (monthChart){monthChart.destroy();monthChart=null;}
  const done = allBooks.filter(b=>b.status==='완독'&&b.date_finish);
  const labels=['1','2','3','4','5','6','7','8','9','10','11','12'].map(l=>l+'월');
  const ctx = document.getElementById('chart-monthly').getContext('2d');
  if (curYM==='all') {
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
  const total=filtered.length;const cnt=Array(12).fill(0);filtered.forEach(b=>cnt[parseInt(b.date_finish.slice(5,7))-1]++);
  const mx=Math.max(...cnt);const bestM=mx===0?'-':(cnt.indexOf(mx)+1)+'월 ('+mx+'권)';
  const yrs=new Set(done.map(b=>b.date_finish.slice(0,4))).size||1;
  document.getElementById('monthly-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">${curYM==='all'?'누적 완독':curYM+'년 완독'}</span></div><div class="si"><span class="sn">${curYM==='all'?Math.round(total/yrs*10)/10:Math.round(total/12*10)/10}</span><span class="sl">${curYM==='all'?'연평균':'월평균'}</span></div><div class="si"><span class="sn">${bestM}</span><span class="sl">최다 독서월</span></div>`;
}

function buildGenre() {
  if(donutChart){donutChart.destroy();donutChart=null;}
  const done=allBooks.filter(b=>b.status==='완독');
  const genreMap={};
  done.forEach(b=>{const g=Array.isArray(b.genre)?b.genre[0]:(b.genre||'미분류');genreMap[g]=(genreMap[g]||0)+1;});
  const genres=Object.keys(genreMap);const vals=genres.map(g=>genreMap[g]);
  const total=vals.reduce((a,b)=>a+b,0)||1;const maxV=Math.max(...vals)||1;
  const dl=document.getElementById('donut-layout');dl.innerHTML='';
  const db=document.createElement('div');db.className='donut-box';
  const dc=document.createElement('canvas');dc.width=130;dc.height=130;
  const ctr=document.createElement('div');ctr.className='dcenter';
  ctr.innerHTML=`<div class="dcenter-n">${total}</div><div class="dcenter-l">총 권수</div>`;
  db.appendChild(dc);db.appendChild(ctr);
  const lc=document.createElement('div');lc.className='leg-col';
  genres.forEach((g,i)=>{
    const pct=Math.round(vals[i]/total*100);
    const r=document.createElement('div');r.className='lrow';
    r.innerHTML=`<div class="lsw" style="background:${GCOLS[i%GCOLS.length]}"></div><div class="lbar-wrap"><div class="lname">${g}</div><div class="ltrack"><div class="lfill" style="width:${Math.round(vals[i]/maxV*100)}%;background:${GCOLS[i%GCOLS.length]}"></div></div></div><div class="lright"><span class="lpct">${pct}%</span><span class="lcnt">${vals[i]}권</span></div>`;
    lc.appendChild(r);
  });
  dl.appendChild(db);dl.appendChild(lc);
  document.getElementById('genre-stat').innerHTML=`<div class="si"><span class="sn">${total}</span><span class="sl">총 권수</span></div><div class="si"><span class="sn">${genres.length}</span><span class="sl">장르 수</span></div>`;
  donutChart=new Chart(dc.getContext('2d'),{type:'doughnut',data:{labels:genres,datasets:[{data:vals,backgroundColor:GCOLS.slice(0,genres.length),borderColor:'#faf6ef',borderWidth:3,hoverOffset:5}]},options:{responsive:false,cutout:'68%',animation:{animateRotate:true,duration:600},plugins:{legend:{display:false},tooltip:{backgroundColor:'#faf6ef',borderColor:'#cfc3ac',borderWidth:1,titleColor:'#2e1f0e',bodyColor:'#5c3d1e',titleFont:{family:'Pretendard',size:11},bodyFont:{family:'Pretendard',size:11},callbacks:{label:c=>' '+c.label+' '+c.parsed+'권'}}}}});
}

function buildRating() {
  buildYrRow('yr-row-r',curYR,yr=>{curYR=yr;buildRating();});
  const done=allBooks.filter(b=>b.status==='완독');
  const filtered=curYR==='all'?done:done.filter(b=>parseInt(b.date_finish?.slice(0,4))===curYR);
  const total=filtered.length;
  const dist=[5,4,3,2,1].map(s=>filtered.filter(b=>b.rating===s).length);
  const maxD=Math.max(...dist)||1;
  const avg=total>0?(filtered.reduce((a,b)=>a+(b.rating||0),0)/total).toFixed(2):'—';
  const stars=s=>'★'.repeat(s)+'☆'.repeat(5-s);
  const layout=document.getElementById('rating-layout');layout.innerHTML='';
  const barsEl=document.createElement('div');barsEl.className='rating-bars';
  [5,4,3,2,1].forEach((s,i)=>{
    const cnt=dist[i],pct=total>0?Math.round(cnt/total*100):0,wpct=Math.round(cnt/maxD*100);
    const inside=wpct>=22;
    const row=document.createElement('div');row.className='rbar-row';
    row.innerHTML=`<span class="rbar-label">${stars(s)}</span><div class="rbar-outer"><div class="rbar-fill" style="width:${wpct}%;background:${RCOLS[i]}">${inside?`<span class="rbar-val">${cnt}권</span>`:''}</div>${!inside&&cnt>0?`<span class="rbar-val-out" style="left:${wpct}%;">${cnt}권</span>`:''}</div><span style="font-size:.63rem;color:var(--tx3);min-width:26px;text-align:right;">${pct}%</span>`;
    barsEl.appendChild(row);
  });
  layout.appendChild(barsEl);
  const sumEl=document.createElement('div');sumEl.className='rating-summary';
  sumEl.innerHTML=`<div class="rs-avg">${avg}</div><div class="rs-lbl">평균 평점</div>`;
  const distEl=document.createElement('div');distEl.className='rs-dist';
  [5,4,3,2,1].forEach((s,i)=>{const r=document.createElement('div');r.className='rs-star-row';r.innerHTML=`<span class="rs-star" style="font-size:11px;">${'★'.repeat(s)}</span><div class="rs-mini"><div class="rs-mini-fill" style="width:${Math.round(dist[i]/maxD*100)}%;background:${RCOLS[i]}"></div></div>`;distEl.appendChild(r);});
  sumEl.appendChild(distEl);layout.appendChild(sumEl);
}

function buildMilestone() {
  const done=allBooks.filter(b=>b.status==='완독');
  const total=done.length;
  const years=new Set(done.map(b=>b.date_finish?.slice(0,4)).filter(Boolean));
  const yrs=years.size||1;
  const totalMins=allBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const items=[
    {n:total,l:'총 완독 권수',prog:Math.min(total/200,1),target:'목표 200권'},
    {n:yrs+'년',l:'독서 기록 기간',prog:Math.min(yrs/10,1),target:'10년 독서가'},
    {n:Math.round(total/yrs*10)/10+'권',l:'연평균 독서량',prog:Math.min(total/yrs/20,1),target:'연 20권 목표'},
    {n:Math.floor(totalMins/60)+'h',l:'총 독서 시간',prog:Math.min(totalMins/60/500,1),target:'500시간 목표'},
    {n:new Set(done.map(b=>b.date_finish?.slice(0,7)).filter(Boolean)).size+'개월',l:'독서한 달 수',prog:0,target:''},
    {n:done.filter(b=>b.rating>=4).length+'권',l:'★★★★ 이상',prog:Math.min(done.filter(b=>b.rating>=4).length/100,1),target:'명작 100권'},
  ];
  const g=document.getElementById('ms-grid');g.innerHTML='';
  items.forEach(it=>{const el=document.createElement('div');el.className='ms-card';el.innerHTML=`<div class="ms-n">${it.n}</div><div class="ms-l">${it.l}</div>`+(it.prog>0?`<div class="ms-prog"><div class="ms-prog-fill" style="width:${Math.round(it.prog*100)}%"></div></div><div class="ms-target">${it.target}</div>`:'');g.appendChild(el);});
}

// ── 책 추가 모달 ───────────────────────────
function openAddBook() {
  editingBookId = null; selectedBook = null; curRating = 0; curStatus = '완독';
  document.getElementById('modal-book-title').textContent = '책 추가';
  document.getElementById('search-section').style.display = '';
  document.getElementById('book-form').style.display = 'none';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('book-search-input').value = '';
  document.getElementById('book-review').value = '';
  document.getElementById('book-genre').value = '';
  document.getElementById('book-start').value = '';
  document.getElementById('book-finish').value = new Date().toISOString().slice(0,10);
  document.getElementById('book-reread').checked = false;
  document.getElementById('book-pages').value = '';
  document.getElementById('book-source').value = '';
  document.getElementById('quotes-list').innerHTML = '';
  updateStars(0);
  document.querySelectorAll('.status-btn').forEach(b => b.classList.toggle('on', b.textContent==='완독'));
  openModal('modal-book');
}

// ── 책 검색 ───────────────────────────────
async function searchBook() {
  const q = document.getElementById('book-search-input').value.trim();
  if (!q) return;
  const res = document.getElementById('search-results');
  res.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 중...</div>';
  try {
    const resp = await fetch(`${NAVER_PROXY}?query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const data = await resp.json();
    res.innerHTML = '';
    if (!data.items?.length) {
      res.innerHTML = '<div style="font-size:.75rem;color:var(--tx3);padding:.5rem;">검색 결과가 없어요.</div>';
      return;
    }
    data.items.forEach(item => {
      const el = document.createElement('div'); el.className = 'search-item';
      const cover = item.image || '';
      const title = item.title.replace(/<[^>]+>/g,'');
      const author = item.author.replace(/<[^>]+>/g,'');
      const publisher = item.publisher || '';
      const desc = item.description.replace(/<[^>]+>/g,'');
      el.innerHTML = `${cover?`<img class="search-item-cover" src="${cover}" alt="${title}">`:'<div class="search-item-cover"></div>'}
        <div class="search-item-info">
          <div class="search-item-title">${title}</div>
          <div class="search-item-author">${author}</div>
          <div class="search-item-pub">${publisher}</div>
        </div>`;
      el.onclick = () => selectBook({ title, author, publisher, cover, description: desc, isbn: item.isbn });
      res.appendChild(el);
    });
  } catch(e) {
    res.innerHTML = '<div style="font-size:.75rem;color:#c0392b;padding:.5rem;">검색 실패. 잠시 후 다시 시도해주세요.</div>';
  }
}

function selectBook(book) {
  selectedBook = book;
  document.getElementById('search-section').style.display = 'none';
  document.getElementById('book-form').style.display = '';
  const coverHTML = book.cover ? `<img class="selected-cover" src="${book.cover}" alt="${book.title}">` : `<div class="selected-cover" style="background:linear-gradient(150deg,#a07040,#5c3010);"></div>`;
  document.getElementById('selected-book-info').innerHTML = `
    ${coverHTML}
    <div class="selected-info">
      <div class="selected-title">${book.title}</div>
      <div class="selected-author">${book.author}</div>
      <div class="selected-desc">${book.description || ''}</div>
      <span class="selected-change" onclick="changeBook()">다른 책 선택</span>
    </div>`;
}

function changeBook() {
  selectedBook = null;
  document.getElementById('search-section').style.display = '';
  document.getElementById('book-form').style.display = 'none';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('book-search-input').value = '';
}

function setStar(n) { curRating = n; updateStars(n); }
function updateStars(n) {
  document.querySelectorAll('.star').forEach((s,i) => s.classList.toggle('on', i < n));
}

function setStatus(s, btn) {
  curStatus = s;
  document.querySelectorAll('.status-btn').forEach(b => b.classList.toggle('on', b === btn));
}

function addQuoteField(text='', page='', tag='') {
  const list = document.getElementById('quotes-list');
  const el = document.createElement('div'); el.className='quote-field';
  el.innerHTML = `<button class="quote-remove" onclick="this.parentElement.remove()">✕</button>
    <textarea class="form-input" placeholder="인상 깊은 문장을 입력하세요..." rows="2" data-qtext>${text}</textarea>
    <div class="quote-field-row">
      <input type="text" class="form-input" placeholder="태그 (예: 삶, 감동)" data-qtag value="${tag}">
      <input type="text" class="form-input" placeholder="p.42" data-qpage value="${page}">
    </div>`;
  list.appendChild(el);
}

// ── 책 저장 ───────────────────────────────
async function saveBook() {
  if (!selectedBook && !editingBookId) { alert('책을 검색해서 선택해주세요.'); return; }
  const genre     = document.getElementById('book-genre').value;
  const review    = document.getElementById('book-review').value.trim();
  const dateStart = document.getElementById('book-start').value;
  const dateFinish= document.getElementById('book-finish').value;
  const reread    = document.getElementById('book-reread').checked;
  const pages     = parseInt(document.getElementById('book-pages').value) || null;
  const source    = document.getElementById('book-source').value;
  const quoteFields = document.querySelectorAll('.quote-field');
  const newQuotes = [...quoteFields].map(f => ({
    text: f.querySelector('[data-qtext]').value.trim(),
    tag:  f.querySelector('[data-qtag]').value.trim(),
    page: f.querySelector('[data-qpage]').value.trim(),
  })).filter(q => q.text);
  const existing = editingBookId ? allBooks.find(b => b.id === editingBookId) : null;
  const bookData = {
    user_id:     currentUser.id,
    title:       selectedBook?.title       || existing?.title       || '',
    author:      selectedBook?.author      || existing?.author      || '',
    publisher:   selectedBook?.publisher   || existing?.publisher   || '',
    cover:       selectedBook?.cover       || existing?.cover       || '',
    description: selectedBook?.description || existing?.description || '',
    isbn:        selectedBook?.isbn        || existing?.isbn        || '',
    genre:       genre ? [genre] : [],
    rating:      curRating || null,
    status:      curStatus,
    date_start:  dateStart  || null,
    date_finish: dateFinish || null,
    review, reread, pages, source: source || null,
  };
  try {
    let bookId = editingBookId;
    if (editingBookId) {
      const { error } = await sb.from('books').update(bookData).eq('id', editingBookId);
      if (error) throw error;
      await sb.from('quotes').delete().eq('book_id', editingBookId);
    } else {
      const { data, error } = await sb.from('books').insert(bookData).select().single();
      if (error) throw error;
      bookId = data?.id;
    }
    if (bookId && newQuotes.length) {
      await sb.from('quotes').insert(newQuotes.map(q => ({ ...q, user_id: currentUser.id, book_id: bookId })));
    }
    closeModal('modal-book');
    await loadData();
    buildGallery();
  } catch(e) {
    alert('저장 중 오류: ' + (e.message || JSON.stringify(e)));
  }
}

// ── 책 상세 ───────────────────────────────
function openDetail(bookId) {
  curBookId = bookId;
  const b = allBooks.find(b => b.id === bookId);
  if (!b) return;
  document.getElementById('detail-title').textContent = b.title;
  const quotes = allQuotes.filter(q => q.book_id === bookId);
  const genre = Array.isArray(b.genre) ? b.genre.join(', ') : (b.genre || '');
  const coverHTML = b.cover ? `<img class="detail-cover" src="${b.cover}" alt="${b.title}">` : `<div class="detail-cover-ph">${b.title}</div>`;

  // 줄거리 더보기 처리
  const MAX_DESC = 150;
  let descHTML = '';
  if (b.description) {
    if (b.description.length > MAX_DESC) {
      descHTML = `<div class="detail-sec">줄거리</div>
        <div class="detail-body">
          <span class="desc-short">${b.description.slice(0, MAX_DESC)}...</span>
          <span class="desc-full" style="display:none;">${b.description}</span>
          <span class="desc-toggle" onclick="toggleDesc(this)">더 보기</span>
        </div><div class="detail-divhr"></div>`;
    } else {
      descHTML = `<div class="detail-sec">줄거리</div><div class="detail-body">${b.description}</div><div class="detail-divhr"></div>`;
    }
  }

  const readingTime = b.reading_time ? `<span class="detail-chip">📖 ${Math.floor(b.reading_time/60)}h ${b.reading_time%60}m</span>` : '';
  const sourceTag = b.source ? `<span class="detail-chip">${b.source}</span>` : '';
  const pagesTag = b.pages ? `<span class="detail-chip">${b.pages}p</span>` : '';

  let html = `<div class="detail-head">${coverHTML}
    <div style="flex:1;min-width:0;">
      <div class="detail-title">${b.title}</div>
      <div class="detail-sub">${b.author||''}${b.publisher?' · '+b.publisher:''}</div>
      <div class="detail-stars">${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</div>
      <div class="detail-chips">
        ${genre?`<span class="detail-chip">${genre}</span>`:''}
        ${b.status?`<span class="detail-chip">${b.status}</span>`:''}
        ${b.date_finish?`<span class="detail-chip">${b.date_finish}</span>`:''}
        ${pagesTag}${readingTime}${sourceTag}
        ${b.reread?`<span class="detail-chip">다시 읽고 싶음</span>`:''}
      </div>
    </div>
  </div>`;
  html += descHTML;
  if (b.review) html += `<div class="detail-sec">감상</div><div class="detail-body">${b.review}</div>`;
  if (quotes.length) {
    html += `<div class="detail-divhr"></div><div class="detail-sec">인상 깊은 문장</div>`;
    quotes.forEach(q => {
      html += `<div class="detail-quote">${q.text}<div class="detail-qsrc">${q.page?'p.'+q.page+' ':''}${q.tag?'#'+q.tag:''}</div></div>`;
    });
  }
  document.getElementById('detail-body').innerHTML = html;
  openModal('modal-detail');
}

function toggleDesc(el) {
  const parent = el.parentElement;
  const short = parent.querySelector('.desc-short');
  const full  = parent.querySelector('.desc-full');
  if (full.style.display === 'none') {
    short.style.display = 'none';
    full.style.display  = '';
    el.textContent = '접기';
  } else {
    short.style.display = '';
    full.style.display  = 'none';
    el.textContent = '더 보기';
  }
}

async function deleteBook() {
  if (!curBookId) return;
  if (!confirm('이 책 기록을 삭제할까요?')) return;
  await sb.from('quotes').delete().eq('book_id', curBookId);
  await sb.from('books').delete().eq('id', curBookId);
  closeModal('modal-detail');
  await loadData();
  buildGallery();
}

function editBook() {
  const b = allBooks.find(b => b.id === curBookId);
  if (!b) return;
  editingBookId = curBookId;
  selectedBook = { title:b.title, author:b.author, publisher:b.publisher, cover:b.cover, description:b.description, isbn:b.isbn };
  closeModal('modal-detail');
  document.getElementById('modal-book-title').textContent = '책 수정';
  document.getElementById('search-section').style.display = 'none';
  selectBook(selectedBook);
  curRating = b.rating || 0; curStatus = b.status || '완독';
  updateStars(curRating);
  document.querySelectorAll('.status-btn').forEach(btn => btn.classList.toggle('on', btn.textContent===curStatus));
  document.getElementById('book-genre').value = Array.isArray(b.genre) ? b.genre[0] : (b.genre||'');
  document.getElementById('book-review').value = b.review || '';
  document.getElementById('book-start').value  = b.date_start  || '';
  document.getElementById('book-finish').value = b.date_finish || '';
  document.getElementById('book-reread').checked = b.reread || false;
  document.getElementById('book-pages').value = b.pages || '';
  document.getElementById('book-source').value = b.source || '';
  const list = document.getElementById('quotes-list'); list.innerHTML = '';
  allQuotes.filter(q => q.book_id === b.id).forEach(q => addQuoteField(q.text, q.page, q.tag));
  openModal('modal-book');
}

// ── 프로필 ────────────────────────────────
async function openProfile() {
  const tempName = currentUser.email?.split('@')[0] || '독서가';
  document.getElementById('profile-avatar').textContent = tempName.slice(0,1).toUpperCase();
  document.getElementById('profile-name').textContent = tempName;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-display-name').value = tempName;
  openModal('modal-profile');
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (profile) {
    const name = profile.display_name || profile.username || tempName;
    document.getElementById('profile-avatar').textContent = name.slice(0,1).toUpperCase();
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-display-name').value = name;
  }
}

async function saveProfile() {
  const name = document.getElementById('profile-display-name').value.trim();
  if (!name) return;
  await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  closeModal('modal-profile');
}

function openModal(id) { document.getElementById(id).style.display='flex'; }
function closeModal(id) { document.getElementById(id).style.display='none'; }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.style.display='none'; });
});
