const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const createDefaultDb = () => ({
  masterData: {
    products: [
      { id: 1, code: 'P001', name: 'Kain Katun Premium', categoryId: 1, supplierId: 1, stock: 150, buyPrice: 60000, sellPrice: 85000 },
      { id: 2, code: 'P002', name: 'Kain Denim Stretch', categoryId: 1, supplierId: 2, stock: 80, buyPrice: 90000, sellPrice: 120000 },
      { id: 3, code: 'P003', name: 'Celana Chino Slim', categoryId: 2, supplierId: 3, stock: 45, buyPrice: 140000, sellPrice: 189000 }
    ],
    categories: [
      { id: 1, code: 'C001', name: 'Kain', description: 'Bahan kain mentah untuk produksi' },
      { id: 2, code: 'C002', name: 'Celana', description: 'Produk celana jadi siap jual' }
    ],
    suppliers: [
      { id: 1, code: 'S001', name: 'PT Tekstil Jaya', phone: '081234567890', city: 'Bandung' },
      { id: 2, code: 'S002', name: 'CV Denim Indo', phone: '081298765432', city: 'Surabaya' },
      { id: 3, code: 'S003', name: 'PT Asia Fabric', phone: '082112345678', city: 'Jakarta' }
    ],
    accounts: [
      { id: 1, code: 'A001', name: 'Kas', type: 'Aset', balance: 45000000 },
      { id: 2, code: 'A002', name: 'Modal', type: 'Ekuitas', balance: 100000000 },
      { id: 3, code: 'A003', name: 'Persediaan Barang', type: 'Aset', balance: 32000000 },
      { id: 4, code: 'A004', name: 'Beban Operasional', type: 'Beban', balance: 0 }
    ],
    users: [{ id: 1, username: 'admin', role: 'admin', name: 'Admin Veracollection' }]
  },
  transactions: {
    sales: [
      { id: 1, date: '2025-09-10', productId: 1, product: 'Kain Katun Premium', qty: 335, price: 85000, total: 28475000 },
      { id: 2, date: '2025-10-10', productId: 2, product: 'Kain Denim Stretch', qty: 267, price: 120000, total: 32040000 },
      { id: 3, date: '2025-11-10', productId: 3, product: 'Celana Chino Slim', qty: 158, price: 189000, total: 29862000 },
      { id: 4, date: '2025-12-10', productId: 1, product: 'Kain Katun Premium', qty: 419, price: 85000, total: 35615000 },
      { id: 5, date: '2026-01-10', productId: 3, product: 'Celana Chino Slim', qty: 202, price: 189000, total: 38178000 },
      { id: 6, date: '2026-02-10', productId: 2, product: 'Kain Denim Stretch', qty: 346, price: 120000, total: 41520000 }
    ],
    purchases: [
      { id: 1, date: '2025-09-05', item: 'Pembelian Kain Katun', qty: 200, price: 60000, total: 12000000 },
      { id: 2, date: '2025-10-05', item: 'Pembelian Kain Denim', qty: 161, price: 90000, total: 14490000 },
      { id: 3, date: '2025-11-05', item: 'Pembelian Kain Twill', qty: 140, price: 80000, total: 11200000 },
      { id: 4, date: '2025-12-05', item: 'Pembelian Kain Linen', qty: 180, price: 88000, total: 15840000 },
      { id: 5, date: '2026-01-05', item: 'Pembelian Kain Drill', qty: 180, price: 90000, total: 16200000 },
      { id: 6, date: '2026-02-05', item: 'Pembelian Kain Premium', qty: 250, price: 70000, total: 17500000 }
    ],
    expenses: [
      { id: 1, date: '2025-09-20', type: 'Gaji', note: 'Gaji karyawan', amount: 7200000 },
      { id: 2, date: '2025-09-25', type: 'Operasional', note: 'Listrik & transport', amount: 4000000 },
      { id: 3, date: '2025-10-25', type: 'Operasional', note: 'Listrik & transport', amount: 10800000 },
      { id: 4, date: '2025-11-25', type: 'Operasional', note: 'Listrik & transport', amount: 12100000 },
      { id: 5, date: '2025-12-25', type: 'Operasional', note: 'Listrik & transport', amount: 11500000 },
      { id: 6, date: '2026-01-25', type: 'Operasional', note: 'Listrik & transport', amount: 12800000 },
      { id: 7, date: '2026-02-25', type: 'Operasional', note: 'Listrik & transport', amount: 13200000 }
    ]
  }
});

