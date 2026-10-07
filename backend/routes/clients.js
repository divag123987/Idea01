const express=require('express'); const { db }=require('../db/database');
const { requireAuth }=require('../middleware/auth');
const router=express.Router(); router.use(requireAuth);

router.get('/',(req,res)=>res.json(db.getClients()));
router.get('/:id',(req,res)=>{ const c=db.getClientById(req.params.id); c?res.json(c):res.status(404).json({error:'Not found'}); });
router.post('/',(req,res)=>{
  const { name }=req.body;
  if(!name) return res.status(400).json({error:'Client name is required'});
  res.status(201).json(db.createClient({ ...req.body, _actor:req.session.fullName }));
});
router.put('/:id',(req,res)=>{
  const c=db.updateClient(req.params.id,{ ...req.body, _actor:req.session.fullName });
  c?res.json(c):res.status(404).json({error:'Not found'});
});
router.delete('/:id',(req,res)=>{ db.deleteClient(req.params.id,req.session.fullName); res.json({success:true}); });
module.exports=router;
