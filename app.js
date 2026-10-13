(function(){
'use strict';
const THEMES=[
  {id:'ink',name:'먹색',l:'#1A1A1A',d:'#3A3A35'},
  {id:'navy',name:'남색',l:'#23395B',d:'#2F4C78'},
  {id:'forest',name:'숲',l:'#2C5546',d:'#376B58'},
  {id:'brick',name:'벽돌',l:'#8A3A2B',d:'#9D4736'},
  {id:'gray',name:'회색',l:'#5C5F64',d:'#696C72'},
  {id:'earth',name:'흙',l:'#6B5230',d:'#7D623B'}
];
const SORTS=[{id:'near',name:'가까운 날짜순'},{id:'recent',name:'최근 추가순'},{id:'name',name:'이름순'}];
const WD=['일','월','화','수','목','금','토'];
const HOME_DAYS=30;
const $=id=>document.getElementById(id);

/* ---------- state ---------- */
let sb=null,me=null,access=null;          // me = {id,email,name}
let items=[],profiles={},members=[],myReminders=[];
let loaded=false;
let prefs={theme:'ink',sort:'near',pins:[],groups:[],groupOf:{},view:'home'};
let groupsOpen=true;
try{const c=JSON.parse(localStorage.getItem('dday-prefs')||'null');if(c)prefs=Object.assign(prefs,c);}catch(e){}
try{groupsOpen=localStorage.getItem('dday-groups-open')!=='0';}catch(e){}

/* ---------- dates ---------- */
const DAY=864e5;
const num=(y,m,d)=>Date.UTC(y,m-1,d)/DAY;
const leap=y=>(y%4===0&&y%100!==0)||y%400===0;
const occ=(y,m,d)=>(m===2&&d===29&&!leap(y))?num(y,2,28):num(y,m,d);
function todayNum(){const t=new Date();return num(t.getFullYear(),t.getMonth()+1,t.getDate());}
function localDayNum(ms){const t=new Date(ms);return num(t.getFullYear(),t.getMonth()+1,t.getDate());}
function parts(n){const t=new Date(n*DAY);return {y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate(),w:t.getUTCDay()};}
const pad=n=>String(n).padStart(2,'0');
function fmt(n){const p=parts(n);return p.y+'.'+pad(p.m)+'.'+pad(p.d)+' ('+WD[p.w]+')';}
function compute(it,T){
  const [y,m,d]=String(it.date||'').split('-').map(Number);
  if(!y||!m||!d) return null;
  const base=num(y,m,d);
  if(it.mode==='count'){
    if(base>T) return {target:base,diff:base-T,label:'D-'+(base-T).toLocaleString(),upcoming:true};
    const n=T-base+1;
    return {target:base,diff:-(n-1),label:'+'+n.toLocaleString(),upcoming:false,count:true};
  }
  let target=base,prev=null;
  if(it.repeat&&base<T){
    const ty=parts(T).y;
    target=occ(ty,m,d); if(target<T) target=occ(ty+1,m,d);
    const pv=occ(parts(target).y-1,m,d); prev=pv>=base?pv:null;
  }
  const diff=target-T;
  const label=diff===0?'D-DAY':diff>0?'D-'+diff.toLocaleString():'D+'+(-diff).toLocaleString();
  return {target,diff,prev,label,upcoming:diff>=0};
}

/* ---------- prefs / theme ---------- */
function applyTheme(){
  const t=THEMES.find(x=>x.id===prefs.theme)||THEMES[0];
  const r=document.documentElement.style;
  r.setProperty('--theme-l',t.l); r.setProperty('--theme-d',t.d);
}
let prefsTimer=null;
function savePrefs(){
  try{localStorage.setItem('dday-prefs',JSON.stringify(prefs));}catch(e){}
  if(!sb||!me) return;
  clearTimeout(prefsTimer);
  prefsTimer=setTimeout(async()=>{
    const p={theme:prefs.theme,listBars:!!prefs.listBars,sort:prefs.sort,pins:pinList(),groups:prefs.groups||[],groupOf:prefs.groupOf||{},view:prefs.view||'home',remindTime:prefs.remindTime||'09:00'};
    await sb.from('user_prefs').upsert({user_id:me.id,prefs:p,updated_at:new Date().toISOString()});
  },400);
}
const MAX_PINS=3;
let pinSlide=0;
function pinList(){
  let a=Array.isArray(prefs.pins)?prefs.pins.slice():[];
  if(!a.length&&prefs.pinned) a=[prefs.pinned];   // 예전 1개 고정 설정 옮기기
  return a.filter((x,i)=>x&&a.indexOf(x)===i).slice(0,MAX_PINS);
}
function isPinned(id){return pinList().includes(id);}
function setPinned(id,on){
  let a=pinList().filter(x=>x!==id);
  if(on) a.push(id);
  prefs.pins=a.slice(0,MAX_PINS);delete prefs.pinned;
}
function groupById(id){return (prefs.groups||[]).find(g=>g.id===id)||null;}
function groupOfItem(id){const g=(prefs.groupOf||{})[id];return g&&groupById(g)?g:null;}

/* ---------- helpers ---------- */
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  for(const k in attrs||{}){
    const v=attrs[k];
    if(k==='class') el.className=v;
    else if(k==='text') el.textContent=v;
    else if(k.startsWith('on')) el.addEventListener(k.slice(2),v);
    else if(v===true) el.setAttribute(k,'');
    else if(v!==false&&v!=null) el.setAttribute(k,v);
  }
  for(const c of kids.flat()) if(c!=null) el.append(c);
  return el;
}
function svg(markup){const t=document.createElement('template');t.innerHTML=markup;return t.content.firstChild;}
const REPEAT_ICON='<svg aria-label="매년 반복" role="img" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
const BELL_ICON='<svg aria-label="알림 있음" role="img" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
function hasAlarm(id){return myReminders.some(r=>r.dday_id===id&&r.next_at);}
const PIN_ICON='<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg>';
const PEOPLE_ICON='<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>';
const ICON=(d,s)=>'<svg aria-hidden="true" width="'+(s||20)+'" height="'+(s||20)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
const HOME_ICON=ICON('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>');
const ALL_ICON=ICON('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6" fill="currentColor"/><circle cx="4" cy="12" r=".6" fill="currentColor"/><circle cx="4" cy="18" r=".6" fill="currentColor"/>');
const FOLDER_ICON=ICON('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
const CHEV_ICON='<svg class="chev" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const CLOSE_ICON=ICON('<path d="M6 6l12 12M18 6L6 18"/>',22);
const GEAR_ICON=ICON('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',15);
const LOGOUT_ICON=ICON('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',20);
function personIcon(){return h('span',{class:'avatar'},svg('<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'));}
function nameOf(id){
  if(me&&id===me.id) return '나';
  const p=profiles[id];
  return p?(p.name||p.email):'함께 쓰는 사람';
}
function sharedTag(it){
  if(!it.shares.length) return null;
  const n=it.shares.length+1;
  return h('span',{class:'shared-tag','aria-label':n+'명이 함께 보는 디데이'},svg(PEOPLE_ICON),String(n));
}
let toastTimer;
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,2600);}
function errMsg(){return '저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';}
function newId(){return 'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const x=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
  return x.slice(0,8)+'-'+x.slice(8,12)+'-'+x.slice(12,16)+'-'+x.slice(16,20)+'-'+x.slice(20);
}
async function must(p){const r=await p;if(r.error)throw r.error;return r.data;}

