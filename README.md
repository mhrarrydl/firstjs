# Aplikasi Gadai (Node.js)

Aplikasi sederhana untuk mencatat transaksi gadai, menampilkan dashboard, dan mengelola tebus/fee.

## Menjalankan

```bash
npm install
npm run gadai
```

Buka `http://localhost:3000`.
Server akan otomatis membuka browser saat berjalan, dan akan terus aktif sampai Anda menutupnya (Ctrl+C).

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
Folder `datagadai/uploads` menyimpan foto barang yang diunggah, dan `datagadai/backups` menyimpan hasil backup.

## Fitur Utama

- Dashboard ringkas (aktif, total nilai, tebus, total transaksi).
- Backup otomatis harian saat server berjalan + tombol backup manual.
- Laporan harian (gadai masuk, tebus masuk, fee masuk).
- Status jatuh tempo berwarna (aman/peringatan/jatuh tempo).
- Template print ringkas/lengkap.
- Export CSV & backup data langsung dari dashboard.
- Filter & sort pada halaman aktif/riwayat.
- Notifikasi jatuh tempo untuk gadai yang mendekati 3 minggu.
- Upload foto barang pada form gadai baru.
- Form gadai baru dengan tanggal otomatis dan input manual.
- Data identitas tambahan (alamat & NIK) untuk pencatatan.
- Daftar gadai aktif + aksi **Bayar Fee**, **Tebus**, dan **Print**.
- Riwayat tebus dengan tombol print.
