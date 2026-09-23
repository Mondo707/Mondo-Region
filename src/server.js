const path = require('path');
const express = require('express');
require('express-async-errors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const config = require('./config');
const { pool, initDb } = require('./db');
const { startSyncScheduler } = require('./jobs/salesSync');

const authRoutes = require('./routes/auth');
const bozorlikRoutes = require('./routes/bozorlik');
const dailySalesRoutes = require('./routes/dailySales');
const expensesRoutes = require('./routes/expenses');
const cashRoutes = require('./routes/cash');
const fotRoutes = require('./routes/fot');
const salesRoutes = require('./routes/sales');
const dashboardRoutes = require('./routes/dashboard');
const loginHistoryRoutes = require('./routes/loginHistory');
const adminRoutes = require('./routes/admin');

async function main() {
  await initDb();

  const app = express();
  app.use(express.json());

  app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    name: 'mondo.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 12 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/bozorlik', bozorlikRoutes);
  app.use('/api/daily-sales', dailySalesRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/cash', cashRoutes);
  app.use('/api/fot', fotRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/login-history', loginHistoryRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server xatosi' });
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Mondo Region ${config.branch.name} — http://localhost:${config.port} (poster.mock=${config.poster.mock})`);
  });

  startSyncScheduler();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Ishga tushmadi:', e);
  process.exit(1);
});
