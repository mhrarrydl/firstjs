const state = {
  db: null,
  reports: null,
  analysis: null
};

let trendChart;
let cashChart;
let cashDetailChart;
let monthlyChart;

const fmt = (value) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));

const pct = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;

const fetchData = async () => {
  const res = await fetch('/api/data');
  const payload = await res.json();
  state.db = payload.db;
  state.reports = payload.reports;
  state.analysis = payload.analysis;
};

const upsert = async (type, entity, id, payload) => {
  const endpoint = type === 'master' ? `/api/master/${entity}` : `/api/transactions/${entity}`;
  const url = id ? `${endpoint}/${id}` : endpoint;
  await fetch(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await renderAll();
};

const removeItem = async (type, entity, id) => {
  const endpoint = type === 'master' ? `/api/master/${entity}/${id}` : `/api/transactions/${entity}/${id}`;
  await fetch(endpoint, { method: 'DELETE' });
  await renderAll();
};

const openDialog = (title, initialJson, onSave) => {
  const dialog = document.getElementById('jsonDialog');
  const form = document.getElementById('jsonForm');
  const titleEl = document.getElementById('dialogTitle');
  const payloadEl = document.getElementById('dialogPayload');

  titleEl.textContent = title;
  payloadEl.value = JSON.stringify(initialJson, null, 2);
  dialog.showModal();

  const handler = async (event) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(payloadEl.value);
      await onSave(payload);
      dialog.close();
      form.removeEventListener('submit', handler);
    } catch {
      alert('JSON tidak valid.');
    }
  };

  form.addEventListener('submit', handler, { once: true });
};

const categoryName = (id) => state.db.masterData.categories.find((item) => Number(item.id) === Number(id))?.name || '-';
const supplierName = (id) => state.db.masterData.suppliers.find((item) => Number(item.id) === Number(id))?.name || '-';

const setHtml = (id, html) => (document.getElementById(id).innerHTML = html);

const renderProducts = () => {
  setHtml(
    'productsTable',
    state.db.masterData.products
      .map(
        (item) => `<tr>
      <td>${item.code || item.id}</td><td>${item.name}</td><td><span class="chip">${categoryName(item.categoryId)}</span></td>
      <td>${fmt(item.sellPrice)}</td><td>${item.stock}</td><td>${supplierName(item.supplierId)}</td>
      <td>
        <button class="icon-btn" data-edit-master="products:${item.id}">✏️</button>
        <button class="icon-btn danger" data-delete-master="products:${item.id}">🗑️</button>
      </td>
    </tr>`
      )
      .join('')
  );
};

const renderCategories = () => {
  setHtml(
    'categoriesGrid',
    state.db.masterData.categories
      .map(
        (item) => `<article class="card mini-card"><small>${item.code || item.id}</small><h4>${item.name}</h4><p>${item.description || '-'}</p>
      <div class="row-actions"><button class="icon-btn" data-edit-master="categories:${item.id}">✏️</button><button class="icon-btn danger" data-delete-master="categories:${item.id}">🗑️</button></div>
    </article>`
      )
      .join('')
  );
};

const renderSuppliers = () => {
  setHtml(
    'suppliersGrid',
    state.db.masterData.suppliers
      .map(
        (item) => `<article class="card mini-card"><small>${item.code || item.id}</small><h4>${item.name}</h4><p>📞 ${item.phone || '-'}</p><p>📍 ${item.city || '-'}</p>
      <div class="row-actions"><button class="icon-btn" data-edit-master="suppliers:${item.id}">✏️</button><button class="icon-btn danger" data-delete-master="suppliers:${item.id}">🗑️</button></div>
    </article>`
      )
      .join('')
  );
};

const renderAccounts = () => {
  setHtml(
    'accountsTable',
    state.db.masterData.accounts
      .map(
        (item) => `<tr><td>${item.code || item.id}</td><td>${item.name}</td><td>${item.type}</td><td>${fmt(item.balance)}</td><td><button class="icon-btn" data-edit-master="accounts:${item.id}">✏️</button><button class="icon-btn danger" data-delete-master="accounts:${item.id}">🗑️</button></td></tr>`
      )
      .join('')
  );
};