/* ---------- data ---------- */
async function fetchAll(){
  const [d,p,m,rm]=await Promise.all([
    sb.from('ddays').select('id,owner,title,date,mode,repeat,created_at,updated_at,updated_by,dday_shares(user_id)'),
    sb.from('profiles').select('id,email,name'),
    sb.from('members').select('email,is_admin,created_at').order('created_at'),
    sb.from('reminders').select('id,dday_id,kind,remind_time,custom_at,next_at')
  ]);
  if(d.error) throw d.error;
  items=(d.data||[]).map(r=>({
    id:r.id,owner:r.owner,title:r.title,date:r.date,mode:r.mode,repeat:r.repeat,
    createdAt:Date.parse(r.created_at)||0,updatedBy:r.updated_by,
    shares:(r.dday_shares||[]).map(s=>s.user_id)
  }));
  profiles={};(p.data||[]).forEach(x=>profiles[x.id]=x);
  members=m.data||[];
  myReminders=rm.error?[]:(rm.data||[]);
  loaded=true;
}
let refetchTimer=null;
function refetch(){
  clearTimeout(refetchTimer);
  refetchTimer=setTimeout(async()=>{
    try{await fetchAll();$('notice').hidden=true;$('addBtn').disabled=false;}
    catch(e){showNotice('디데이를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');}
    render();
  },250);
}
function showNotice(msg){const n=$('notice');n.textContent=msg;n.hidden=false;}

/* ---------- render ---------- */
let lastDay=todayNum();
function currentView(){
  const v=prefs.view||'home';
  if(v.startsWith('g:')&&!groupById(v.slice(2))) return 'all';
  return v;
}
function sortRows(rows){
  const s=prefs.sort;
  return rows.sort((a,b)=>{
    if(s==='name') return String(a.it.title).localeCompare(String(b.it.title),'ko');
    if(s==='recent') return (b.it.createdAt||0)-(a.it.createdAt||0);
    const ka=a.c.upcoming?0:1, kb=b.c.upcoming?0:1;
    if(ka!==kb) return ka-kb;
    return ka===0?a.c.diff-b.c.diff:b.c.target-a.c.target;
  });
}
// 진행 막대 비율: D-day는 등록일(반복이면 지난번 그날)부터 당일까지, +1일부터는 다음 100일 단위까지
function progressOf(it,c,T){
  if(c.count){const n=T-(c.target)+1;return ((n-1)%100+1)/100;}
  if(c.diff===0) return 1;
  if(c.diff<0) return null;
  const start=c.prev!=null?c.prev:Math.min(localDayNum(it.createdAt||Date.now()),T);
  const span=c.target-start;
  return span>0?Math.max(0,Math.min(1,(T-start)/span)):0;
}
function rowEl({it,c},showPin){
  const r=prefs.listBars?progressOf(it,c,todayNum()):null;
  return h('li',{class:(!c.upcoming&&!c.count)?'past':''},
    h('button',{class:'row',onclick:()=>openEdit(it)},
      h('div',{class:'info'},
        h('div',{class:'t',text:it.title}),
        h('div',{class:'m'},showPin&&isPinned(it.id)?svg(PIN_ICON):null,(c.count?'시작 ':'')+fmt(c.target),it.repeat&&!c.count?svg(REPEAT_ICON):null,hasAlarm(it.id)?svg(BELL_ICON):null,sharedTag(it))),
      h('span',{class:'v num',text:c.label}),
      r!=null?h('div',{class:'row-bar','aria-hidden':'true'},h('i',{style:'width:'+(r*100).toFixed(1)+'%'})):null));
}
function render(){
  const T=todayNum(); lastDay=T;
  const p=parts(T);
  $('today').textContent=p.y+'년 '+p.m+'월 '+p.d+'일 '+WD[p.w]+'요일';

  const view=currentView();
  const rows=items.map(it=>({it,c:compute(it,T)})).filter(r=>r.c);
  const slot=$('pinnedSlot'); slot.replaceChildren();
  let listRows,headText,emptyText;

  if(view==='home'){
    $('viewTitle').textContent='홈';
    const pinnedRows=pinList().map(id=>rows.find(r=>r.it.id===id)).filter(Boolean);
    if(pinnedRows.length){
      const cards=pinnedRows.map(({it,c},i)=>{
        let bar=null;
        if(!c.count&&c.diff>0){
          const start=c.prev!=null?c.prev:Math.min(localDayNum(it.createdAt||Date.now()),T);
          const span=c.target-start;
          if(span>0){const r=Math.max(0,Math.min(1,(T-start)/span));bar=h('div',{class:'bar'},h('i',{style:'width:'+(r*100).toFixed(1)+'%'}));}
        }
        return h('button',{class:'pinned','aria-label':(pinnedRows.length>1?(i+1)+'번째 고정, ':'')+it.title+' '+c.label+', 수정하기',onclick:()=>openEdit(it)},
          h('div',{class:'top'},h('span',{},svg(PIN_ICON),'고정됨',sharedTag(it)),h('span',{},it.repeat&&!c.count?svg(REPEAT_ICON):null,(c.count?'시작 ':'')+fmt(c.target))),
          h('div',{},h('div',{class:'name',text:it.title}),h('div',{class:'big num',text:c.label})),
          bar);
      });
      const track=h('div',{class:'pin-track'},cards);
      slot.append(track);
      if(cards.length>1){
        const dots=h('div',{class:'pin-dots',role:'tablist','aria-label':'고정한 디데이'},cards.map((_,i)=>h('button',{class:'pin-dot',type:'button',role:'tab','aria-label':(i+1)+'번째 고정 디데이',onclick:()=>track.scrollTo({left:i*track.clientWidth,behavior:'smooth'})})));
        slot.append(dots);
        const mark=()=>{
          const i=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));
          pinSlide=Math.max(0,Math.min(cards.length-1,i));
          dots.querySelectorAll('.pin-dot').forEach((d,k)=>{d.classList.toggle('on',k===pinSlide);d.setAttribute('aria-selected',String(k===pinSlide));});
        };
        track.addEventListener('scroll',()=>{cancelAnimationFrame(track._raf);track._raf=requestAnimationFrame(mark);},{passive:true});
        const keep=Math.min(pinSlide,cards.length-1);
        requestAnimationFrame(()=>{track.scrollLeft=keep*track.clientWidth;mark();});
        mark();
      }
    }
    const pinnedSet=new Set(pinnedRows);
    listRows=rows.filter(r=>!pinnedSet.has(r)&&r.c.upcoming&&r.c.diff<=HOME_DAYS).sort((a,b)=>a.c.diff-b.c.diff);
    headText=HOME_DAYS+'일 안에 다가오는 디데이 · '+listRows.length+'개';
    emptyText=rows.length?HOME_DAYS+'일 안에 다가오는 디데이가 없어요.\n메뉴의 전체보기에서 모든 디데이를 볼 수 있어요.':null;
  }else if(view==='none'){
    $('viewTitle').textContent='그룹 미지정';
    listRows=sortRows(rows.filter(r=>!groupOfItem(r.it.id)));
    headText=(SORTS.find(x=>x.id===prefs.sort)||SORTS[0]).name+' · '+listRows.length+'개';
    emptyText=rows.length?'그룹 미지정 디데이가 없어요.':null;
  }else if(view==='all'){
    $('viewTitle').textContent='전체보기';
    listRows=sortRows(rows.slice());
    headText=(SORTS.find(x=>x.id===prefs.sort)||SORTS[0]).name+' · '+listRows.length+'개';
  }else{
    const g=groupById(view.slice(2));
    $('viewTitle').textContent=g.name;
    listRows=sortRows(rows.filter(r=>groupOfItem(r.it.id)===g.id));
    headText=(SORTS.find(x=>x.id===prefs.sort)||SORTS[0]).name+' · '+listRows.length+'개';
    emptyText=rows.length?'이 그룹에 디데이가 없어요.':null;
  }

  $('list').replaceChildren(...listRows.map(r=>rowEl(r,view!=='home')));
  $('listHead').hidden=!listRows.length;
  $('countLabel').textContent=headText;
  $('sortBtn').hidden=view==='home';
  const empty=$('empty');
  if(!loaded){empty.hidden=false;empty.textContent='디데이 목록을 불러오는 중이에요.';}
  else if(!rows.length){empty.hidden=false;empty.textContent='아직 디데이가 없어요.\n아래 + 버튼으로 첫 디데이를 추가해 보세요.';}
  else if(!listRows.length&&emptyText){empty.hidden=false;empty.textContent=emptyText;}
  else empty.hidden=true;
  $('peopleBtn').hidden=!access;
  if(!$('drawer').hidden) renderDrawer();
}

