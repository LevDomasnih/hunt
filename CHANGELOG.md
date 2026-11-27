# Changelog

One version for the plugin and the server. `node scripts/release.mjs <version>` turns "Unreleased" into the release; the release
workflow puts the section on the GitHub release that the bot links for the admins of every server, so write it for people: what
changed for them, not how.

## Unreleased

## 0.2.0 (2026-11-27)

- One version for the plugin and the server, so `claude plugin update` and `codex plugin marketplace upgrade` bring the new plugin.
- `/hunt:update` (Codex: `$hunt:update`): your agent checks the plugin, the countries and your own server once a day and updates each with your yes; the countries can go back one step.
- Your own server updates in one command: `docker compose pull && docker compose up -d` with the ready image, or `npm run update` on Cloudflare.
- The bot tells the admins of a server once when a new version is out, with the update command for their kind of install.
- Before new migrations the database is saved: a copy next to it on Node and Docker, a D1 Time Travel bookmark on Cloudflare, and the way back is printed.
- Your own server without Cloudflare: the same server runs in Docker or on Node with SQLite in one file (`crm/README.md`).
- Toy 3D maps for every city: Bali (Bukit, Canggu, Ubud, Sanur), Jakarta, Bangkok, Phuket, Pattaya, Chiang Mai, Koh Phangan, Almaty, Astana, Tbilisi, Batumi, Istanbul, Antalya, Belgrade, Novi Sad.
- After moving in, the chats show the home only; the other homes you wrote to sit in a read-only search archive.
- The demo works as a static site, so it can be opened from a link without any server.
- Fixed: on the site the "asked" price in a negotiation never showed; changes made right after saving could be lost until the next reload.

## 0.1.0 (2026-11-20)

- The first public version.
