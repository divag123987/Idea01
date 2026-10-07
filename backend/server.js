const express = require('express');
const session = require('express-session');
const path    = require('path');
const { initDb } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;
const FRONTEND = path.join(__dirname, '..', 'frontend', 'public');

initDb();

app.use(express.json({ limit:'25mb' }));
app.use(express.urlencoded({ extended:true, limit:'25mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'qlickleads_secret_change_me',
  resave:false, saveUninitialized:false,
  cookie:{ maxAge: 1000*60*60*12 }
}));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/clients',    require('./routes/clients'));
app.use('/api/jobs',       require('./routes/jobs'));
app.use('/api/candidates', require('./routes/candidates'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/admin',      require('./routes/admin'));

app.use(express.static(FRONTEND));
app.get('*', (req,res)=>res.sendFile(path.join(FRONTEND,'index.html')));

app.listen(PORT, ()=>{
  console.log(`\nQlickLeads RPO running → http://localhost:${PORT}`);
  console.log('Login: divyansh@jobqlick.com / DShree@123\n');
});
