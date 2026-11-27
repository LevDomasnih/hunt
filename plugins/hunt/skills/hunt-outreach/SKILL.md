---
name: hunt-outreach
description: How Hunt writes to owners, agents and managers on Telegram, WhatsApp, Facebook Messenger, Instagram, Viber, LINE and email — pre-send checklist, tone and language per contact, first contact, follow-ups, negotiation, scheduling, declines, cancellations and the "we found a place" close-out, plus channel mechanics and safe sending pace. Use before sending or drafting ANY message to a landlord or agent.
---

# Writing to people

## Before every message (checklist)

1. `contact_resolve` by channel address **with `search_id`**. New person → `contact_upsert` with `lang` and role, link to the listing. If `notes_elsewhere` is not empty, this person is known from another search on this Hunt: read the notes, tell the hunter before the first message, and adapt (ask for terms in writing, don't repeat what went wrong). After the conversation, add what you learned with `contact_note_add`.
2. Read the full history on that channel (`tg_history` / `wa_history` / `fb_history` / `ig_history` / `bridge_history` limit ≥ 200) **and every photo, video and document**. Do not ask for what they already sent.
3. Check the listing `decision`. `not_interested` → don't write (except cancelling a confirmed viewing or the final close-out).
4. Check the brief and profile: what to say about who's moving, budget said, phone policy.
5. Pick the language from `contact.lang` (set it from the conversation, never from the app's interface language). Templates: `region_doc(path, "templates/<lang>/<kind>.md")`.
6. Make sure you are in the right chat: the header or peer id matches the contact's stored address or display name.
7. Draft (`draft_create`) unless the search is in `routine_auto` and the kind is routine. After sending: `draft_mark`, `messages_log`. In another language than the owner's? Put what it says into `tr` in both (and in incoming messages when you log them): the site shows the translation first and the original under it.

## Tone

Like a real person in a chat: short, lowercase is fine, no em dashes, no dot after every line, no numbered questionnaires. One or two questions that matter. Friendly, specific, mention the listing.

First contact = who (from profile), move-in date, term, monthly payment, plus the single most important open question (free on our dates? closed living room? construction nearby?). Add the listing link if they might have many.

> hi! saw your 3br in Ungasan on the Bingin rentals group, looks great. two of us, from Nov 22 for 3-6 months, paying monthly. is it free on those dates?

Follow up once after 1–2 days of silence. Not more.

## Negotiation

- Before ANY message that touches price (first contact asking the price, counter-offer, renewal terms): `negotiation_get(listing_id)`. Open with `offer.price` or lower, never above `budget_said` (`offer.capped` = it was lowered to it); move up only with the hunter's consent.
- Never reveal, hint at or ask about `budget_cap` (it is not in the helper on purpose).
- Use the `arguments` that are present, one or two per message, politely and with numbers: `median` (similar places nearby go for about X), `not_included` (ask to include electricity/water/internet or lower the rent), `empty_since` / `long_listed` (it has been free / listed a while), `season` (low or wet season: demand is down; high: don't push), `term_upfront` (longer term or months upfront for a discount), `was_cheaper` (it was offered for X before; say it gently, from history, not as an accusation).
- Say only `budget_said`. Aim for value, not just price: utilities included, discount for a longer term, cleaning or pool included, smaller deposit, earlier move-in, a bike or car in the deal.
- Our leverage: quick decision, ready to pay monthly on time, longer term if needed.
- Check `market.md` in the region pack for what is normally negotiable and what a realistic discount is.
- Never agree to pay, book or "take it" yourself. Bring the offer to the hunter.

## Viewings

Ask for the exact map pin. Propose concrete slots grouped by area. Confirm the day before or the morning of. "Running late ~10 min" if needed. If the hunter cancels, cancel promptly and politely.

## Declines and close-out

Short, kind, with a reason when useful ("we really need a separate living room"). Agents you decline often bring better options; say what you need in one line. When the search ends: cancel confirmed viewings first, then send everyone else a short "we've found a place, thank you" in their language. Report per channel what was sent and what failed.

**After the home is chosen, other homes are the search archive** (the app shows them read-only under "Архив поиска"; the home's chats are the chosen home, house contacts and contacts not tied to a listing). Never write first to an archived home, never bargain or plan viewings with it. When one writes again ("still looking? I can do 20"), log the message (the thread becomes `waiting_us`, shown as "1 новое" on the archive row, never in "Ждут тебя"), and draft one short "thank you, we already live in another home" in their language for approval; after it goes out set the thread `closed`.

## Event bookings (Афиша)

A member pressed Записаться (digest `event_book`): `event_book_draft(booking_id, text?, lang?)` creates a normal approval draft to the organizer.

- The organizer's language (read their posts or chat first; `lang` en / ru / id uses the CRM template, any other language: write `text`). Short and human: who and how many (names from the booking + guests), the date and time, one question: is there space, a guest list, a table, a padel slot?
- Never pay, never promise or arrange payment, never send card or ID data: payment is on site by the humans ("оплата на месте, сами"). Don't agree to deposits or prepayment; bring such requests to the hunter.
- Same pace, quiet hours and approval as any message; a venue's Instagram counts as a new chat. One follow-up at most, and not on the day of the event.
- After the reply: `event_booking_set(booked | declined, note)` ("guest list under Alex until 23:00"). Members withdrew (`event_book_cancel`) after you asked: a short polite cancellation, then `cancelled`.
- "Опаздываю" on the evening Home (digest `event_late`): the Worker drafts the organizer message itself, only when a booking exists; approve-and-send it like any draft, don't write a second one.

## Supplier orders (wave 10)

The order message is generated by the CRM (Indonesian or English, the names of the price list, "Bayar di tempat") and usually sent by the member themselves. You send one only as an approved draft, word for word: the supplier picks by these names. Questions to a supplier (is it fresh, do you clean the fish, when can you come) are normal drafts, short and polite ("Halo, selamat pagi…"), one message at a time, inside their hours. Never confirm a price, never promise payment, never order "as usual" on your own; the member decides and pays on delivery.

## Party notice (owner, neighbours)

Members throw a party at the house; the region pack's party rules (`party_get` → `rules`) say whether to warn the owner and the neighbours (Bali: yes, quiet after 22:00, the banjar can fine a noisy party). Draft on `party_notice_requested` or when the rules say so, a day or two before, never at night: `party_notice_draft(party_id, to, channel, address, contact_id?, lang?, text?, reason?)`.

- Approval draft only, never auto-sent; same approval, pace and quiet hours as any message. The owner's channel comes from the house contacts; for neighbours use only what the members gave you.
- The owner's language from your thread with them (read it first, `dir='in'` only); neighbours in the local language (Bali: Indonesian, English as a fallback). Without `text` the CRM writes a short default for `lang` en / ru / id.
- Short, warm, good-neighbour tone: the date and time, roughly how many people, "we'll keep it quiet after <quiet_after>" and end on time, a number to call if it gets loud. No excuses, no legal talk, no promises the members didn't make; never mention fines to the owner as a threat, never invent amounts or rules.
- The owner says no or sets conditions: tell the members (`notify`), don't argue.

## Channels

`channels_list` (MCP `hunt-bridge`) shows what is connected. A bridge (any messenger the hunter added, see `channels/BRIDGE.md`) uses `bridge_inbox`, `bridge_history`, `bridge_media`, `bridge_send(expect_display=stored name)`, `bridge_resolve`; when a bridge serves a channel that is also built in, use the bridge. The same rules apply on every channel: approved texts only, read the history first, log with `messages_log`. When the contact's channel is Viber or LINE and no bridge serves it, use the handoff: `handoff_link(channel, address, final_text)` after approval, give the hunter `url` (+ `share_url` for LINE) with `how` and `fallback_text` as a separate message; when they say it went out, `handoff_log_item(direction="out", draft_id)` → `messages_log` → `draft_mark(sent)`; a reply they paste → `handoff_log_item(direction="in")` → `messages_log` → `thread_set`.

| Channel | How | Watch out |
|---|---|---|
| Telegram | MCP `hunt-telegram`: `tg_inbox`, `tg_history`, `tg_media`, `tg_send` (pacing built in), Hunt folder | stop on PeerFlood / FloodWait, don't retry |
| WhatsApp | MCP `hunt-browser` (headless, own profile): `wa_inbox`, `wa_history`, `wa_media`, `wa_send(peer=number, expect_display=stored name)`, see `channels/headless.md`. Fallback: WhatsApp Web in the hunter's browser, `channels/whatsapp.md` | business/saved contacts show a name, so pass `expect_display`; `unknown` after a send = read `wa_history` before anything else, never resend |
| Messenger | MCP `hunt-browser`: `fb_inbox`, `fb_history`, `fb_media`, `fb_send(peer=thread id)`, see `channels/headless.md`. Fallback: facebook.com/messages in the browser, `channels/messenger.md` | e2ee PIN or security check → `login needed`: the hunter types it in the `fb_login` window; personal account only |
| Instagram | MCP `hunt-browser`: `ig_inbox` (incl. requests), `ig_history`, `ig_media`, `ig_send(peer=thread id or @username)`, see `channels/headless.md`. Fallback: instagram.com/direct in the browser | non-followers get one message until they accept |
| Email | Gmail connector, label "Hunt" | agencies in some countries answer only by email |
| Viber | one-tap handoff (MCP `hunt-bridge`): `handoff_link("viber", +phone, final_text)`, see `channels/viber.md` | no automation of personal Viber; prefilled text is best effort, always send `fallback_text` too |
| LINE | one-tap handoff: `handoff_link("line", @oa_id \| LINE ID \| line.me/ti/p link \| +phone, final_text)`, see `channels/line.md` | only an Official Account gets the text prefilled in its chat; a person = profile link + `share_url`; links work on the phone, not LINE for PC |
| Portal chats | per region pack (Airbnb, krisha.kz, DDproperty) | log them like any other channel |

## Pace (avoid bans)

New account: warm up 3–7 days. Then 5–10 new chats a day, never above the tools' daily caps (WhatsApp 15, Messenger 10, Instagram 8, Telegram 20 by default), 2–5 minutes apart, respect quiet hours. One first message per landlord and at most one follow-up. On any limit warning: stop that channel for the day and tell the hunter.

## Re-let, directory and move-out messages

- **Roommates and re-let where the pack sets `housing_ads` (Bali)**: `mode: friends_only` = never post a roommate / flatmate search or a room in our place anywhere public (chats, Facebook groups, marketplaces, no "ищу соседа/соседку"): Indonesians watch these and it brings the owner, banjar or immigration; instead draft a short private message the members send themselves to people they know (`notify` the text). `relet: plain_with_consent` = the whole place for the rest of the lease may go to the usual rental chats only after `relet_set consent=yes`, written as a normal villa for rent (from date, months, price, what is included, photos) with no "пересдача / переуступка / субаренда / re-let / sublet / take over my lease"; in private replies explain honestly how it works (the owner agreed, whose contract, deposit). Before consent, or with `relet: friends_only`, only privately to people the members know (`relet_set` with `channels: [{kind: friends}]`). If a member asks to post otherwise, explain why not and offer the allowed text.
- **Re-let the rest of our lease**: only after the owner's consent (`relet_set consent=yes`). In a `housing_ads` region the wording and channel rules above apply to the posting step below. Compose the ad from the listing and the house (price, term left, what's included, 3 best photos), the hunter approves the text (`draft_create` kind `relet_ad` to the hunter or `notify`), then post it where `sources.yaml` `post_request_where` says it works, on the hunter's accounts, at the normal pace. No auto-posting. Every reply → `relet_lead_set` (reply / viewing / not_suitable with a one-line note) and a normal approved draft back. Viewings with a lead: agree the time with the owner first, then confirm to the lead; set the lead to `viewing` with "tomorrow 15:00, the owner knows".
- **Directory** (`dir_message` instruction, "order 2 gallons of water for tomorrow"): a normal draft to that entry's channel, in the language that works for local services (often Indonesian / Thai / Russian), short and concrete.
- **Owner push-back on move-out** (`moveout_reply`): reply calmly with facts from the lease and `rules.md` (what was paid, what the lease says about early exit, outages or defects), propose the re-let as the fair way out; never threaten, never agree to extra payments yourself.