const renderTransactions = () => {
  setHtml(
    'salesTable',
    state.db.transactions.sales
      .map(
        (item) => `<tr><td>${item.date}</td><td>${item.product || '-'}</td><td>${item.qty || 0}</td><td>${fmt(item.price)}</td><td>${fmt(item.total)}</td><td><button class="icon-btn" data-edit-trx="sales:${item.id}">✏️</button><button class="icon-btn danger" data-delete-trx="sales:${item.id}">🗑️</button></td></tr>`
      )
      .join('')
  );

  setHtml(
    'purchasesTable',
    state.db.transactions.purchases
      .map(
        (item) => `<tr><td>${item.date}</td><td>${item.item || '-'}</td><td>${item.qty || 0}</td><td>${fmt(item.price)}</td><td>${fmt(item.total)}</td><td><button class="icon-btn" data-edit-trx="purchases:${item.id}">✏️</button><button class="icon-btn danger" data-delete-trx="purchases:${item.id}">🗑️</button></td></tr>`
      )
      .join('')
  );

  setHtml(
    'expensesTable',
    state.db.transactions.expenses
      .map(
        (item) => `<tr><td>${item.date}</td><td>${item.type || '-'}</td><td>${item.note || '-'}</td><td>${fmt(item.amount)}</td><td><button class="icon-btn" data-edit-trx="expenses:${item.id}">✏️</button><button class="icon-btn danger" data-delete-trx="expenses:${item.id}">🗑️</button></td></tr>`
      )
      .join('')
  );
};

const renderReports = () => {
  const { profitLoss, monthlyDetails } = state.reports;
  document.getElementById('kpiSales').textContent = fmt(profitLoss.totalSales);
  document.getElementById('kpiProfit').textContent = fmt(profitLoss.netProfit);
  document.getElementById('kpiCost').textContent = fmt(profitLoss.totalCost);
  document.getElementById('kpiHealth').textContent = state.analysis.healthStatus;

  setHtml(
    'profitLossBox',
    `<div class="line"><span>Total Penjualan</span><b>${fmt(profitLoss.totalSales)}</b></div>
     <div class="line"><span>Harga Pokok Pembelian</span><b>(${fmt(profitLoss.purchaseCost)})</b></div>
     <div class="line"><span>Beban Operasional</span><b>(${fmt(profitLoss.operationalCost)})</b></div>
     <div class="line total"><span>Laba Bersih</span><b>${fmt(profitLoss.netProfit)}</b></div>`
  );

  setHtml(
    'monthlyTable',
    monthlyDetails
      .map(
        (item) => `<tr><td>${item.month}</td><td>${fmt(item.sales)}</td><td>${fmt(item.purchases)}</td><td>${fmt(item.expenses)}</td><td class="profit">${fmt(item.profit)}</td></tr>`
      )
      .join('')
  );

  const labels = monthlyDetails.map((item) => item.month);
  const sales = monthlyDetails.map((item) => item.sales);
  const profits = monthlyDetails.map((item) => item.profit);
  const cashOut = monthlyDetails.map((item) => item.purchases + item.expenses);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Pendapatan', data: sales, borderColor: '#4f46e5' }, { label: 'Laba', data: profits, borderColor: '#10b981' }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  if (cashChart) cashChart.destroy();
  cashChart = new Chart(document.getElementById('cashChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Kas Masuk', data: sales, backgroundColor: '#22c55e' }, { label: 'Kas Keluar', data: cashOut, backgroundColor: '#ef4444' }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  if (cashDetailChart) cashDetailChart.destroy();
  cashDetailChart = new Chart(document.getElementById('cashDetailChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Kas Masuk', data: sales, backgroundColor: '#22c55e' }, { label: 'Kas Keluar', data: cashOut, backgroundColor: '#ef4444' }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Penjualan', data: sales, backgroundColor: '#4f46e5' }, { label: 'Laba', data: profits, backgroundColor: '#10b981' }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });
};

const renderAnalysis = () => {
  const { healthStatus, profitMargin, inventoryTurnover, assetTurnover } = state.analysis;
  document.getElementById('healthStatus').textContent = healthStatus;
  document.getElementById('healthDesc').textContent =
    healthStatus.includes('Sehat')
      ? 'Kondisi keuangan usaha dalam keadaan baik.'
      : healthStatus.includes('Risiko')
        ? 'Kondisi usaha berisiko, perlu tindakan cepat.'
        : 'Usaha berjalan, tetapi perlu evaluasi dan efisiensi.';
  document.getElementById('metricMargin').textContent = pct(profitMargin);
  document.getElementById('metricInventory').textContent = `${inventoryTurnover.toFixed(2)}x`;
  document.getElementById('metricAsset').textContent = `${assetTurnover.toFixed(2)}x`;
};

const setRoute = (route) => {
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === route));
  document.querySelectorAll('.menu-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
  window.location.hash = route;
};

const bindActions = () => {
  document.querySelectorAll('[data-edit-master]').forEach((btn) => {
    btn.onclick = () => {
      const [entity, id] = btn.dataset.editMaster.split(':');
      const item = state.db.masterData[entity].find((x) => Number(x.id) === Number(id));
      openDialog(`Edit ${entity}`, item, (payload) => upsert('master', entity, id, payload));
    };
  });

  document.querySelectorAll('[data-delete-master]').forEach((btn) => {
    btn.onclick = () => {
      const [entity, id] = btn.dataset.deleteMaster.split(':');
      if (confirm('Hapus data ini?')) removeItem('master', entity, id);
    };
  });

  document.querySelectorAll('[data-edit-trx]').forEach((btn) => {
    btn.onclick = () => {
      const [type, id] = btn.dataset.editTrx.split(':');
      const item = state.db.transactions[type].find((x) => Number(x.id) === Number(id));
      openDialog(`Edit ${type}`, item, (payload) => upsert('trx', type, id, payload));
    };
  });

  document.querySelectorAll('[data-delete-trx]').forEach((btn) => {
    btn.onclick = () => {
      const [type, id] = btn.dataset.deleteTrx.split(':');
      if (confirm('Hapus transaksi ini?')) removeItem('trx', type, id);
    };
  });
};

const renderAll = async () => {
  await fetchData();
  document.getElementById('adminName').textContent = state.db.masterData.users[0]?.name || 'Admin';
  renderProducts();
  renderCategories();
  renderSuppliers();
  renderAccounts();
  renderTransactions();
  renderReports();
  renderAnalysis();
  document.getElementById('rawDb').textContent = JSON.stringify(state.db, null, 2);
  bindActions();
};

const setupMenus = () => {
  document.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.onclick = () => setRoute(btn.dataset.route);
  });

  const route = window.location.hash.replace('#', '') || 'dashboard';
  setRoute(route);
};

