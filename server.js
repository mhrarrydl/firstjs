const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { nanoid } = require("nanoid");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.GADAI_DATA_DIR || path.join(__dirname, "datagadai");
const DB_FILE = path.join(DATA_DIR, "gadai_db.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_META = path.join(DATA_DIR, "backup_meta.json");

const FEE_RATE = 0.1;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function loadDb() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    return { records: [] };
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.records || !Array.isArray(parsed.records)) {
      return { records: [] };
    }
    return parsed;
  } catch (error) {
    return { records: [] };
  }
}

function saveDb(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function rupiah(amount) {
  const number = Number(amount || 0);
  return `Rp ${number.toLocaleString("id-ID")}`;
}

function toDateInputValue(date) {
  const dt = new Date(date);
  const year = dt.getFullYear();
  const month = `${dt.getMonth() + 1}`.padStart(2, "0");
  const day = `${dt.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0);
}

function diffDays(fromDate, toDate) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  const diff = end - start;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function weeksFromDays(days) {
  const effectiveDays = Math.max(1, days || 0);
  return Math.max(1, Math.ceil(effectiveDays / 7));
}

function calcWeeklyFee(amount) {
  return Math.round(Number(amount || 0) * FEE_RATE);
}

function formatDateId(date) {
  const dt = new Date(date);
  const bulan = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return `${dt.getDate()} ${bulan[dt.getMonth()]} ${dt.getFullYear()} pukul ${String(dt.getHours()).padStart(2, "0")}.${String(
    dt.getMinutes()
  ).padStart(2, "0")}`;
}

function calcFeeSummary(record, now = new Date()) {
  const pawnDate = new Date(record.pawnDate);
  const days = diffDays(pawnDate, now);
  const weeks = weeksFromDays(days);
  const weeklyFee = calcWeeklyFee(record.amount);
  const totalFee = weeks * weeklyFee;
  const alreadyPaid = record.feeType === "depan" ? weeklyFee : 0;
  const feeDue = Math.max(0, totalFee - alreadyPaid);

  return {
    days,
    weeks,
    weeklyFee,
    totalFee,
    feeDue,
  };
}

function calcTotals(records) {
  const activeRecords = records.filter((rec) => rec.status === "aktif");
  const redeemedRecords = records.filter((rec) => rec.status === "tebus");
  const totalActiveAmount = activeRecords.reduce((sum, rec) => sum + rec.amount, 0);
  const totalRedeemed = redeemedRecords.reduce((sum, rec) => sum + (rec.tebusTotal || 0), 0);

  return {
    activeCount: activeRecords.length,
    totalActiveAmount,
    totalRedeemed,
    totalRecords: records.length,
  };
}

function loadBackupMeta() {
  ensureDataDir();
  if (!fs.existsSync(BACKUP_META)) {
    return { lastBackupDate: "" };
  }
  try {
    const raw = fs.readFileSync(BACKUP_META, "utf-8");
    return JSON.parse(raw) || { lastBackupDate: "" };
  } catch (error) {
    return { lastBackupDate: "" };
  }
}

function saveBackupMeta(meta) {
  ensureDataDir();
  fs.writeFileSync(BACKUP_META, JSON.stringify(meta, null, 2));
}

function runBackup() {
  ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `gadai_db_${stamp}.json`);
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(backupPath, JSON.stringify({ records: [] }, null, 2));
  } else {
    fs.copyFileSync(DB_FILE, backupPath);
  }
  const dateOnly = new Date().toISOString().slice(0, 10);
  saveBackupMeta({ lastBackupDate: dateOnly });
}

function scheduleDailyBackup() {
  const meta = loadBackupMeta();
  const today = new Date().toISOString().slice(0, 10);
  if (meta.lastBackupDate !== today) {
    runBackup();
  }
  setInterval(() => {
    const checkMeta = loadBackupMeta();
    const nowDate = new Date().toISOString().slice(0, 10);
    if (checkMeta.lastBackupDate !== nowDate) {
      runBackup();
    }
  }, 60 * 60 * 1000);
}

function calcDailyReport(records, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let gadaiMasuk = 0;
  let tebusMasuk = 0;
  let feeMasuk = 0;

  records.forEach((rec) => {
    if (rec.pawnDate && rec.pawnDate.slice(0, 10) === today) {
      gadaiMasuk += rec.amount || 0;
    }
    if (rec.tebusAt && rec.tebusAt.slice(0, 10) === today) {
      tebusMasuk += rec.tebusTotal || 0;
    }
    (rec.events || []).forEach((event) => {
      if (event.type === "bayar-fee" && event.at && event.at.slice(0, 10) === today) {
        feeMasuk += event.feePaid || 0;
      }
    });
  });

  return { gadaiMasuk, tebusMasuk, feeMasuk };
}

function dueStatus(days) {
  if (days >= 21) return "jatuh";
  if (days >= 14) return "warning";
  return "aman";
}

function buildPrintableData(record) {
  const now = new Date();
  const feeSummary = calcFeeSummary(record, now);
  const totalDue = record.amount + feeSummary.feeDue;

  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    item: record.item,
    amount: record.amount,
    feeType: record.feeType,
    pawnDate: new Date(record.pawnDate),
    status: record.status,
    tebusAt: record.tebusAt,
    feeSummary,
    totalDue,
  };
}

function buildCsv(records) {
  const header = [
    "id",
    "nama",
    "hp",
    "barang",
    "gadai",
    "fee_type",
    "status",
    "pawn_date",
    "tebus_at",
    "tebus_total",
  ];
  const rows = records.map((rec) =>
    [
      rec.id,
      rec.name,
      rec.phone,
      rec.item,
      rec.amount,
      rec.feeType,
      rec.status,
      rec.pawnDate,
      rec.tebusAt || "",
      rec.tebusTotal || "",
    ]
      .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function filterRecords(records, query) {
  const search = (query.q || "").toLowerCase();
  const min = Number(query.min || 0);
  const max = Number(query.max || 0);
  const sort = query.sort || "newest";

  let filtered = records.filter((rec) => {
    const matchesSearch = !search
      ? true
      : `${rec.id} ${rec.name || ""} ${rec.item || ""} ${rec.phone || ""}`.toLowerCase().includes(search);
    const matchesMin = min ? rec.amount >= min : true;
    const matchesMax = max ? rec.amount <= max : true;
    return matchesSearch && matchesMin && matchesMax;
  });

  filtered = filtered.sort((a, b) => {
    if (sort === "amountAsc") return a.amount - b.amount;
    if (sort === "amountDesc") return b.amount - a.amount;
    if (sort === "oldest") return new Date(a.pawnDate) - new Date(b.pawnDate);
    return new Date(b.pawnDate) - new Date(a.pawnDate);
  });

  return filtered;
}

function getDueSoon(records, now = new Date()) {
  return records
    .filter((rec) => rec.status === "aktif")
    .map((rec) => {
      const days = diffDays(new Date(rec.pawnDate), now);
      return { rec, days };
    })
    .filter(({ days }) => days >= 14)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
});

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  const db = loadDb();
  const totals = calcTotals(db.records);
  const dueSoon = getDueSoon(db.records);
  const daily = calcDailyReport(db.records);
  res.send(renderLayout("Dashboard", renderDashboard(totals, db.records, dueSoon, daily)));
});

app.get("/gadai-baru", (req, res) => {
  const todayValue = toDateInputValue(new Date());
  res.send(renderLayout("Gadai Baru", renderNewForm(todayValue)));
});

app.post("/gadai-baru", upload.single("photo"), (req, res) => {
  const db = loadDb();
  const pawnDateInput = parseLocalDate(req.body.pawnDate);
  const pawnDate = pawnDateInput || new Date();

  const record = {
    id: `MC${nanoid(8).toUpperCase()}`,
    name: (req.body.name || "").trim(),
    phone: (req.body.phone || "").trim(),
    item: (req.body.item || "").trim(),
    amount: Number(req.body.amount || 0),
    feeType: req.body.feeType === "depan" ? "depan" : "belakang",
    pawnDate: pawnDate.toISOString(),
    photo: req.file ? `/uploads/${req.file.filename}` : "",
    status: "aktif",
    events: [
      {
        type: "gadai",
        at: new Date().toISOString(),
        pawnDate: pawnDate.toISOString(),
      },
    ],
  };

  db.records.unshift(record);
  saveDb(db);

  res.redirect("/aktif");
});

app.get("/aktif", (req, res) => {
  const db = loadDb();
  const records = filterRecords(
    db.records.filter((rec) => rec.status === "aktif"),
    req.query
  );
  const rows = records.map((record) => ({
    record,
    feeSummary: calcFeeSummary(record),
  }));
  res.send(renderLayout("Gadai Aktif", renderActiveList(rows)));
});

app.get("/aktif/:id/bayar-fee", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }
  const feeSummary = calcFeeSummary(record);
  res.send(renderLayout("Bayar Fee", renderFeePage(record, feeSummary)));
});

app.get("/aktif/:id", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }
  const feeSummary = calcFeeSummary(record);
  res.send(renderLayout("Detail Gadai", renderDetailGadai(record, feeSummary)));
});

app.get("/riwayat", (req, res) => {
  const db = loadDb();
  const history = filterRecords(
    db.records.filter((rec) => rec.status !== "aktif"),
    req.query
  );
  res.send(renderLayout("Riwayat", renderHistory(history)));
});

app.post("/aktif/:id/bayar-fee", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }

  const feeSummary = calcFeeSummary(record);
  const paidWeeks = Math.min(3, Math.max(1, Number(req.body.paidWeeks || 1)));
  const feePaid = paidWeeks * feeSummary.weeklyFee;
  const pawnDate = new Date(record.pawnDate);
  pawnDate.setDate(pawnDate.getDate() + paidWeeks * 7);
  record.events = record.events || [];
  record.events.push({
    type: "bayar-fee",
    at: new Date().toISOString(),
    weeks: paidWeeks,
    feePaid,
    note: "Fee dibayar untuk memperpanjang masa gadai.",
  });
  record.pawnDate = pawnDate.toISOString();
  record.updatedAt = new Date().toISOString();

  saveDb(db);
  res.redirect("/aktif");
});

app.post("/aktif/:id/tebus", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }
  if (!req.body.confirmed) {
    return res.send(renderLayout("Konfirmasi Tebus", renderConfirmTebus(record)));
  }
  const feeSummary = calcFeeSummary(record);
  const tebusTotal = record.amount + feeSummary.feeDue;

  record.status = "tebus";
  record.tebusAt = new Date().toISOString();
  record.tebusTotal = tebusTotal;
  record.events = record.events || [];
  record.events.push({
    type: "tebus",
    at: new Date().toISOString(),
    feePaid: feeSummary.feeDue,
    totalPaid: tebusTotal,
  });

  saveDb(db);
  res.redirect("/riwayat");
});

app.post("/riwayat/:id/delete", (req, res) => {
  const db = loadDb();
  const index = db.records.findIndex((rec) => rec.id === req.params.id);
  if (index === -1) {
    return res.redirect("/riwayat");
  }
  if (!req.body.confirmed) {
    return res.send(renderLayout("Konfirmasi Hapus", renderConfirmDelete(db.records[index])));
  }
  db.records.splice(index, 1);
  saveDb(db);
  res.redirect("/riwayat");
});

app.get("/print/:id", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.status(404).send("Data tidak ditemukan");
  }
  res.send(renderPrintGadai(buildPrintableData(record), req.query.mode));
});

app.get("/print/tebus/:id", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.status(404).send("Data tidak ditemukan");
  }
  res.send(renderPrintTebus(buildPrintableData(record), req.query.mode));
});

app.get("/print/fee/:id", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.status(404).send("Data tidak ditemukan");
  }
  const events = record.events || [];
  const lastFee = [...events].reverse().find((event) => event.type === "bayar-fee");
  if (!lastFee) {
    return res.status(404).send("Belum ada pembayaran fee.");
  }
  res.send(renderPrintFee(buildPrintableData(record), lastFee, req.query.mode));
});

app.get("/export/csv", (req, res) => {
  const db = loadDb();
  const csv = buildCsv(db.records);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gadai_export_${Date.now()}.csv"`);
  res.send(csv);
});

