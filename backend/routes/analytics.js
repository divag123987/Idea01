const express=require('express'); const { db }=require('../db/database');
const { requireAuth }=require('../middleware/auth');
const router=express.Router(); router.use(requireAuth);

const OFFER_STAGES=['Selected','Offer Released','Offer Accepted','Resigned','Joined','30 Days Done'];

// Overall / per-job / per-client analytics in one endpoint
router.get('/', (req,res)=>{
  const { job_id, client_id } = req.query;
  const clients=db.getClients(), jobs=db.getJobs();
  let cands=db.getCandidates(), scopeJobs=jobs, label='Overall', scope='all';

  if(job_id){ scopeJobs=jobs.filter(j=>j.id===Number(job_id));
    cands=cands.filter(c=>c.job_id===Number(job_id));
    label=(scopeJobs[0]&&scopeJobs[0].title)||'Job'; scope='job'; }
  else if(client_id){ scopeJobs=jobs.filter(j=>j.client_id===Number(client_id));
    const ids=new Set(scopeJobs.map(j=>j.id));
    cands=cands.filter(c=>ids.has(c.job_id));
    const cl=clients.find(c=>c.id===Number(client_id)); label=cl?cl.name:'Client'; scope='client'; }

  const by=s=>cands.filter(c=>c.status===s).length;
  const iby=s=>cands.filter(c=>c.interview_status===s).length;
  // CVs added per day for the last 30 days
  const days=[]; for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().split('T')[0]); }
  const daily=days.map(d=>({ d, n:cands.filter(c=>(c.created_at||'').startsWith(d)).length }));
  // per-recruiter split
  const recs={}; cands.forEach(c=>{ const r=c.recruiter_name||'Unassigned';
    if(!recs[r]) recs[r]={ name:r, total:0, submitted:0, shortlisted:0, offered:0 };
    recs[r].total++;
    if(c.status==='CV Submitted') recs[r].submitted++;
    if(c.status==='Shortlisted') recs[r].shortlisted++;
    if(c.interview_status==='Offered') recs[r].offered++; });

  res.json({
    scope, label,
    stats:{ clients:scope==='all'?clients.length:1, jobs:scopeJobs.length, candidates:cands.length,
      cv_not_submitted:by('CV Not Submitted'), cv_submitted:by('CV Submitted'),
      hr_rejected:by('HR Rejected'), shortlisted:by('Shortlisted'),
      in_interview:iby('Interview'), offered:iby('Offered'), rejected:iby('Rejected') },
    daily,
    recruiters:Object.values(recs).sort((a,b)=>b.total-a.total),
    offer_pipeline:OFFER_STAGES.map(st=>({ stage:st, count:cands.filter(c=>c.offer_stage===st).length })),
    filters:{ clients:clients.map(c=>({id:c.id,name:c.name})),
              jobs:jobs.map(j=>({id:j.id,title:j.title,client_id:j.client_id})) }
  });
});
// ── ALERTS: candidate stage untouched for 4+ days ──
// Clears automatically the moment the status moves, and never fires once
// the candidate has reached a settled state (HR Rejected / Offered).
router.get('/alerts',(req,res)=>{
  const SETTLED_STATUS=['HR Rejected'];
  const SETTLED_INT=['Rejected','Offered'];
  const jobs=db.getJobs(), clients=db.getClients();
  const nowMs=Date.now();
  const daysSince=iso=>iso?Math.floor((nowMs-new Date(iso).getTime())/86400000):null;
  const rows=[];
  db.getCandidates().forEach(c=>{
    if(SETTLED_STATUS.includes(c.status)) return;
    if(SETTLED_INT.includes(c.interview_status)) return;
    // last time anything moved on this candidate
    const ref=c.status_changed_at||c.last_edited_at||c.updated_at||c.created_at;
    const d=daysSince(ref);
    if(d===null||d<4) return;
    const j=jobs.find(x=>x.id===c.job_id);
    const cl=j?clients.find(x=>x.id===j.client_id):null;
    rows.push({ id:c.id, name:c.name, job_id:c.job_id,
      job_title:j?j.title:'—', client_name:cl?cl.name:'—',
      status:c.status, interview_status:c.interview_status||'',
      recruiter:c.recruiter_name||'Unassigned', days:d,
      severity:d>=10?'high':d>=7?'medium':'low',
      last_touch:ref });
  });
  rows.sort((a,b)=>b.days-a.days);
  res.json({ count:rows.length, alerts:rows });
});
router.get('/activity',(req,res)=>res.json(db.getActivity(req.query)));
module.exports=router;
