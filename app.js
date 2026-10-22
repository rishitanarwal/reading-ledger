(function(){
"use strict";
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parseYmd=s=>{const p=String(s).split("-").map(Number);return new Date(p[0],(p[1]||1)-1,p[2]||1);};
const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x;};
const weekStart=d=>addDays(d,-((d.getDay()+6)%7));
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const fmtDay=d=>d.getDate()+" "+MON[d.getMonth()];
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/864e5+1)/7);}
const KINDS=["Book","Article","Report","Podcast","Video"];
const LIB_SELECT="id,title,author,kind,pages,link,topics,takeaway,added_by,added_at,file_path,file_name,file_size,adder:members(display_name)";
const BUCKET="sources", MAX_FILE=50*1024*1024;
const fmtSize=b=>{b=Number(b)||0;return b>=1048576?(b/1048576).toFixed(b>=10485760?0:1)+" MB":Math.max(1,Math.round(b/1024))+" KB";};
const fileExt=n=>{const m=/\.([a-z0-9]{1,5})$/i.exec(n||"");return m?m[1].toUpperCase():"FILE";};
const safeName=n=>String(n||"file").normalize("NFKD").replace(/[^\w.\-]+/g,"_").replace(/_+/g,"_").slice(-120)||"file";

const S={sb:null,uid:null,me:null,library:[],libLoaded:false,sessions:[],settings:{weekly_goal:500},shelf:{},
  filter:{q:"",kind:"All",topic:null,files:false},editingId:null,removeFile:false,returnToLog:false,confirmDel:null,channel:null,authMode:"signin"};

