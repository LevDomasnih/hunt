# Channel bridges, contract 1

A bridge connects a messenger to Hunt. It is a small HTTP service in any language that **you run yourself**, usually on your own computer. It holds the login; Hunt never sees it. A new channel (LINE, Viber, Signal, another WhatsApp client) needs no change in Hunt: write a bridge, run it, `bridge_add`.

Minimal working example: [`examples/echo_bridge.py`](examples/echo_bridge.py).

## Rules

- Listen on `127.0.0.1`, or on https behind your own proxy. Every request carries `Authorization: Bearer <token>`: refuse others with 401.
- Answer JSON objects. Errors: an HTTP status ≥ 400 with `{"error": "code", "message": "…"}`.
- Never retry a send by yourself. If you are not sure it went out, answer `{"status": "unknown"}`.
- Passwords and codes are typed by the person in your own window or on their phone, never passed through Hunt.
- Follow the platform's rules. WhatsApp, Messenger and Instagram forbid automation of personal accounts and may ban them: say so in your README. Do not build ways around their protection.

## Viber and LINE

Without a bridge Hunt uses the one-tap handoff for them ([`viber.md`](viber.md), [`line.md`](line.md)): a link that opens the chat on the hunter's phone, the hunter presses send. A Viber or LINE bridge you run yourself (`channel: "viber"` / `"line"`, peers = E.164 phone for Viber, LINE ID or `@id` for LINE) replaces the handoff once added. Build it only on what the platform officially offers you: a LINE Official Account (Messaging API) or a Viber bot can talk only to people who added or wrote to it, which suits an agency's own inbox, not the hunter's personal chats. Hunt doesn't recommend unofficial clients, reverse-engineered protocols or GUI automation of the desktop apps.

## Endpoints (all under `/v1`)

| Method, path | Answer |
|---|---|
| GET `/about` | `{contract: 1, channel: "line", name: "LINE", features: ["media", "resolve"]}`. `channel`: lowercase, as stored in the CRM |
| GET `/status` | `{connected: true, account: "+66…"}` |
| POST `/login` | `{status: "connected"}` or `{status: "scan", qr_png_base64}` or `{status: "open", url}` |
| GET `/inbox?since=&limit=` | `{chats: [{peer, display, unread, last_at, last_text}], cursor}` |
| GET `/history?peer=&limit=` | `{peer, display, messages: [{id, dir: "in"\|"out"\|"system", at, text, media: [{id, kind, name}]}]}` oldest first; an unknown or new peer → an empty list |
| GET `/media?peer=&id=` | the file bytes with its content type |
| GET `/resolve?query=` | `{matches: [{peer, display}]}` |
| POST `/send` `{peer, text}` | `{status: "sent", id}`, `sent_pending`, `not_sent` or `unknown` |

`peer` is the bridge's stable id of a chat (a phone in E.164, @name or thread id). Times are ISO with an offset. Hunt itself checks the chat name, skips repeated texts and keeps the pace (20 s between messages, 120 s between new chats, 20 new chats a day).
