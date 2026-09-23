const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.6 12.6a2 2 0 002 1.6h8.4a2 2 0 002-1.6L21 8H6"/>',
  bars: '<rect x="3" y="10" width="4" height="10"/><rect x="10" y="6" width="4" height="14"/><rect x="17" y="3" width="4" height="17"/>',
  receipt: '<path d="M3 7h18v12H3z"/><path d="M3 11h18"/><path d="M7 15h4"/>',
  wallet: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/>',
  fot: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 19c.8-3.4 3.3-5.4 6.2-5.4s5.4 2 6.2 5.4"/><circle cx="18" cy="8.5" r="2.4"/><path d="M16 13.4c2.2.4 3.9 2 4.6 4.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

function icon(name, color) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">${ICONS[name]}</svg>`;
}

const NAV_ITEMS = [
  { href: 'dashboard.html', label: 'Bosh sahifa', icon: 'home', section: null },
  { href: 'bozorlik.html', label: 'Bozorlik', icon: 'cart', section: 'bozorlik' },
  { href: 'daily-sales.html', label: 'Kunlik savdo', icon: 'bars', section: 'daily_sales' },
  { href: 'expenses.html', label: 'Xarajatlar', icon: 'receipt', section: 'expenses' },
  { href: 'cash-entry.html', label: 'Kassa kiritish', icon: 'wallet', section: 'cash' },
  { href: 'savdo.html', label: 'Savdo', icon: 'trend', section: 'savdo' },
];

const MGMT_ITEMS = [
  { href: 'fot.html', label: 'FOT', icon: 'fot', section: 'fot', badge: 'admin' },
  { href: 'login-history.html', label: 'Kirish tarixi', icon: 'clock', section: 'login_history', badge: null },
  { href: 'admin.html', label: 'Admin panel', icon: 'users', section: 'admin', badge: 'ac', roles: ['admin', 'curator'] },
];

function canSee(item, user) {
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (!item.section) return true;
  if (user.role === 'admin') return true;
  return Array.isArray(user.allowed_sections) && user.allowed_sections.includes(item.section);
}

function initials(fullName) {
  return (fullName || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

function renderNav(user) {
  const root = document.getElementById('sidebar-root');
  if (!root) return;
  const current = window.location.pathname.split('/').pop() || 'dashboard.html';

  const navHtml = NAV_ITEMS.filter((it) => canSee(it, user)).map((it) => `
    <a href="${it.href}" class="nav-item ${current === it.href ? 'active' : ''}">
      ${icon(it.icon, current === it.href ? '#f5c518' : '#b8b6c9')}
      <span>${it.label}</span>
    </a>`).join('');

  const mgmtVisible = MGMT_ITEMS.filter((it) => canSee(it, user));
  const mgmtHtml = mgmtVisible.map((it) => `
    <a href="${it.href}" class="nav-item ${current === it.href ? 'active' : ''}">
      ${icon(it.icon, current === it.href ? '#f5c518' : '#b8b6c9')}
      <span>${it.label}</span>
      ${it.badge === 'admin' ? '<span class="badge badge-admin">ADMIN</span>' : ''}
      ${it.badge === 'ac' ? '<span class="badge badge-ac">A/C</span>' : ''}
    </a>`).join('');

  root.innerHTML = `
    <div class="brand">
      <img src="assets/logo.png" alt="Mondo">
      <div>
        <div class="brand-name">MONDO REGION</div>
        <div class="brand-sub">${window.BRANCH_NAME || "Farg'ona filiali"}</div>
      </div>
    </div>
    <div class="nav-group-label">Filial</div>
    ${navHtml}
    ${mgmtVisible.length ? `<div class="nav-group-label">Boshqaruv</div>${mgmtHtml}` : ''}
    <div style="flex:1"></div>
    <div class="sidebar-footer">
      <div class="avatar">${initials(user.full_name)}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:#faf9f5;">${user.full_name}</div>
        <div style="font-size:11px;color:#8b8a97;">${roleLabel(user.role)}</div>
      </div>
      <a href="#" id="logout-link" title="Chiqish">${icon('logout', '#8b8a97')}</a>
    </div>
  `;

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

function roleLabel(role) {
  if (role === 'admin') return "To'liq huquq";
  if (role === 'curator') return 'Curator';
  return 'Xodim';
}

async function bootPage() {
  const user = await requireSession();
  if (!user) return null;
  renderNav(user);
  return user;
}