let toastT;
function toast(msg){const t=$("toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true;},2600);}
function banner(msg){const b=$("banner");if(msg){b.textContent=msg;b.hidden=false;}else b.hidden=true;}

/* ---------- Screens ---------- */
function screen(name){
  $("auth").hidden=name!=="auth";
  $("join").hidden=name!=="join";
  $("app").hidden=name!=="app";
  $("tabs").hidden=name!=="app";
  $("account").hidden=!(name==="app"||name==="join");
}
function showTab(name){
  const lib=name==="library";
  $("tab-log").setAttribute("aria-selected",String(!lib));
  $("tab-library").setAttribute("aria-selected",String(lib));
  $("view-log").hidden=lib; $("view-library").hidden=!lib;
  try{history.replaceState(null,"",lib?"#library":"#");}catch(e){}
}
$("tab-log").addEventListener("click",()=>showTab("log"));
$("tab-library").addEventListener("click",()=>showTab("library"));

/* ---------- Derived ---------- */
function pagesByDate(){const m={};for(const s of S.sessions){m[s.date]=(m[s.date]||0)+(Number(s.pages)||0);}return m;}
function pagesByItem(){const m={};for(const s of S.sessions){if(s.item_id)m[s.item_id]=(m[s.item_id]||0)+(Number(s.pages)||0);}return m;}
function lastDateByItem(){const m={};for(const s of S.sessions){if(s.item_id&&(!m[s.item_id]||s.date>m[s.item_id]))m[s.item_id]=s.date;}return m;}
const libById=()=>Object.fromEntries(S.library.map(i=>[i.id,i]));
const goal=()=>Math.max(1,Number(S.settings.weekly_goal)||500);

/* ---------- Week ---------- */
function renderWeek(){
  const g=goal(), byDate=pagesByDate(), today=new Date(), ws=weekStart(today), idx=(today.getDay()+6)%7, daily=g/7;
  const days=[...Array(7)].map((_,i)=>{const d=addDays(ws,i),k=ymd(d);return{d,k,pages:byDate[k]||0,i};});
  const total=days.reduce((a,b)=>a+b.pages,0);
  $("wk-label").textContent="Week "+isoWeek(today);
  $("wk-range").textContent=fmtDay(ws)+" – "+fmtDay(addDays(ws,6));
  $("wk-total").textContent=total.toLocaleString("en-IN");
  $("wk-goal").textContent=g.toLocaleString("en-IN");
  $("wk-meter").style.width=Math.min(100,total/g*100).toFixed(1)+"%";
  let cls,txt;
  if(total>=g){cls="ahead";txt="Goal met";}
  else if(total>=daily*(idx+1)){cls="ahead";txt="Ahead of pace";}
  else if(total>=daily*idx-0.5){cls="onpace";txt="On pace";}
  else{cls="behind";txt="Behind pace";}
  $("wk-status").className="chip "+cls; $("wk-status").textContent=txt;
  const left=Math.max(0,g-total), remDays=7-idx, per=Math.ceil(left/remDays);
  $("wk-pace").innerHTML= left===0
    ? (total>g?"<strong>"+(total-g).toLocaleString("en-IN")+"</strong> pages over this week's goal":"Goal reached for this week")
    : "<strong>"+left.toLocaleString("en-IN")+"</strong> pages to go · <strong>"+per+"</strong> a day for the "+(remDays===1?"rest of today":"next "+remDays+" days");
  const scale=Math.max(daily*1.6,...days.map(d=>d.pages)), tgtPct=(daily/scale*100).toFixed(1);
  $("wk-days").innerHTML=days.map(d=>{
    const h=(d.pages/scale*100).toFixed(1), fut=d.i>idx;
    return '<div class="day'+(d.i===idx?" today":"")+(fut?" future":"")+'"><div class="val">'+(d.pages||"")+'</div>'+
      '<div class="bar-track" title="'+esc(fmtDay(d.d)+": "+d.pages+" pages")+'">'+
      (d.pages?'<div class="bar-fill'+(d.pages<daily?" under":"")+'" style="height:'+h+'%"></div>':"")+
      '<div class="target" style="bottom:'+tgtPct+'%"></div></div><div class="lbl">'+DOW[d.i]+'<b>'+d.d.getDate()+'</b></div></div>';
  }).join("");
  $("wk-daily-lbl").textContent="Daily target, "+Math.round(daily)+" pp";
  let streak=0, cur=byDate[ymd(today)]?today:addDays(today,-1);
  while(byDate[ymd(cur)]){streak++;cur=addDays(cur,-1);}
  $("wk-streak").textContent=streak?streak+"-day reading streak":"";
  const gi=$("goal-input"); if(document.activeElement!==gi){gi.value=g;$("goal-save").hidden=true;}
}
function renderHistory(){
  const g=goal(), byDate=pagesByDate(), ws=weekStart(new Date()), weeks=[];
  for(let w=8;w>=1;w--){const s=addDays(ws,-7*w);let t=0;for(let i=0;i<7;i++)t+=byDate[ymd(addDays(s,i))]||0;weeks.push({s,t});}
  const scale=Math.max(g*1.25,...weeks.map(w=>w.t)), gp=(g/scale*100).toFixed(1);
  $("hist").innerHTML=weeks.map(w=>'<div class="hcol"><div class="v">'+(w.t||"–")+'</div><div class="htrack" title="'+esc("Week of "+fmtDay(w.s)+": "+w.t+" pages")+'">'+
    (w.t?'<div class="hbar'+(w.t>=g?" hit":"")+'" style="height:'+(w.t/scale*100).toFixed(1)+'%"></div>':"")+
    '<div class="hgoal" style="bottom:'+gp+'%"></div></div><div class="lbl">Wk '+isoWeek(w.s)+'</div></div>').join("");
  const hits=weeks.filter(w=>w.t>=g).length, avg=Math.round(weeks.reduce((a,b)=>a+b.t,0)/8);
  $("hist-sum").textContent=S.sessions.length?"Goal hit in "+hits+" of the last 8 weeks · average "+avg.toLocaleString("en-IN")+" pages a week":"Past weeks fill in as you log. Pink bars hit the goal line.";
}
function renderReading(){
  const lib=libById(), read=pagesByItem(), last=lastDateByItem(), shelf=S.shelf;
  const ids=new Set([...Object.keys(read),...Object.keys(shelf).filter(k=>shelf[k]==="reading")]);
  const finished=Object.keys(shelf).filter(k=>shelf[k]==="finished");
  const now=[...ids].filter(id=>shelf[id]!=="finished"&&lib[id]).sort((a,b)=>(last[b]||"").localeCompare(last[a]||""));
  const byDate=pagesByDate(); let p14=0; const t=new Date(); for(let i=0;i<14;i++)p14+=byDate[ymd(addDays(t,-i))]||0;
  const perDay=p14/14;
  $("finished-count").textContent=finished.length?finished.length+" finished":"";
  if(!now.length){$("reading-list").innerHTML='<li class="empty">Books you log pages for appear here with progress and an estimated finish date.</li>';return;}
  $("reading-list").innerHTML=now.map(id=>{
    const it=lib[id], r=read[id]||0, tot=Number(it.pages)||0;
    let sub=r+" pp read", bar="";
    if(tot){sub=r+" of "+tot+" pp";bar='<div class="mini-meter"><i style="width:'+Math.min(100,r/tot*100).toFixed(1)+'%"></i></div>';
      const rem=Math.max(0,tot-r); if(rem&&perDay>0){const dl=Math.ceil(rem/perDay);sub+=" · about "+dl+" day"+(dl===1?"":"s")+" left at your pace";}}
    return '<li><div class="line"><span class="t">'+esc(it.title)+'</span><button class="linkbtn quiet small" data-finish="'+esc(id)+'" type="button">Mark finished</button></div>'+bar+'<span class="small muted num">'+esc(sub)+'</span></li>';
  }).join("");
}
function renderRecent(){
  const lib=libById();
  const list=[...S.sessions].sort((a,b)=>(b.date+b.created_at).localeCompare(a.date+a.created_at)).slice(0,10);
  if(!list.length){$("recent-list").innerHTML='<li class="empty">Nothing logged yet. Pick what you read, enter the pages, and it lands here.</li>';return;}
  $("recent-list").innerHTML=list.map(s=>{
    const d=parseYmd(s.date), it=lib[s.item_id], c=S.confirmDel==="s:"+s.id;
    return '<li><div class="entry"><span class="d">'+esc(DOW[(d.getDay()+6)%7]+" "+d.getDate())+'</span><span class="t">'+esc(it?it.title:"Removed from library")+
      (s.note?'<span class="small muted"> · '+esc(s.note)+'</span>':"")+'</span><span class="p">'+esc(s.pages)+' pp</span>'+
      '<button class="linkbtn '+(c?"danger":"quiet")+' small" type="button" data-delsession="'+esc(s.id)+'">'+(c?"Confirm":"Delete")+'</button></div></li>';
  }).join("");
}
function renderSelect(){
  const sel=$("log-item"), keep=sel.value, shelf=S.shelf, read=pagesByItem();
  const reading=S.library.filter(i=>shelf[i.id]!=="finished"&&(shelf[i.id]==="reading"||read[i.id]));
  const rset=new Set(reading.map(i=>i.id));
  const rest=S.library.filter(i=>!rset.has(i.id)).sort((a,b)=>String(a.title).localeCompare(String(b.title)));
  const opt=i=>'<option value="'+esc(i.id)+'">'+esc(i.title)+(i.author?" — "+esc(i.author):"")+'</option>';
  let html='<option value="">'+(S.library.length?"Choose a title":"Add a title to the library first")+'</option>';
  if(reading.length) html+='<optgroup label="Reading now">'+reading.map(opt).join("")+'</optgroup>';
  if(rest.length) html+='<optgroup label="Library">'+rest.map(opt).join("")+'</optgroup>';
  sel.innerHTML=html;
  if(keep&&S.library.some(i=>i.id===keep)) sel.value=keep;
}
function renderFilters(){
  const kinds=["All",...KINDS.filter(k=>S.library.some(i=>i.kind===k))];
  const nFiles=S.library.filter(i=>i.file_path).length;
  $("kind-filters").innerHTML=(kinds.length>2?kinds.map(k=>'<button type="button" class="pill" data-kind="'+esc(k)+'" aria-pressed="'+(S.filter.kind===k)+'">'+esc(k==="All"?"All types":k+"s")+'</button>').join(""):"")+
    (nFiles?'<button type="button" class="pill" id="files-filter" aria-pressed="'+S.filter.files+'">With files <span class="num" style="opacity:.6">'+nFiles+'</span></button>':"");
  const counts={};S.library.forEach(i=>(i.topics||[]).forEach(t=>counts[t]=(counts[t]||0)+1));
  const topics=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]||a.localeCompare(b)).slice(0,14);
  $("topic-filters").innerHTML=topics.map(t=>'<button type="button" class="pill" data-topicf="'+esc(t)+'" aria-pressed="'+(S.filter.topic===t)+'">'+esc(t)+' <span class="num" style="opacity:.6">'+counts[t]+'</span></button>').join("");
}
function renderLibrary(){
  $("lib-count").textContent=S.library.length?String(S.library.length):"";
  renderFilters();
  const q=S.filter.q.trim().toLowerCase(), read=pagesByItem(), shelf=S.shelf, isAdmin=S.me&&S.me.role==="admin";
  const list=S.library.filter(i=>{
    if(S.filter.kind!=="All"&&i.kind!==S.filter.kind) return false;
    if(S.filter.topic&&!(i.topics||[]).includes(S.filter.topic)) return false;
    if(S.filter.files&&!i.file_path) return false;
    return !q||[i.title,i.author,i.takeaway,i.file_name,(i.topics||[]).join(" ")].join(" ").toLowerCase().includes(q);
  });
  const ul=$("lib-list");
  if(!S.libLoaded){ul.innerHTML='<li class="empty">Loading the library…</li>';return;}
  if(!S.library.length){ul.innerHTML='<li class="item"><h3>The library is empty</h3><p class="muted" style="margin:0">Add the first thing you are reading with a one-line takeaway. Each title you add also becomes available to log pages against.</p></li>';return;}
  if(!list.length){ul.innerHTML='<li class="empty">Nothing matches. <button type="button" class="linkbtn" id="clear-filters">Clear filters</button></li>';return;}
  ul.innerHTML=list.map(i=>{
    const mine=i.added_by===S.uid, canEdit=mine||isAdmin, link=/^https?:\/\//i.test(i.link||"")?i.link:"";
    const added=i.added_at?new Date(i.added_at):null, r=read[i.id]||0, st=shelf[i.id];
    let mineTxt=""; if(st==="finished")mineTxt="You finished this"; else if(r)mineTxt="You've read "+r+(i.pages?" of "+i.pages:"")+" pp";
    const who=mine?"you":((i.adder&&i.adder.display_name)||"a teammate"), c=S.confirmDel==="l:"+i.id;
    return '<li class="item"><div class="meta"><span class="kind">'+esc(i.kind||"Book")+'</span>'+(i.author?'<span>'+esc(i.author)+'</span>':"")+(i.pages?'<span class="num">'+esc(i.pages)+' pp</span>':"")+'</div>'+
      '<h3>'+(link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+esc(i.title)+'</a>':esc(i.title))+'</h3>'+
      (i.takeaway?'<p class="takeaway" style="margin:0">'+esc(i.takeaway)+'</p>':"")+
      (i.file_path?'<button type="button" class="file-btn" data-download="'+esc(i.id)+'" title="Download '+esc(i.file_name||"file")+'"><span class="ext">'+esc(fileExt(i.file_name))+'</span><span class="fname">'+esc(i.file_name||"Attached file")+'</span>'+(i.file_size?'<span class="fsize">'+esc(fmtSize(i.file_size))+'</span>':"")+'<span class="dl">Download</span></button>':"")+
      ((i.topics||[]).length?'<div class="topics">'+i.topics.map(t=>'<button type="button" class="topic" data-topicf="'+esc(t)+'">'+esc(t)+'</button>').join("")+'</div>':"")+
      '<div class="item-foot"><span>Added by '+esc(who)+(added?" · "+esc(fmtDay(added)+" "+added.getFullYear()):"")+'</span>'+
      '<span class="actions" style="gap:12px">'+(mineTxt?'<span class="mine">'+esc(mineTxt)+'</span>':"")+
      (st!=="finished"?'<button type="button" class="linkbtn small" data-logthis="'+esc(i.id)+'">Log pages</button>':"")+
      (canEdit?'<button type="button" class="linkbtn quiet small" data-edit="'+esc(i.id)+'">Edit</button><button type="button" class="linkbtn '+(c?"danger":"quiet")+' small" data-dellib="'+esc(i.id)+'">'+(c?"Confirm delete":"Delete")+'</button>':"")+
      '</span></div></li>';
  }).join("");
}
function renderAll(){renderWeek();renderHistory();renderReading();renderRecent();renderSelect();renderLibrary();}