app.post("/backup", (req, res) => {
  runBackup();
  res.redirect("/dashboard");
});

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${url}"`);
    return;
  }
  if (platform === "darwin") {
    exec(`open "${url}"`);
    return;
  }
  exec(`xdg-open "${url}"`);
}

app.listen(PORT, () => {
  ensureDataDir();
  scheduleDailyBackup();
  const url = `http://localhost:${PORT}`;
  console.log(`Aplikasi gadai berjalan di ${url}`);
  openBrowser(url);
});

function renderLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Aplikasi Gadai</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-icon">MC</div>
          <div>
            <h1>Mahir Cell</h1>
            <p>Sistem Manajemen Gadai</p>
          </div>
        </div>
        <button class="ghost">Install App</button>
      </header>
      <nav class="tabs">
        <a class="${title === "Dashboard" ? "active" : ""}" href="/dashboard">
          <span class="tab-icon">▦</span> Dashboard
        </a>
        <a class="${title === "Gadai Baru" ? "active" : ""}" href="/gadai-baru">
          <span class="tab-icon">＋</span> Gadai Baru
        </a>
        <a class="${title === "Gadai Aktif" || title === "Bayar Fee" ? "active" : ""}" href="/aktif">
          <span class="tab-icon">◼</span> Aktif
        </a>
        <a class="${title === "Riwayat" ? "active" : ""}" href="/riwayat">
          <span class="tab-icon">↺</span> Riwayat
        </a>
      </nav>
      <main class="content">
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function renderDashboard(totals, records, dueSoon, daily) {
  const latest = records.slice(0, 5);
  return `
    <section class="stats">
      <div class="stat-card">
        <div>
          <h3>Gadai Aktif</h3>
          <p class="stat-value">${totals.activeCount}</p>
          <span class="stat-meta">transaksi</span>
        </div>
        <div class="stat-icon blue">◼</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Total Nilai Gadai</h3>
          <p class="stat-value">${rupiah(totals.totalActiveAmount)}</p>
          <span class="stat-meta">outstanding</span>
        </div>
        <div class="stat-icon green">💵</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Sudah Ditebus</h3>
          <p class="stat-value">${totals.totalRedeemed > 0 ? rupiah(totals.totalRedeemed) : "0"}</p>
          <span class="stat-meta">transaksi</span>
        </div>
        <div class="stat-icon purple">↗</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Total Transaksi</h3>
          <p class="stat-value">${totals.totalRecords}</p>
          <span class="stat-meta">semua waktu</span>
        </div>
        <div class="stat-icon orange">⟳</div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3>Laporan Harian</h3>
      </div>
      <div class="report-grid">
        <div>
          <p class="label">Gadai Masuk</p>
          <p class="value">${rupiah(daily.gadaiMasuk)}</p>
        </div>
        <div>
          <p class="label">Tebus Masuk</p>
          <p class="value">${rupiah(daily.tebusMasuk)}</p>
        </div>
        <div>
          <p class="label">Fee Masuk</p>
          <p class="value">${rupiah(daily.feeMasuk)}</p>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3>Export & Backup</h3>
      </div>
      <div class="action-row">
        <a class="primary" href="/export/csv">Export CSV</a>
        <form method="post" action="/backup">
          <button type="submit" class="ghost">Backup Sekarang</button>
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3>Notifikasi Jatuh Tempo (≥ 2 minggu)</h3>
      </div>
      ${
        dueSoon.length
          ? `<div class="table modern">
              <div class="table-row header">
                <span>ID</span>
                <span>Nama</span>
                <span>Barang</span>
                <span>Hari</span>
              </div>
              ${dueSoon
                .map(
                  ({ rec, days }) => `
                <div class="table-row">
                  <span>${rec.id}</span>
                  <span>${rec.name || "-"}</span>
                  <span>${rec.item || "-"}</span>
                  <span><span class="pill ${dueStatus(days)}">${days} hari</span></span>
                </div>
              `
                )
                .join("")}
            </div>`
          : "<p class=\"muted\">Belum ada gadai yang mendekati 3 minggu.</p>"
      }
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3>Transaksi Terbaru</h3>
      </div>
      <div class="table modern">
        <div class="table-row header">
          <span>ID</span>
          <span>Nama</span>
          <span>Barang</span>
          <span>Status</span>
        </div>
        ${latest
          .map(
            (rec) => `
          <div class="table-row">
            <span>${rec.id}</span>
            <span>${rec.name || "-"}</span>
            <span>${rec.item || "-"}</span>
            <span class="pill ${rec.status}">${rec.status}</span>
          </div>
        `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderNewForm(todayValue) {
  return `
    <section class="form-layout">
      <div class="panel panel-form">
        <div class="panel-header">
          <h3>Gadai Baru</h3>
        </div>
      <form class="form clean" method="post" action="/gadai-baru" id="gadai-form" enctype="multipart/form-data">
          <div class="form-row">
            <label>
              Nama Pegadai
              <input type="text" name="name" placeholder="Masukkan nama..." required />
            </label>
            <label>
              No. HP (opsional)
              <input type="text" name="phone" placeholder="08xx..." />
            </label>
          </div>
        <label>
          Nama Barang
          <input type="text" name="item" placeholder="Contoh: HP Samsung A54" required />
        </label>
        <label>
          Foto Barang
          <input type="file" name="photo" accept="image/*" />
        </label>
          <div class="form-row">
            <label>
              Nilai Gadai (Rp)
              <input type="number" name="amount" min="0" step="1000" value="0" required id="gadai-amount" />
            </label>
            <label>
              Tanggal Gadai
              <input type="date" name="pawnDate" value="${todayValue}" id="gadai-date" />
              <small>Biarkan otomatis jika kosong.</small>
            </label>
          </div>
          <label>
            Pembayaran Fee
            <select name="feeType" id="gadai-fee-type">
              <option value="belakang">Bayar di Belakang</option>
              <option value="depan">Bayar di Depan</option>
            </select>
          </label>
          <button class="primary" type="submit">Simpan Gadai</button>
        </form>
      </div>
      <aside class="panel summary-panel">
        <div class="panel-header">
          <h3>Ringkasan Gadai</h3>
        </div>
        <div class="summary-item">
          <span>Nilai Gadai</span>
          <strong id="summary-amount">Rp 0</strong>
        </div>
        <div class="summary-item">
          <span>Fee per Minggu (10%)</span>
          <strong id="summary-fee">Rp 0</strong>
        </div>
        <div class="summary-item">
          <span>Tebus (Bayar Depan)</span>
          <strong id="summary-tebus-depan">Rp 0</strong>
        </div>
        <div class="summary-item">
          <span>Tebus (Bayar Belakang)</span>
          <strong id="summary-tebus-belakang">Rp 0</strong>
        </div>
        <div class="summary-item highlight">
          <span>Maksimal Tebus (3 minggu)</span>
          <strong id="summary-max-date">-</strong>
        </div>
        <p class="muted">Tanggal maksimal dihitung 3 minggu dari tanggal gadai.</p>
      </aside>
    </section>
    <script>
      const amountInput = document.getElementById("gadai-amount");
      const dateInput = document.getElementById("gadai-date");
      const feeTypeSelect = document.getElementById("gadai-fee-type");
      const summaryAmount = document.getElementById("summary-amount");
      const summaryFee = document.getElementById("summary-fee");
      const summaryTebusDepan = document.getElementById("summary-tebus-depan");
      const summaryTebusBelakang = document.getElementById("summary-tebus-belakang");
      const summaryMaxDate = document.getElementById("summary-max-date");

      const rupiah = (value) =>
        new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
          Number(value || 0)
        );

      function updateSummary() {
        const amount = Number(amountInput.value || 0);
        const fee = Math.round(amount * 0.1);
        summaryAmount.textContent = rupiah(amount);
        summaryFee.textContent = rupiah(fee);
        summaryTebusDepan.textContent = rupiah(amount);
        summaryTebusBelakang.textContent = rupiah(amount + fee);

        const dateValue = dateInput.value;
        if (dateValue) {
          const dt = new Date(dateValue);
          dt.setDate(dt.getDate() + 21);
          summaryMaxDate.textContent = dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
        } else {
          summaryMaxDate.textContent = "-";
        }
      }

      amountInput.addEventListener("input", updateSummary);
      dateInput.addEventListener("change", updateSummary);
      feeTypeSelect.addEventListener("change", updateSummary);
      updateSummary();
    </script>
  `;
}

function renderActiveList(rows) {
  if (!rows.length) {
    return `<section class="panel"><p>Belum ada data gadai aktif.</p></section>`;
  }
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Gadai Aktif</h3>
          <p class="muted">Daftar barang gadai yang masih berjalan.</p>
        </div>
        <span class="badge">${rows.length} item</span>
      </div>
      <form class="search" method="get" action="/aktif">
        <span>🔍</span>
        <input type="text" name="q" placeholder="Cari nota, nama, atau barang..." />
        <input type="number" name="min" placeholder="Min Rp" />
        <input type="number" name="max" placeholder="Max Rp" />
        <select name="sort">
          <option value="newest">Terbaru</option>
          <option value="oldest">Terlama</option>
          <option value="amountAsc">Nominal ↑</option>
          <option value="amountDesc">Nominal ↓</option>
        </select>
        <button type="submit" class="ghost">Filter</button>
      </form>
      <div class="cards-list">
        ${rows
          .map(({ record, feeSummary }) => {
            const pawnDate = new Date(record.pawnDate).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
            const totalDue = record.amount + feeSummary.feeDue;
            const statusClass = dueStatus(feeSummary.days);
            const maxDays = record.feeType === "depan" ? 28 : 21;
            const remainingDays = Math.max(0, maxDays - feeSummary.days);
            return `
            <div class="active-card" data-search="${record.id.toLowerCase()} ${(record.name || "").toLowerCase()} ${(record.item || "").toLowerCase()}">
              <div class="active-header">
                <div>
                  <div class="active-id">
                    <strong>${record.id}</strong>
                    <span class="pill aktif">aktif</span>
                    <span class="pill neutral">Fee ${record.feeType === "depan" ? "Depan" : "Belakang"}</span>
                    <span class="pill ${statusClass}">${feeSummary.days} hari</span>
                    <span class="pill warning">Sisa ${remainingDays} hari</span>
                  </div>
                  <div class="active-meta">
                    <span>👤 ${record.name || "-"}</span>
                    <span>📦 ${record.item || "-"}</span>
                    ${record.photo ? `<a class="link" href="${record.photo}" target="_blank">📷 Foto</a>` : ""}
                  </div>
                </div>
                <div class="active-actions">
                  <a class="ghost" href="/aktif/${record.id}">Detail</a>
                  <form method="post" action="/aktif/${record.id}/tebus">
                    <button type="submit" class="secondary">Tebus</button>
                  </form>
                  <a class="ghost" href="/aktif/${record.id}/bayar-fee">Bayar Fee</a>
                  <a class="ghost" href="/print/${record.id}?mode=ringkas" target="_blank">Print Ringkas</a>
                  <a class="ghost" href="/print/${record.id}?mode=lengkap" target="_blank">Print Lengkap</a>
                </div>
              </div>
              <div class="active-details">
                <span>📞 ${record.phone || "-"}</span>
                <span>📅 ${pawnDate}</span>
              </div>
              <div class="active-footer">
                <div>
                  <p class="label">Gadai</p>
                  <p class="value">${rupiah(record.amount)}</p>
                </div>
                <div>
                  <p class="label">${feeSummary.weeks} minggu</p>
                  <p class="value fee">Fee: ${rupiah(feeSummary.feeDue)}</p>
                </div>
                <div>
                  <p class="label">Total Tebus</p>
                  <p class="value">${rupiah(totalDue)}</p>
                </div>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderHistory(records) {
  if (!records.length) {
    return `<section class="panel"><p>Belum ada transaksi tebus.</p></section>`;
  }
  return `
    <section class="panel">
      <div class="panel-header">
        <h3>Riwayat Tebus</h3>
      </div>
      <form class="search" method="get" action="/riwayat">
        <span>🔍</span>
        <input type="text" name="q" placeholder="Cari nota, nama, atau barang..." />
        <input type="number" name="min" placeholder="Min Rp" />
        <input type="number" name="max" placeholder="Max Rp" />
        <select name="sort">
          <option value="newest">Terbaru</option>
          <option value="oldest">Terlama</option>
          <option value="amountAsc">Nominal ↑</option>
          <option value="amountDesc">Nominal ↓</option>
        </select>
        <button type="submit" class="ghost">Filter</button>
      </form>
      <div class="table modern">
        <div class="table-row header">
          <span>ID</span>
          <span>Nama</span>
          <span>Barang</span>
          <span>Total Tebus</span>
          <span>Tanggal Tebus</span>
          <span>Print</span>
          <span>Hapus</span>
        </div>
        ${records
          .map(
            (rec) => `
        <div class="table-row">
          <span>${rec.id}</span>
          <span>${rec.name || "-"}</span>
          <span>${rec.item || "-"}</span>
          <span>${rupiah(rec.tebusTotal || 0)}</span>
          <span>${rec.tebusAt ? new Date(rec.tebusAt).toLocaleDateString("id-ID") : "-"}</span>
          <span>
            <a class="link" href="/print/tebus/${rec.id}?mode=ringkas" target="_blank">Print Ringkas</a>
            <span> | </span>
            <a class="link" href="/print/tebus/${rec.id}?mode=lengkap" target="_blank">Print Lengkap</a>
          </span>
          <span>
            <form method="post" action="/riwayat/${rec.id}/delete">
              <button type="submit" class="ghost danger">Delete</button>
            </form>
          </span>
        </div>
      `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFeePage(record, feeSummary) {
  const pawnDate = new Date(record.pawnDate).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `
    <section class="panel fee-panel">
      <div class="panel-header">
        <div>
          <h3>Bayar Fee Perpanjangan</h3>
          <p class="muted">Bayar fee untuk memperpanjang masa gadai.</p>
        </div>
      </div>
      <div class="fee-card">
        <div class="fee-header">
          <div>
            <p class="fee-id">${record.id}</p>
            <p class="fee-meta">👤 ${record.name || "-"} · 📦 ${record.item || "-"}</p>
            <p class="fee-meta">📅 ${pawnDate}</p>
          </div>
          <span class="pill neutral">Fee ${record.feeType === "depan" ? "Depan" : "Belakang"}</span>
        </div>
        <div class="fee-grid">
          <div>
            <p class="label">Nilai Gadai</p>
            <p class="value">${rupiah(record.amount)}</p>
          </div>
          <div>
            <p class="label">Max Minggu</p>
            <p class="value">3 minggu</p>
          </div>
          <div>
            <p class="label">Minggu Saat Ini</p>
            <p class="value">${feeSummary.weeks} minggu</p>
          </div>
          <div>
            <p class="label">Fee/Minggu</p>
            <p class="value">${rupiah(feeSummary.weeklyFee)}</p>
          </div>
        </div>
        <form method="post" action="/aktif/${record.id}/bayar-fee" class="fee-form">
          <label>Pilih Jumlah Minggu</label>
          <div class="fee-options">
            ${[1, 2, 3]
              .map(
                (week) => `
              <label class="fee-option">
                <input type="radio" name="paidWeeks" value="${week}" ${week === 1 ? "checked" : ""} />
                <span>${week}</span>
              </label>
            `
              )
              .join("")}
          </div>
          <div class="fee-summary">
            <div>
              <p class="label">Fee per Minggu (10%)</p>
              <p class="value">${rupiah(feeSummary.weeklyFee)}</p>
            </div>
            <div>
              <p class="label">Total Bayar</p>
              <p class="value" id="fee-total">${rupiah(feeSummary.weeklyFee)}</p>
            </div>
          </div>
          <div class="fee-actions">
            <a class="ghost" href="/aktif">Batal</a>
            <a class="ghost" href="/print/fee/${record.id}?mode=ringkas" target="_blank">Print Ringkas</a>
            <a class="ghost" href="/print/fee/${record.id}?mode=lengkap" target="_blank">Print Lengkap</a>
            <button type="submit" class="primary">Bayar Fee</button>
          </div>
        </form>
      </div>
    </section>
    <script>
      const feeRadios = document.querySelectorAll('input[name="paidWeeks"]');
      const feeTotal = document.getElementById("fee-total");
      const weeklyFee = ${feeSummary.weeklyFee};
      feeRadios.forEach((radio) => {
        radio.addEventListener("change", (event) => {
          const weeks = Number(event.target.value || 1);
          feeTotal.textContent = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
            weeks * weeklyFee
          );
        });
      });
    </script>
  `;
}

function renderPrintShell(title, body) {
  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      @page {
        size: 58mm auto;
        margin: 0;
      }
      body {
        font-family: "Helvetica", Arial, sans-serif;
        margin: 0;
        padding: 0;
      }
      .ticket {
        width: 58mm;
        padding: 0;
        box-sizing: border-box;
      }
      .content {
        width: 48mm;
        margin: 0 2mm;
      }
      h1 {
        font-size: 12px;
        margin: 0 0 4px;
        text-align: center;
        font-weight: 700;
      }
      h2 {
        font-size: 9.2px;
        margin: 0 0 8px;
        text-align: center;
        font-weight: 700;
      }
      .rule {
        border-top: 1px solid #000;
        margin: 6px 0;
      }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
        font-size: 10.2px;
      }
      .row .label {
        font-weight: 700;
        flex: 1;
      }
      .row .value {
        font-weight: 700;
        text-align: right;
        flex: 1;
        word-break: break-word;
      }
      .total {
        font-weight: bold;
        font-size: 11.2px;
      }
      .section {
        font-size: 9.2px;
        line-height: 1.35;
      }
      .muted {
        color: #000;
        font-size: 9.6px;
        text-align: center;
        font-weight: 700;
      }
      @media print {
        button {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <button onclick="window.print()">Print</button>
    ${body}
  </body>
</html>`;
}