/* ---------- menu tree ---------- */
function setView(v){prefs.view=v;savePrefs();closeDrawer();render();window.scrollTo(0,0);}
function renderDrawer(){
  const view=currentView();
  const countIn=gid=>items.filter(it=>groupOfItem(it.id)===gid).length;
  const nav=(v,icon,label,cnt)=>h('button',{class:'nav-item','aria-current':view===v?'page':null,onclick:()=>setView(v)},svg(icon),h('span',{class:'label',text:label}),cnt!=null?h('span',{class:'cnt',text:String(cnt)}):null);

  const toggle=h('button',{class:'nav-item nav-tree-toggle','aria-expanded':String(groupsOpen),'aria-controls':'navGroups',onclick:()=>{
    groupsOpen=!groupsOpen;try{localStorage.setItem('dday-groups-open',groupsOpen?'1':'0');}catch(e){}renderDrawer();
  }},svg(FOLDER_ICON),h('span',{class:'label',text:'그룹'}),svg(CHEV_ICON));

  const addInput=h('input',{class:'input',type:'text',id:'nav-new-group',maxlength:'20',placeholder:'새 그룹 이름',autocomplete:'off','aria-label':'새 그룹 이름'});
  const addForm=h('form',{class:'nav-add',onsubmit:e=>{
    e.preventDefault();const name=addInput.value.trim();if(!name)return;
    prefs.groups=(prefs.groups||[]).concat([{id:newId(),name}]);savePrefs();addInput.value='';renderDrawer();toast('그룹을 만들었어요.');
  }},addInput,h('button',{type:'submit','aria-label':'그룹 추가',title:'그룹 추가'},svg('<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>')));

  const sub=h('div',{class:'nav-sub',id:'navGroups',hidden:!groupsOpen},
    (prefs.groups||[]).map(g=>nav('g:'+g.id,ICON('<circle cx="12" cy="12" r="2.2" fill="currentColor"/>',16),g.name,countIn(g.id))),
    (prefs.groups||[]).length?null:h('p',{class:'nav-muted',text:'아직 그룹이 없어요.',style:'margin:8px 12px'}),
    (()=>{const n=items.filter(it=>!groupOfItem(it.id)).length;
      return (n||view==='none')?h('button',{class:'nav-item nav-ungrouped','aria-current':view==='none'?'page':null,onclick:()=>setView('none')},svg(ICON('<circle cx="12" cy="12" r="2.4" stroke-width="1.4"/>',16)),h('span',{class:'label',text:'그룹 미지정'}),h('span',{class:'cnt',text:String(n)})):null;})(),
    addForm,
    (prefs.groups||[]).length?h('button',{class:'nav-item nav-manage',onclick:()=>{closeDrawer();openGroupManager();}},svg(GEAR_ICON),h('span',{class:'label',text:'그룹 관리'})):null);

  $('drawer').replaceChildren(
    h('div',{class:'drawer-head'},h('span',{text:'메뉴'}),h('button',{class:'icon-btn','aria-label':'메뉴 닫기',onclick:closeDrawer},svg(CLOSE_ICON))),
    nav('home',HOME_ICON,'홈'),
    nav('all',ALL_ICON,'전체보기',items.length),
    toggle,sub,
    h('div',{class:'drawer-foot'},
      h('span',{class:'me',text:me?me.email:''}),
      h('button',{class:'logout',type:'button','aria-label':'로그아웃',title:'로그아웃',onclick:logout},svg(LOGOUT_ICON))));
}
function openDrawer(){renderDrawer();$('drawer').hidden=false;$('drawerScrim').hidden=false;$('menuBtn').setAttribute('aria-expanded','true');$('menuBtn').setAttribute('aria-label','메뉴 닫기');}
function closeDrawer(){if($('drawer').hidden)return;$('drawer').hidden=true;$('drawerScrim').hidden=true;$('menuBtn').setAttribute('aria-expanded','false');$('menuBtn').setAttribute('aria-label','메뉴 열기');}
$('menuBtn').addEventListener('click',()=>{$('drawer').hidden?openDrawer():closeDrawer();});
$('drawerScrim').addEventListener('click',closeDrawer);

