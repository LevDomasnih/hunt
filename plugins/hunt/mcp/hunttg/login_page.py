"""hunt_telegram: login_page."""
from __future__ import annotations
import asyncio
import contextlib
import html
import io
import os
import secrets
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs
from telethon import errors
from telethon.tl import functions
from hunttg import clients as _clients
# ---------------------------------------------------------------- QR rendering

def render_qr(url: str, base: Path) -> dict:
    try:
        import qrcode
    except ImportError:
        return {"qr_note": "qrcode package missing; open the url on the phone instead"}
    q = qrcode.QRCode(border=2)
    q.add_data(url)
    q.make(fit=True)
    buf = io.StringIO()
    q.print_ascii(out=buf, invert=True)
    out: dict[str, Any] = {"qr_ascii": buf.getvalue()}
    try:
        from qrcode.image.pure import PyPNGImage
        png = base.with_suffix(".png")
        q.make_image(image_factory=PyPNGImage, box_size=8).save(str(png))
        os.chmod(png, 0o600)
        out["qr_png"] = str(png)
    except Exception:  # pypng missing: SVG needs nothing extra
        import qrcode.image.svg
        svg = base.with_suffix(".svg")
        q.make_image(image_factory=qrcode.image.svg.SvgImage).save(str(svg))
        out["qr_svg"] = str(svg)
    return out


# ---------------------------------------------------------------- 2FA page on 127.0.0.1

_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunt · Telegram password</title>
<style>body{{font:16px system-ui;max-width:420px;margin:12vh auto;padding:0 16px;color:#222;background:#fafafa}}
input,button{{font:inherit;padding:10px;width:100%;box-sizing:border-box;margin-top:8px}}
.err{{color:#b00020}}.ok{{color:#0a7a2f}}small{{color:#666}}</style>
<h2>Telegram two-step password</h2>
<p>Account: <b>{label}</b>{hint}</p>{msg}
{form}
<p><small>This page runs only on your computer (127.0.0.1). The password goes straight to Telegram and is not saved
or shown to the agent.</small></p>"""
_FORM = """<form method="post"><input type="password" name="password" autocomplete="current-password" autofocus required
placeholder="Cloud password"><button>Log in</button></form>"""


async def _start_password_page(acc: _clients.Account) -> str:
    st = acc.login
    token = secrets.token_urlsafe(18)
    hint = ""
    with contextlib.suppress(Exception):
        pw = await acc.client(functions.account.GetPasswordRequest())
        if getattr(pw, "hint", None):
            hint = f" · hint: <i>{html.escape(pw.hint)}</i>"

    def page(msg: str = "", form: bool = True) -> bytes:
        return _PAGE.format(label=html.escape(acc.label), hint=hint, msg=msg, form=_FORM if form else "").encode()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        status, body = "404 Not Found", b"not found"
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            lines = head.decode("latin-1").split("\r\n")
            method, path, _ = (lines[0].split(" ") + ["", "", ""])[:3]
            hdrs = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ln)}
            if path.split("?")[0] == f"/{token}":
                status = "200 OK"
                if st.get("state") == "done":
                    body = page('<p class="ok">Logged in. You can close this tab.</p>', form=False)
                elif method == "POST":
                    n = min(int(hdrs.get("content-length", "0") or 0), 4096)
                    raw = await asyncio.wait_for(reader.readexactly(n), 10) if n else b""
                    pw_ = (parse_qs(raw.decode("utf-8", "replace")).get("password") or [""])[0]
                    try:
                        user = await acc.client.sign_in(password=pw_)
                        acc.me = user
                        st.update(state="done", error=None)
                        body = page('<p class="ok">Logged in. You can close this tab and go back to Claude.</p>', form=False)
                    except errors.PasswordHashInvalidError:
                        body = page('<p class="err">Wrong password, try again.</p>')
                    except errors.FloodWaitError as e:
                        body = page(f'<p class="err">Too many attempts. Wait {e.seconds} s.</p>')
                    except Exception as e:  # noqa: BLE001
                        body = page(f'<p class="err">{html.escape(type(e).__name__)}</p>')
                    finally:
                        pw_ = ""  # drop the reference
                else:
                    body = page()
        except Exception:  # noqa: BLE001
            status, body = "400 Bad Request", b"bad request"
        writer.write(f"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                     f"Referrer-Policy: no-referrer\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
        with contextlib.suppress(Exception):
            await writer.drain()
            writer.close()
        if st.get("state") == "done" and st.get("pw_server"):
            st["pw_server"].close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    st["pw_server"] = server

    async def expire() -> None:
        await asyncio.sleep(600)
        server.close()
        if st.get("state") == "password_needed":
            st.update(state="expired", error="The password page expired; start again with tg_login_qr.")
    st["pw_expire_task"] = asyncio.create_task(expire())
    return f"http://127.0.0.1:{port}/{token}"
