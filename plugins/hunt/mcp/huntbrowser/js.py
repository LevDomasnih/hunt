"""hunt_browser: js."""
from __future__ import annotations
import contextlib
import re
from pathlib import Path
from playwright.async_api import Page
from playwright.async_api import Error as PWError
from huntbrowser import base as _base, helpers as _helpers, pacing as _pacing, session as _session
# ---------------------------------------------------------------- shared JS

TEXT_OF = r"""
function textOf(root) {
  if (!root) return '';
  let out = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.tagName === 'IMG' && n.alt) out += n.alt;
    else if (n.tagName === 'BR') out += '\n';
  }
  return out;
}
"""

SCROLL_UP_JS = r"""
(sel) => {
  const first = document.querySelector(sel);
  if (!first) return {ok: false, why: 'no rows'};
  let el = first.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 5) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return {ok: false, why: 'no scroller'};
  const before = el.scrollTop;
  el.scrollTop = 0;
  const r = el.getBoundingClientRect();
  return {ok: true, before, height: el.scrollHeight, x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 200)};
}
"""

PASTE_JS = r"""
([sel, text]) => {
  const boxes = [...document.querySelectorAll(sel)];
  const box = boxes[boxes.length - 1];
  if (!box) return false;
  box.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  box.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  return true;
}
"""

BOX_TEXT_JS = "(sel) => { " + TEXT_OF + """
  const boxes = [...document.querySelectorAll(sel)];
  const box = boxes[boxes.length - 1];
  return box ? textOf(box) : null;
}"""

LARGEST_IMG_JS = r"""
() => {
  let best = null, area = 0;
  for (const i of document.images) {
    const a = (i.naturalWidth || 0) * (i.naturalHeight || 0);
    if (a > area && i.src && !i.src.startsWith('data:')) { best = i; area = a; }
  }
  return best ? {src: best.src, w: best.naturalWidth, h: best.naturalHeight} : null;
}
"""

BLOB_B64_JS = r"""
async (src) => {
  const r = await fetch(src);
  const b = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return {type: r.headers.get('content-type') || '', data: btoa(s)};
}
"""

DIALOG_TEXT_JS = r"""
() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"], [data-animate-modal-popup="true"]')]
  .map(d => (d.innerText || '').trim()).filter(Boolean).join('\n---\n').slice(0, 2000)
"""


async def scroll_up(page: Page, row_sel: str) -> None:
    """Jump the message list to the top; if it already was there, nudge with a real wheel event so the
    site's 'load older messages' handler fires."""
    r = await _session.safe_eval(page, SCROLL_UP_JS, row_sel)
    if r and r.get("ok") and r.get("before", 1) < 5:
        with contextlib.suppress(PWError):
            await page.mouse.move(r["x"], r["y"])
            await page.mouse.wheel(0, -2500)


def _ext_for(content_type: str, url: str = "") -> str:
    ct = (content_type or "").lower()
    for k, v in (("png", ".png"), ("webp", ".webp"), ("gif", ".gif"), ("mp4", ".mp4"), ("jpeg", ".jpg"), ("jpg", ".jpg")):
        if k in ct:
            return v
    m = re.search(r"\.(jpe?g|png|webp|gif|mp4)(?:\?|$)", url, re.I)
    return f".{m.group(1).lower().replace('jpeg', 'jpg')}" if m else ".jpg"


def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:60] or "peer"


def media_dir(channel: str, account: str, peer: str, out_dir: str | None) -> Path:
    d = Path(out_dir).expanduser() if out_dir else _base.browser_dir() / "media" / f"{channel}-{account}" / _safe_name(peer)
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


async def _fill_box(page: Page, sel: str, text: str, paste_first: bool) -> bool:
    """Put text into a contenteditable composer. Returns True if the box now holds exactly the text."""
    box = page.locator(sel).last
    await box.click()
    current = await _session.safe_eval(page, BOX_TEXT_JS, sel, "")
    if (current or "").strip():
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
    if paste_first:
        await _session.safe_eval(page, PASTE_JS, [sel, text], False)
        await page.wait_for_timeout(700)
        if _helpers._alnum(await _session.safe_eval(page, BOX_TEXT_JS, sel, "") or "") == _helpers._alnum(text):
            return True
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line:
            await page.keyboard.insert_text(line)
        if i < len(lines) - 1:
            await page.keyboard.press("Shift+Enter")
    await page.wait_for_timeout(400)
    return _helpers._alnum(await _session.safe_eval(page, BOX_TEXT_JS, sel, "") or "") == _helpers._alnum(text)


async def _clear_box(page: Page, sel: str) -> None:
    with contextlib.suppress(Exception):
        await page.locator(sel).last.click()
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")


async def _limit_warning(page: Page) -> str | None:
    t = await _session.safe_eval(page, DIALOG_TEXT_JS, None, "") or ""
    return t if t and _pacing.LIMIT_RE.search(t) else None