function openGroupManager(){
  const rowsEls=(prefs.groups||[]).map(g=>{
    const inp=h('input',{class:'input',type:'text',id:'gm-'+g.id,maxlength:'20',value:g.name,'aria-label':'그룹 이름'});
    let armed=false;
    const del=h('button',{class:'btn danger',type:'button',text:'삭제',onclick:()=>{
      if(!armed){armed=true;del.textContent='한 번 더';return;}
      prefs.groups=prefs.groups.filter(x=>x.id!==g.id);
      for(const k in prefs.groupOf) if(prefs.groupOf[k]===g.id) delete prefs.groupOf[k];
      if(prefs.view==='g:'+g.id) prefs.view='all';
      savePrefs();render();openGroupManager();toast('그룹을 삭제했어요. 안에 있던 디데이는 그대로 남아 있어요.');
    }});
    return {g,inp,el:h('div',{class:'group-row'},inp,del)};
  });
  const form=h('form',{style:'display:flex;flex-direction:column;gap:14px',onsubmit:e=>{
    e.preventDefault();
    for(const r of rowsEls){const n=r.inp.value.trim();if(n) r.g.name=n;}
    savePrefs();closeSheet();render();toast('저장했어요.');
  }},
    rowsEls.length?rowsEls.map(r=>r.el):h('p',{class:'hint',text:'그룹이 없어요. 메뉴에서 새 그룹을 만들어 보세요.'}),
    h('p',{class:'hint',text:'그룹은 나에게만 보이고, 그룹을 지워도 디데이는 지워지지 않아요.'}),
    h('div',{class:'actions'},h('button',{class:'btn ghost',type:'button',text:'닫기',onclick:closeSheet}),rowsEls.length?h('button',{class:'btn primary',type:'submit',text:'저장'}):null));
  openSheet('그룹 관리',form);
}

/* ---------- sheets ---------- */
function openSheet(title,...content){
  const sheet=$('sheet');
  sheet.style.transition='';sheet.style.transform='';
  const top=h('div',{class:'sheet-top'},h('div',{class:'grip','aria-hidden':'true'}),h('h2',{id:'sheetTitle',text:title}));
  sheet.replaceChildren(top,...content);
  sheet.scrollTop=0;
  dragToClose(top,sheet);
  $('scrim').hidden=false;
}
function closeSheet(){
  $('scrim').hidden=true;
  const sheet=$('sheet');sheet.style.transition='';sheet.style.transform='';
}
// 창 맨 위(손잡이·제목)를 잡고 아래로 내리면 닫기
function dragToClose(handle,sheet){
  let y0=null,dy=0,t0=0,id=null;
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0) return;
    y0=e.clientY;dy=0;t0=Date.now();id=e.pointerId;
    try{handle.setPointerCapture(id);}catch(x){}
    sheet.style.transition='none';
  });
  handle.addEventListener('pointermove',e=>{
    if(y0==null||e.pointerId!==id) return;
    dy=Math.max(0,e.clientY-y0);
    sheet.style.transform='translateY('+dy+'px)';
  });
  const end=e=>{
    if(y0==null||(e&&e.pointerId!==id)) return;
    const speed=dy/Math.max(1,Date.now()-t0);
    y0=null;
    sheet.style.transition='transform .2s ease-out';
    if(dy>110||(dy>30&&speed>0.6)){
      sheet.style.transform='translateY(100%)';
      setTimeout(closeSheet,190);
    }else sheet.style.transform='';
  };
  handle.addEventListener('pointerup',end);
  handle.addEventListener('pointercancel',end);
}
$('scrim').addEventListener('click',e=>{if(e.target===$('scrim'))closeSheet();});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('scrim').hidden)closeSheet();else closeDrawer();});

function shareSection(it){
  const owner=!it||it.owner===me.id;
  if(!owner){
    const ids=[it.owner].concat(it.shares).filter(x=>x!==me.id);
    return {selected:()=>null,el:h('div',{class:'field'},h('span',{text:'함께 보는 사람'}),
      h('div',{},ids.map(id=>h('div',{class:'member'},personIcon(),h('span',{text:nameOf(id)+(id===it.owner?' · 만든 사람':'')})))),
      h('p',{class:'hint',text:'함께 볼 사람은 이 디데이를 만든 사람만 바꿀 수 있어요.'}))};
  }
  const current=new Set(it?it.shares:[]);
  const memberEmails=new Set(members.map(m=>m.email));
  const others=Object.values(profiles).filter(p=>p.id!==me.id&&memberEmails.has(String(p.email).toLowerCase())).map(p=>p.id);
  for(const id of current) if(!others.includes(id)) others.push(id);
  const boxes=others.map(id=>{
    const box=h('input',{type:'checkbox',id:'share-'+id,checked:current.has(id)});
    return {id,box,el:h('label',{class:'member',for:'share-'+id},h('span',{},personIcon(),nameOf(id)),box)};
  });
  return {selected:()=>boxes.filter(b=>b.box.checked).map(b=>b.id),
    el:h('div',{class:'field'},h('span',{text:'함께 볼 사람'}),
      boxes.length?h('div',{},boxes.map(b=>b.el)):null,
      h('p',{class:'hint',text:boxes.length?'아무도 고르지 않으면 나만 볼 수 있어요. 고른 사람은 날짜를 함께 고칠 수 있어요.':'아직 고를 수 있는 사람이 없어요. 초대한 사람이 한 번 로그인하면 여기에 나타나요.'}))};
}

/* ---------- 날짜·시각 입력칸 ---------- */
// PC(마우스)에서는 칸 어디를 눌러도 달력/시계가 열리게. 폰은 원래 칸 전체가 선택창을 열어요.
function pickerOnClick(input){
  if(typeof input.showPicker==='function'&&window.matchMedia&&matchMedia('(pointer: fine)').matches){
    input.addEventListener('mousedown',e=>{e.preventDefault();input.focus({preventScroll:true});try{input.showPicker();}catch(x){}});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();try{input.showPicker();}catch(x){}}});
  }
}
function dateField(id,value,label){
  const input=h('input',{class:'input',type:'date',id,value:value||'','aria-label':label||null});
  const wrap=h('div',{class:'date-wrap'},input,h('span',{class:'date-ph','aria-hidden':'true',text:'YYYY-MM-DD'}));
  const sync=()=>wrap.classList.toggle('is-empty',!input.value);
  ['input','change','blur'].forEach(ev=>input.addEventListener(ev,sync));sync();
  pickerOnClick(input);
  return {input,wrap};
}
function timeField(id,value,label){
  const input=h('input',{class:'input',type:'time',id,value:value||'09:00',step:'60','aria-label':label||null});
  pickerOnClick(input);
  return input;
}

