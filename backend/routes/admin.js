const express=require('express'); const bcrypt=require('bcryptjs');
const { db }=require('../db/database');
const { requireAuth, requireAdmin }=require('../middleware/auth');
const router=express.Router();

const VALID_ROLES=['admin','recruiter'];
const ROLE_LABELS={ admin:'Admin', recruiter:'Recruiter' };

router.get('/users-by-role', requireAuth, (req,res)=>{
  res.json(db.getUsers().filter(u=>u.is_active)
    .map(u=>({ id:u.id, full_name:u.full_name, email:u.email, role:u.role, role_label:ROLE_LABELS[u.role]||u.role })));
});

router.use(requireAuth, requireAdmin);

router.get('/users',(req,res)=>res.json(db.getUsers().map(u=>({ ...u, password:undefined }))));
router.post('/users',(req,res)=>{
  const { email, full_name, password, role }=req.body;
  if(!email||!full_name||!password) return res.status(400).json({error:'Email, name and password are required'});
  if(db.getUserByEmail(email)) return res.status(409).json({error:'A user with this email already exists'});
  const u=db.createUser({ email, full_name, password:bcrypt.hashSync(password,10),
    role:VALID_ROLES.includes(role)?role:'recruiter' });
  db.logAction('user',u.id,'created',req.session.fullName,full_name);
  res.status(201).json({ ...u, password:undefined });
});
router.put('/users/:id',(req,res)=>{
  const u=db.getUserById(req.params.id);
  if(!u) return res.status(404).json({error:'Not found'});
  const upd={ full_name:req.body.full_name||u.full_name,
    role:VALID_ROLES.includes(req.body.role)?req.body.role:u.role,
    is_active:req.body.is_active?1:0, _actor:req.session.fullName };
  if(req.body.password) upd.password=bcrypt.hashSync(req.body.password,10);
  res.json({ ...db.updateUser(req.params.id,upd), password:undefined });
});
router.delete('/users/:id',(req,res)=>{ db.deleteUser(req.params.id,req.session.fullName); res.json({success:true}); });

// Recruiter performance
router.get('/recruiter-analysis',(req,res)=>{
  const cands=db.getCandidates(), users=db.getUsers().filter(u=>u.is_active);
  const rows=users.map(u=>{
    const mine=cands.filter(c=>c.recruiter_name===u.full_name||c.created_by===u.id);
    const n=s=>mine.filter(c=>c.status===s).length;
    const sub=n('CV Submitted')+n('Shortlisted');
    return { id:u.id, name:u.full_name, role:ROLE_LABELS[u.role]||u.role, last_login:u.last_login,
      total:mine.length, submitted:sub, shortlisted:n('Shortlisted'), rejected:n('HR Rejected'),
      offered:mine.filter(c=>c.interview_status==='Offered').length,
      shortlist_rate: sub? Math.round(n('Shortlisted')/sub*100):0 };
  }).sort((a,b)=>b.total-a.total);
  res.json(rows);
});
module.exports=router;