/* ---------- Library form helpers ---------- */
function showCurrentFile(it){
  const box=$("lib-file-current");
  S.removeFile=false;box.classList.remove("removing");$("lib-file-remove").textContent="Remove";
  if(it&&it.file_path){box.hidden=false;$("lib-file-current-name").textContent="Attached: "+(it.file_name||"file")+(it.file_size?" ("+fmtSize(it.file_size)+")":"");
    $("lib-file-hint").textContent="Choose a new file to replace it.";}
  else{box.hidden=true;$("lib-file-hint").textContent="Everyone on the team can download it from the library.";}
}
$("lib-file-remove").addEventListener("click",()=>{
  S.removeFile=!S.removeFile;
  $("lib-file-current").classList.toggle("removing",S.removeFile);
  $("lib-file-remove").textContent=S.removeFile?"Keep it":"Remove";
});
function resetLibForm(){
  S.editingId=null;$("lib-file").value="";showCurrentFile(null);
  ["lib-title","lib-author","lib-pages","lib-link","lib-topics","lib-takeaway"].forEach(id=>$(id).value="");
  $("lib-kind").value="Book";$("lib-form-title").textContent="Add to the library";$("lib-submit").textContent="Add to library";
  $("lib-cancel").hidden=!S.returnToLog;$("lib-msg").textContent="";
}
function fillLibForm(it){
  S.editingId=it.id;
  $("lib-title").value=it.title||"";$("lib-author").value=it.author||"";$("lib-kind").value=it.kind||"Book";
  $("lib-pages").value=it.pages||"";$("lib-link").value=it.link||"";$("lib-topics").value=(it.topics||[]).join(", ");$("lib-takeaway").value=it.takeaway||"";
  $("lib-file").value="";showCurrentFile(it);
  $("lib-form-title").textContent="Edit entry";$("lib-submit").textContent="Save changes";$("lib-cancel").hidden=false;
  $("lib-form-panel").scrollIntoView({behavior:"smooth",block:"start"});$("lib-title").focus({preventScroll:true});
}
function parseTopics(s){const seen=new Set();return s.split(",").map(t=>t.trim().replace(/\s+/g," ")).filter(t=>t&&t.length<=40).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).filter(t=>{const k=t.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).slice(0,6);}
function errMsg(e){
  const m=(e&&e.message)||"";
  if(/fetch|network/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
  if(/row-level security|permission/i.test(m)) return "You don't have permission to change that.";
  return m||"That didn't save. Try again.";
}

/* ---------- Events ---------- */
document.addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b||$("app").hidden) return;
  if(b.dataset.kind){S.filter.kind=b.dataset.kind;renderLibrary();}
  else if(b.dataset.topicf){S.filter.topic=S.filter.topic===b.dataset.topicf?null:b.dataset.topicf;renderLibrary();}
  else if(b.id==="files-filter"){S.filter.files=!S.filter.files;renderLibrary();}
  else if(b.dataset.download) downloadFile(b.dataset.download,b);
  else if(b.id==="clear-filters"){S.filter={q:"",kind:"All",topic:null,files:false};$("lib-search").value="";renderLibrary();}
  else if(b.dataset.finish) setShelf(b.dataset.finish,"finished");
  else if(b.dataset.logthis){showTab("log");renderSelect();$("log-item").value=b.dataset.logthis;$("log-pages").focus();}
  else if(b.dataset.edit){const it=S.library.find(i=>i.id===b.dataset.edit);if(it)fillLibForm(it);}
  else if(b.dataset.dellib) armDelete("l:"+b.dataset.dellib,()=>deleteLib(b.dataset.dellib),renderLibrary);
  else if(b.dataset.delsession) armDelete("s:"+b.dataset.delsession,()=>deleteSession(b.dataset.delsession),renderRecent);
});
let delT;
function armDelete(key,run,rerender){
  if(S.confirmDel===key){S.confirmDel=null;clearTimeout(delT);run();return;}
  S.confirmDel=key;rerender();clearTimeout(delT);delT=setTimeout(()=>{S.confirmDel=null;rerender();},4000);
}
$("lib-search").addEventListener("input",e=>{S.filter.q=e.target.value;renderLibrary();});
$("log-add-new").addEventListener("click",()=>{S.returnToLog=true;resetLibForm();showTab("library");$("lib-title").focus();});
$("lib-cancel").addEventListener("click",()=>{const back=S.returnToLog&&!S.editingId;S.returnToLog=false;resetLibForm();if(back)showTab("log");});
$("goal-input").addEventListener("input",()=>{$("goal-save").hidden=Number($("goal-input").value)===goal();});
$("goal-save").addEventListener("click",saveGoal);
$("goal-input").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();saveGoal();}});
$("log-date").value=ymd(new Date());$("log-date").max=ymd(new Date());