/* ---------- 알림 ---------- */
const KINDS=[{id:'day0',name:'당일',off:0},{id:'day1',name:'하루 전',off:1},{id:'day7',name:'일주일 전',off:7}];
const kstFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'});
const kstYear=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric'});
function fmtWhen(ms){
  const s=kstFmt.format(new Date(ms));
  const y=kstYear.format(new Date(ms)),ny=kstYear.format(new Date());
  return (y!==ny?y+' ':'')+s;
}
function kstMs(dayN,hhmm){const [hh,mm]=String(hhmm||'09:00').split(':').map(Number);return dayN*DAY+((hh-9)*60+mm)*60000;}
function kstDayOf(ms){const t=new Date(ms+9*3600000);return num(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());}
// 서버(reminder_next_at)와 같은 규칙으로 다음 알림 시각을 계산
function nextFire(f,off,hhmm,now){
  const [y,m,d]=String(f.date||'').split('-').map(Number);
  if(!y||!m||!d) return null;
  const base=num(y,m,d);
  if(f.mode==='dday'&&f.repeat){
    const ty=new Date(now+9*3600000).getUTCFullYear()-1;
    for(let i=0;i<4;i++){const t=occ(ty+i,m,d);if(t<base)continue;const c=kstMs(t-off,hhmm);if(c>now)return c;}
    return null;
  }
  const c=kstMs(base-off,hhmm);return c>now?c:null;
}
function customMs(dateStr,hhmm){
  const [y,m,d]=String(dateStr||'').split('-').map(Number);
  if(!y||!m||!d) return null;
  return kstMs(num(y,m,d),hhmm);
}

function pushSupported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;}
function isIOS(){return /iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
function isStandalone(){return (window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;}
function b64ToBytes(s){const p='='.repeat((4-s.length%4)%4);const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0));}
async function pushState(){
  if(!pushSupported()) return isIOS()&&!isStandalone()?'need-install':'unsupported';
  if(Notification.permission==='denied') return 'denied';
  try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();return sub&&Notification.permission==='granted'?'on':'off';}
  catch(e){return 'off';}
}
async function registerSub(sub){
  const j=sub.toJSON();
  await must(sb.rpc('register_push',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth}));
}
async function enablePush(){
  const key=(window.DDAY_CONFIG||{}).VAPID_PUBLIC_KEY;
  if(!key) throw new Error('no key');
  const perm=await Notification.requestPermission();
  if(perm!=='granted') return 'denied';
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(key)});
  await registerSub(sub);
  try{await reg.showNotification('알림이 켜졌어요',{body:'정한 시각에 이 기기로 디데이 알림이 와요.',icon:'icons/icon-192.png',tag:'dday-enabled'});}catch(e){}
  return 'on';
}
async function refreshPushRegistration(){
  if(!pushSupported()||Notification.permission!=='granted') return;
  try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub) await registerSub(sub);}catch(e){}
}