const setupCreateButtons = () => {
  document.getElementById('addProduct').onclick = () =>
    openDialog('Tambah Produk', { code: 'P999', name: '', categoryId: 1, supplierId: 1, stock: 0, buyPrice: 0, sellPrice: 0 }, (payload) =>
      upsert('master', 'products', null, payload)
    );
  document.getElementById('addCategory').onclick = () =>
    openDialog('Tambah Kategori', { code: 'C999', name: '', description: '' }, (payload) => upsert('master', 'categories', null, payload));
  document.getElementById('addSupplier').onclick = () =>
    openDialog('Tambah Supplier', { code: 'S999', name: '', phone: '', city: '' }, (payload) => upsert('master', 'suppliers', null, payload));
  document.getElementById('addAccount').onclick = () =>
    openDialog('Tambah Akun', { code: 'A999', name: '', type: 'Aset', balance: 0 }, (payload) => upsert('master', 'accounts', null, payload));
  document.getElementById('addSale').onclick = () =>
    openDialog('Tambah Penjualan', { date: '2026-02-11', product: '', qty: 1, price: 0 }, (payload) => upsert('trx', 'sales', null, payload));
  document.getElementById('addPurchase').onclick = () =>
    openDialog('Tambah Pembelian', { date: '2026-02-11', item: '', qty: 1, price: 0 }, (payload) => upsert('trx', 'purchases', null, payload));
  document.getElementById('addExpense').onclick = () =>
    openDialog('Tambah Pengeluaran', { date: '2026-02-11', type: 'Operasional', note: '', amount: 0 }, (payload) => upsert('trx', 'expenses', null, payload));
};

setupMenus();
setupCreateButtons();
renderAll();
