const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-only-change-me';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DB_URL = process.env.DATABASE_URL;
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
let pool;
let dbReady = false;

async function initializeDb() {
  if (!DB_URL) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DB_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined, max: 3, idleTimeoutMillis: 10000 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE IF NOT EXISTS channels (id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '', color text NOT NULL DEFAULT 'lavender');
    CREATE TABLE IF NOT EXISTS ideas (id text PRIMARY KEY, title text NOT NULL, channel_id text REFERENCES channels(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'Idea', kind text NOT NULL DEFAULT 'idea', notes text NOT NULL DEFAULT '', assignee text NOT NULL DEFAULT '', due_date date, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS votes (idea_id text REFERENCES ideas(id) ON DELETE CASCADE, member_id text REFERENCES members(id) ON DELETE CASCADE, vote text NOT NULL, PRIMARY KEY (idea_id, member_id));
    CREATE TABLE IF NOT EXISTS comments (id text PRIMARY KEY, idea_id text REFERENCES ideas(id) ON DELETE CASCADE, member_id text REFERENCES members(id) ON DELETE CASCADE, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS schedule (id text PRIMARY KEY, title text NOT NULL, channel_id text REFERENCES channels(id) ON DELETE SET NULL, member_id text REFERENCES members(id) ON DELETE SET NULL, due_date date NOT NULL, kind text NOT NULL DEFAULT 'Publishing');
    CREATE TABLE IF NOT EXISTS prompts (id text PRIMARY KEY, title text NOT NULL, tool text NOT NULL DEFAULT '', channel_id text REFERENCES channels(id) ON DELETE SET NULL, body text NOT NULL, tags text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS assets (id text PRIMARY KEY, title text NOT NULL, url text NOT NULL, channel_id text REFERENCES channels(id) ON DELETE SET NULL, note text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'Reference', created_at timestamptz NOT NULL DEFAULT now());
  `);
  await pool.query("INSERT INTO channels (id,name,description,url,color) VALUES ('common','Common','Ideas and plans shared across both channels.','','mint') ON CONFLICT DO NOTHING");
  await pool.query(`INSERT INTO members (id,name) VALUES ('zeel','Zeel'),('palak','Palak'),('nishita','Nishita') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO channels (id,name,description,url,color) VALUES ('channel-1','Dreamscapes AI','Stories and visuals from worlds imagined with AI.','', 'lilac'),('channel-2','Little Wonder Lab','Curious, creative experiments made with AI.','', 'peach') ON CONFLICT DO NOTHING`);
  const n = await pool.query('SELECT count(*)::int AS n FROM ideas');
  if (!n.rows[0].n) {
    await pool.query(`INSERT INTO ideas (id,title,channel_id,status,kind,notes,assignee,due_date) VALUES
      ('idea-welcome','Our first channel introduction','channel-1','In Discussion','Video idea','Introduce our creative trio and the worlds we want to make.','zeel',CURRENT_DATE + 2),
      ('idea-prompt','Soft watercolor dream world','channel-1','Approved','AI prompt','Pastel watercolor, gentle paper texture, tiny glowing lanterns, cinematic wide shot.','palak',CURRENT_DATE + 5),
      ('idea-experiment','Can AI invent a tiny planet?','channel-2','Idea','Video idea','Build a tiny planet from three unexpected ingredients.','nishita',CURRENT_DATE + 7)`);
    await pool.query(`INSERT INTO schedule (id,title,channel_id,member_id,due_date,kind) VALUES ('schedule-kickoff','Pick our first idea','channel-1','zeel',CURRENT_DATE + 1,'Team turn'),('schedule-script','Draft the first script','channel-1','palak',CURRENT_DATE + 3,'Production'),('schedule-short','Make a tiny planet short','channel-2','nishita',CURRENT_DATE + 6,'Publishing')`);
  }
  dbReady = true;
}

function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function sessionToken() { const value = crypto.randomBytes(24).toString('hex'); return `${value}.${sign(value)}`; }
function isAuthed(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('studio_session='))?.slice('studio_session='.length);
  if (!token) return false;
  const [value, signature] = token.split('.');
  return !!value && !!signature && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value)));
}
function send(res, code, data, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', part => { data += part; if (data.length > 100000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function id() { return crypto.randomUUID(); }

async function api(req, res, url) {
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, database: dbReady ? 'connected' : DB_URL ? 'connecting' : 'not configured' });
  if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, { passwordEnabled: !!APP_PASSWORD, database: dbReady ? 'connected' : 'not configured' });
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!APP_PASSWORD || body.password !== APP_PASSWORD) return send(res, 401, { error: 'That passcode did not match.' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': `studio_session=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'studio_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  if (url.pathname.startsWith('/api/') && !isAuthed(req)) return send(res, 401, { error: 'Please unlock the studio first.' });
  if (!dbReady) return send(res, 503, { error: 'Database is not connected. Set DATABASE_URL and restart the app.' });

  if (url.pathname === '/api/data' && req.method === 'GET') {
    const [members, channels, ideas, comments, schedule, prompts, assets] = await Promise.all([
      pool.query('SELECT * FROM members ORDER BY name'), pool.query('SELECT * FROM channels ORDER BY name'),
      pool.query(`SELECT i.*, c.name AS channel_name, COALESCE(json_agg(json_build_object('memberId',v.member_id,'vote',v.vote)) FILTER (WHERE v.member_id IS NOT NULL),'[]') AS votes FROM ideas i LEFT JOIN channels c ON c.id=i.channel_id LEFT JOIN votes v ON v.idea_id=i.id GROUP BY i.id,c.name ORDER BY i.created_at DESC`),
      pool.query(`SELECT c.*, m.name AS member_name FROM comments c JOIN members m ON m.id=c.member_id ORDER BY c.created_at`),
      pool.query('SELECT s.*, c.name AS channel_name, m.name AS member_name FROM schedule s LEFT JOIN channels c ON c.id=s.channel_id LEFT JOIN members m ON m.id=s.member_id ORDER BY s.due_date'),
      pool.query('SELECT p.*, c.name AS channel_name FROM prompts p LEFT JOIN channels c ON c.id=p.channel_id ORDER BY p.created_at DESC'),
      pool.query('SELECT a.*, c.name AS channel_name FROM assets a LEFT JOIN channels c ON c.id=a.channel_id ORDER BY a.created_at DESC')
    ]);
    return send(res, 200, { members: members.rows, channels: channels.rows, ideas: ideas.rows, comments: comments.rows, schedule: schedule.rows, prompts: prompts.rows.map(p=>({...p,tags:p.tags?p.tags.split(','):[]})), assets: assets.rows });
  }
  if (url.pathname === '/api/ideas' && req.method === 'POST') {
    const b = await readBody(req); if (!b.title?.trim()) return send(res, 400, { error: 'Add a title first.' });
    const result = await pool.query('INSERT INTO ideas (id,title,channel_id,status,kind,notes,assignee,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id(), b.title.trim(), b.channelId || null, b.status || 'Idea', b.kind || 'Video idea', b.notes || '', b.assignee || '', b.dueDate || null]);
    return send(res, 201, result.rows[0]);
  }
  if (url.pathname.match(/^\/api\/ideas\/[^/]+$/) && req.method === 'PATCH') {
    const ideaId = decodeURIComponent(url.pathname.split('/').pop()), b = await readBody(req);
    const allowed = ['title','channelId','status','kind','notes','assignee','dueDate'];
    const fields = { title: 'title', channelId: 'channel_id', status: 'status', kind: 'kind', notes: 'notes', assignee: 'assignee', dueDate: 'due_date' };
    const entries = Object.entries(b).filter(([k]) => allowed.includes(k)); if (!entries.length) return send(res, 400, { error: 'No fields to update.' });
    const params = [ideaId]; const sets = entries.map(([k,v],i) => { params.push(v || null); return `${fields[k]}=$${i+2}`; });
    if (b.status === 'Approved') {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM votes WHERE idea_id=$1 AND vote=$2', [ideaId, 'yes']);
      if (rows[0].n < 2) return send(res, 400, { error: 'Two team approvals are needed before this idea can be marked Approved.' });
    }
    const r = await pool.query(`UPDATE ideas SET ${sets.join(',')} WHERE id=$1 RETURNING *`, params); return r.rowCount ? send(res, 200, r.rows[0]) : send(res, 404, { error: 'Idea not found.' });
  }
  if (url.pathname.match(/^\/api\/ideas\/[^/]+$/) && req.method === 'DELETE') {
    await pool.query('DELETE FROM ideas WHERE id=$1', [decodeURIComponent(url.pathname.split('/').pop())]); return send(res, 200, { ok: true });
  }
  if (url.pathname.match(/^\/api\/ideas\/[^/]+$/) && req.method === 'DELETE') {
    await pool.query('DELETE FROM ideas WHERE id=$1', [decodeURIComponent(url.pathname.split('/').pop())]); return send(res, 200, { ok: true });
  }
  if (url.pathname.match(/^\/api\/ideas\/[^/]+\/vote$/) && req.method === 'POST') {
    const ideaId = decodeURIComponent(url.pathname.split('/')[3]), b = await readBody(req);
    if (!['zeel','palak','nishita'].includes(b.memberId) || !['yes','work'].includes(b.vote)) return send(res, 400, { error: 'Choose a team member and a vote.' });
    await pool.query('INSERT INTO votes (idea_id,member_id,vote) VALUES ($1,$2,$3) ON CONFLICT (idea_id,member_id) DO UPDATE SET vote=EXCLUDED.vote', [ideaId,b.memberId,b.vote]);
    const count = await pool.query('SELECT count(*)::int AS n FROM votes WHERE idea_id=$1 AND vote=$2', [ideaId,'yes']);
    if (count.rows[0].n >= 2) await pool.query("UPDATE ideas SET status='Approved' WHERE id=$1 AND status IN ('Idea','In Discussion')", [ideaId]);
    return send(res, 200, { ok: true, approvals: count.rows[0].n });
  }
  if (url.pathname.match(/^\/api\/ideas\/[^/]+\/comments$/) && req.method === 'POST') {
    const ideaId = decodeURIComponent(url.pathname.split('/')[3]), b = await readBody(req);
    if (!b.body?.trim() || !['zeel','palak','nishita'].includes(b.memberId)) return send(res, 400, { error: 'Choose your name and write a note.' });
    const r = await pool.query('INSERT INTO comments (id,idea_id,member_id,body) VALUES ($1,$2,$3,$4) RETURNING *', [id(),ideaId,b.memberId,b.body.trim()]); return send(res, 201, r.rows[0]);
  }
  if (url.pathname === '/api/channels' && req.method === 'POST') {
    const b = await readBody(req); if (!b.name?.trim()) return send(res, 400, { error: 'Add a channel name.' });
    const r = await pool.query('INSERT INTO channels (id,name,description,url,color) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id(),b.name.trim(),b.description||'',b.url||'','lilac']); return send(res, 201, r.rows[0]);
  }
  if (url.pathname.match(/^\/api\/channels\/[^/]+$/) && req.method === 'PATCH') {
    const channelId=decodeURIComponent(url.pathname.split('/').pop()),b=await readBody(req);
    if(channelId==='common')return send(res,400,{error:'The Common channel cannot be edited.'});
    const r=await pool.query('UPDATE channels SET name=COALESCE($2,name), description=COALESCE($3,description), url=COALESCE($4,url) WHERE id=$1 RETURNING *',[channelId,b.name?.trim()||null,b.description??null,b.url??null]);
    return r.rowCount?send(res,200,r.rows[0]):send(res,404,{error:'Channel not found.'});
  }
  if (url.pathname.match(/^\/api\/channels\/[^/]+$/) && req.method === 'DELETE') {
    const channelId=decodeURIComponent(url.pathname.split('/').pop());if(channelId==='common')return send(res,400,{error:'The Common channel cannot be deleted.'});
    await pool.query('DELETE FROM channels WHERE id=$1',[channelId]);return send(res,200,{ok:true});
  }
  if (url.pathname === '/api/schedule' && req.method === 'POST') {
    const b = await readBody(req); if (!b.title?.trim() || !b.dueDate) return send(res, 400, { error: 'Add a task title and date.' });
    const r = await pool.query('INSERT INTO schedule (id,title,channel_id,member_id,due_date,kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id(),b.title.trim(),b.channelId||null,b.memberId||null,b.dueDate,b.kind||'Team turn']); return send(res, 201, r.rows[0]);
  }
  if (url.pathname.match(/^\/api\/schedule\/[^/]+$/) && req.method === 'PATCH') {
    const itemId=decodeURIComponent(url.pathname.split('/').pop()),b=await readBody(req);
    const r=await pool.query('UPDATE schedule SET title=COALESCE($2,title),channel_id=$3,member_id=$4,due_date=COALESCE($5,due_date),kind=COALESCE($6,kind) WHERE id=$1 RETURNING *',[itemId,b.title?.trim()||null,b.channelId||null,b.memberId||null,b.dueDate||null,b.kind||null]);
    return r.rowCount?send(res,200,r.rows[0]):send(res,404,{error:'Calendar item not found.'});
  }
  if (url.pathname.match(/^\/api\/schedule\/[^/]+$/) && req.method === 'DELETE') {
    await pool.query('DELETE FROM schedule WHERE id=$1',[decodeURIComponent(url.pathname.split('/').pop())]);return send(res,200,{ok:true});
  }
  if (url.pathname === '/api/prompts' && req.method === 'POST') {
    const b = await readBody(req); if (!b.title?.trim() || !b.text?.trim()) return send(res, 400, { error: 'Add a prompt name and prompt text.' });
    const r = await pool.query('INSERT INTO prompts (id,title,tool,channel_id,body,tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id(),b.title.trim(),b.tool||'',b.channelId||null,b.text.trim(),(b.tags||[]).join(',')]); return send(res, 201, r.rows[0]);
  }
  if (url.pathname.match(/^\/api\/prompts\/[^/]+$/) && req.method === 'PATCH') {
    const promptId=decodeURIComponent(url.pathname.split('/').pop()),b=await readBody(req);
    const r=await pool.query('UPDATE prompts SET title=COALESCE($2,title),tool=COALESCE($3,tool),channel_id=$4,body=COALESCE($5,body),tags=COALESCE($6,tags) WHERE id=$1 RETURNING *',[promptId,b.title?.trim()||null,b.tool??null,b.channelId||null,b.text?.trim()||null,Array.isArray(b.tags)?b.tags.join(','):null]);
    return r.rowCount?send(res,200,r.rows[0]):send(res,404,{error:'Prompt not found.'});
  }
  if (url.pathname.match(/^\/api\/prompts\/[^/]+$/) && req.method === 'DELETE') {
    await pool.query('DELETE FROM prompts WHERE id=$1',[decodeURIComponent(url.pathname.split('/').pop())]);return send(res,200,{ok:true});
  }
  if (url.pathname === '/api/assets' && req.method === 'POST') {
    const b = await readBody(req); if (!b.title?.trim() || !b.url?.trim()) return send(res, 400, { error: 'Add a title and preview URL.' });
    const r = await pool.query('INSERT INTO assets (id,title,url,channel_id,note,kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [id(),b.title.trim(),b.url.trim(),b.channelId||null,b.note||'',b.kind||'Reference']); return send(res, 201, r.rows[0]);
  }
  if (url.pathname.match(/^\/api\/assets\/[^/]+$/) && req.method === 'PATCH') {
    const assetId=decodeURIComponent(url.pathname.split('/').pop()),b=await readBody(req);
    const r=await pool.query('UPDATE assets SET title=COALESCE($2,title),url=COALESCE($3,url),channel_id=$4,note=COALESCE($5,note),kind=COALESCE($6,kind) WHERE id=$1 RETURNING *',[assetId,b.title?.trim()||null,b.url?.trim()||null,b.channelId||null,b.note??null,b.kind||null]);
    return r.rowCount?send(res,200,r.rows[0]):send(res,404,{error:'Review link not found.'});
  }
  if (url.pathname.match(/^\/api\/assets\/[^/]+$/) && req.method === 'DELETE') {
    await pool.query('DELETE FROM assets WHERE id=$1',[decodeURIComponent(url.pathname.split('/').pop())]);return send(res,200,{ok:true});
  }
  if (url.pathname === '/api/turn' && req.method === 'POST') {
    const b = await readBody(req); if (!['zeel','palak','nishita'].includes(b.memberId)) return send(res, 400, { error: 'Choose a team member.' });
    const r = await pool.query('INSERT INTO schedule (id,title,member_id,due_date,kind) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id(),b.title||'Team turn',b.memberId,b.dueDate||new Date().toISOString().slice(0,10),'Team turn']); return send(res, 201, r.rows[0]);
  }
  return send(res, 404, { error: 'Not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await api(req,res,url); } catch (err) { console.error(err); send(res, 500, { error: 'Something went wrong. Check the server logs.' }); }
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length }); return res.end(page); }
  res.writeHead(404); res.end('Not found');
});

initializeDb().then(() => console.log(DB_URL ? 'Postgres connected and ready' : 'No DATABASE_URL; set it to enable shared storage')).catch(err => { console.error('Database initialization failed:', err); process.exitCode = 1; });
server.listen(PORT, '0.0.0.0', () => console.log(`Creator studio listening on ${PORT}`));