function ampmText(hhmm){
  const [hh,mm]=String(hhmm||'09:00').split(':').map(Number);
  const h12=hh%12===0?12:hh%12;
  return (hh<12?'오전 ':'오후 ')+pad(h12)+':'+pad(mm);
}
function dayStr(n){const t=new Date(n*DAY);return t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());}
function reminderSection(it,getFields){
  const mine=it?myReminders.filter(r=>r.dday_id===it.id):[];
  const cur=mine[0]||null;
  let initDate='',initTime=prefs.remindTime||'09:00';
  if(cur&&cur.kind==='custom'&&cur.custom_at){
    const t=new Date(new Date(cur.custom_at).getTime()+9*3600000);
    initDate=t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());initTime=pad(t.getUTCHours())+':'+pad(t.getUTCMinutes());
  }else if(cur&&cur.next_at){
    initDate=dayStr(kstDayOf(Date.parse(cur.next_at)));initTime=String(cur.remind_time||initTime).slice(0,5);
  }
  const df=dateField('r-date',initDate,'알림 날짜');
  const time=timeField('r-time',initTime,'알림 시각');
  const chipsBox=h('div',{class:'chips',role:'group','aria-label':'알림 날짜 빠르게 고르기'});
  const guide=h('p',{class:'rem-guide','aria-live':'polite'});
  const body=h('div',{class:'rem-body'});
  const sw=h('input',{type:'checkbox',role:'switch',id:'r-on',class:'switch',checked:!!cur,'aria-label':'알림 설정'});
  sw.addEventListener('change',()=>{refresh();drawStatus();});

  // 세는 방법에 따라 버튼이 바뀜
  function chipDefs(f){
    const [y,m,d]=String(f.date||'').split('-').map(Number);
    if(!y) return [];
    const base=num(y,m,d),T=todayNum();
    if(f.mode==='count'){
      // 이미 지난 단위면 다음 단위로 (+100 → +200 …, +1000 → +2000 …)
      const n=Math.max(1,T-base+1);
      const next=step=>{let k=Math.ceil(n/step)*step;if(k<=n&&base+k-1<=T)k+=step;if(base+k-1<T)k+=step;return k;};
      const k100=next(100),k1000=next(1000);
      return [{id:'c100',name:'+'+k100,day:base+k100-1},{id:'c1000',name:'+'+k1000,day:base+k1000-1}];
    }
    const c=compute(f,T);
    const target=c&&c.upcoming?c.target:base;
    return KINDS.map(k=>({id:k.id,name:k.name,day:target-k.off}));
  }
  let chips=[];
  function drawChips(){
    const f=getFields();chips=chipDefs(f);
    const T=todayNum();
    chipsBox.replaceChildren(...chips.map(c=>{
      const past=c.day<T;
      const on=df.input.value===dayStr(c.day);
      return h('button',{class:'chip'+(on?' on':''),type:'button','aria-pressed':String(on),disabled:past,
        onclick:()=>{if(!sw.checked)return;df.input.value=dayStr(c.day);df.input.dispatchEvent(new Event('change'));refresh();}},c.name);
    }));
    chipsBox.hidden=!chips.length;
  }
  function refresh(){
    drawChips();
    const f=getFields();
    const on=sw.checked;
    body.classList.toggle('off',!on);
    df.input.disabled=!on;time.disabled=!on;
    chipsBox.querySelectorAll('button').forEach(b=>{if(!on)b.disabled=true;});
    if(!on){guide.textContent='알림이 꺼져 있어요';return;}
    if(!f.date){guide.textContent='디데이 날짜를 먼저 골라 주세요';return;}
    const ms=customMs(df.input.value,time.value);
    if(!ms){guide.textContent='알림 날짜를 고르거나 위 버튼을 눌러 주세요';return;}
    const c=compute({date:f.date,mode:f.mode,repeat:f.repeat},kstDayOf(ms));
    const lab=c?(f.mode==='count'&&c.count?'D'+c.label:c.label):'';
    const p=parts(kstDayOf(ms));
    const when=p.m+'월 '+p.d+'일 ('+WD[p.w]+') '+ampmText(time.value);
    guide.textContent=(lab?'('+lab+') ':'')+when+(ms>Date.now()?'에 울려요':' · 지난 시각이라 울리지 않아요');
  }
  [df.input,time].forEach(x=>{x.addEventListener('change',refresh);x.addEventListener('input',refresh);});

  const status=h('div',{class:'push-status'});
  async function drawStatus(){
    status.replaceChildren();
    if(!sw.checked) return;
    const st=await pushState();
    status.replaceChildren();
    if(st==='on'){status.append(h('p',{class:'hint',text:'이 기기에서 알림이 켜져 있어요.'}));return;}
    if(st==='need-install'){status.append(h('p',{class:'hint',text:'아이폰은 Safari에서 홈 화면에 추가한 앱으로 열어야 알림을 켤 수 있어요.'}));return;}
    if(st==='unsupported'){status.append(h('p',{class:'hint',text:'이 브라우저는 알림을 지원하지 않아요.'}));return;}
    if(st==='denied'){status.append(h('p',{class:'hint',text:'이 기기에서 알림이 꺼져 있어요. 기기 설정에서 이 앱의 알림을 허용해 주세요.'}));return;}
    const btn=h('button',{class:'btn ghost push-on',type:'button',text:'이 기기에서 알림 켜기',onclick:async()=>{
      btn.disabled=true;
      try{const r=await enablePush();if(r==='denied')toast('알림이 허용되지 않았어요.');}
      catch(e){toast('알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.');}
      drawStatus();
    }});
    status.append(btn,h('p',{class:'hint',text:'알림을 받으려면 기기마다 한 번 켜 주세요.'}));
  }
  drawStatus();

  body.append(h('div',{class:'rem-inputs'},df.wrap,time),chipsBox,guide);
  const el=h('div',{class:'field rem-section'},h('span',{text:'알림 (나에게만)'}),
    h('label',{class:'rem-switch-row',for:'r-on'},h('span',{text:'알림 설정'}),sw),
    body,
    status);

  function desired(){
    if(!sw.checked) return [];
    const ms=customMs(df.input.value,time.value);
    if(!ms) return [];
    const f=getFields();
    // D-day 방식에서 당일·하루 전·일주일 전을 고르면 매년 반복 디데이도 해마다 울리게 종류로 저장
    if(f.mode==='dday'){
      const hit=chips.find(c=>KINDS.some(k=>k.id===c.id)&&df.input.value===dayStr(c.day));
      if(hit) return [{kind:hit.id,remind_time:time.value||'09:00'}];
    }
    return [{kind:'custom',custom_at:new Date(ms).toISOString()}];
  }
  return {el,refresh,desired,time:()=>time.value};
}
async function saveReminders(ddayId,list){
  const before=myReminders.filter(r=>r.dday_id===ddayId);
  if(before.length) await must(sb.from('reminders').delete().eq('dday_id',ddayId).eq('user_id',me.id));
  if(list.length) await must(sb.from('reminders').insert(list.map(r=>Object.assign({dday_id:ddayId,user_id:me.id},r))));
}

