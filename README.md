# Veracollection Insight - Sistem Keuangan UMKM (JSON)

Aplikasi keuangan UMKM dengan UI dashboard modern seperti referensi (sidebar, menu modul, KPI, tabel master data, transaksi, laporan, analisis) dan seluruh data tersimpan otomatis ke `db.json`.

## Jalankan

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

## Fitur yang berfungsi

- **Master Data**: Produk, Kategori, Supplier, Akun (tambah / edit / hapus).
- **Transaksi**: Penjualan, Pembelian, Pengeluaran (tambah / edit / hapus).
- **Laporan**: Laba Rugi, Arus Kas, Rekap Bulanan + grafik.
- **Analisis**: Profit Margin, Perputaran Persediaan, Asset Turnover + indikator kesehatan.
- **Persistensi Otomatis**: Data tetap ada walaupun server dimatikan lalu `npm start` lagi.

## Catatan API

- `GET /api/data`
- `GET /api/reports`
- `GET /api/analysis`
- `POST|PUT|DELETE /api/master/:entity/:id?`
- `POST|PUT|DELETE /api/transactions/:type/:id?`
