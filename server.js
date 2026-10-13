const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl) + known frontends
    const allowed = [
      process.env.FRONTEND_URL,
      'https://luxe-beauty-salon.vercel.app',
      'https://salon-spa-frontend.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(null, true); // permissive for deployment simplicity
  },
  credentials: true
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Salon Clinic API is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mongo: !!mongoose.connection.readyState,
  });
});

// Database Connection (optional — falls back to db.json file store)
let useMongo = false;
if (process.env.MONGO_URI && !process.env.MONGO_URI.includes('your_connection_string')) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => {
      useMongo = true;
      console.log('MongoDB connected successfully');
    })
    .catch(err => console.error('MongoDB connection error (falling back to JSON file):', err.message));
} else {
  console.warn('MONGO_URI not found. Using JSON file mode (db.json).');
}

// ---------------------------------------------------------------------------
// JSON file store (json-server compatible, works locally + on Vercel)
// ---------------------------------------------------------------------------
const dbPath = path.join(__dirname, 'db.json');
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (e) {
    return { users: [], services: [], appointments: [], notifications: [], homePageConfig: {} };
  }
}
function saveDb(db) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  } catch (e) {
    // On serverless (Vercel) the filesystem is read-only — ignore write errors
    console.warn('Could not persist db.json:', e.message);
  }
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Simple query filter: ?email=x&userId=y&date=z ...
function applyQuery(rows, query) {
  const keys = Object.keys(query);
  if (!keys.length) return rows;
  return rows.filter(r => keys.every(k => String(r[k]) === String(query[k])));
}

const jsonRouter = express.Router();

['users', 'services', 'appointments', 'notifications'].forEach((resource) => {
  // List + query filter
  jsonRouter.get(`/${resource}`, (req, res) => {
    const db = loadDb();
    res.json(applyQuery(db[resource] || [], req.query));
  });
  // Get one
  jsonRouter.get(`/${resource}/:id`, (req, res) => {
    const db = loadDb();
    const item = (db[resource] || []).find(x => String(x.id) === String(req.params.id));
    if (!item) return res.status(404).json({ message: `${resource} not found` });
    res.json(item);
  });
  // Create
  jsonRouter.post(`/${resource}`, (req, res) => {
    const db = loadDb();
    const item = { id: genId(), ...req.body };
    if (!item.createdAt) item.createdAt = new Date().toISOString();
    db[resource] = db[resource] || [];
    db[resource].push(item);
    saveDb(db);
    res.status(201).json(item);
  });
  // Full replace
  jsonRouter.put(`/${resource}/:id`, (req, res) => {
    const db = loadDb();
    const arr = db[resource] || [];
    const idx = arr.findIndex(x => String(x.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ message: `${resource} not found` });
    arr[idx] = { ...arr[idx], ...req.body, id: arr[idx].id, updatedAt: new Date().toISOString() };
    saveDb(db);
    res.json(arr[idx]);
  });
  // Partial update (used heavily by frontend: cancel, feedback, status)
  jsonRouter.patch(`/${resource}/:id`, (req, res) => {
    const db = loadDb();
    const arr = db[resource] || [];
    const idx = arr.findIndex(x => String(x.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ message: `${resource} not found` });
    arr[idx] = { ...arr[idx], ...req.body, updatedAt: new Date().toISOString() };
    saveDb(db);
    res.json(arr[idx]);
  });
  // Delete
  jsonRouter.delete(`/${resource}/:id`, (req, res) => {
    const db = loadDb();
    const arr = db[resource] || [];
    db[resource] = arr.filter(x => String(x.id) !== String(req.params.id));
    saveDb(db);
    res.json({ message: 'Deleted' });
  });
});

// homePageConfig is a singleton object (json-server style)
jsonRouter.get('/homePageConfig', (req, res) => {
  const db = loadDb();
  res.json(db.homePageConfig || {});
});
jsonRouter.put('/homePageConfig', (req, res) => {
  const db = loadDb();
  db.homePageConfig = { ...req.body, lastUpdated: new Date().toISOString() };
  saveDb(db);
  res.json(db.homePageConfig);
});
jsonRouter.patch('/homePageConfig', (req, res) => {
  const db = loadDb();
  db.homePageConfig = { ...(db.homePageConfig || {}), ...req.body, lastUpdated: new Date().toISOString() };
  saveDb(db);
  res.json(db.homePageConfig);
});

// Basic auth endpoints (plain-text, json-server parity — use /api/auth for hashed version)
jsonRouter.post('/auth/register', (req, res) => {
  const { name, email, password, phone, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required' });
  const db = loadDb();
  if ((db.users || []).some(u => u.email === email)) {
    return res.status(400).json({ message: 'User already exists' });
  }
  const user = { id: genId(), name, email, password, phone: phone || '', role: role || 'user', createdAt: new Date().toISOString() };
  db.users = db.users || [];
  db.users.push(user);
  saveDb(db);
  const { password: _p, ...safe } = user;
  res.status(201).json({ message: 'User registered successfully', user: safe });
});
jsonRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDb();
  const user = (db.users || []).find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const { password: _p, ...safe } = user;
  res.json({ message: 'Login successful', user: safe, token: 'json-token-' + user.id });
});

// Mount JSON store at root (json-server compatible: /users, /services, ...)
app.use('/', jsonRouter);

// ---------------------------------------------------------------------------
// Mongo / JWT API routes (production-grade, mounted under /api)
// ---------------------------------------------------------------------------
try {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/services', require('./routes/services'));
  app.use('/api/appointments', require('./routes/appointments'));
  app.use('/api/staff', require('./routes/staff'));
} catch (e) {
  console.warn('Could not mount /api routes:', e.message);
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// For Vercel serverless
module.exports = app;

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/`);
  });
}