function openEdit(it){
  const isNew=!it;
  const v=it||{title:'',date:'',mode:'dday',repeat:false};
  const title=h('input',{class:'input',type:'text',id:'f-title',maxlength:'30',placeholder:'예: 제주 여행',value:v.title,autocomplete:'off'});
  const {input:date,wrap:dateWrap}=dateField('f-date',v.date);
  const modeD=h('input',{type:'radio',name:'mode',id:'f-mode-d',value:'dday',checked:v.mode!=='count'});
  const modeC=h('input',{type:'radio',name:'mode',id:'f-mode-c',value:'count',checked:v.mode==='count'});
  const repeat=h('input',{type:'checkbox',id:'f-repeat',checked:!!v.repeat});
  const livePins=pinList().filter(id=>items.some(x=>x.id===id));
  const pin=h('input',{type:'checkbox',id:'f-pin',checked:isNew?livePins.length===0:isPinned(it.id)});
  const pinNote=h('small',{class:'sub',text:''});
  const pinFull=()=>!pin.checked&&livePins.filter(id=>!it||id!==it.id).length>=MAX_PINS;
  const syncPin=()=>{const n=livePins.filter(id=>!it||id!==it.id).length+(pin.checked?1:0);pinNote.textContent=pinFull()?'고정은 3개까지예요. 다른 고정을 먼저 풀어 주세요':'고정 '+n+' / '+MAX_PINS;pin.disabled=pinFull();};
  pin.addEventListener('change',syncPin);syncPin();
  const view=currentView();
  const curGroup=isNew?(view.startsWith('g:')?view.slice(2):''):(groupOfItem(it.id)||'');
  const group=h('select',{class:'input',id:'f-group'},
    h('option',{value:'',text:'그룹 없음'}),
    (prefs.groups||[]).map(g=>h('option',{value:g.id,text:g.name,selected:g.id===curGroup})));
  const repeatRow=h('label',{class:'toggle',for:'f-repeat'},h('span',{text:'매년 반복'}),repeat);
  const sync=()=>{repeatRow.hidden=modeC.checked;};
  modeD.addEventListener('change',sync);modeC.addEventListener('change',sync);sync();
  const share=shareSection(it);
  const rem=reminderSection(it,()=>({date:date.value,mode:modeC.checked?'count':'dday',repeat:!modeC.checked&&repeat.checked}));
  [date,modeD,modeC,repeat].forEach(x=>x.addEventListener('change',rem.refresh));
  date.addEventListener('input',rem.refresh);
  rem.refresh();
  const err=h('p',{class:'notice',hidden:true});
  const saveBtn=h('button',{class:'btn primary',type:'submit',text:isNew?'추가':'저장'});
  const owner=!it||it.owner===me.id;
  const fail=()=>{err.textContent=errMsg();err.hidden=false;};

  let armed=false,delBtn=null;
  if(!isNew){
    delBtn=h('button',{class:owner?'btn danger':'btn leave',type:'button',text:owner?'삭제':'내 목록에서 빼기',onclick:async()=>{
      if(!armed){armed=true;delBtn.textContent=owner&&it.shares.length?'모두에게서 삭제할까요? 한 번 더 누르기':'한 번 더 누르면 '+(owner?'삭제':'빼기');return;}
      try{
        if(owner) await must(sb.from('ddays').delete().eq('id',it.id));
        else await must(sb.from('dday_shares').delete().eq('dday_id',it.id).eq('user_id',me.id));
        setPinned(it.id,false);
        if(prefs.groupOf) delete prefs.groupOf[it.id];
        savePrefs();
        items=items.filter(x=>x.id!==it.id);
        closeSheet();toast(owner?'삭제했어요.':'내 목록에서 뺐어요.');render();refetch();
      }catch(e){fail();}
    }});
  }
  const by=h('p',{class:'byline',hidden:true});
  if(it&&it.shares.length&&it.updatedBy){by.textContent='마지막 수정: '+nameOf(it.updatedBy);by.hidden=false;}

  const form=h('form',{style:'display:flex;flex-direction:column;gap:18px',onsubmit:async e=>{
    e.preventDefault();
    const t=title.value.trim();
    if(!t){err.textContent='이름을 입력해 주세요.';err.hidden=false;title.focus();return;}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date.value)){err.textContent='날짜를 골라 주세요.';err.hidden=false;date.focus();return;}
    const mode=modeC.checked?'count':'dday';
    const fields={title:t,date:date.value,mode,repeat:mode==='dday'&&repeat.checked};
    const sel=share.selected(); // null = 공유 대상을 바꿀 수 없음
    saveBtn.disabled=true;
    try{
      let id;
      if(isNew){
        id=uuid();
        await must(sb.from('ddays').insert(Object.assign({id},fields)));
        if(sel&&sel.length) await must(sb.from('dday_shares').insert(sel.map(u=>({dday_id:id,user_id:u}))));
      }else{
        id=it.id;
        await must(sb.from('ddays').update(fields).eq('id',id));
        if(sel){
          const add=sel.filter(u=>!it.shares.includes(u));
          const rm=it.shares.filter(u=>!sel.includes(u));
          if(add.length) await must(sb.from('dday_shares').insert(add.map(u=>({dday_id:id,user_id:u}))));
          if(rm.length) await must(sb.from('dday_shares').delete().eq('dday_id',id).in('user_id',rm));
        }
      }
      await saveReminders(id,rem.desired());
      prefs.remindTime=rem.time()||prefs.remindTime;
      if(pin.checked!==isPinned(id)) setPinned(id,pin.checked);
      prefs.groupOf=prefs.groupOf||{};
      if(group.value) prefs.groupOf[id]=group.value; else delete prefs.groupOf[id];
      savePrefs();
      closeSheet();toast(isNew?'추가했어요.':'저장했어요.');
      await fetchAll().catch(()=>{});render();
    }catch(e2){fail();saveBtn.disabled=false;}
  }},
    h('label',{class:'field',for:'f-title'},h('span',{text:'이름'}),title),
    h('label',{class:'field',for:'f-date'},h('span',{text:'날짜'}),dateWrap),
    h('div',{class:'field',role:'radiogroup','aria-label':'날짜 세는 방법'},h('span',{text:'세는 방법'}),
      h('div',{class:'seg'},
        h('label',{for:'f-mode-d'},modeD,'D-day',h('small',{text:'당일이 D-DAY'})),
        h('label',{for:'f-mode-c'},modeC,'+1일부터',h('small',{text:'시작일이 1일째'})))),
    h('label',{class:'field',for:'f-group'},h('span',{text:'그룹 (나에게만)'}),group),
    h('div',{},repeatRow,h('label',{class:'toggle',for:'f-pin'},h('span',{class:'rem-text'},h('span',{text:'홈에 고정 (나에게만)'}),pinNote),pin)),
    rem.el,
    share.el,
    err,by,
    h('div',{class:'actions'},delBtn,h('button',{class:'btn ghost',type:'button',text:'취소',onclick:closeSheet}),saveBtn));
  openSheet(isNew?'새 디데이':'디데이 수정',form);
}

$('addBtn').addEventListener('click',()=>openEdit(null));

$('sortBtn').addEventListener('click',()=>{
  openSheet('정렬',h('div',{role:'radiogroup'},SORTS.map(s=>h('button',{class:'opt',role:'radio','aria-checked':String(prefs.sort===s.id),onclick:()=>{prefs.sort=s.id;savePrefs();render();closeSheet();}},
    h('span',{text:s.name}),prefs.sort===s.id?svg('<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'):null))),
    h('p',{class:'hint',text:'정렬 방식은 나에게만 적용돼요.'}));
});

$('themeBtn').addEventListener('click',()=>{
  const grid=h('div',{class:'swatches',role:'radiogroup','aria-label':'테마 색상'});
  const draw=()=>grid.replaceChildren(...THEMES.map(t=>h('button',{class:'swatch',role:'radio','aria-checked':String(prefs.theme===t.id),onclick:()=>{prefs.theme=t.id;applyTheme();savePrefs();draw();}},
    h('i',{style:'background:'+t.l}),h('span',{text:t.name}))));
  draw();
  const bars=h('input',{type:'checkbox',role:'switch',id:'t-bars',class:'switch',checked:!!prefs.listBars});
  bars.addEventListener('change',()=>{prefs.listBars=bars.checked;savePrefs();render();});
  openSheet('테마 색상',grid,
    h('label',{class:'toggle',for:'t-bars'},h('span',{class:'rem-text'},h('span',{text:'진행 막대'}),h('small',{class:'sub',text:'켜면 목록의 모든 디데이에 진행 막대가 보여요'})),bars),
    h('p',{class:'hint',text:'테마 색상과 진행 막대는 나에게만 적용되고, 함께 쓰는 사람의 화면은 바뀌지 않아요.'}),
    h('div',{class:'actions'},h('button',{class:'btn ghost',type:'button',text:'닫기',onclick:closeSheet})));
});

