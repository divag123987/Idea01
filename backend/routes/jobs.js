const express = require('express');
const multer  = require('multer');
const { db }  = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 10*1024*1024 } });
router.use(requireAuth);

const DOC_RX = /\.(pdf|docx?)$/i;
// Lists never carry file blobs — keeps payloads small and the UI fast
const lite = j => {
  const { jd_file, prescreen_file, ...r } = j;
  return { ...r,
    jd_file: jd_file ? { name: jd_file.name } : null,
    prescreen_file: prescreen_file ? { name: prescreen_file.name } : null };
};

router.get('/', (req,res) => {
  const clients = db.getClients();
  const cands   = db.getCandidates();
  const byJob   = new Map();
  cands.forEach(c => { if(!byJob.has(c.job_id)) byJob.set(c.job_id, []); byJob.get(c.job_id).push(c); });
  const out = db.getJobs(req.query.client_id).map(j => {
    const cl = clients.find(c => c.id === j.client_id);
    const jc = byJob.get(j.id) || [];
    const by = s => jc.filter(c => c.status === s).length;
    return { ...lite(j), client_name: cl ? cl.name : '—',
      total_candidates: jc.length,
      cv_not_submitted: by('CV Not Submitted'), cv_submitted: by('CV Submitted'),
      hr_rejected: by('HR Rejected'), shortlisted: by('Shortlisted'),
      offered: jc.filter(c => c.interview_status === 'Offered').length };
  });
  res.json(out);
});

router.get('/:id', (req,res) => {
  const j = db.getJobById(req.params.id);
  j ? res.json(j) : res.status(404).json({ error:'Not found' });
});

router.post('/', (req,res) => {
  const { client_id, title } = req.body;
  if (!client_id) return res.status(400).json({ error:'Client is required' });
  if (!title)     return res.status(400).json({ error:'Job title is required' });
  res.status(201).json(db.createJob({ ...req.body, created_by:req.session.userId, _actor:req.session.fullName }));
});

router.put('/:id', (req,res) => {
  const j = db.updateJob(req.params.id, { ...req.body, _actor:req.session.fullName });
  j ? res.json(j) : res.status(404).json({ error:'Not found' });
});

router.delete('/:id', (req,res) => { db.deleteJob(req.params.id, req.session.fullName); res.json({ success:true }); });

// ── File uploads: JD + pre-screening document ──
function attach(field){
  return (req,res) => {
    const id = Number(req.params.id);
    if (!db.getJobById(id))  return res.status(404).json({ error:'Not found' });
    if (!req.file)           return res.status(400).json({ error:'No file uploaded' });
    if (!DOC_RX.test(req.file.originalname||'')) return res.status(400).json({ error:'Only PDF or Word files are allowed' });
    db.updateJob(id, { [field]: { base64:req.file.buffer.toString('base64'),
      mime:req.file.mimetype, name:req.file.originalname }, _actor:req.session.fullName });
    res.json({ success:true, name:req.file.originalname });
  };
}
function download(field,label){
  return (req,res) => {
    const j = db.getJobById(req.params.id);
    if (!j || !j[field]) return res.status(404).json({ error:`No ${label}` });
    res.setHeader('Content-Disposition', `attachment; filename="${j[field].name}"`);
    res.setHeader('Content-Type', j[field].mime || 'application/octet-stream');
    res.send(Buffer.from(j[field].base64, 'base64'));
  };
}
router.post('/:id/jd', upload.single('file'), attach('jd_file'));
router.get('/:id/jd/download', download('jd_file','JD'));
router.post('/:id/prescreen', upload.single('file'), attach('prescreen_file'));
router.get('/:id/prescreen/download', download('prescreen_file','pre-screening file'));

// ── Pre-screening question form (filled when a candidate is added) ──
router.get('/:id/form', (req,res) => {
  const j = db.getJobById(req.params.id);
  j ? res.json(j.prescreen_form || []) : res.status(404).json({ error:'Not found' });
});
router.put('/:id/form', (req,res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions)) return res.status(400).json({ error:'questions must be an array' });
  const clean = questions.filter(q => q && q.label).map(q => ({
    id: q.id || Date.now() + Math.random().toString(36).slice(2,7),
    type: ['single','multi','text'].includes(q.type) ? q.type : 'text',
    label: String(q.label).trim(),
    options: Array.isArray(q.options) ? q.options.filter(Boolean).map(String) : [],
    required: !!q.required
  }));
  const j = db.updateJob(req.params.id, { prescreen_form: clean, _actor:req.session.fullName });
  j ? res.json(j.prescreen_form) : res.status(404).json({ error:'Not found' });
});

module.exports = router;
