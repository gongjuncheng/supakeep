require('dotenv').config();

const path = require('path');
const fs = require('fs');
const https = require('https');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();

// ================= 配置 =================
const HOST = '0.0.0.0';
const PORT = process.env.SERVER_PORT || process.env.PORT || 6592;
const JWT_SECRET = process.env.JWT_SECRET || 'supa-keepalive-secret';

// SSL 证书（3 个独立文件，不合并）
const SSL_KEY = process.env.SSL_KEY || './ssl/private.key';
const SSL_CERT = process.env.SSL_CERT || './ssl/certificate.crt';
const SSL_CA = process.env.SSL_CA || './ssl/ca_bundle.crt';

// 持久化数据库
const db = new Low(new JSONFile('./db.json'), { users: [], projects: [], pings: [] });
db.read().then(() => db.write());
// ========================================

// ================= 控制台（SSE，挂在同一端口 /console）=================
const consoleClients = [];
const consoleHistory = [];
const MAX_HISTORY = 500;

function broadcastLog(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  consoleHistory.push(line);
  if (consoleHistory.length > MAX_HISTORY) consoleHistory.shift();
  consoleClients.forEach(c => {
    try { c.res.write(`event: log\ndata: ${JSON.stringify({ level, msg, ts })}\n\n`); } catch {}
  });
}

app.get('/console', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  consoleHistory.forEach(line => {
    res.write(`event: log\ndata: ${JSON.stringify({ level: 'info', msg: line, ts: new Date().toISOString() })}\n\n`);
  });

  const client = { res };
  consoleClients.push(client);
  req.on('close', () => {
    const i = consoleClients.indexOf(client);
    if (i !== -1) consoleClients.splice(i, 1);
  });
});

// ================= 业务路由 =================
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'supabase-keepalive', transport: 'https' });
});

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '缺少 token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token 无效或已过期' });
  }
}

// 注册
app.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.data.users.find(u => u.username === username)) {
    return res.status(400).json({ error: '用户已存在' });
  }
  db.data.users.push({ username, password_hash: bcrypt.hashSync(password, 10) });
  await db.write();
  broadcastLog('info', `新用户注册: ${username}`);
  res.json({ ok: true, username });
});

// 登录
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少 username 或 password' });
  const user = db.data.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  broadcastLog('info', `用户登录: ${username}`);
  res.json({ ok: true, token, username });
});

// 修改密码
app.post('/change-password', auth, async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  const user = db.data.users.find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  user.password_hash = bcrypt.hashSync(new_password, 10);
  await db.write();
  broadcastLog('info', `用户改密: ${req.user.username}`);
  res.json({ ok: true, message: '密码已更新' });
});

// 注销账号
app.delete('/account', auth, async (req, res) => {
  const username = req.user.username;
  db.data.projects = db.data.projects.filter(p => p.owner !== username);
  db.data.users = db.data.users.filter(u => u.username !== username);
  await db.write();
  broadcastLog('warn', `用户注销: ${username}`);
  res.json({ ok: true, message: '账号已注销，所有数据已清除' });
});

// 获取项目列表
app.get('/projects', auth, async (req, res) => {
  const list = db.data.projects.filter(p => p.owner === req.user.username);
  res.json(list);
});

// 添加项目
app.post('/projects', auth, async (req, res) => {
  const { name, supabase_url, anon_key, interval_hours } = req.body || {};
  if (!name || !supabase_url || !anon_key) {
    return res.status(400).json({ error: '缺少 name / supabase_url / anon_key' });
  }
  const iv = parseFloat(interval_hours);
  if (isNaN(iv) || iv < 0.01) return res.status(400).json({ error: '保活间隔至少 0.01 小时' });
  const project = {
    id: Date.now(),
    owner: req.user.username,
    name, supabase_url, anon_key,
    interval_hours: iv,
    enabled: true,
    last_ping_at: null,
    last_status: null,
    created_at: new Date().toISOString(),
  };
  db.data.projects.push(project);
  await db.write();
  broadcastLog('info', `项目添加: ${name} (${supabase_url}) 间隔=${iv}h`);
  res.json({ ok: true, project });
});

// 编辑项目
app.put('/projects/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const project = db.data.projects.find(p => p.id === id && p.owner === req.user.username);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const { name, supabase_url, anon_key, interval_hours } = req.body || {};
  if (name) project.name = name;
  if (supabase_url) project.supabase_url = supabase_url;
  if (anon_key) project.anon_key = anon_key;
  if (interval_hours !== undefined) {
    const iv = parseFloat(interval_hours);
    if (isNaN(iv) || iv < 0.01) return res.status(400).json({ error: '保活间隔至少 0.01 小时' });
    project.interval_hours = iv;
  }
  await db.write();
  broadcastLog('info', `项目编辑: ${project.name}`);
  res.json({ ok: true, project });
});

