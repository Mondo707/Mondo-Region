require('dotenv').config();
const express = require('express');
const cors = require('cors');

const path = require('path');
const { ready: dbReady } = require('./db/db');
const { ensureAdminUser } = require('./services/bootstrap');
const { matchProducts } = require('./services/productMatcher');
const authRoutes = require('./routes/auth');
const bonusRoutes = require('./routes/bonus');
const spotsRoutes = require('./routes/spots');
const adminRoutes = require('./routes/admin');
const cashRoutes = require('./routes/cash');
const loginHistoryRoutes = require('./routes/loginHistory');
const portionRoutes = require('./routes/portion');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/bonus', bonusRoutes);
app.use('/api/spots', spotsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cash', cashRoutes);
app.use('/api/login-history', loginHistoryRoutes);
app.use('/api/portion', portionRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server xatosi' });
});

async function start() {
  await dbReady; // Baza jadvallari tayyor bo'lishini kutamiz
  await ensureAdminUser(); // ADMIN_LOGIN/ADMIN_PASSWORD bo'lsa, admin yaratadi (Render'da shell yo'q)

  try {
    await matchProducts(); // Poster mahsulotlarini bonus jadvali bilan moslashtirish
  } catch (e) {
    console.error('[server] Mahsulotlarni moslashtirishda xato (Poster ulanishini tekshiring):', e.message);
  }

  app.listen(PORT, () => {
    console.log(`KPI backend http://localhost:${PORT} portida ishga tushdi`);
    startScheduler();
  });
}

start();
