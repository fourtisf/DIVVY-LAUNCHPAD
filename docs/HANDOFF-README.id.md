# Paket handoff Divvy

Isi folder:

| File | Untuk apa |
|---|---|
| `PROMPT.md` | Prompt yang di-copy ke Claude Code (bagian di bawah garis). |
| `HANDOFF.md` | Spesifikasi lengkap: mekanisme, desain on-chain, API, database, worker, keamanan, fase kerja. |
| `CLAUDE.md` | Aturan repo yang otomatis dibaca Claude Code di setiap sesi. |
| `prototype/divvy-prototype.html` | UI yang sudah di-approve, jadi acuan tampilan. |

## Cara pakai
1. Buat repo baru (misalnya `divvy`), lalu taruh keempat item ini di root repo.
2. Buka Claude Code di folder repo itu.
3. Copy isi `PROMPT.md` (bagian di bawah garis) dan kirim.
4. Claude Code akan mengerjakan **Fase 0** (verifikasi fakta on-chain) dan **Fase 1** (setup project + port UI), lalu berhenti dan mengirim laporan.

## Langkah berikutnya (setelah laporan Fase 0 dan 1)
Kirim ke Claude Code satu per satu, tunggu laporan tiap fase:
- **Fase 2:** "Lanjut Fase 2: launch flow live sesuai HANDOFF §11."
- **Fase 3:** "Lanjut Fase 3: indexer dan trading."
- **Fase 4:** "Lanjut Fase 4: dividend engine, mulai dari dry-run."
- **Fase 5:** "Lanjut Fase 5: hardening dan persiapan launch."

## Keputusan yang perlu kamu jawab (HANDOFF §12)
1. **Pembayaran dividen:** dikirim otomatis tiap jam, atau dikreditkan tiap jam lalu holder klaim sendiri (direkomendasikan, karena biaya kirim ke wallet baru bisa lebih mahal dari dividennya).
2. **Pembagian fee final:** ditentukan setelah batas PlatformConfig Raydium terverifikasi.
3. **Fee creator:** creator ikut tanda tangan saat launch (fee langsung on-chain ke dia), atau Divvy yang meneruskan.
4. **Identitas:** nama final, domain, serta akun X dan Telegram untuk alert.
5. **Saham dividen:** daftar saham yang tersedia saat launch.
6. **Legal:** daftar negara yang diblokir dan teks Terms. Wajib review legal sebelum promosi mainnet, karena token saham dibatasi di beberapa negara.

## Catatan penting
- Claude Code diinstruksikan **tidak memakai SOL mainnet tanpa izinmu**. Dia akan bertanya dulu sebelum membuat PlatformConfig atau mencoba launch.
- Semua angka di prototype masih **data demo** dan akan diganti data asli dari API.
