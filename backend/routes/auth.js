const express=require('express'); const bcrypt=require('bcryptjs');
const { db }=require('../db/database'); const { requireAuth }=require('../middleware/auth');
const router=express.Router();

router.post('/login',(req,res)=>{
  const { email,password }=req.body;
  const u=db.getUserByEmail(email);
  if(!u||!u.is_active) return res.status(401).json({error:'Invalid credentials'});
  if(!bcrypt.compareSync(password||'',u.password)) return res.status(401).json({error:'Invalid credentials'});
  req.session.userId=u.id; req.session.email=u.email; req.session.fullName=u.full_name; req.session.role=u.role;
  db.touchLogin(u.id);
  res.json({ user:{ id:u.id, email:u.email, fullName:u.full_name, role:u.role } });
});
router.post('/logout',(req,res)=>{ req.session.destroy(()=>res.json({success:true})); });
router.get('/me',requireAuth,(req,res)=>res.json({
  id:req.session.userId, email:req.session.email, fullName:req.session.fullName, role:req.session.role }));
module.exports=router;