/* ---------- 초대 관리 ---------- */
function openPeople(){
  const isAdmin=access==='admin';
  const byEmail={};Object.values(profiles).forEach(p=>byEmail[String(p.email).toLowerCase()]=p);
  const list=h('div',{},members.map(m=>{
    const p=byEmail[m.email];
    const self=me&&m.email===me.email.toLowerCase();
    let armed=false;
    const rm=isAdmin&&!self?h('button',{class:'rm',type:'button',text:'초대 취소',onclick:async()=>{
      if(!armed){armed=true;rm.textContent='한 번 더';return;}
      try{await must(sb.from('members').delete().eq('email',m.email));await fetchAll();render();openPeople();toast('초대를 취소했어요.');}
      catch(e){toast('초대를 취소하지 못했어요.');}
    }}):null;
    return h('div',{class:'member'},personIcon(),
      h('span',{class:'who'},h('span',{text:(p&&p.name?p.name:m.email)+(self?' (나)':'')}),
        h('small',{text:(p&&p.name?m.email+' · ':'')+(m.is_admin?'관리자':p?'참여 중':'아직 로그인 전')})),
      rm);
  }));
  const parts=[list];
  if(isAdmin){
    const inp=h('input',{class:'input',type:'email',id:'invite-email',placeholder:'초대할 구글 이메일',autocomplete:'off',autocapitalize:'off','aria-label':'초대할 구글 이메일'});
    const err=h('p',{class:'notice',hidden:true});
    parts.push(h('form',{class:'field',onsubmit:async e=>{
      e.preventDefault();
      const email=inp.value.trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent='이메일 주소를 확인해 주세요.';err.hidden=false;return;}
      try{
        const r=await sb.from('members').insert({email});
        if(r.error&&r.error.code!=='23505') throw r.error;
        await fetchAll();render();openPeople();toast('초대했어요. 이 이메일의 구글 계정으로 로그인하면 돼요.');
      }catch(x){err.textContent='초대하지 못했어요. 잠시 후 다시 시도해 주세요.';err.hidden=false;}
    }},h('span',{text:'새로 초대하기'}),h('div',{class:'invite'},inp,h('button',{type:'submit',text:'초대'})),err,
      h('p',{class:'hint',text:'초대한 사람에게 이 앱 주소를 보내 주세요. 디데이를 누구와 함께 볼지는 디데이 수정 화면에서 골라요.'})));
  }else{
    parts.push(h('p',{class:'hint',text:'새로운 사람은 관리자만 초대할 수 있어요.'}));
  }
  parts.push(h('div',{class:'actions'},h('button',{class:'btn ghost',type:'button',text:'닫기',onclick:closeSheet})));
  openSheet('초대된 사람',...parts);
}
$('peopleBtn').addEventListener('click',openPeople);

/* ---------- 로그인 ---------- */
function showGate(mode){
  $('app').hidden=true;$('addBtn').hidden=true;closeDrawer();closeSheet();
  $('gate').hidden=false;
  const err=$('gateError');err.hidden=true;
  if(mode==='config'){
    $('gateTitle').textContent='설정이 필요해요';
    $('gateText').textContent='config.js에 Supabase 주소와 키를 넣어 주세요.';
    $('googleBtn').hidden=true;$('gateLogout').hidden=true;
  }else if(mode==='denied'){
    $('gateTitle').textContent='초대받지 않은 계정이에요';
    $('gateText').replaceChildren(h('span',{class:'who',text:me.email}),document.createTextNode('\n계정으로는 이 앱을 쓸 수 없어요.\n관리자에게 이 이메일을 초대해 달라고 요청하거나, 초대받은 계정으로 다시 로그인해 주세요.'));
    $('googleBtn').hidden=true;$('gateLogout').hidden=false;
  }else{
    $('gateTitle').textContent='디데이';
    $('gateText').textContent='초대받은 구글 계정으로 로그인해 주세요.';
    $('googleBtn').hidden=false;$('gateLogout').hidden=true;
  }
}
function showApp(){$('gate').hidden=true;$('app').hidden=false;$('addBtn').hidden=false;}

$('googleBtn').addEventListener('click',async()=>{
  const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:'select_account'}}});
  if(error){const e=$('gateError');e.textContent='로그인 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.';e.hidden=false;}
});
async function logout(){
  try{await sb.auth.signOut();}catch(e){}
  me=null;access=null;items=[];loaded=false;
  try{localStorage.removeItem('dday-prefs');}catch(e){}
  showGate('login');
}
$('gateLogout').addEventListener('click',logout);

let channel=null,started=false;
async function startSession(user){
  if(started&&me&&me.id===user.id) return;
  started=true;
  me={id:user.id,email:String(user.email||'').toLowerCase(),name:(user.user_metadata&&(user.user_metadata.full_name||user.user_metadata.name))||''};
  const a=await sb.rpc('my_access');
  access=a.error?null:a.data;
  if(!access){showGate('denied');started=false;return;}
  showApp();render();
  refreshPushRegistration();
  sb.from('profiles').upsert({id:me.id,email:me.email,name:me.name,updated_at:new Date().toISOString()}).then(()=>{});
  const pr=await sb.from('user_prefs').select('prefs').eq('user_id',me.id).maybeSingle();
  if(pr.data&&pr.data.prefs){
    const d=pr.data.prefs;
    prefs=Object.assign(prefs,d,{groups:(d.groups||[]).map(g=>({id:g.id,name:g.name})),groupOf:Object.assign({},d.groupOf||{})});
    applyTheme();try{localStorage.setItem('dday-prefs',JSON.stringify(prefs));}catch(e){}
  }
  try{await fetchAll();$('addBtn').disabled=false;}
  catch(e){loaded=true;showNotice('디데이를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');}
  render();
  if(channel) sb.removeChannel(channel);
  channel=sb.channel('dday-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'ddays'},refetch)
    .on('postgres_changes',{event:'*',schema:'public',table:'dday_shares'},refetch)
    .subscribe();
}

/* ---------- boot ---------- */
applyTheme();
setInterval(()=>{if(me&&todayNum()!==lastDay)render();},60000);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!me) return;
  if(todayNum()!==lastDay) render();
  refetch();
});

const cfg=window.DDAY_CONFIG||{};
if(!window.supabase||!cfg.SUPABASE_URL||/여기에/.test(cfg.SUPABASE_URL+cfg.SUPABASE_ANON_KEY)){
  showGate('config');
}else{
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{flowType:'implicit',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  sb.auth.onAuthStateChange((event,session)=>{
    if(session&&session.user) setTimeout(()=>startSession(session.user),0);
    else if(event==='SIGNED_OUT'){started=false;showGate('login');}
  });
  sb.auth.getSession().then(({data})=>{
    if(data&&data.session) startSession(data.session.user);
    else showGate('login');
  });
}

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{
      reg.update().catch(()=>{});
      // 앱을 다시 볼 때마다 새 버전이 있는지 확인
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)reg.update().catch(()=>{});});
    }).catch(()=>{});
  });
  // 새 버전이 설치되면 한 번 새로고침해서 바로 적용 (입력 중인 창이 열려 있으면 닫힐 때까지 기다림)
  let reloaded=false;const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloaded||!hadController) return;
    const go=()=>{if(reloaded)return;reloaded=true;location.reload();};
    if($('scrim').hidden) go();
    else{const t=setInterval(()=>{if($('scrim').hidden){clearInterval(t);go();}},1000);}
  });
}
})();
