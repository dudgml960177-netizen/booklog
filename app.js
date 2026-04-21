// ═══════════════════════════════════════════
// 북로그 v3
// ═══════════════════════════════════════════
const SUPABASE_URL = 'https://xowlwzpoxrudgaoavkbr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvd2x3enBveHJ1ZGdhb2F2a2JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTgxNjQsImV4cCI6MjA5MjIzNDE2NH0.Dlv8KYcQAieS1jQ9J6zjfsodco2U-m3ObuP5LXJPaVQ';
const NAVER_PROXY = `${SUPABASE_URL}/functions/v1/naver-book`;
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 상태
let currentUser = null, allBooks = [], allQuotes = [], allCategories = [];
let curFilter = '전체', curCatFilter = null, curView = 'gallery';
let curTagQ = '전체', curBookId = null, editingBookId = null, selectedBook = null;
let curRating = 0, curStatus = '완독';
let calY = new Date().getFullYear(), calM = new Date().getMonth();
let monthChart = null, donutChart = null, pagesChart = null;
let curYM = 'all', curYR = 'all';
let timerInterval = null, timerSeconds = 0, timerRunning = false, timerBookId = null;
let timerTrackY = new Date().getFullYear(), timerTrackM = new Date().getMonth();
let goals = { books: 0, minutes: 0, pages: 0 };

const YC = {
  2022:{line:'#7a9e7e',rgb:'122,158,126'}, 2023:{line:'#5a8a8a',rgb:'90,138,138'},
  2024:{line:'#c4714a',rgb:'196,113,74'}, 2025:{line:'#9a7090',rgb:'154,112,144'},
  2026:{line:'#c8a87a',rgb:'200,168,122'}, 2027:{line:'#8a8aaa',rgb:'138,138,170'},
};
const GCOLS = ['#c4714a','#7a9e7e','#5a8a8a','#c8a87a','#9a7090','#8a8aaa','#b06040','#6a8a6a'];
const RCOLS = ['#c4714a','#b07030','#c8a87a','#7a9e7e','#8a8aaa'];
const TRACKER_COLORS = ['#f0e6cc','#d4a870','#b07030','#7a3e18','#4a2008'];

// ── 초기화
function showScreen(name) {
  ['loading','auth','app'].forEach(n => {
    const el = document.getElementById('screen-'+n);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('screen-'+name);
  if (el) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
}

async function init() {
  showScreen('loading');
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      currentUser = data.session.user;
      await loadData();
      loadGoals();
      showScreen('app');
      buildBooks();
    } else { showScreen('auth'); }
  } catch(e) { showScreen('auth'); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    currentUser = session.user;
    await loadData(); loadGoals();
    showScreen('app'); buildBooks();
  }
  if (event === 'SIGNED_OUT') { currentUser=null; allBooks=[]; allQuotes=[]; showScreen('auth'); }
  if (event === 'TOKEN_REFRESHED' && session) currentUser = session.user;
});

async function loadData() {
  const [bR, qR] = await Promise.all([
    sb.from('books').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
    sb.from('quotes').select('*').eq('user_id', currentUser.id).order('created_at',{ascending:false}),
  ]);
  allBooks = bR.data || []; allQuotes = qR.data || [];
  // 카테고리 로컬 스토리지에서 로드
  try { allCategories = JSON.parse(localStorage.getItem('bl_cats_'+currentUser.id)||'[]'); } catch(e){ allCategories=[]; }
}

