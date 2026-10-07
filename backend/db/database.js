const path   = require('path');
const fs     = require('fs');
const bcrypt = require('bcryptjs');

// Persist to the mounted volume in production (set DATA_DIR), else alongside this file.
const DATA_DIR = process.env.DATA_DIR && process.env.DATA_DIR.trim() ? process.env.DATA_DIR.trim() : __dirname;
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('DATA_DIR init error:', e.message); }
const DB_PATH = path.join(DATA_DIR, 'data.json');
console.log('[QlickLeads] Data file:', DB_PATH);

let store = {
  users: [], clients: [], jobs: [], candidates: [], activity: [],
  _ids: { users:0, clients:0, jobs:0, candidates:0, activity:0 }
};

const now = () => new Date().toISOString();
function save(){ fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2)); }
function load(){
  if (fs.existsSync(DB_PATH)) {
    try { store = JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }
    catch(e){ console.error('DB load error:', e.message); }
  }
  ['users','clients','jobs','candidates','activity'].forEach(k=>{ if(!store[k]) store[k]=[]; });
  if(!store._ids) store._ids={};
  ['users','clients','jobs','candidates','activity'].forEach(k=>{ if(!store._ids[k]) store._ids[k]=0; });
}
function nextId(t){ store._ids[t]=(store._ids[t]||0)+1; return store._ids[t]; }

// ── ACTIVITY LOG — every create/edit/delete is recorded ──
function log(entity_type, entity_id, action, actor, detail){
  store.activity.unshift({                       // newest first
    id: nextId('activity'), entity_type, entity_id, action,
    actor: actor || 'System', detail: detail || '', at: now()
  });
  if (store.activity.length > 5000) store.activity.length = 5000;   // keep it bounded
}

