---
name: hunt-deal
description: Close a rental in Hunt — scam-check the place and the owner, request the documents (lease, receipts, owner consent, move-in video), review a lease (or a new version of it) against the region's rules and contract checklist, compare versions, write the document summary and the deal dates, plan the payment and handover, run the move-in checklist, log shared expenses, and close the search. Use when a listing is marked "take", when the user shares a lease draft (.docx/.pdf), or says "we're taking it", "check the contract", "what changed in the new version", "we move in on Monday".
---

# Deal, lease and move-in

Before pushing a place towards a deal, check `ratings_get`: if the group rated several places, say how this one compares (score, weak criteria, price, interest). A "take" by the owner sets the group decision to take.

## 0. Before any money: scam check and documents

- The listing must have a scam check (`listing_checks_set`, rules in `region_doc(<region>, "scam.md")`). Owner documents are the part that matters now: the person who signs and receives money must match the land/title document and their ID (Bali: SHM/HGB + KTP; Kazakhstan: fresh certificate of registered rights + ID; Thailand: Chanote / อ.ช.2 + ID). Set the "owner documents" signal to `ok` only after it matches.
- When the place is taken, create the document rows the members will see in "Deal · documents":
  - `doc_request(listing_id, "lease", "Lease")` until you have it;
  - `doc_request(..., "receipt", "Receipt: <amount> cash")` for **every** cash payment, and `expense_add` for the payment itself;
  - `doc_request(..., "owner_consent", "Owner's consent to sublease", note=...)` if the landlord is a tenant subletting;
  - `doc_set(..., kind="movein_video", title="Move-in video and meters", status="due", due_date=<move-in day>, note="before unpacking")`.
  Then ask the owner for the requested ones with `draft_create` (one short message, local language).