function renderPrintGadai(data, mode = "ringkas") {
  const isFull = mode === "lengkap";
  const fee = calcWeeklyFee(data.amount);
  const tebus = data.amount + fee;
  const uangTerima = data.feeType === "depan" ? Math.max(0, data.amount - fee) : data.amount;
  const feeInfo = isFull
    ? "Penjelasan Fee:\\nFee 10% per minggu dari harga gadai.\\nJika lebih dari 1 minggu, fee bertambah 10% tiap minggu."
    : "Fee: 10%/minggu dari harga gadai (bertambah tiap minggu).";
  const info = isFull
    ? "Informasi Penting:\\n1. Barang disimpan baik dan tidak digunakan.\\n2. Tidak ambil komponen sebelum tebus.\\n3. Kerusakan tersembunyi di luar tanggung jawab.\\n4. Tidak ditebus sesuai ketentuan = hangus (maksimal 3 minggu).\\n5. Nota wajib dibawa saat tebus.\\n6. Hub 085136661556 jika ada pertanyaan."
    : "Info:\\n1) Disimpan baik & tidak digunakan.\\n2) Tidak ambil komponen sebelum tebus.\\n3) Kerusakan tersembunyi di luar tanggung jawab.\\n4) Lewat ketentuan = hangus. (maksimal 3 minggu)\\n5) Nota wajib dibawa saat tebus.\\n6) Hub 085136661556 jika ada pertanyaan.";
  const body = `
    <div class="ticket">
      <div class="content">
        <h1>MAHIR CELL</h1>
        <h2>BUKTI GADAI (58mm)</h2>
        <div class="rule"></div>
        <div class="row"><span class="label">ID Nota</span><span class="value">${data.id}</span></div>
        <div class="row"><span class="label">Tanggal</span><span class="value">${formatDateId(data.pawnDate)}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Nama</span><span class="value">${(data.name || "-").toUpperCase()}</span></div>
        <div class="row"><span class="label">No HP</span><span class="value">${data.phone || "-"}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Barang</span><span class="value">${(data.item || "-").toUpperCase()}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Harga Gadai</span><span class="value">${rupiah(data.amount)}</span></div>
        <div class="row"><span class="label">Fee</span><span class="value">${rupiah(fee)}</span></div>
        <div class="row"><span class="label">Tipe</span><span class="value">${data.feeType === "depan" ? "Depan" : "Belakang"}</span></div>
        <div class="rule"></div>
        <div class="row total"><span class="label">Harga Tebus</span><span class="value">${rupiah(tebus)}</span></div>
        <div class="row"><span class="label">Uang Diterima</span><span class="value">${rupiah(uangTerima)}</span></div>
        <div class="rule"></div>
        <div class="section">${feeInfo.replaceAll("\\n", "<br />")}</div>
        <div class="rule"></div>
        <div class="section">${info.replaceAll("\\n", "<br />")}</div>
        <p class="muted">Simpan nota ini baik-baik</p>
      </div>
    </div>
  `;
  return renderPrintShell(`Print ${data.id}`, body);
}

