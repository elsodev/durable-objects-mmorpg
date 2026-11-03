# Builds the scythe's tool layers and inventory icon from the Universal LPC Spritesheet Character
# Generator scythe by bluecarrot16 (CC-BY-SA 3.0, https://opengameart.org/content/lpc-extended-weapon-animations),
# generator commit 86160e7, spritesheets/weapon/polearm/scythe/.
#   tools/scythe.bg.png       <- attack_slash/behind/scythe.png (zPos 8, behind the body)
#   tools/scythe.fg.png       <- attack_slash/scythe.png        (zPos 150, in front of the hair)
#   tools/scythe.held.bg.png  <- universal_behind/walk/scythe.png
#   tools/scythe.held.fg.png  <- walk/scythe.png
# The slash sheets are the generator's slash_oversize layout (4 facing rows x 6 frames of 192 px),
# which is custom.json's "scythe" action as is. The icon is the upright scythe of the held sheet
# (facing down, frame 0) with the gap where the hand goes filled, the shaft shortened to fit 32 px
# and a wooden grip peg added; it goes in cell 128 of icons/tool_icons.png.
# Usage: python3 scripts/art/build-scythe.py <generator scythe dir> <src/client/public/assets/lpc>
import sys
from PIL import Image

src, assets = sys.argv[1], sys.argv[2]
tools = f"{assets}/custom/tools"


def load(rel):
    return Image.open(f"{src}/{rel}").convert("RGBA")


for rel, out, size in [
    ("attack_slash/behind/scythe.png", "scythe.bg.png", (1152, 768)),
    ("attack_slash/scythe.png", "scythe.fg.png", (1152, 768)),
    ("universal_behind/walk/scythe.png", "scythe.held.bg.png", (576, 256)),
    ("walk/scythe.png", "scythe.held.fg.png", (576, 256)),
]:
    im = load(rel)
    assert im.size == size, (rel, im.size)
    im.save(f"{tools}/{out}", optimize=True)

# ---- icon ----
OUTLINE = (43, 28, 29, 255)
WOOD_D = (98, 53, 28, 255)
WOOD = (174, 118, 75, 255)
WOOD_L = (195, 151, 83, 255)

held = Image.new("RGBA", (64, 64))
held.alpha_composite(load("universal_behind/walk/scythe.png").crop((0, 128, 64, 192)))
held.alpha_composite(load("walk/scythe.png").crop((0, 128, 64, 192)))
fig = held.crop(held.getbbox())  # 21 x 34: blade at the top right, shaft down the left
w, h = fig.size
px = fig.load()

# The shaft's column pattern (outline, dark wood, mid wood) from an unbroken shaft row.
shaft_row = next(y for y in range(h - 1, 0, -1) if px[0, y][3] and px[1, y][3] and px[2, y][3])
pattern = [px[x, shaft_row] for x in range(3)]
# Fill the hand gap: every shaft row below the blade gets the full pattern.
blade_bottom = max(y for y in range(h) for x in range(4, w) if px[x, y][3])
for y in range(blade_bottom + 1, h - 1):
    for x in range(3):
        px[x, y] = pattern[x]

# Keep the blade and the top of the shaft, then a shorter shaft and the butt, so it fits 32 px.
keep_top = blade_bottom + 1
butt = fig.crop((0, h - 2, w, h))
shaft_len = 30 - keep_top - 2
icon_fig = Image.new("RGBA", (w, keep_top + shaft_len + 2))
icon_fig.alpha_composite(fig.crop((0, 0, w, keep_top)), (0, 0))
for i in range(shaft_len):
    icon_fig.alpha_composite(fig.crop((0, keep_top, w, keep_top + 1)), (0, keep_top + i))
icon_fig.alpha_composite(butt, (0, keep_top + shaft_len))
ipx = icon_fig.load()
# Close the butt end with the outline.
for x in range(3):
    if ipx[x, icon_fig.height - 1][3]:
        ipx[x, icon_fig.height - 1] = OUTLINE

cell = Image.new("RGBA", (32, 32))
ox = (32 - icon_fig.width) // 2 + 3
oy = (32 - icon_fig.height) // 2
cell.alpha_composite(icon_fig, (ox, oy))
c = cell.load()
# The grip peg: a short handle sticking out of the shaft to the left, two thirds of the way down.
gy = oy + keep_top + (shaft_len * 2) // 5
for x in range(ox - 4, ox):
    c[x, gy - 1] = OUTLINE
    c[x, gy] = WOOD_L if x > ox - 4 else WOOD
    c[x, gy + 1] = WOOD_D
    c[x, gy + 2] = OUTLINE
for y in range(gy - 1, gy + 3):
    c[ox - 5, y] = OUTLINE

sheet_path = f"{assets}/icons/tool_icons.png"
sheet = Image.open(sheet_path).convert("RGBA")
if sheet.width < 160:
    wide = Image.new("RGBA", (160, 32))
    wide.alpha_composite(sheet, (0, 0))
    sheet = wide
sheet.paste((0, 0, 0, 0), (128, 0, 160, 32))
sheet.alpha_composite(cell, (128, 0))
sheet.save(sheet_path, optimize=True)
print("ok")