// 删除项目
app.delete('/projects/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const before = db.data.projects.length;
  db.data.projects = db.data.projects.filter(
    p => !(p.id === id && p.owner === req.user.username)
  );
  db.data.pings = db.data.pings.filter(p => p.project_id !== id);
  await db.write();
  if (db.data.projects.length === before) return res.status(404).json({ error: '项目不存在' });
  broadcastLog('warn', `项目删除: id=${id}`);
  res.json({ ok: true });
});

// 清空保活日志
app.delete('/projects/:id/logs', auth, async (req, res) => {
  const id = Number(req.params.id);
  const project = db.data.projects.find(
    p => p.id === id && p.owner === req.user.username
  );
  if (!project) return res.status(404).json({ error: '项目不存在' });

  try {
    const r = await fetch(
      `${project.supabase_url}/rest/v1/keepalive_logs?project_id=eq.${encodeURIComponent(String(id))}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': project.anon_key,
          'Authorization': `Bearer ${project.anon_key}`,
          'Prefer': 'return=representation',
        },
      }
    );
    broadcastLog('info', `清空日志 ✅ ${project.name} | ${r.status}`);
    res.json({ ok: true, status: r.status });
  } catch (e) {
    broadcastLog('error', `清空日志失败 ${project.name}: ${e.message}`);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 写保活日志到 Supabase
async function writeKeepaliveLog(project, status, latency) {
  try {
    await fetch(
      `${project.supabase_url}/rest/v1/keepalive_logs`,
      {
        method: 'POST',
        headers: {
          'apikey': project.anon_key,
          'Authorization': `Bearer ${project.anon_key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          project_id: String(project.id),
          status,
          latency_ms: latency,
        }),
      }
    );
  } catch (e) {
    broadcastLog('error', `日志写入失败 (${project.name}): ${e.message}`);
  }
}

// 执行一次保活
async function doPing(project) {
  const start = Date.now();
  try {
    const r = await fetch(
      `${project.supabase_url}/rest/v1/keepalive?select=id&limit=1`,
      {
        headers: {
          'apikey': project.anon_key,
          'Authorization': `Bearer ${project.anon_key}`,
        },
      }
    );
    const latency = Date.now() - start;
    project.last_ping_at = new Date().toISOString();
    project.last_status = r.status;

    db.data.pings.push({
      project_id: project.id, status: r.status, ok: r.ok ? 1 : 0,
      latency_ms: latency, created_at: project.last_ping_at,
    });
    if (db.data.pings.length > 500) db.data.pings.shift();

    await writeKeepaliveLog(project, r.status, latency);
    await db.write();

    broadcastLog(r.ok ? 'info' : 'warn',
      `保活 ${r.ok ? '✅' : '❌'} ${project.name} | status=${r.status} | ${latency}ms`);
    return { ok: r.ok, status: r.status, latency_ms: latency };
  } catch (e) {
    project.last_status = 999;
    project.last_ping_at = new Date().toISOString();
    await db.write();
    broadcastLog('error', `保活异常 ${project.name}: ${e.message}`);
    return { ok: false, error: String(e) };
  }
}

// 手动保活
app.post('/ping/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const project = db.data.projects.find(
    p => p.id === id && p.owner === req.user.username
  );
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const result = await doPing(project);
  if (result.ok) res.json(result);
  else res.status(500).json(result);
});

// 自动保活定时器
setInterval(async () => {
  const now = Date.now();
  for (const p of db.data.projects) {
    if (!p.enabled) continue;
    const last = p.last_ping_at ? new Date(p.last_ping_at).getTime() : 0;
    const intervalMs = (p.interval_hours || 72) * 3600 * 1000;
    if (now - last < intervalMs - 60 * 1000) continue;
    await doPing(p);
  }
}, 30 * 1000);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `${req.method} ${req.originalUrl}` });
});

// ================= 启动 =================
if (!fs.existsSync(SSL_KEY) || !fs.existsSync(SSL_CERT) || !fs.existsSync(SSL_CA)) {
  console.error('❌ SSL 证书文件缺失！');
  process.exit(1);
}

const httpsOptions = {
  key: fs.readFileSync(SSL_KEY),
  cert: fs.readFileSync(SSL_CERT),
  ca: fs.readFileSync(SSL_CA),
  minVersion: 'TLSv1.2',
};

broadcastLog('info', '=== Supabase Keepalive 启动 ===');
broadcastLog('info', `面板+控制台 统一端口: ${PORT}`);
broadcastLog('info', `控制台 SSE 路径: /console`);

https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
  broadcastLog('info', `✅ HTTPS on https://${HOST}:${PORT}`);
});

process.on('uncaughtException', e => broadcastLog('error', `未捕获异常: ${e.message}`));
process.on('unhandledRejection', e => broadcastLog('error', `未处理Promise: ${e.message}`));