function renderPrintTebus(data, mode = "ringkas") {
  const isFull = mode === "lengkap";
  const tebusAt = data.status === "tebus" && data.tebusAt ? new Date(data.tebusAt) : new Date();
  const pawnDate = new Date(data.pawnDate);
  const days = diffDays(pawnDate, tebusAt);
  const weeks = weeksFromDays(days);
  const weeklyFee = calcWeeklyFee(data.amount);
  const feeTotal = weeklyFee * weeks;
  const feePaid = data.feeType === "depan" ? Math.max(0, feeTotal - weeklyFee) : feeTotal;
  const totalTebus = data.amount + feePaid;
  const info = isFull
    ? "Informasi Penting:\\nNota ini adalah bukti tebus resmi. Simpan baik-baik untuk arsip."
    : "Info: Simpan nota ini baik-baik.";
  const body = `
    <div class="ticket">
      <div class="content">
        <h1>MAHIR CELL</h1>
        <h2>BUKTI TEBUS (58mm)</h2>
        <div class="rule"></div>
        <div class="row"><span class="label">ID Nota</span><span class="value">${data.id}</span></div>
        <div class="row"><span class="label">Tebus</span><span class="value">${formatDateId(tebusAt)}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Nama</span><span class="value">${(data.name || "-").toUpperCase()}</span></div>
        <div class="row"><span class="label">Barang</span><span class="value">${(data.item || "-").toUpperCase()}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Harga Gadai</span><span class="value">${rupiah(data.amount)}</span></div>
        <div class="row"><span class="label">Tgl Gadai</span><span class="value">${formatDateId(pawnDate)}</span></div>
        <div class="row"><span class="label">Selisih Hari</span><span class="value">${days}</span></div>
        <div class="row"><span class="label">Minggu (ceil)</span><span class="value">${weeks}</span></div>
        <div class="row"><span class="label">Fee/Minggu</span><span class="value">${rupiah(weeklyFee)}</span></div>
        <div class="row"><span class="label">Fee Total</span><span class="value">${rupiah(feeTotal)}</span></div>
        <div class="row"><span class="label">Fee Dibayar</span><span class="value">${rupiah(feePaid)}</span></div>
        <div class="rule"></div>
        <div class="row total"><span class="label">TOTAL TEBUS</span><span class="value">${rupiah(totalTebus)}</span></div>
        <div class="rule"></div>
        <div class="section">${info.replaceAll("\\n", "<br />")}</div>
        <p class="muted">Simpan nota ini baik-baik</p>
      </div>
    </div>
  `;
  return renderPrintShell(`Print ${data.id}`, body);
}

