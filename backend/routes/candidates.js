const express = require('express');
const multer  = require('multer');
const ExcelJS = require('exceljs');
const { db }  = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 10*1024*1024 } });
router.use(requireAuth);

const STATUSES  = ['CV Not Submitted','CV Submitted','HR Rejected','Shortlisted'];
const INT_STATUS= ['Shortlisted','Interview','Rejected','Offered'];
const INT_STAGE = ['HR Round 1','HR Round 2','HR Round 3','HM Round 1','HM Round 2','HM Round 3'];

// Lists never carry file blobs
const lite = c => {
  const { cv, match_report, ...r } = c;
  return { ...r, cv: cv ? { name:cv.name } : null, match_report: match_report ? { name:match_report.name } : null };
};
function enrich(list){
  const jobs=db.getJobs(), clients=db.getClients();
  return list.map(c=>{
    const j=jobs.find(x=>x.id===c.job_id);
    const cl=j?clients.find(x=>x.id===j.client_id):null;
    return { ...lite(c), job_title:j?j.title:'—', client_name:cl?cl.name:'—',
             client_id:cl?cl.id:null, job_location:j?j.location:'' };
  });
}

router.get('/', (req,res) => res.json(enrich(db.getCandidates(req.query.job_id))));
router.get('/meta', (req,res) => res.json({ statuses:STATUSES, interview_statuses:INT_STATUS, interview_stages:INT_STAGE }));
router.get('/:id', (req,res) => {
  const c=db.getCandidateById(req.params.id);
  c ? res.json(c) : res.status(404).json({ error:'Not found' });
});

router.post('/', (req,res) => {
  const { job_id, name } = req.body;
  if (!job_id) return res.status(400).json({ error:'Job is required' });
  if (!name)   return res.status(400).json({ error:'Candidate name is required' });
  if (!db.getJobById(job_id)) return res.status(404).json({ error:'Job not found' });
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'CV Not Submitted';
  res.status(201).json(lite(db.createCandidate({ ...req.body, status,
    created_by:req.session.userId, _actor:req.session.fullName })));
});

router.put('/:id', (req,res) => {
  const d = { ...req.body, _actor:req.session.fullName };
  if (d.status && !STATUSES.includes(d.status)) delete d.status;
  if (d.interview_status && !INT_STATUS.includes(d.interview_status)) delete d.interview_status;
  if (d.interview_stage && d.interview_stage && !INT_STAGE.includes(d.interview_stage)) delete d.interview_stage;
  // Moving someone to Shortlisted seeds the interview pipeline
  if (d.status === 'Shortlisted') {
    const prev = db.getCandidateById(req.params.id);
    if (prev && !prev.interview_status) d.interview_status = 'Shortlisted';
  }
  const c = db.updateCandidate(req.params.id, d);
  c ? res.json(lite(c)) : res.status(404).json({ error:'Not found' });
});

router.delete('/:id', (req,res) => { db.deleteCandidate(req.params.id, req.session.fullName); res.json({ success:true }); });

// ── CV + match report upload/download ──
function attach(field){
  return (req,res) => {
    const id=Number(req.params.id);
    if(!db.getCandidateById(id)) return res.status(404).json({ error:'Not found' });
    if(!req.file)                return res.status(400).json({ error:'No file uploaded' });
    if(!/\.(pdf|docx?)$/i.test(req.file.originalname||'')) return res.status(400).json({ error:'Only PDF or Word files are allowed' });
    const patch={ [field]:{ base64:req.file.buffer.toString('base64'), mime:req.file.mimetype, name:req.file.originalname }, _actor:req.session.fullName };
    // Attaching a CV naturally moves the candidate to "CV Submitted"
    if(field==='cv'){ const c=db.getCandidateById(id); if(c && c.status==='CV Not Submitted') patch.status='CV Submitted'; }
    db.updateCandidate(id, patch);
    res.json({ success:true, name:req.file.originalname });
  };
}
function download(field,label){
  return (req,res) => {
    const c=db.getCandidateById(req.params.id);
    if(!c||!c[field]) return res.status(404).json({ error:`No ${label}` });
    res.setHeader('Content-Disposition',`attachment; filename="${c[field].name}"`);
    res.setHeader('Content-Type', c[field].mime||'application/octet-stream');
    res.send(Buffer.from(c[field].base64,'base64'));
  };
}
router.post('/:id/cv', upload.single('file'), attach('cv'));
router.get('/:id/cv/download', download('cv','CV'));
router.post('/:id/report', upload.single('file'), attach('match_report'));
router.get('/:id/report/download', download('match_report','match report'));

// ── EXPORT: selected ids or everything ──
router.get('/export/excel', async (req,res) => {
  try{
    let list = db.getCandidates();
    if (req.query.ids) {
      const set = new Set(String(req.query.ids).split(',').map(Number).filter(Boolean));
      if (set.size) list = list.filter(c => set.has(c.id));
    }
    const rows = enrich(list);
    const wb = new ExcelJS.Workbook(); wb.creator='QlickLeads';
    const ws = wb.addWorksheet('Candidates',{ views:[{ freezeRows:1 }] });
    ws.columns=[
      {header:'Candidate',key:'name',width:22},{header:'Job',key:'job',width:24},
      {header:'Client',key:'client',width:20},{header:'Status',key:'status',width:17},
      {header:'Recruiter',key:'rec',width:18},{header:'Current Location',key:'loc',width:18},
      {header:'Last Organisation',key:'org',width:22},{header:'Last Designation',key:'desig',width:20},
      {header:'Current CTC',key:'cctc',width:14},{header:'Expected CTC',key:'ectc',width:14},
      {header:'Applying For',key:'apply',width:18},{header:'Match Score',key:'score',width:12},{header:'Brief',key:'brief',width:42},
      {header:'Interview Status',key:'istatus',width:16},{header:'Interview Stage',key:'istage',width:16},
      {header:'Interview At',key:'iat',width:18},{header:'Added On',key:'added',width:14}];
    ws.getRow(1).eachCell(c=>{ c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2563C9'}}; c.font={color:{argb:'FFFFFFFF'},bold:true}; });
    rows.forEach((c,i)=>{
      const r=ws.addRow({ name:c.name, job:c.job_title, client:c.client_name, status:c.status,
        rec:c.recruiter_name, loc:c.current_location, org:c.last_org, desig:c.last_designation,
        cctc:c.current_ctc, ectc:c.expected_ctc, apply:c.applying_location, score:c.match_score, brief:c.brief,
        istatus:c.interview_status, istage:c.interview_stage, iat:c.interview_at,
        added:(c.created_at||'').split('T')[0] });
      if(i%2) r.eachCell(cell=>{ cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F7FB'}}; });
    });
    res.setHeader('Content-Disposition','attachment; filename="candidates.xlsx"');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res); res.end();
  }catch(e){ if(!res.headersSent) res.status(500).json({ error:'Export failed: '+e.message }); }
});

module.exports = router;