- Members send files (lease PDF, receipt photo, move-in video) to the bot DM; the bot attaches them to the deal and a `document` event arrives in the digest. `doc_get(doc_id)` downloads the file for you. A file you produce (a .docx lease converted to PDF: `textutil -convert` / `soffice --headless --convert-to pdf`) goes to the deal with `doc_upload` (sent through the hunter's bot DM; Hunt keeps only the Telegram file id).

## 1. Lease review

Read the file completely (docx: `textutil -convert txt` on macOS or python-docx; pdf: read it). Then load `region_doc(<region>, "rules.md")` and `region_doc(<region>, "contract.md")`.

Report in the user's language, short:

1. **Who is who.** Landlord = owner, or a tenant subletting? If a sublease: owner's consent in writing (or the landlord confirms it in the lease), master lease end date ≥ our end date, owner's name and contact.
2. **Money.** Rent, total, what's due before move-in, payment dates, method (bank / cash), currency.
3. **Deposit.** Amount, when and how it comes back, who returns it (and will that person be around?), allowed deductions, evidence required (photos).
4. **Included / extra.** Utilities, internet, cleaning, pool, garden, building fees. Unknown costs → ask for typical monthly amounts.
5. **Term and exit.** Start/end dates vs what was agreed, extension, early exit, notice.
6. **Rules.** Pets, smoking, guests, subletting, repairs (who fixes what), access.
7. **Local law.** Anything from `rules.md` that applies: registration of foreigners (who files, deadline), stamp duty, notarization, legal deposit limits.
8. **What to fix or ask.** Numbered, each one line, in priority order. Mark what is a must vs nice-to-have.
9. **Check yourself.** Tell the user to verify their own name, date of birth and passport number in the parties section. Never repeat those numbers back.

Do not draft "everything" — only the questions that matter. If the user says something was agreed separately, drop it.

Then write what the members see:
- `doc_summary_set(doc_id, sections=[{icon: "users", title: "Who rents it out", text}, {icon: "calendar", title: "Term"}, {icon: "wallet", title: "Money"}, {icon: "shield", title: "Deposit"}, {icon: "zap", title: "Utilities, cleaning, pool"}], version, pages, doc_date, signed_at)` — 3–6 short sections in the hunter's language. **Never** passport/ID/card/bank numbers or dates of birth (refused).
- `deal_dates_set(listing_id, dates)` from the lease: every `payment` (amount), the `notice` deadline (last day to say "we extend or leave"), `moveout`, `deposit_return` (the latest day it must come back). The bot reminds every member: payments 7 and 2 days before and that morning, notice 14 and 3 days before, move-out 3 days before, deposit on the day and 3 days later (then a `date_due` event comes to you: write to the landlord). Mark paid payments `done: true`.
- `deal_set` keeps terms (`from`, `to`, `rent`, `currency`, `type`), `name` (what the group calls the house, e.g. "House in Ungasan") and the move-in checklist; read the deal first and keep members' ticks and `dates`.
- Asked vs agreed (wave 5): the first `deal_set` with `terms.rent` records the agreed price and takes the first price seen for the listing as asked. If the talk went differently (asked 25M, agreed 22M after negotiation), set both with `deal_prices_set(listing_id, asked, agreed)`: it feeds the recap ("saved 3M a month, 18M over the term"). `recap_get` lists what is still `missing`.

## 2. New version of the lease

Diff old vs new by clause: what changed, what got better or worse for the tenant, what is still open. Short. Save the new version as its own document (`doc_upload` or the file a member sent) with `version` set, and `doc_summary_set(..., changes="…", changes_from=<old version>)`; update `deal_dates_set` if dates moved.

## 3. Payment and handover

- Payments are done by the humans. You may prepare the message with the time of the meeting and the questions.
- Cash: suggest a written receipt on the lease ("received IDR … in cash on <date>", signature), ask the members to photograph it and send it to the bot. Bank: get account details in writing from the landlord's known contact, not from a new number. Log each payment with `expense_add` (who paid, method).
- Keys: who hands them over and when, especially if the landlord leaves before move-in.

## 4. Move-in checklist (store in `deal_set` → `checklist`)

- Walk-through video of every room with the date visible, including existing damage; send it to the landlord and owner the same day, and to the bot (it becomes the `movein_video` document).
- Meter readings (electricity, water, gas) with photos; token balance where prepaid.
- Keys, remotes, access cards counted.
- Contacts: owner, manager, cleaner, pool, emergency repairs → `house_contact_set` (role, cost, period, who pays: in the rent or us, schedule, channel).
- Wi-Fi works; AC in every room works; hot water; pool equipment.
- Local registration of residence if the region requires it (see `rules.md`), and who does it.
- Next payment dates and where to pay.

3D act (wave 4): ask the members to scan the house on move-in day with a LiDAR app (Scaniverse or Polycam: walk room by room, export **GLB**, not USDZ) and send each file to the bot with the room as the caption; it becomes a scan in the Mini App "3D act". Plan the rooms with `scan_set(search_id, room=…, status="todo")` so the act shows "3 of 6". A file you have locally: `scan_upload(listing_id, path, room)` — it compresses big GLBs to ≤ 18 MB with `scan_prepare` first (gltf-transform via npx; Bot API reads files up to 20 MB). Mark a room `redo` with a note when it is too dark or incomplete. When a member presses "Send to the owners" you get `scan_send`: draft a short message with what was scanned and the notable damage, approval first (skill `hunt-outreach`), and send the files only to the contacts the hunter picked. At move-out the same rooms go in with `phase="moveout"`; the act shows both side by side.

Bikes (wave 4): every rental goes into `bike_set` (model, plate, rider, price and period, `paid_until`, the deposit — **never the original passport, only a copy or cash**; refuse and warn if they left the passport — rental contact, pickup checklist: video of every scratch with the date, helmets, STNK in the box, fuel). Each payment: `bike_set(..., pay={amount, paid_by, until})` → an expense (on the rider in split money mode, the common wallet in shared mode) and the new paid-until date. The bot reminds the rider 2 days before and on the day, and on the return date.

Things bought for the house (wave 4): log them with `item_set` (name, price, from whom, date). Two weeks before the move-out offer them to the next tenants (the re-let lead, the owner) and in the region chats with one draft per channel for approval (`items_get` → `resale_target`), then mark them `offered` / `sold` with `sold_price`.

After move-in: `search_update status=living`. Issues members report in the Mini App arrive as `issue` instructions: `issue_set`, tell the owner in their language, follow up until `fixed`. Issues from a guest (`issue` with `data.guest = true`, wave 5) go the same way: relay them to the owner like any other issue.

House guide (wave 5): once the lease is summarized, fill `guide_set(search_id, address, map_url, wifi_name, wifi_password, rules, note)` from the lease summary and the house chat (house rules as up to 12 short lines with an icon). Never passport/ID data or the owner's documents: the guide is shown to guests and on a public link. Don't repeat the Wi-Fi password in chat.

Guests (wave 5): members invite friends for a few days in the Mini App; `guests_get` shows who is in the house and what they see. A guest's request to message a house contact becomes a draft of kind `guest` that a member approves; it then comes back in `drafts_ready` like any other ready draft: send `final_text` and `draft_mark`.

## 5. Move-out checklist

Notice given in writing; inspection date with whoever inspects; deposit bank details sent in advance; photos at check-out.

## 6. Close the search

When the place is confirmed by the hunter: cancel confirmed viewings first, then send everyone else "we've found a place, thank you" (skill `hunt-outreach`), mark all other listings closed, `search_update status=found`. Never store passport or card numbers in `deal_set`, document summaries or expenses.

## House dossier at move-out (wave 4)

At move-out write the dossier of the house (`dossier_set(listing_id=…, title, area_text, owner_contact_id, stats={months, price, currency, price_note, issues}, verdict_title, verdict)`) and its history with `dossier_item_add` (kind `issue`, `power`, `cleaning`, `conflict`, `good`, `money`; one line each: what happened, how it was solved). Facts only, the hunter's language, no ID/card numbers. The verdict is 1–2 sentences ("can rent again, but get the move-out terms on paper"). The dossier is shared across the whole Hunt instance and shows up when the same property or owner appears in a new search.

## What next when the lease ends (wave 5)

42 days before `terms.to` the CRM opens a "what next" vote (`next_get`); add context with `next_note_set(search_id, note)` ("the owner wants +10 % for 2027", "Nusa Dua is 15 % cheaper now"). The decision arrives as an instruction:

- **`next_stay {lease_to, contact_hint}`**: draft to the owner/landlord (`contact_hint` says who) asking the price and terms of a new direct contract from `lease_to`: `negotiation_get` first, rules in `hunt-outreach`; approval as usual. Then the lease flow above for the new contract. Record the new contract as an **extension term** of the same project (wave 6, below), not as a new search.
- **`next_new {lease_to}`**: `search_clone(search_id, move_in=<lease_to>)` → the usual new-search flow (skill `hunt-onboarding` brief check, then sweep), pre-filled from the house dossier (what to avoid, what was good), the members' notes and their places. Post the new links to the group.
- **`next_leave {lease_to}`**: `moveout_set` with the steps below, plan the move-out 3D scans (`scan_set(..., phase="moveout", status="todo")` for the move-in rooms), offer the things for sale (`items_get`, drafts per channel).

## Extension: a new lease term on the same home (wave 6)

After "stay" the project stage is `extension` until the new contract is signed and starts; then it is `living` again, with the full history of terms (`deal_terms_get`). Flow:

1. `deal_term_set(search_id, seq="new", date_from=<old lease end>, date_to, kind, rent, currency, landlord="Made, owner", status="draft")` as soon as the terms are known (often a new landlord: the owner directly instead of the sublessor). `landlord_contact_id` links the contact.
2. The old deposit: returned (paid back), carried (moved into the new deposit), pending (still to come back) or kept — `deposit_prev` + `deposit_prev_amount`; the new deposit in `deposit`. A carried deposit is not a new payment: don't `expense_add` it twice.
3. The new contract: lease review as in section 1, then `doc_upload(listing_id, path, kind="lease", term_seq=<seq>, signed_at=…)` (and receipts with the same `term_seq`); `deal_term_set(..., status="signed")`, and `status="active"` / `"ended"` as time goes by.
4. The new dates: `deal_term_set(..., dates=[…])` in the `deal_dates_set` shape (payments, notice, move-out, deposit return of this term) — the bot reminds members like for the first contract; the next "what next" vote opens 42 days before the new end.
5. The first term stays in the deal (`deal_set` / `deal_dates_set`); never rewrite it into the new contract.

## Closing the project (wave 6)

When the move-out is done (keys handed over, the move-out video and scans in, the deposit back or settled, things sold), finish the house dossier (section above), then `stage_set(search_id, "closed", note="dossier final")`. The project becomes a read-only archive for the members (dossier, documents, money totals stay readable), guests lose access and everyone gets a short DM. If something comes up later (a deposit dispute), `stage_set(search_id, "auto")` reopens it.

## Move-out and re-letting the rest (wave 3)

- When the group decides to leave (end of lease or early), `moveout_set(search_id, date, steps)`: notice (when and how the owner was told), keys and remote (handover time), move-out video and meter photos (members send the video to the bot: it becomes a `moveout_video` document and the step turns done), cleaning, deposit (from the lease `deposit_return` date; after the move-out the bot reminds and raises `date_due` if it does not come back).
- Owner push-back ("you signed for 6 months"): check `contract.md`, the lease summary and `rules.md` for early exit and penalties; write talking points into `moveout_set(pushback={who, to, quote, points})`. Members press "Draft a reply" → instruction `moveout_reply` → a draft with those points (skill `hunt-outreach`).
- If the lease runs past our move-out: ask the owner whether a newcomer can take over the rest (`relet_set consent=asked`, then yes/no), then the re-let flow in `hunt-outreach` (in Bali and any pack with `housing_ads`: the whole villa may be posted only after the owner agrees and only as a normal rental, never called a re-let; a roommate or a room only privately) (`relet_set` with ad text, photos and channels; `relet_lead_set` per reply).
