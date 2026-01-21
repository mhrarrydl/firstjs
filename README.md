# Aplikasi Gadai (Node.js)

Aplikasi sederhana untuk mencatat transaksi gadai, menampilkan dashboard, dan mengelola tebus/fee.

## Menjalankan

```bash
npm install
npm run gadai
```

Buka `http://localhost:3000`.

## Penyimpanan Data

Data disimpan otomatis di folder `datagadai/gadai_db.json`.
Anda juga bisa mengubah lokasi dengan environment variable `GADAI_DATA_DIR`.

## Fitur Utama

- Dashboard ringkas (aktif, total nilai, tebus, total transaksi).
- Form gadai baru dengan tanggal otomatis dan input manual.
- Daftar gadai aktif + aksi **Bayar Fee**, **Tebus**, dan **Print**.
- Riwayat tebus dengan tombol print.