function renderPrintFee(data, feeEvent, mode = "ringkas") {
  const isFull = mode === "lengkap";
  const weeks = Number(feeEvent.weeks || 1);
  const weeklyFee = calcWeeklyFee(data.amount);
  const feePaid = Number(feeEvent.feePaid || weeks * weeklyFee);
  const info = isFull
    ? "Fee dibayar untuk memperpanjang masa gadai. Simpan nota ini sebagai bukti pembayaran."
    : "Fee dibayar untuk memperpanjang masa gadai.";
  const body = `
    <div class="ticket">
      <div class="content">
        <h1>MAHIR CELL</h1>
        <h2>BUKTI BAYAR FEE (58mm)</h2>
        <div class="rule"></div>
        <div class="row"><span class="label">ID Nota</span><span class="value">${data.id}</span></div>
        <div class="row"><span class="label">Tanggal</span><span class="value">${formatDateId(feeEvent.at)}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Nama</span><span class="value">${(data.name || "-").toUpperCase()}</span></div>
        <div class="row"><span class="label">Barang</span><span class="value">${(data.item || "-").toUpperCase()}</span></div>
        <div class="rule"></div>
        <div class="row"><span class="label">Fee/Minggu</span><span class="value">${rupiah(weeklyFee)}</span></div>
        <div class="row"><span class="label">Minggu Dibayar</span><span class="value">${weeks}</span></div>
        <div class="row total"><span class="label">Total Bayar</span><span class="value">${rupiah(feePaid)}</span></div>
        <div class="rule"></div>
        <div class="section">${info}</div>
        <p class="muted">Simpan nota ini baik-baik</p>
      </div>
    </div>
  `;
  return renderPrintShell(`Print ${data.id}`, body);
}

