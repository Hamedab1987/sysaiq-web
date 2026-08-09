// SysaiQ admin panel — vanilla JS SPA. Talks to /api/admin/*.
const $ = s => document.querySelector(s);
const api = {
  async get(p){ const r = await fetch('/api/admin'+p); if(r.status===401) throw 'auth'; return r.json(); },
  async send(m,p,body){ const r = await fetch('/api/admin'+p,{method:m,headers:{'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined}); if(r.status===401) throw 'auth'; return r.json(); },
  post:(p,b)=>api.send('POST',p,b), put:(p,b)=>api.send('PUT',p,b), del:p=>api.send('DELETE',p),
};
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---- auth ----
async function doLogin(){
  const r = await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:$('#lg-user').value,password:$('#lg-pass').value})});
  if(r.ok){ boot(); } else { $('#lg-err').textContent='Invalid username or password.'; }
}
async function doLogout(){ await fetch('/api/admin/logout',{method:'POST'}); location.reload(); }

const TABS = [
  ['content','Content'], ['projects','Projects'], ['faqs','FAQ'],
  ['knowledge','Knowledge Base'], ['ai','AI Assistant'], ['leads','Leads'], ['conversations','AI Log'],
];
let current='content';

function renderTabs(){
  $('#tabs').innerHTML = TABS.map(([k,l])=>`<button class="${k===current?'on':''}" onclick="go('${k}')">${l}</button>`).join('');
}
function go(k){ current=k; renderTabs(); render(); }

async function render(){
  const v=$('#view'); v.innerHTML='<p class="muted">Loading…</p>';
  try{ await VIEWS[current](v); }
  catch(e){ if(e==='auth'){ showLogin(); } else { v.innerHTML='<p class="muted">Error loading.</p>'; console.error(e);} }
}

const VIEWS = {
  // ---- site content (settings) ----
  async content(v){
    const s = await api.get('/settings');
    const fields = [
      ['hero_h1','Hero heading'], ['hero_note_l','Hero note (left / mono)'],
      ['hero_note_r','Hero note (right)'], ['about_1','About — paragraph 1'],
      ['about_2','About — paragraph 2'], ['contact_email','Contact email'],
    ];
    v.innerHTML = `<h2 class="section">Site content</h2>
      <p class="hint">Edit the main bilingual copy. Changes go live immediately.</p>` +
      fields.map(([k,label])=>{
        const val=s[k]||{en:'',fa:''};
        return `<div class="item"><h3>${label}</h3>
          <div class="grid2">
            <div><label>English</label><textarea data-k="${k}" data-l="en">${esc(val.en)}</textarea></div>
            <div class="fa-field"><label>فارسی</label><textarea data-k="${k}" data-l="fa">${esc(val.fa)}</textarea></div>
          </div>
          <div class="actions"><button class="btn sm" onclick="saveSetting('${k}',this)">Save</button></div>
        </div>`;
      }).join('');
  },

  // ---- projects ----
  async projects(v){
    const list = await api.get('/projects');
    v.innerHTML = `<h2 class="section">Projects <span class="muted">(work slider)</span></h2>
      <p class="hint">Add, edit, reorder (sort number) or remove portfolio cards.</p>
      <button class="btn sm" style="margin-bottom:14px" onclick="newProject()">+ New project</button>
      <div id="plist">${list.map(projectCard).join('')}</div>`;
  },

  // ---- faqs ----
  async faqs(v){
    const list = await api.get('/faqs');
    v.innerHTML = `<h2 class="section">FAQ</h2><p class="hint">Questions shown on the site.</p>
      <button class="btn sm" style="margin-bottom:14px" onclick="newFaq()">+ New question</button>
      <div id="flist">${list.map(faqCard).join('')}</div>`;
  },

  // ---- knowledge base ----
  async knowledge(v){
    const list = await api.get('/knowledge');
    v.innerHTML = `<h2 class="section">Knowledge Base <span class="muted">(feeds the AI assistant)</span></h2>
      <p class="hint">Each entry is a fact the AI assistant can use to answer visitors. Disable to exclude without deleting.</p>
      <button class="btn sm" style="margin-bottom:14px" onclick="newKnowledge()">+ New entry</button>
      <div id="klist">${list.map(kbCard).join('')}</div>`;
  },

  // ---- AI assistant config ----
  async ai(v){
    const c = await api.get('/ai-config');
    const models = ['gpt-4o-mini','gpt-4o','gpt-4.1-mini','gpt-4.1'];
    v.innerHTML = `<h2 class="section">AI Assistant</h2>
      <p class="hint">Connect your OpenAI key so the site's chat assistant can answer visitors. The key is stored securely on the server and never shown again.</p>
      <div class="item">
        <h3>Connection ${c.configured?'<span class="badge" style="border-color:var(--mint);color:var(--mint)">● connected</span>':'<span class="badge" style="border-color:var(--danger);color:var(--danger)">not configured</span>'}</h3>
        ${c.configured?`<p class="muted" style="margin-bottom:10px">Current key: ${esc(c.key_hint)} &middot; source: ${c.source}</p>`:''}
        <label>OpenAI API key</label>
        <input id="ai-key" type="password" placeholder="sk-..." autocomplete="off">
        <p class="muted" style="font-size:11.5px;margin-top:4px">Paste a key to set or replace it. Leave blank to keep the current one. Get one at platform.openai.com/api-keys</p>
        <label style="margin-top:14px">Model</label>
        <select id="ai-model">${models.map(m=>`<option value="${m}" ${m===c.model?'selected':''}>${m}</option>`).join('')}</select>
        <div class="actions"><button class="btn sm" onclick="saveAI(this)">Save</button>
          <button class="btn ghost sm" onclick="testAI(this)">Test assistant</button></div>
        <p id="ai-test" class="muted" style="margin-top:8px"></p>
      </div>
      <div class="item">
        <h3>How it answers</h3>
        <p class="muted">The assistant replies only from your <a href="#" onclick="go('knowledge');return false">Knowledge Base</a> — add entries there to teach it about your services, projects and process. It auto-detects Persian vs English and replies in the visitor's language.</p>
      </div>`;
  },

  // ---- leads ----
  async leads(v){
    const list = await api.get('/leads');
    v.innerHTML = `<h2 class="section">Leads <span class="muted">(${list.length})</span></h2>
      <p class="hint">Submissions from the contact form and AI-qualified leads.</p>
      ${list.length?list.map(leadCard).join(''):'<p class="muted">No leads yet.</p>'}`;
  },

  // ---- ai conversation log ----
  async conversations(v){
    const list = await api.get('/conversations');
    v.innerHTML = `<h2 class="section">AI conversation log</h2>
      <p class="hint">Latest assistant activity (most recent first).</p>
      <div class="item chatlog">${list.length?list.map(c=>
        `<div><span class="${c.role==='user'?'u':'a'}">${c.role==='user'?'▸ visitor':'◂ assistant'}</span>
         <span class="badge">${c.language||''}</span> <span class="muted">${c.created_at}</span><br>${esc(c.content)}</div>`
      ).join(''):'<p class="muted">No conversations yet.</p>'}</div>`;
  },
};

