#!/usr/bin/env python3
"""把 PNG 转成多尺寸 ICO favicon。"""
import sys
from PIL import Image

src = sys.argv[1]
dst = sys.argv[2]
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

img = Image.open(src).convert("RGBA")
print(f"源图尺寸: {img.size}, mode: {img.mode}")

# 透明像素：圆角矩形裁切 + 中心裁切
w, h = img.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
img = img.crop((left, top, left + side, top + side))

# 生成各尺寸
imgs = []
for s in sizes:
    im = img.resize(s, Image.LANCZOS)
    imgs.append(im)

imgs[-1].save(dst, format="ICO", sizes=[(im.width, im.height) for im in imgs],
              append_images=imgs[:-1])
print(f"已写出: {dst}")

# 验证
import os
print(f"文件大小: {os.path.getsize(dst)} bytes")
ica = Image.open(dst)
print(f"Ico 尺寸: {ica.sizes}")