function renderDetailGadai(record, feeSummary) {
  const pawnDate = formatDateId(record.pawnDate);
  const maxDays = record.feeType === "depan" ? 28 : 21;
  const remainingDays = Math.max(0, maxDays - feeSummary.days);
  const maxLabel = record.feeType === "depan" ? "4 minggu" : "3 minggu";
  const photoBlock = record.photo
    ? `
        <div class="detail-photo">
          <img src="${record.photo}" alt="Foto barang ${record.item || ""}" />
          <a class="ghost" href="${record.photo}" download>Save Image</a>
        </div>
      `
    : `
        <div class="detail-photo placeholder">
          <div class="placeholder-icon">📷</div>
          <p class="muted">Belum ada foto barang.</p>
        </div>
      `;
  return `
    <section class="panel confirm-panel">
      <div class="confirm-card">
        <h3>Detail Gadai</h3>
        <p class="muted">Informasi lengkap transaksi gadai.</p>
        ${photoBlock}
        <div class="confirm-details">
          <div>
            <p class="label">ID Nota</p>
            <p class="value">${record.id}</p>
          </div>
          <div>
            <p class="label">Nama</p>
            <p class="value">${record.name || "-"}</p>
          </div>
          <div>
            <p class="label">Barang</p>
            <p class="value">${record.item || "-"}</p>
          </div>
          <div>
            <p class="label">No HP</p>
            <p class="value">${record.phone || "-"}</p>
          </div>
          <div>
            <p class="label">Tanggal Gadai</p>
            <p class="value">${pawnDate}</p>
          </div>
          <div>
            <p class="label">Harga Gadai</p>
            <p class="value">${rupiah(record.amount)}</p>
          </div>
          <div>
            <p class="label">Fee/Minggu</p>
            <p class="value">${rupiah(feeSummary.weeklyFee)}</p>
          </div>
          <div>
            <p class="label">Minggu Berjalan</p>
            <p class="value">${feeSummary.weeks} minggu (${feeSummary.days} hari)</p>
          </div>
          <div>
            <p class="label">Maksimal</p>
            <p class="value">${maxLabel}</p>
          </div>
          <div>
            <p class="label">Sisa Hari</p>
            <p class="value">${remainingDays} hari</p>
          </div>
        </div>
        <div class="confirm-actions">
          <a class="ghost" href="/aktif">Kembali</a>
          <a class="ghost" href="/print/${record.id}?mode=lengkap" target="_blank">Print Lengkap</a>
        </div>
      </div>
    </section>
  `;
}