// ---- card templates ----
function projectCard(p){
  return `<div class="item" data-id="${p.id}">
    <div class="grid2">
      <div><label>Title (EN)</label><input data-f="title_en" value="${esc(p.title_en)}"></div>
      <div class="fa-field"><label>عنوان (FA)</label><input data-f="title_fa" value="${esc(p.title_fa)}"></div>
    </div>
    <div class="grid2">
      <div><label>Description (EN)</label><textarea data-f="desc_en">${esc(p.desc_en)}</textarea></div>
      <div class="fa-field"><label>توضیح (FA)</label><textarea data-f="desc_fa">${esc(p.desc_fa)}</textarea></div>
    </div>
    <div class="row">
      <div><label>Tags</label><input data-f="tags" value="${esc(p.tags)}"></div>
      <div><label>Image URL</label><input data-f="image" value="${esc(p.image)}"></div>
      <div style="flex:0;min-width:90px"><label>Sort</label><input data-f="sort" type="number" value="${p.sort}"></div>
    </div>
    <div class="actions">
      <label style="display:inline-flex;align-items:center;gap:6px;text-transform:none;margin:0">
        <input type="checkbox" data-f="published" ${p.published?'checked':''} style="width:auto"> Published</label>
      <input type="file" accept="image/*" style="width:auto;flex:0" onchange="uploadFor(this,'.item[data-id=&quot;${p.id}&quot;] [data-f=image]')">
      <button class="btn sm" onclick="saveProject(${p.id},this)">Save</button>
      <button class="btn sm danger" onclick="delProject(${p.id})">Delete</button>
    </div>
  </div>`;
}
function faqCard(f){
  return `<div class="item" data-id="${f.id}">
    <div class="grid2">
      <div><label>Question (EN)</label><input data-f="q_en" value="${esc(f.q_en)}"></div>
      <div class="fa-field"><label>سؤال (FA)</label><input data-f="q_fa" value="${esc(f.q_fa)}"></div>
    </div>
    <div class="grid2">
      <div><label>Answer (EN)</label><textarea data-f="a_en">${esc(f.a_en)}</textarea></div>
      <div class="fa-field"><label>پاسخ (FA)</label><textarea data-f="a_fa">${esc(f.a_fa)}</textarea></div>
    </div>
    <div class="actions">
      <div style="flex:0;min-width:90px"><input data-f="sort" type="number" value="${f.sort}" title="sort"></div>
      <label style="display:inline-flex;align-items:center;gap:6px;text-transform:none;margin:0">
        <input type="checkbox" data-f="published" ${f.published?'checked':''} style="width:auto"> Published</label>
      <button class="btn sm" onclick="saveFaq(${f.id},this)">Save</button>
      <button class="btn sm danger" onclick="delFaq(${f.id})">Delete</button>
    </div>
  </div>`;
}
function kbCard(k){
  return `<div class="item" data-id="${k.id}">
    <div class="row">
      <div><label>Title</label><input data-f="title" value="${esc(k.title)}"></div>
      <div><label>Tags</label><input data-f="tags" value="${esc(k.tags)}"></div>
    </div>
    <div class="grid2">
      <div><label>Content (EN)</label><textarea data-f="body_en">${esc(k.body_en)}</textarea></div>
      <div class="fa-field"><label>محتوا (FA)</label><textarea data-f="body_fa">${esc(k.body_fa)}</textarea></div>
    </div>
    <div class="actions">
      <label style="display:inline-flex;align-items:center;gap:6px;text-transform:none;margin:0">
        <input type="checkbox" data-f="enabled" ${k.enabled?'checked':''} style="width:auto"> Enabled</label>
      <button class="btn sm" onclick="saveKnowledge(${k.id},this)">Save</button>
      <button class="btn sm danger" onclick="delKnowledge(${k.id})">Delete</button>
    </div>
  </div>`;
}
function leadCard(l){
  return `<div class="item lead">
    <div class="row"><div><b>${esc(l.name)||'(no name)'}</b> <span class="badge">${l.language}</span> <span class="badge">${l.source}</span></div>
    <div class="muted" style="flex:0;text-align:right">${l.created_at}</div></div>
    <p class="muted" style="margin:6px 0">${esc(l.email)} ${l.phone?'· '+esc(l.phone):''} ${l.company?'· '+esc(l.company):''}</p>
    ${l.project_type?`<p><span class="muted">Type:</span> ${esc(l.project_type)}</p>`:''}
    ${l.message?`<p style="margin-top:6px">${esc(l.message)}</p>`:''}
    ${l.summary?`<p class="muted" style="margin-top:6px">AI: ${esc(l.summary)}</p>`:''}
    <div class="actions"><button class="btn sm danger" onclick="delLead(${l.id})">Delete</button></div>
  </div>`;
}