/* ---------- Data ---------- */
async function loadLibrary(){
  const {data,error}=await S.sb.from("library").select(LIB_SELECT).order("added_at",{ascending:false});
  if(error){banner("The library couldn't load: "+errMsg(error));return;}
  S.library=data||[];S.libLoaded=true;renderAll();
}
async function loadMine(){
  const [ses,set,sh]=await Promise.all([
    S.sb.from("sessions").select("id,item_id,date,pages,minutes,note,created_at").order("date",{ascending:false}).limit(2000),
    S.sb.from("user_settings").select("weekly_goal").maybeSingle(),
    S.sb.from("shelf").select("item_id,status")
  ]);
  if(ses.error){banner("Your reading log couldn't load: "+errMsg(ses.error));return;}
  S.sessions=ses.data||[];
  S.settings=set.data||{weekly_goal:500};
  S.shelf={};(sh.data||[]).forEach(r=>S.shelf[r.item_id]=r.status);
  renderAll();
}
let libT;
function subscribeLibrary(){
  if(S.channel) return;
  S.channel=S.sb.channel("library-changes")
    .on("postgres_changes",{event:"*",schema:"public",table:"library"},()=>{clearTimeout(libT);libT=setTimeout(loadLibrary,400);})
    .subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S.me){loadLibrary();}});