const db = {
  // ── USERS ──
  getUsers: () => store.users,
  getUserByEmail: (e) => store.users.find(u=>u.email.toLowerCase()===String(e||'').toLowerCase()),
  getUserById: (id) => store.users.find(u=>u.id===Number(id)),
  createUser(d){
    const u={ id:nextId('users'), email:d.email, full_name:d.full_name, password:d.password,
      role:d.role||'recruiter', is_active:1, created_at:now(), last_login:null };
    store.users.push(u); save(); return u;
  },
  updateUser(id,d){
    const i=store.users.findIndex(u=>u.id===Number(id)); if(i<0) return null;
    const { _actor, ...rest } = d;
    store.users[i]={...store.users[i],...rest};
    if(d.password) store.users[i].password=d.password;
    log('user', Number(id), 'updated', _actor, store.users[i].full_name);
    save(); return store.users[i];
  },
  deleteUser(id, actor){
    const u=store.users.find(x=>x.id===Number(id));
    store.users=store.users.filter(x=>x.id!==Number(id));
    log('user', Number(id), 'deleted', actor, u?u.full_name:'');
    save();
  },
  touchLogin(id){ const u=db.getUserById(id); if(u){ u.last_login=now(); save(); } },

  // ── CLIENTS ──
  getClients: () => store.clients,
  getClientById: (id) => store.clients.find(c=>c.id===Number(id)),
  createClient(d){
    const c={ id:nextId('clients'), name:d.name, linkedin:d.linkedin||'',
      created_at:now(), updated_at:now(), created_by_name:d._actor||'' };
    store.clients.unshift(c);                    // newest on top
    log('client', c.id, 'created', d._actor, c.name);
    save(); return c;
  },
  updateClient(id,d){
    const i=store.clients.findIndex(c=>c.id===Number(id)); if(i<0) return null;
    const { _actor, ...rest } = d;
    store.clients[i]={...store.clients[i],...rest, updated_at:now(),
      last_edited_by:_actor||'', last_edited_at:now()};
    log('client', Number(id), 'updated', _actor, store.clients[i].name);
    save(); return store.clients[i];
  },
  deleteClient(id, actor){
    const c=db.getClientById(id);
    store.clients=store.clients.filter(x=>x.id!==Number(id));
    log('client', Number(id), 'deleted', actor, c?c.name:'');
    save();
  },

  // ── JOBS ──
  getJobs: (client_id) => client_id ? store.jobs.filter(j=>j.client_id===Number(client_id)) : store.jobs,
  getJobById: (id) => store.jobs.find(j=>j.id===Number(id)),
  createJob(d){
    const { _actor, ...rest } = d;
    const j={ id:nextId('jobs'), client_id:Number(d.client_id), title:d.title||'',
      budget:d.budget||'', location:d.location||'', jd_file:null, prescreen_file:null,
      prescreen_form:d.prescreen_form||[], created_at:now(), updated_at:now(),
      created_by_name:_actor||'', ...rest };
    j.client_id=Number(d.client_id);
    store.jobs.unshift(j);
    log('job', j.id, 'created', _actor, j.title);
    save(); return j;
  },
  updateJob(id,d){
    const i=store.jobs.findIndex(j=>j.id===Number(id)); if(i<0) return null;
    const { _actor, ...rest } = d;
    store.jobs[i]={...store.jobs[i],...rest, updated_at:now(),
      last_edited_by:_actor||'', last_edited_at:now()};
    log('job', Number(id), 'updated', _actor, store.jobs[i].title);
    save(); return store.jobs[i];
  },
  deleteJob(id, actor){
    const j=db.getJobById(id);
    store.jobs=store.jobs.filter(x=>x.id!==Number(id));
    store.candidates=store.candidates.filter(c=>c.job_id!==Number(id));
    log('job', Number(id), 'deleted', actor, j?j.title:'');
    save();
  },

  // ── CANDIDATES ──
  getCandidates: (job_id) => job_id ? store.candidates.filter(c=>c.job_id===Number(job_id)) : store.candidates,
  getCandidateById: (id) => store.candidates.find(c=>c.id===Number(id)),
  createCandidate(d){
    const { _actor, ...rest } = d;
    const c={ id:nextId('candidates'), job_id:Number(d.job_id),
      recruiter_name:d.recruiter_name||'', name:d.name||'',
      current_location:'', last_org:'', last_designation:'',
      current_ctc:'', expected_ctc:'', applying_location:'',
      match_score:'', cv:null, match_report:null, prescreen_answers:[],
      status:'CV Not Submitted',                 // default entry state
      interview_status:'', interview_stage:'', interview_at:'',
      created_at:now(), updated_at:now(), created_by:d.created_by||null,
      created_by_name:_actor||'', ...rest };
    c.job_id=Number(d.job_id);
    store.candidates.unshift(c);
    log('candidate', c.id, 'created', _actor, c.name);
    save(); return c;
  },
  updateCandidate(id,d){
    const i=store.candidates.findIndex(c=>c.id===Number(id)); if(i<0) return null;
    const { _actor, ...rest } = d;
    const prev=store.candidates[i];
    store.candidates[i]={...prev,...rest, updated_at:now(),
      last_edited_by:_actor||'', last_edited_at:now()};
    if(d.status && d.status!==prev.status){
      store.candidates[i].status_changed_at=now();
      log('candidate', Number(id), 'stage changed', _actor, `${prev.name}: ${prev.status} → ${d.status}`);
    } else {
      log('candidate', Number(id), 'updated', _actor, prev.name);
    }
    save(); return store.candidates[i];
  },
  deleteCandidate(id, actor){
    const c=db.getCandidateById(id);
    store.candidates=store.candidates.filter(x=>x.id!==Number(id));
    log('candidate', Number(id), 'deleted', actor, c?c.name:'');
    save();
  },

  // ── ACTIVITY ──
  getActivity: (filter={}) => {
    let a=store.activity;
    if(filter.entity_type) a=a.filter(x=>x.entity_type===filter.entity_type);
    if(filter.entity_id)   a=a.filter(x=>x.entity_id===Number(filter.entity_id));
    return a.slice(0, Number(filter.limit)||200);
  },
  logAction: log
};

function initDb(){
  const dir=path.dirname(DB_PATH);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  load();
  if(store.users.length===0){
    db.createUser({ email:'divyansh@jobqlick.com', full_name:'Divyansh',
      password:bcrypt.hashSync(process.env.ADMIN_PASSWORD||'DShree@123',10), role:'admin' });
    console.log('Admin seeded → divyansh@jobqlick.com');
  }
  console.log(`DB ready — ${store.users.length} users, ${store.clients.length} clients, ${store.jobs.length} jobs, ${store.candidates.length} candidates`);
}

module.exports = { db, initDb };