function renderConfirmTebus(record) {
  return `
    <section class="panel confirm-panel">
      <div class="confirm-card">
        <h3>Konfirmasi Tebus</h3>
        <p class="muted">Pastikan data benar sebelum memproses tebus.</p>
        <div class="confirm-details">
          <div>
            <p class="label">ID Nota</p>
            <p class="value">${record.id}</p>
          </div>
          <div>
            <p class="label">Nama</p>
            <p class="value">${record.name || "-"}</p>
          </div>
          <div>
            <p class="label">Barang</p>
            <p class="value">${record.item || "-"}</p>
          </div>
        </div>
        <div class="confirm-actions">
          <a class="ghost" href="/aktif">Batal</a>
          <form method="post" action="/aktif/${record.id}/tebus">
            <input type="hidden" name="confirmed" value="true" />
            <button type="submit" class="primary">Ya, Tebus</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderConfirmDelete(record) {
  return `
    <section class="panel confirm-panel">
      <div class="confirm-card danger">
        <h3>Hapus Riwayat</h3>
        <p class="muted">Data tebus akan dihapus permanen.</p>
        <div class="confirm-details">
          <div>
            <p class="label">ID Nota</p>
            <p class="value">${record.id}</p>
          </div>
          <div>
            <p class="label">Nama</p>
            <p class="value">${record.name || "-"}</p>
          </div>
          <div>
            <p class="label">Barang</p>
            <p class="value">${record.item || "-"}</p>
          </div>
        </div>
        <div class="confirm-actions">
          <a class="ghost" href="/riwayat">Batal</a>
          <form method="post" action="/riwayat/${record.id}/delete">
            <input type="hidden" name="confirmed" value="true" />
            <button type="submit" class="ghost danger">Ya, Hapus</button>
          </form>
        </div>
      </div>
    </section>
  `;
}