async function saveGoal(){
  const v=Math.round(Number($("goal-input").value));
  if(!(v>=50&&v<=5000)){toast("Set a goal between 50 and 5,000 pages.");return;}
  const {error}=await S.sb.from("user_settings").upsert({user_id:S.uid,weekly_goal:v});
  if(error){toast(errMsg(error));return;}
  S.settings.weekly_goal=v;$("goal-save").hidden=true;renderAll();toast("Weekly goal set to "+v+" pages");
}
async function setShelf(id,status){
  const {error}=await S.sb.from("shelf").upsert({user_id:S.uid,item_id:id,status});
  if(error){toast(errMsg(error));return;}
  S.shelf[id]=status;renderAll();
  if(status==="finished"){const it=S.library.find(i=>i.id===id);toast("Finished: "+(it?it.title:"title"));}
}
$("log-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const item_id=$("log-item").value, pages=Math.round(Number($("log-pages").value)), date=$("log-date").value;
  const minutes=Math.round(Number($("log-min").value))||null, note=$("log-note").value.trim(), msg=$("log-msg");
  if(!item_id){msg.textContent="Choose what you read.";$("log-item").focus();return;}
  if(!(pages>=1&&pages<=2000)){msg.textContent="Enter the pages you read, from 1 to 2,000.";$("log-pages").focus();return;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){msg.textContent="Pick a date.";return;}
  msg.textContent="";$("log-submit").disabled=true;
  try{
    const {data,error}=await S.sb.from("sessions").insert({user_id:S.uid,item_id,pages,date,minutes,note}).select("id,item_id,date,pages,minutes,note,created_at").single();
    if(error) throw error;
    S.sessions.push(data);
    if(!S.shelf[item_id]) await setShelf(item_id,"reading"); else renderAll();
    $("log-pages").value="";$("log-min").value="";$("log-note").value="";
    toast("Logged "+pages+" pages");
  }catch(err){msg.textContent=errMsg(err);}
  finally{$("log-submit").disabled=false;}
});
async function deleteSession(id){
  const {error}=await S.sb.from("sessions").delete().eq("id",id);
  if(error){toast(errMsg(error));return;}
  S.sessions=S.sessions.filter(s=>s.id!==id);renderAll();toast("Entry deleted");
}
$("lib-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("lib-msg"), title=$("lib-title").value.trim();
  if(!title){msg.textContent="Give it a title.";$("lib-title").focus();return;}
  let link=$("lib-link").value.trim(); if(link&&!/^https?:\/\//i.test(link)) link="https://"+link;
  const pages=Math.round(Number($("lib-pages").value))||null;
  const body={title,author:$("lib-author").value.trim(),kind:$("lib-kind").value,pages,link,topics:parseTopics($("lib-topics").value),takeaway:$("lib-takeaway").value.trim()};
  const file=$("lib-file").files&&$("lib-file").files[0];
  if(file&&file.size>MAX_FILE){msg.textContent="That file is "+fmtSize(file.size)+". The limit is 50 MB, so try a compressed PDF.";return;}
  if(file&&file.size===0){msg.textContent="That file is empty. Choose another one.";return;}
  msg.textContent="";$("lib-submit").disabled=true;
  const btnLabel=$("lib-submit").textContent;
  let uploadedPath=null;
  const old=S.editingId?S.library.find(i=>i.id===S.editingId):null;
  try{
    if(file){
      $("lib-submit").textContent="Uploading "+fmtSize(file.size)+"…";
      const path=S.uid+"/"+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2))+"-"+safeName(file.name);
      const up=await S.sb.storage.from(BUCKET).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
      if(up.error) throw up.error;
      uploadedPath=path;
      Object.assign(body,{file_path:path,file_name:file.name.slice(0,200),file_size:file.size});
    }else if(S.editingId&&S.removeFile){
      Object.assign(body,{file_path:null,file_name:null,file_size:null});
    }
    $("lib-submit").textContent="Saving…";
    if(S.editingId){
      const {error}=await S.sb.from("library").update(body).eq("id",S.editingId);
      if(error) throw error;
      uploadedPath=null;
      if(old&&old.file_path&&(file||S.removeFile)) S.sb.storage.from(BUCKET).remove([old.file_path]).catch(()=>{});
      toast("Saved changes");resetLibForm();await loadLibrary();
    }else{
      body.added_by=S.uid;
      const {data,error}=await S.sb.from("library").insert(body).select(LIB_SELECT).single();
      if(error) throw error;
      uploadedPath=null;
      if(!S.library.some(i=>i.id===data.id)) S.library.unshift(data);
      renderAll();toast("Added to the library");
      const back=S.returnToLog;S.returnToLog=false;resetLibForm();
      if(back){showTab("log");renderSelect();$("log-item").value=data.id;$("log-pages").focus();}
    }
  }catch(err){
    if(uploadedPath) S.sb.storage.from(BUCKET).remove([uploadedPath]).catch(()=>{});
    const m=(err&&err.message)||"";
    msg.textContent=/bucket not found/i.test(m)?"File uploads aren't switched on yet. Run the file-attachments script in Supabase.":
      /exceeded|too large|payload/i.test(m)?"That file is too large. The limit is 50 MB.":errMsg(err);
  }
  finally{$("lib-submit").disabled=false;if(/Uploading|Saving/.test($("lib-submit").textContent))$("lib-submit").textContent=btnLabel;}
});
async function deleteLib(id){
  const it=S.library.find(i=>i.id===id);
  const {error}=await S.sb.from("library").delete().eq("id",id);
  if(error){toast(errMsg(error));return;}
  if(it&&it.file_path) S.sb.storage.from(BUCKET).remove([it.file_path]).catch(()=>{});
  S.library=S.library.filter(i=>i.id!==id);if(S.editingId===id)resetLibForm();renderAll();toast("Removed from the library");
}
async function downloadFile(id,btn){
  const it=S.library.find(i=>i.id===id);
  if(!it||!it.file_path) return;
  const dl=btn.querySelector(".dl"), label=dl?dl.textContent:"";
  btn.disabled=true;if(dl)dl.textContent="Preparing…";
  try{
    const {data,error}=await S.sb.storage.from(BUCKET).createSignedUrl(it.file_path,300,{download:it.file_name||true});
    if(error) throw error;
    const a=document.createElement("a");a.href=data.signedUrl;a.rel="noopener";a.download=it.file_name||"";
    document.body.appendChild(a);a.click();a.remove();
  }catch(err){toast(/not found/i.test((err&&err.message)||"")?"That file is no longer available.":"Couldn't download the file. Try again.");}
  finally{btn.disabled=false;if(dl)dl.textContent=label;}
}

