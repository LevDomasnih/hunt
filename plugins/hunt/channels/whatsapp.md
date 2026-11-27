# WhatsApp channel (browser adapter)

> The default is Hunt's own headless profile (`hunt-browser`, see `headless.md`). This page is the fallback: the hunter's Chrome driven with the browser extension.

WhatsApp has no usable API for personal outreach (Cloud API needs opt-in and templates; unofficial libraries risk a ban). Hunt drives **WhatsApp Web in the hunter's own browser** with the browser tools (Claude in Chrome). Ideally a separate Chrome profile linked to the hunting number.

All snippets below were used in real hunts. Run them with the browser JavaScript tool in the WhatsApp tab.

## Open a chat

Navigate to `https://web.whatsapp.com/send?phone=<digits without +>`, wait ~10 s (the page reloads), then wait for `#main header`. Never act on whatever chat happens to be open.

## Verify it's the right chat

```js
const H = document.querySelector('#main header')?.innerText || '';
const digits = H.replace(/\D/g, '');
// Personal numbers: header contains the number digits.
// Saved contacts and business accounts show a NAME instead: compare with contact_channels.display
// stored in the CRM. If neither matches, stop.
```

If `#main` is missing after a fresh navigation, the number has no WhatsApp or the page is still loading: wait and retry once, then report "no chat".

## Read

```js
[...document.querySelectorAll('#main [role="row"]')]
  .map(r => r.innerText.replace(/\n/g, ' | ')).join('\n')
```

Scroll up (`#main [role="application"]` or the message list) until the first message to read the whole history. Strip URLs and `?&=` from returned text if the tool refuses to output query strings.

Unread chats in the list: rows in `#pane-side` that contain an element with `aria-label` mentioning unread (localized: "unread", "непрочитан"). Missed calls show as "Missed voice call" rows — report them.

## Send

```js
const box = document.querySelector('#main footer [contenteditable="true"]');
box.focus();
const dt = new DataTransfer();
dt.setData('text/plain', TEXT);
box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
await new Promise(r => setTimeout(r, 700));
box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
```

Then wait 2 s **in a separate step** (the page sometimes reloads right after a send and the tool reports "Detached"), and verify the last row contains your text. Never resend without checking: a retry after "Detached" can produce a duplicate.

## Language

Decide the language from the contact's own messages (`contact.lang`), never from what the page shows: WhatsApp UI labels and system notices are in the interface language and will fool a naive detector.

## Media

Photos open in a viewer; save full-size images via the viewer, not grid thumbnails. Note "video in chat" on the card if you can't save it.

## Batches

For many contacts (close-out), one contact per step: navigate → wait → verify → send → wait → verify. Keep a list with results (sent / no chat / failed) and retry the failures once at the end.
