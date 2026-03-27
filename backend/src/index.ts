import express from "express";
import axios from "axios";
import cors from "cors";
import { RouterOSAPI } from "node-routeros";

const app = express();
app.use(express.json());

// استخدم حزمة CORS لإرجاع رؤوس Access-Control المناسبة
// اسمح للأصل المنتج (frontend) بالوصول؛ عدّل القائمة حسب الحاجة
const allowedOrigins = [
  'https://datahub-44154.web.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    // السماح بالوصول في حال كانت الطلبات من نفس المنشأ أو origin غير موجود (مثل أدوات الاختبار)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// دعم رد على طلبات preflight
app.options('*', cors());

// اختبار Cloud NAT
app.get("/ip", async (_req, res) => {
  const { data } = await axios.get("https://api.ipify.org");
  res.json({ egressIp: String(data).trim() });
});

app.get("/", (_req, res) => res.send("mikrotik api running"));

// Helper function to create RouterOS connection
async function connectToRouter(host: string, user: string, password: string, port = 8728) {
  const api = new RouterOSAPI({
    host,
    user,
    password,
    port,
    timeout: 10,
  });
  await api.connect();
  return api;
}

// اتصال + جلب داشبورد كامل
app.post('/mikrotik/dashboard', async (req, res) => {
  const { host, username, password, port = 8728 } = req.body as { host?: string; username?: string; password?: string; port?: number };
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'missing host, username or password' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);

    // جلب معلومات النظام
    const [identity] = await api.write('/system/identity/print');
    const [resource] = await api.write('/system/resource/print');
    const [routerboard] = await api.write('/system/routerboard/print');

    // جلب PPPoE secrets
    const secrets = await api.write('/ppp/secret/print');

    // جلب الاتصالات النشطة
    const activeConnections = await api.write('/ppp/active/print');

    // جلب الانترفيسات
    const interfaces = await api.write('/interface/print');

    api.close();

    return res.json({
      connected: true,
      identity: identity?.name || 'Unknown',
      system: {
        uptime: resource?.uptime,
        version: resource?.version,
        cpuLoad: resource?.['cpu-load'],
        freeMemory: resource?.['free-memory'],
        totalMemory: resource?.['total-memory'],
        architecture: resource?.['architecture-name'],
        boardName: resource?.['board-name'],
      },
      routerboard: {
        model: routerboard?.model,
        serialNumber: routerboard?.['serial-number'],
        firmware: routerboard?.['current-firmware'],
      },
      secrets: secrets.map((s: any) => ({
        id: s['.id'],
        name: s.name,
        service: s.service,
        profile: s.profile,
        remoteAddress: s['remote-address'],
        disabled: s.disabled === 'true',
      })),
      activeConnections: activeConnections.map((c: any) => ({
        id: c['.id'],
        name: c.name,
        service: c.service,
        callerId: c['caller-id'],
        address: c.address,
        uptime: c.uptime,
      })),
      interfaces: interfaces.map((i: any) => ({
        id: i['.id'],
        name: i.name,
        type: i.type,
        running: i.running === 'true',
        disabled: i.disabled === 'true',
      })),
    });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Connection failed' });
  }
});

// إضافة PPPoE secret جديد
app.post('/mikrotik/secrets', async (req, res) => {
  const { host, username, password, port = 8728, secret } = req.body as {
    host?: string;
    username?: string;
    password?: string;
    port?: number;
    secret?: { name: string; password: string; service?: string; profile?: string; remoteAddress?: string };
  };

  if (!host || !username || !password || !secret?.name || !secret?.password) {
    return res.status(400).json({ error: 'missing required fields' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);

    const params = [
      `=name=${secret.name}`,
      `=password=${secret.password}`,
      `=service=${secret.service || 'pppoe'}`,
    ];
    if (secret.profile) params.push(`=profile=${secret.profile}`);
    if (secret.remoteAddress) params.push(`=remote-address=${secret.remoteAddress}`);

    await api.write('/ppp/secret/add', params);
    api.close();

    return res.json({ success: true, message: `Secret ${secret.name} added` });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Failed to add secret' });
  }
});

// حذف PPPoE secret
app.delete('/mikrotik/secrets/:id', async (req, res) => {
  const { host, username, password, port = 8728 } = req.body as { host?: string; username?: string; password?: string; port?: number };
  const secretId = req.params.id;

  if (!host || !username || !password) {
    return res.status(400).json({ error: 'missing credentials' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);
    await api.write('/ppp/secret/remove', [`=.id=${secretId}`]);
    api.close();

    return res.json({ success: true, message: 'Secret removed' });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Failed to remove secret' });
  }
});

// تعطيل/تفعيل PPPoE secret
app.post('/mikrotik/secrets/:id/toggle', async (req, res) => {
  const { host, username, password, port = 8728, disabled } = req.body as { host?: string; username?: string; password?: string; port?: number; disabled: boolean };
  const secretId = req.params.id;

  if (!host || !username || !password) {
    return res.status(400).json({ error: 'missing credentials' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);
    await api.write('/ppp/secret/set', [`=.id=${secretId}`, `=disabled=${disabled ? 'yes' : 'no'}`]);
    api.close();

    return res.json({ success: true, message: disabled ? 'Secret disabled' : 'Secret enabled' });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Failed to toggle secret' });
  }
});

// فصل اتصال نشط
app.post('/mikrotik/active/:id/disconnect', async (req, res) => {
  const { host, username, password, port = 8728 } = req.body as { host?: string; username?: string; password?: string; port?: number };
  const connectionId = req.params.id;

  if (!host || !username || !password) {
    return res.status(400).json({ error: 'missing credentials' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);
    await api.write('/ppp/active/remove', [`=.id=${connectionId}`]);
    api.close();

    return res.json({ success: true, message: 'Connection disconnected' });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Failed to disconnect' });
  }
});

// جلب Profiles
app.post('/mikrotik/profiles', async (req, res) => {
  const { host, username, password, port = 8728 } = req.body as { host?: string; username?: string; password?: string; port?: number };

  if (!host || !username || !password) {
    return res.status(400).json({ error: 'missing credentials' });
  }

  let api: RouterOSAPI | null = null;
  try {
    api = await connectToRouter(host, username, password, port);
    const profiles = await api.write('/ppp/profile/print');
    api.close();

    return res.json({
      profiles: profiles.map((p: any) => ({
        id: p['.id'],
        name: p.name,
        localAddress: p['local-address'],
        remoteAddress: p['remote-address'],
        rateLimit: p['rate-limit'],
      })),
    });
  } catch (err: any) {
    if (api) api.close();
    return res.status(500).json({ error: err.message || 'Failed to get profiles' });
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log("listening on", port));