/* ---------- Auth ---------- */
function setAuthMode(m){
  S.authMode=m;
  $("auth-signin-tab").setAttribute("aria-selected",String(m==="signin"));
  $("auth-signup-tab").setAttribute("aria-selected",String(m==="signup"));
  document.querySelectorAll(".signup-only").forEach(el=>el.hidden=m!=="signup");
  $("auth-submit").textContent=m==="signup"?"Create account":"Sign in";
  $("auth-password").setAttribute("autocomplete",m==="signup"?"new-password":"current-password");
  $("auth-msg").textContent="";
}
$("auth-signin-tab").addEventListener("click",()=>setAuthMode("signin"));
$("auth-signup-tab").addEventListener("click",()=>setAuthMode("signup"));

$("auth-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("auth-msg"), email=$("auth-email").value.trim(), password=$("auth-password").value;
  const name=$("auth-name").value.trim(), code=$("auth-code").value.trim();
  if(!email||!password){msg.textContent="Enter your email and password.";return;}
  $("auth-submit").disabled=true;msg.textContent="";
  try{
    if(S.authMode==="signup"){
      if(!name){msg.textContent="Enter your name so teammates know who added what.";return;}
      if(password.length<6){msg.textContent="Use a password of at least 6 characters.";return;}
      const ok=await S.sb.rpc("check_team_code",{p_code:code});
      if(ok.error) throw ok.error;
      if(!ok.data){msg.textContent="That team code is not right. Ask the person who shared this link.";return;}
      const {data,error}=await S.sb.auth.signUp({email,password,options:{data:{display_name:name}}});
      if(error) throw error;
      if(!data.session){msg.textContent="Account created, but email confirmation is switched on. Ask the admin to turn off “Confirm email” in Supabase, then sign in.";return;}
      const j=await S.sb.rpc("join_team",{p_code:code,p_name:name});
      if(j.error) throw j.error;
      await route();
    }else{
      const {error}=await S.sb.auth.signInWithPassword({email,password});
      if(error) throw error;
      await route();
    }
  }catch(err){
    const m=(err&&err.message)||"";
    msg.textContent=/invalid login/i.test(m)?"That email and password don't match. Check them, or create an account.":
      /already registered/i.test(m)?"There's already an account for this email. Sign in instead.":errMsg(err);
  }finally{$("auth-submit").disabled=false;}
});
$("join-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("join-msg"), name=$("join-name").value.trim(), code=$("join-code").value.trim();
  if(!name||!code){msg.textContent="Enter your name and the team code.";return;}
  $("join-submit").disabled=true;msg.textContent="";
  const {error}=await S.sb.rpc("join_team",{p_code:code,p_name:name});
  $("join-submit").disabled=false;
  if(error){msg.textContent=errMsg(error);return;}
  await route();
});
$("signout").addEventListener("click",async()=>{
  await S.sb.auth.signOut();
  if(S.channel){S.sb.removeChannel(S.channel);S.channel=null;}
  Object.assign(S,{uid:null,me:null,library:[],libLoaded:false,sessions:[],shelf:{},settings:{weekly_goal:500}});
  $("auth-password").value="";
  screen("auth");
});

