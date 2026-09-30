// Sahifa yuqorisidagi navigatsiya panelini chizadi.
function renderTopbar(activePage) {
  const user = getUser();
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const allowedSections = isAdmin
    ? ['kpi', 'daily_sales', 'bonus_table', 'cash', 'savdo', 'login_history', 'portsiya']
    : (user.allowed_sections || ['kpi', 'daily_sales', 'bonus_table', 'cash', 'savdo', 'login_history', 'portsiya']);

  const currentTheme = localStorage.getItem('kpi_theme') || 'dark';
  const isDark = currentTheme === 'dark';

  const nav = document.createElement('div');
  nav.className = 'topbar';
  nav.innerHTML = `
    <div class="brand" style="display:flex; align-items:center; gap:10px;">
      <img src="/img/logo.png" alt="Mondo" class="brand-logo">
      <span class="brand-sep"></span>
      <span>KPI <span style="color:var(--accent);">Bonus</span></span>
    </div>
    <nav>
      ${allowedSections.includes('kpi') ? `<a href="/dashboard.html" class="${activePage === 'kpi' ? 'active' : ''}">KPI</a>` : ''}
      ${allowedSections.includes('daily_sales') ? `<a href="/daily-sales.html" class="${activePage === 'sales' ? 'active' : ''}">Kunlik savdo</a>` : ''}
      ${allowedSections.includes('bonus_table') ? `<a href="/bonus-table.html" class="${activePage === 'bonus_table' ? 'active' : ''}">Bonus jadvali</a>` : ''}
      ${allowedSections.includes('cash') ? `<a href="/cash-entry.html" class="${activePage === 'cash' ? 'active' : ''}">Kassa kiritish</a>` : ''}
      ${allowedSections.includes('portsiya') ? `<a href="/portsiya.html" class="${activePage === 'portsiya' ? 'active' : ''}">Portsiya</a>` : ''}
      ${allowedSections.includes('savdo') ? `<a href="/savdo.html" class="${activePage === 'savdo' ? 'active' : ''}">Savdo</a>` : ''}
      ${allowedSections.includes('login_history') ? `<a href="/login-history.html" class="${activePage === 'login_history' ? 'active' : ''}">Kirish tarixi</a>` : ''}
      ${isAdmin ? `<a href="/admin.html" class="${activePage === 'admin' ? 'active' : ''}">Admin panel</a>` : ''}
    </nav>
    <div class="user-info">
      <span>${user.login} ${isAdmin ? '(admin)' : ''}</span>
      <div class="theme-toggle" id="theme-toggle-btn" title="Yorug'/qorong'i rejim">
        <span class="icon" id="icon-sun">&#9728;</span>
        <div class="switch-track ${isDark ? 'on' : ''}" id="switch-track"><div class="switch-knob"></div></div>
        <span class="icon" id="icon-moon">&#9789;</span>
      </div>
      <button class="btn-secondary" id="logout-btn">Chiqish</button>
    </div>
  `;
  document.body.prepend(nav);
  nav.querySelector('#logout-btn').addEventListener('click', logout);

  const sunIcon = nav.querySelector('#icon-sun');
  const moonIcon = nav.querySelector('#icon-moon');
  (isDark ? moonIcon : sunIcon).classList.add('active');

  nav.querySelector('#theme-toggle-btn').addEventListener('click', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = nowDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kpi_theme', next);

    nav.querySelector('#switch-track').classList.toggle('on', next === 'dark');
    sunIcon.classList.toggle('active', next === 'light');
    moonIcon.classList.toggle('active', next === 'dark');
  });
}