// ── 인증
function authSwitch(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('on')); btn.classList.add('on');
  document.getElementById('form-login').style.display = tab==='login'?'':'none';
  document.getElementById('form-signup').style.display = tab==='signup'?'':'none';
  document.getElementById('auth-error').style.display = 'none';
}
async function doLogin() {
  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-pw').value
  });
  if (error) showAuthError(error.message);
}
async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pw = document.getElementById('signup-pw').value;
  const name = document.getElementById('signup-name').value.trim();
  if (!name) { showAuthError('닉네임을 입력해주세요.'); return; }
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) { showAuthError(error.message); return; }
  if (data.user) await sb.from('profiles').upsert({id:data.user.id, username:name, display_name:name});
  showAuthError('가입 완료! 이메일 인증 후 로그인해주세요.', true);
}
async function doLogout() { await sb.auth.signOut(); closeModal('modal-profile'); }
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
  document.getElementById('p-'+name).classList.add('on');
  if (name==='books')  buildBooks();
  if (name==='quotes') buildQuotes();
  if (name==='cal')    renderCal();
  if (name==='timer')  buildTimer();
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
  let list = allBooks;
  if (curFilter !== '전체') list = list.filter(b=>b.status===curFilter);
  if (curCatFilter) list = list.filter(b=>(b.category||'')=== curCatFilter);
  return list;
}
function buildBooks() {
  document.getElementById('view-gallery').style.display = curView==='gallery'?'':'none';
  document.getElementById('view-list').style.display = curView==='list'?'':'none';
  const list = getFilteredBooks();
  if (curView==='gallery') buildGallery(list);
  else buildList(list);
}
function buildGallery(list) {
  const g = document.getElementById('gal-grid'); g.innerHTML = '';
  if (!list.length) { g.innerHTML='<div class="empty-state">아직 기록된 책이 없어요.<br>+ 버튼으로 첫 책을 추가해보세요!</div>'; return; }
  list.forEach(b => {
    const el = document.createElement('div'); el.className='gi'; el.onclick=()=>openDetail(b.id);
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
    const el = document.createElement('div'); el.className='book-list-item'; el.onclick=()=>openDetail(b.id);
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
function buildQuotes() {
  const feed = document.getElementById('q-feed'); feed.innerHTML = '';
  const filter = document.getElementById('q-filter'); filter.innerHTML = '';
  if (!allQuotes.length) { feed.innerHTML='<div class="empty-state">수집된 문장이 없어요.</div>'; return; }
  feed.innerHTML = '';
  allQuotes.forEach(q => {
    const book = allBooks.find(b=>b.id===q.book_id);
    const color = book ? genreColor(book.genre) : '#b07030';
    const el = document.createElement('div'); el.className='qcard';
    el.innerHTML = `<div class="qcard-bar" style="background:${color}"></div>
      <div class="qcard-text">${q.text}</div>
      <div class="qcard-meta">
        <span class="qcard-book">${book?.title||''}</span>
        ${q.page?`<span class="qcard-page">p.${q.page}</span>`:''}
        ${q.tag?`<span class="qcard-comment">${q.tag}</span>`:''}
      </div>`;
    feed.appendChild(el);
  });
}
function genreColor(genre) {
  const g = Array.isArray(genre)?genre[0]:genre;
  return {'소설':'#c4714a','에세이':'#7a9e7e','인문':'#5a8a8a','자기계발':'#c8a87a','과학':'#8a8aaa','시/시집':'#9a7090'}[g]||'#b07030';
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
function buildTimer() {
  const sel = document.getElementById('timer-book-select');
  sel.innerHTML = '<option value="">읽는 중인 책 선택...</option>';
  allBooks.filter(b=>b.status==='읽는중').forEach(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=b.title;sel.appendChild(o);});
  updateTimerDisplay();
  buildTrackerGrid();
  buildTimerBookList();
  document.getElementById('timer-month-label').textContent = `${timerTrackY}년 ${timerTrackM+1}월`;
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
  const mins=Math.round(timerSeconds/60);
  const today=new Date().toISOString().slice(0,10);
  await sb.from('books').update({reading_time:(book?.reading_time||0)+mins,last_read:today}).eq('id',bookId);
  clearInterval(timerInterval);timerRunning=false;timerSeconds=0;
  await loadData(); updateTimerDisplay(); buildTimer();
  alert(`${mins}분 저장됐어요!`);
}
function moveTimerMonth(dir) {
  timerTrackM+=dir;
  if(timerTrackM>11){timerTrackM=0;timerTrackY++;}
  if(timerTrackM<0){timerTrackM=11;timerTrackY--;}
  document.getElementById('timer-month-label').textContent=`${timerTrackY}년 ${timerTrackM+1}월`;
  buildTrackerGrid();
}
function buildTrackerGrid() {
  const grid=document.getElementById('timer-tracker-grid'); if(!grid) return;
  grid.innerHTML='';
  const daysInMonth=new Date(timerTrackY,timerTrackM+1,0).getDate();
  const firstDay=new Date(timerTrackY,timerTrackM,1).getDay();
  const mk=timerTrackY+'-'+String(timerTrackM+1).padStart(2,'0');
  const dayMap={};
  allBooks.forEach(b=>{
    if(b.last_read&&b.last_read.startsWith(mk)&&b.reading_time){
      const day=b.last_read.slice(8,10);
      dayMap[day]=(dayMap[day]||0)+(b.reading_time||0);
    }
  });
  const maxMins=Math.max(1,...Object.values(dayMap));
  ['일','월','화','수','목','금','토'].forEach(d=>{
    const h=document.createElement('div');
    h.style.cssText='font-size:.5rem;color:var(--tx3);text-align:center;padding-bottom:2px;font-weight:600;';
    h.textContent=d; grid.appendChild(h);
  });
  for(let i=0;i<firstDay;i++){const e=document.createElement('div');grid.appendChild(e);}
  for(let d=1;d<=daysInMonth;d++){
    const ds=String(d).padStart(2,'0');
    const mins=dayMap[ds]||0;
    const intensity=mins===0?0:Math.min(4,Math.ceil((mins/maxMins)*4));
    const cell=document.createElement('div');
    cell.style.cssText='aspect-ratio:1;border-radius:2px;background:'+TRACKER_COLORS[intensity]+';display:flex;align-items:center;justify-content:center;cursor:default;position:relative;transition:transform .1s;';
    cell.title=(timerTrackM+1)+'/'+d+': '+(mins?mins+'분':'없음');
    const num=document.createElement('span');
    num.style.cssText='font-size:.48rem;line-height:1;color:'+(intensity>=2?'rgba(255,255,255,.9)':'#a08c72')+';';
    num.textContent=d; cell.appendChild(num);
    cell.onmouseenter=()=>cell.style.transform='scale(1.25)';
    cell.onmouseleave=()=>cell.style.transform='scale(1)';
    grid.appendChild(cell);
  }
  const totalMins=Object.values(dayMap).reduce((a,b)=>a+b,0);
  const monthLabel=document.getElementById('timer-month-label');
  if(monthLabel) monthLabel.textContent=timerTrackY+'년 '+(timerTrackM+1)+'월 — 총 '+Math.floor(totalMins/60)+'h '+totalMins%60+'m';
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
  const items=[
    {n:total,        l:'누적 완독',   sub:years.size?[...years].sort()[0]+'–현재':'전체'},
    {n:avg,          l:'평균 평점',   sub:avg+' / 5.0'},
    {n:Math.floor(totalMins/60)+'h', l:'총 독서 시간', sub:totalMins+'분'},
    {n:thisYear.length, l:'올해 완독', sub:new Date().getFullYear()+'년'},
    {n:allBooks.filter(b=>b.status==='읽는중').length, l:'읽는 중', sub:'권'},
    {n:allQuotes.length, l:'수집 문장', sub:'인상 깊은 구절'},
  ];
  items.forEach(it=>{const el=document.createElement('div');el.className='scard';el.innerHTML=`<div class="scard-n">${it.n}</div><div class="scard-l">${it.l}</div><div class="scard-sub">${it.sub}</div>`;sg.appendChild(el);});
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
  const aSorted=Object.entries(authorMap).sort((a,b)=>b[1]-a[1]);
  const pSorted=Object.entries(pubMap).sort((a,b)=>b[1]-a[1]);
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
    const bg=i===0?'#7a3e18':i===1?'#b07030':i===2?'#c4714a':'#c8a87a';
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
function buildPagesChart() {
  if(pagesChart){pagesChart.destroy();pagesChart=null;}
  const done=allBooks.filter(b=>b.status==='완독'&&b.date_finish&&b.pages);
  const years=[...new Set(done.map(b=>b.date_finish.slice(0,4)))].sort();
  const labels=years;
  const vals=years.map(y=>done.filter(b=>b.date_finish.startsWith(y)).reduce((a,b)=>a+(b.pages||0),0));
  const ctx=document.getElementById('chart-pages').getContext('2d');
  pagesChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[{label:'페이지',data:vals,backgroundColor:'rgba(176,112,48,0.75)',borderColor:'#b07030',borderWidth:1,borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'#faf6ef',borderColor:'#cfc3ac',borderWidth:1,titleColor:'#2e1f0e',bodyColor:'#5c3d1e',callbacks:{label:c=>' '+c.parsed.y.toLocaleString()+'p'}}},scales:{x:{grid:{display:false},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72'}},y:{grid:{color:'rgba(207,195,172,0.32)'},border:{dash:[3,3]},ticks:{font:{family:'Pretendard',size:10},color:'#a08c72'}}}}});
  const totalP=vals.reduce((a,b)=>a+b,0);
  document.getElementById('pages-stat').innerHTML=`<div class="si"><span class="sn">${totalP.toLocaleString()}p</span><span class="sl">누적 페이지</span></div><div class="si"><span class="sn">${vals.length>0?Math.round(totalP/vals.length).toLocaleString()+'p':'—'}</span><span class="sl">연평균</span></div>`;
}

function buildMilestone() {
  const done=allBooks.filter(b=>b.status==='완독');
  const total=done.length,years=new Set(done.map(b=>b.date_finish?.slice(0,4)).filter(Boolean));
  const yrs=years.size||1,totalMins=allBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const totalPages=done.reduce((a,b)=>a+(b.pages||0),0);
  const items=[
    {n:total,l:'총 완독 권수',prog:Math.min(total/200,1),target:'목표 200권'},
    {n:yrs+'년',l:'독서 기록 기간',prog:Math.min(yrs/10,1),target:'10년 독서가'},
    {n:Math.round(total/yrs*10)/10+'권',l:'연평균 독서량',prog:Math.min(total/yrs/20,1),target:'연 20권'},
    {n:Math.floor(totalMins/60)+'h',l:'총 독서 시간',prog:Math.min(totalMins/60/500,1),target:'500h 목표'},
    {n:totalPages.toLocaleString()+'p',l:'누적 페이지',prog:Math.min(totalPages/50000,1),target:'5만 페이지'},
    {n:done.filter(b=>b.rating>=4).length+'권',l:'★★★★ 이상',prog:Math.min(done.filter(b=>b.rating>=4).length/100,1),target:'명작 100권'},
  ];
  const g=document.getElementById('ms-grid');g.innerHTML='';
  items.forEach(it=>{const el=document.createElement('div');el.className='ms-card';el.innerHTML=`<div class="ms-n">${it.n}</div><div class="ms-l">${it.l}</div>`+(it.prog>0?`<div class="ms-prog"><div class="ms-prog-fill" style="width:${Math.round(it.prog*100)}%"></div></div><div class="ms-target">${it.target}</div>`:'');g.appendChild(el);});
}

// ── 목표
function loadGoals() {
  try { goals = JSON.parse(localStorage.getItem('bl_goals_'+currentUser.id)||'{}'); } catch(e){ goals={}; }
  goals = { books:0, minutes:0, pages:0, ...goals };
}
function openGoalModal() {
  document.getElementById('goal-books').value = goals.books||'';
  document.getElementById('goal-minutes').value = goals.minutes||'';
  document.getElementById('goal-pages').value = goals.pages||'';
  openModal('modal-goal');
}
function saveGoal() {
  goals.books   = parseInt(document.getElementById('goal-books').value)||0;
  goals.minutes = parseInt(document.getElementById('goal-minutes').value)||0;
  goals.pages   = parseInt(document.getElementById('goal-pages').value)||0;
  localStorage.setItem('bl_goals_'+currentUser.id, JSON.stringify(goals));
  closeModal('modal-goal');
  buildGoalDisplay();
}
function buildGoalDisplay() {
  const wrap=document.getElementById('goal-display'); if(!wrap) return;
  const done=allBooks.filter(b=>b.status==='완독');
  const thisYear=done.filter(b=>b.date_finish?.startsWith(String(new Date().getFullYear())));
  const totalMins=allBooks.reduce((a,b)=>a+(b.reading_time||0),0);
  const totalPages=done.reduce((a,b)=>a+(b.pages||0),0);
  const items=[];
  if(goals.books>0){const pct=Math.min(Math.round(thisYear.length/goals.books*100),100);items.push({label:'올해 독서 목표',cur:thisYear.length,goal:goals.books,pct,unit:'권'});}
  if(goals.minutes>0){const pct=Math.min(Math.round(totalMins/goals.minutes*100),100);items.push({label:'독서 시간 목표',cur:Math.floor(totalMins/60)+'h',goal:Math.floor(goals.minutes/60)+'h',pct,unit:''});}
  if(goals.pages>0){const pct=Math.min(Math.round(totalPages/goals.pages*100),100);items.push({label:'누적 페이지 목표',cur:totalPages.toLocaleString(),goal:goals.pages.toLocaleString(),pct,unit:'p'});}
  if(!items.length){wrap.innerHTML='<div style="font-size:.75rem;color:var(--tx3);">목표를 설정하면 진행률을 볼 수 있어요.</div>';return;}
  wrap.innerHTML=items.map(it=>`<div class="goal-item">
    <span class="goal-label">${it.label}</span>
    <div class="goal-bar-wrap">
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${it.pct}%;background:${it.pct>=100?'#7a9e7e':'var(--acc)'}"></div></div>
      <div class="goal-progress">${it.cur} / ${it.goal}${it.unit} (${it.pct}%)</div>
    </div>
    ${it.pct>=100?'<span class="goal-badge">🏅 달성!</span>':''}
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
  input.value='';buildCatList();buildCatFilterList();
  updateBookCategorySelect();
}
function deleteCategory(idx) {
  if(!confirm(`'${allCategories[idx]}' 카테고리를 삭제할까요?`))return;
  allCategories.splice(idx,1);
  localStorage.setItem('bl_cats_'+currentUser.id,JSON.stringify(allCategories));
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
      el.innerHTML=`${cover?`<img class="search-item-cover" src="${cover}" alt="${title}">`:'<div class="search-item-cover"></div>'}<div class="search-item-info"><div class="search-item-title">${title}</div><div class="search-item-author">${author}</div><div class="search-item-pub">${publisher}</div></div>`;
      el.onclick=()=>selectBook({title,author,publisher,cover,description:desc,isbn:item.isbn});
      res.appendChild(el);
    });
  } catch(e){res.innerHTML='<div style="font-size:.75rem;color:#c0392b;padding:.5rem;">검색 실패. 잠시 후 다시 시도해주세요.</div>';}
}
function selectBook(book) {
  selectedBook=book;
  document.getElementById('search-section').style.display='none';
  document.getElementById('book-form').style.display='';
  const coverHTML=book.cover?`<img class="selected-cover" src="${book.cover}" alt="${book.title}">`:`<div class="selected-cover" style="background:linear-gradient(150deg,#a07040,#5c3010);"></div>`;
  document.getElementById('selected-book-info').innerHTML=`${coverHTML}<div class="selected-info"><div class="selected-title">${book.title}</div><div class="selected-author">${book.author}</div><div class="selected-desc">${book.description||''}</div><span class="selected-change" onclick="changeBook()">다른 책 선택</span></div>`;
}
function changeBook() {
  selectedBook=null;document.getElementById('search-section').style.display='';
  document.getElementById('book-form').style.display='none';document.getElementById('search-results').innerHTML='';document.getElementById('book-search-input').value='';
}
function setStar(n){curRating=n;updateStars(n);}
function updateStars(n){document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('on',i<n));}
function setStatus(s,btn){curStatus=s;document.querySelectorAll('.status-btn').forEach(b=>b.classList.toggle('on',b===btn));}
function addQuoteField(text='',page='',comment='') {
  const list=document.getElementById('quotes-list');
  const el=document.createElement('div');el.className='quote-field';
  el.innerHTML=`<button class="quote-remove" onclick="this.parentElement.remove()">✕</button>
    <textarea class="form-input" placeholder="인상 깊은 문장을 입력하세요..." rows="2" data-qtext>${text}</textarea>
    <div class="quote-field-row">
      <input type="text" class="form-input" placeholder="코멘트 (느낀 점, 메모...)" data-qtag value="${comment}">
      <input type="text" class="form-input" placeholder="p.42" data-qpage value="${page}" style="max-width:80px;">
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
  document.getElementById('detail-title').textContent=b.title;
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
  let html=`<div class="detail-head">${coverHTML}<div style="flex:1;min-width:0;">
    <div class="detail-title">${b.title}</div>
    <div class="detail-sub">${b.author||''}${b.publisher?' · '+b.publisher:''}</div>
    <div class="detail-stars">${'★'.repeat(b.rating||0)+'☆'.repeat(5-(b.rating||0))}</div>
    <div class="detail-chips">
      ${genre?`<span class="detail-chip">${genre}</span>`:''}
      ${b.status?`<span class="detail-chip">${b.status}</span>`:''}
      ${b.date_finish?`<span class="detail-chip">${b.date_finish}</span>`:''}
      ${b.pages?`<span class="detail-chip">${b.pages}p</span>`:''}
      ${readingTime}
      ${b.source?`<span class="detail-chip">${b.source}</span>`:''}
      ${b.category?`<span class="detail-chip">📁 ${b.category}</span>`:''}
      ${b.reread?`<span class="detail-chip">다시 읽고 싶음</span>`:''}
    </div>
  </div></div>`;
  html+=descHTML;
  if(b.review)html+=`<div class="detail-sec">감상</div><div class="detail-body">${b.review}</div>`;
  if(quotes.length){
    html+=`<div class="detail-divhr"></div><div class="detail-sec">인상 깊은 문장</div>`;
    quotes.forEach(q=>{html+=`<div class="detail-quote">${q.text}<div class="detail-qsrc">${q.page?'p.'+q.page+' ':''}${q.tag?'💬 '+q.tag:''}</div></div>`;});
  }
  document.getElementById('detail-body').innerHTML=html;
  openModal('modal-detail');
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
    curRating=b.rating||0; curStatus=b.status||'완독'; updateStars(curRating);
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
  const{data:profile}=await sb.from('profiles').select('*').eq('id',currentUser.id).single();
  if(profile){const name=profile.display_name||profile.username||tempName;document.getElementById('profile-avatar').textContent=name.slice(0,1).toUpperCase();document.getElementById('profile-name').textContent=name;document.getElementById('profile-display-name').value=name;}
}
async function saveProfile() {
  const name=document.getElementById('profile-display-name').value.trim();if(!name)return;
  await sb.from('profiles').update({display_name:name}).eq('id',currentUser.id);closeModal('modal-profile');
}

// ── 모달 유틸
function openModal(id){document.getElementById(id).style.display='flex';}
function closeModal(id){document.getElementById(id).style.display='none';}
document.querySelectorAll('.modal-overlay').forEach(el=>{el.addEventListener('click',e=>{if(e.target===el)el.style.display='none';});});
