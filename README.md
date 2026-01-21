# Aplikasi Gadai (Node.js)

Aplikasi sederhana untuk mencatat transaksi gadai, menampilkan dashboard, dan mengelola tebus/fee.

## Menjalankan

```bash
npm install
npm run gadai
```

Buka `http://localhost:3000`.

### Windows (jika muncul error ENOENT package.json)

Pastikan Anda menjalankan perintah di folder proyek yang berisi `package.json`.

```bat
cd C:\path\ke\folder\aplikasi\firstjs
dir
npm install
npm run gadai
```

Jika file `package.json` tidak ada di folder tersebut, artinya file proyek belum lengkap
atau Anda berada di folder yang salah.

## Penyimpanan Data

Data disimpan otomatis di folder `datagadai/gadai_db.json`.
Anda juga bisa mengubah lokasi dengan environment variable `GADAI_DATA_DIR`.

## Fitur Utama

- Dashboard ringkas (aktif, total nilai, tebus, total transaksi).
- Form gadai baru dengan tanggal otomatis dan input manual.
- Daftar gadai aktif + aksi **Bayar Fee**, **Tebus**, dan **Print**.
- Riwayat tebus dengan tombol print.
