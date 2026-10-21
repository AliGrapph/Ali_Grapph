#!/usr/bin/env python3
"""ساخت favicon ها از logo.webp با فضای امن برای برش دایره‌ای (Google).
اجرا:  pip install pillow  &&  python3 make_icons.py   (کنار logo.webp)
خروجی: icon-192.png, icon-512.png, apple-touch-icon.png, favicon.ico"""
from PIL import Image
BG = (17, 17, 16, 255)   # #111110 همان رنگ سایت
SAFE = 0.62              # لوگو حداکثر ۶۲٪ بوم؛ داخل دایره‌ی برش می‌ماند

logo = Image.open("logo.webp").convert("RGBA")

def build(size):
    canvas = Image.new("RGBA", (size, size), BG)
    box = int(size * SAFE)
    l = logo.copy()
    l.thumbnail((box, box), Image.LANCZOS)
    canvas.alpha_composite(l, ((size - l.width) // 2, (size - l.height) // 2))
    return canvas

build(192).save("icon-192.png")
build(512).save("icon-512.png")
build(180).save("apple-touch-icon.png")
build(256).save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("done")