const ensureDb = () => {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(createDefaultDb(), null, 2), 'utf-8');
  }
};

const readDb = () => {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
};

const writeDb = (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
const nextId = (list) => (list.length ? Math.max(...list.map((item) => item.id || 0)) + 1 : 1);
const sum = (list, selector) => list.reduce((acc, item) => acc + Number(selector(item) || 0), 0);

const addMonthly = (map, month, key, amount) => {
  if (!map[month]) {
    map[month] = { month, sales: 0, purchases: 0, expenses: 0, profit: 0 };
  }
  map[month][key] += amount;
};

const buildReports = (db) => {
  const totalSales = sum(db.transactions.sales, (item) => item.total);
  const purchaseCost = sum(db.transactions.purchases, (item) => item.total);
  const operationalCost = sum(db.transactions.expenses, (item) => item.amount);
  const totalCost = purchaseCost + operationalCost;
  const netProfit = totalSales - totalCost;

  const monthlyMap = {};

  db.transactions.sales.forEach((item) => {
    const month = (item.date || '').slice(0, 7) || 'unknown';
    addMonthly(monthlyMap, month, 'sales', Number(item.total || 0));
  });

  db.transactions.purchases.forEach((item) => {
    const month = (item.date || '').slice(0, 7) || 'unknown';
    addMonthly(monthlyMap, month, 'purchases', Number(item.total || 0));
  });

  db.transactions.expenses.forEach((item) => {
    const month = (item.date || '').slice(0, 7) || 'unknown';
    addMonthly(monthlyMap, month, 'expenses', Number(item.amount || 0));
  });

  const monthlyDetails = Object.values(monthlyMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => ({
      ...item,
      profit: item.sales - item.purchases - item.expenses
    }));

  return {
    profitLoss: { totalSales, totalCost, netProfit, purchaseCost, operationalCost },
    cashFlow: { cashIn: totalSales, cashOut: totalCost, netCash: totalSales - totalCost },
    monthlyRecap: monthlyDetails.map((item) => ({ month: item.month, income: item.sales })),
    monthlyDetails
  };
};

const buildAnalysis = (db, reports) => {
  const totalSales = reports.profitLoss.totalSales;
  const netProfit = reports.profitLoss.netProfit;
  const inventoryValue = sum(db.masterData.products, (p) => Number(p.stock || 0) * Number(p.buyPrice || 0));
  const avgInventory = inventoryValue || 1;
  const cashBalance = reports.cashFlow.netCash;
  const totalAssets = Math.max(cashBalance + inventoryValue, 1);

  const profitMargin = totalSales > 0 ? netProfit / totalSales : 0;
  const inventoryTurnover = totalSales / avgInventory;
  const assetTurnover = totalSales / totalAssets;

  const score =
    (profitMargin >= 0.2 ? 1 : profitMargin >= 0.1 ? 0.6 : 0.2) +
    (inventoryTurnover >= 1 ? 1 : inventoryTurnover >= 0.5 ? 0.6 : 0.2) +
    (assetTurnover >= 1 ? 1 : assetTurnover >= 0.5 ? 0.6 : 0.2);

  let healthStatus = '🟡 Perlu Evaluasi';
  if (score >= 2.4) healthStatus = '🟢 Sehat';
  if (score <= 1.2) healthStatus = '🔴 Risiko';

  return { profitMargin, inventoryTurnover, assetTurnover, healthStatus };
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const normalizeTransactionRecord = (type, record) => {
  if (type === 'sales' || type === 'purchases') {
    record.qty = Number(record.qty || 0);
    record.price = Number(record.price || 0);
    record.total = record.qty * record.price;
  }

  if (type === 'expenses') {
    record.amount = Number(record.amount || 0);
  }
};

const matchRoute = (pathname, prefix) => {
  if (!pathname.startsWith(prefix)) return null;
  return pathname.replace(prefix, '').split('/').filter(Boolean);
};

const serveStatic = (pathname, res) => {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain; charset=utf-8';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/data') {
    const db = readDb();
    const reports = buildReports(db);
    const analysis = buildAnalysis(db, reports);
    return sendJson(res, 200, { db, reports, analysis });
  }

  if (req.method === 'GET' && pathname === '/api/reports') {
    const db = readDb();
    return sendJson(res, 200, buildReports(db));
  }

  if (req.method === 'GET' && pathname === '/api/analysis') {
    const db = readDb();
    const reports = buildReports(db);
    return sendJson(res, 200, buildAnalysis(db, reports));
  }

  const masterParts = matchRoute(pathname, '/api/master/');
  if (masterParts && masterParts.length >= 1) {
    const [entity, id] = masterParts;
    const db = readDb();
    const list = db.masterData[entity];

    if (!list || !Array.isArray(list)) {
      return sendJson(res, 404, { message: 'Entity master data tidak ditemukan.' });
    }

    if (req.method === 'POST' && !id) {
      try {
        const payload = await parseBody(req);
        const record = { id: nextId(list), ...payload };
        list.push(record);
        writeDb(db);
        return sendJson(res, 201, record);
      } catch {
        return sendJson(res, 400, { message: 'Payload harus JSON valid.' });
      }
    }

    if (req.method === 'PUT' && id) {
      try {
        const payload = await parseBody(req);
        const index = list.findIndex((item) => Number(item.id) === Number(id));
        if (index === -1) return sendJson(res, 404, { message: 'Data tidak ditemukan.' });
        list[index] = { ...list[index], ...payload, id: Number(id) };
        writeDb(db);
        return sendJson(res, 200, list[index]);
      } catch {
        return sendJson(res, 400, { message: 'Payload harus JSON valid.' });
      }
    }

    if (req.method === 'DELETE' && id) {
      const index = list.findIndex((item) => Number(item.id) === Number(id));
      if (index === -1) return sendJson(res, 404, { message: 'Data tidak ditemukan.' });
      const removed = list.splice(index, 1)[0];
      writeDb(db);
      return sendJson(res, 200, removed);
    }
  }

  const transactionParts = matchRoute(pathname, '/api/transactions/');
  if (transactionParts && transactionParts.length >= 1) {
    const [type, id] = transactionParts;
    const db = readDb();
    const list = db.transactions[type];

    if (!list || !Array.isArray(list)) {
      return sendJson(res, 404, { message: 'Tipe transaksi tidak ditemukan.' });
    }

    if (req.method === 'POST' && !id) {
      try {
        const payload = await parseBody(req);
        const record = { id: nextId(list), ...payload };
        normalizeTransactionRecord(type, record);
        list.push(record);
        writeDb(db);
        return sendJson(res, 201, record);
      } catch {
        return sendJson(res, 400, { message: 'Payload harus JSON valid.' });
      }
    }

    if (req.method === 'PUT' && id) {
      try {
        const payload = await parseBody(req);
        const index = list.findIndex((item) => Number(item.id) === Number(id));
        if (index === -1) return sendJson(res, 404, { message: 'Data transaksi tidak ditemukan.' });
        list[index] = { ...list[index], ...payload, id: Number(id) };
        normalizeTransactionRecord(type, list[index]);
        writeDb(db);
        return sendJson(res, 200, list[index]);
      } catch {
        return sendJson(res, 400, { message: 'Payload harus JSON valid.' });
      }
    }

    if (req.method === 'DELETE' && id) {
      const index = list.findIndex((item) => Number(item.id) === Number(id));
      if (index === -1) return sendJson(res, 404, { message: 'Data transaksi tidak ditemukan.' });
      const removed = list.splice(index, 1)[0];
      writeDb(db);
      return sendJson(res, 200, removed);
    }
  }

  return serveStatic(pathname, res);
});

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
