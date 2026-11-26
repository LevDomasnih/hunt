# Facebook Messenger channel (browser adapter)

Personal Messenger has no API. Hunt uses facebook.com in the hunter's browser. Meta removes "additional profiles" after 2026-12-14 and second accounts break its rules, so this is the hunter's personal account; keep work inside Marketplace/listing threads.

## Open a thread

Use `https://www.facebook.com/messages/e2ee/t/<thread_id>/` (or `/messages/t/<id>/` for non-encrypted). Prefer `www.`: redirects to `web.facebook.com` have lost e2ee history before. Store the thread id in `contact_channels` (channel `messenger`).

If Messenger asks for the end-to-end encryption PIN to restore history, stop and ask the hunter to enter it. Never guess or store PINs.

## Read

```js
document.querySelector('[role="main"]').innerText
```

## Send

Click the message box (take a screenshot first to find it), type the text, press Return. Verify the last message after sending.

## Listings

Marketplace and group posts: open the post, read the full text, open each photo and save the full-size image (not the grid). The author's profile name is often not the owner's real name; the lease will tell.
