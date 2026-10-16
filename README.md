# Chat Tanpa Nomor

Aplikasi chat real-time ala WhatsApp yang **tidak memakai nomor telepon**. Daftar dan login cukup dengan username + password.

## Fitur
- Daftar/login dengan username (tanpa nomor HP atau email)
- Chat 1-ke-1 real-time (WebSocket), riwayat tersimpan
- Status online dan indikator "mengetik…"
- Daftar chat dengan pesan terakhir dan penanda belum dibaca
- Tampilan responsif (HP & desktop), bisa dipasang ke layar utama (PWA manifest)
- Password di-hash dengan scrypt, pembatasan percobaan login

## Menjalankan
```bash
npm install
npm start        # http://localhost:3000
npm test         # tes end-to-end
```
Variabel: `PORT` (default 3000), `DB_FILE` (default `data.json`).

Untuk dipakai lewat internet, jalankan di server dan pasang HTTPS (mis. reverse proxy Caddy/Nginx) agar WebSocket memakai `wss://`.

## Catatan
Pesan belum dienkripsi end-to-end dan penyimpanan memakai file JSON (cocok untuk skala kecil/prototipe).