// ---- collect fields from a card ----
function collect(el){
  const o={};
  el.querySelectorAll('[data-f]').forEach(i=>{
    o[i.dataset.f] = i.type==='checkbox' ? i.checked : i.value;
  });
  return o;
}
function card(btn){ return btn.closest('.item'); }

// ---- settings ----
async function saveSetting(k,btn){
  const item=card(btn), value={};
  item.querySelectorAll('[data-k]').forEach(t=>value[t.dataset.l]=t.value);
  await api.put('/settings/'+k,{value}); toast('Saved');
}
// ---- projects ----
async function newProject(){ await api.post('/projects',{title_en:'New project',published:1,sort:99}); go('projects'); }
async function saveProject(id,btn){ await api.put('/projects/'+id,collect(card(btn))); toast('Saved'); }
async function delProject(id){ if(confirm('Delete this project?')){ await api.del('/projects/'+id); go('projects'); } }
// ---- faqs ----
async function newFaq(){ await api.post('/faqs',{q_en:'New question',published:1,sort:99}); go('faqs'); }
async function saveFaq(id,btn){ await api.put('/faqs/'+id,collect(card(btn))); toast('Saved'); }
async function delFaq(id){ if(confirm('Delete this FAQ?')){ await api.del('/faqs/'+id); go('faqs'); } }
// ---- knowledge ----
async function newKnowledge(){ await api.post('/knowledge',{title:'New entry',enabled:1}); go('knowledge'); }
async function saveKnowledge(id,btn){ await api.put('/knowledge/'+id,collect(card(btn))); toast('Saved'); }
async function delKnowledge(id){ if(confirm('Delete this entry?')){ await api.del('/knowledge/'+id); go('knowledge'); } }
// ---- ai config ----
async function saveAI(btn){
  const key=$('#ai-key').value.trim(), model=$('#ai-model').value;
  await api.put('/ai-config',{ openai_key:key, model }); toast('Saved'); go('ai');
}
async function testAI(btn){
  const el=$('#ai-test'); el.textContent='Testing…';
  try{
    const r=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:'In one short sentence, what is SysaiQ?'})});
    const j=await r.json();
    el.textContent = (j.configured?'✓ ':'⚠ ')+j.reply;
    el.style.color = j.configured?'var(--mint)':'var(--danger)';
  }catch(e){ el.textContent='Test failed — is the server reachable?'; el.style.color='var(--danger)'; }
}
// ---- leads ----
async function delLead(id){ if(confirm('Delete this lead?')){ await api.del('/leads/'+id); go('leads'); } }
// ---- upload ----
async function uploadFor(input,sel){
  if(!input.files[0]) return;
  const fd=new FormData(); fd.append('file',input.files[0]);
  const r=await fetch('/api/admin/upload',{method:'POST',body:fd}); const j=await r.json();
  if(j.url){ document.querySelector(sel).value=j.url; toast('Uploaded — remember to Save'); }
}

// ---- boot ----
function showLogin(){ $('#login').style.display='flex'; $('#app').style.display='none'; }
async function boot(){
  try{ await api.get('/me'); $('#login').style.display='none'; $('#app').style.display='block'; renderTabs(); render(); }
  catch{ showLogin(); }
}
$('#lg-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
boot();