let routing=false;
async function route(){
  if(routing) return; routing=true;
  try{
    const {data:{session}}=await S.sb.auth.getSession();
    if(!session){screen("auth");return;}
    S.uid=session.user.id;
    const {data:me,error}=await S.sb.from("members").select("user_id,display_name,role").eq("user_id",S.uid).maybeSingle();
    if(error){banner(errMsg(error));screen("auth");return;}
    if(!me){
      const n=(session.user.user_metadata&&session.user.user_metadata.display_name)||"";
      $("join-name").value=n;$("who").textContent=session.user.email||"";screen("join");return;
    }
    S.me=me;$("who").textContent=me.display_name+(me.role==="admin"?" · admin":"");
    screen("app");banner("");
    try{if(location.hash==="#library")showTab("library");}catch(e){}
    renderAll();
    await Promise.all([loadLibrary(),loadMine()]);
    subscribeLibrary();
  }finally{routing=false;}
}

/* ---------- Boot ---------- */
(function boot(){
  const cfg=window.LEDGER_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||/YOUR-PROJECT/.test(cfg.SUPABASE_URL)||!cfg.SUPABASE_KEY||/YOUR-/.test(cfg.SUPABASE_KEY)){
    screen("none");banner("This site isn't connected to its database yet. Add your Supabase URL and key to config.js.");return;
  }
  S.sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  setAuthMode("signin");
  S.sb.auth.onAuthStateChange((ev)=>{if(ev==="SIGNED_OUT")screen("auth");});
  route();
})();
})();
