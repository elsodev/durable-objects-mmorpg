# Draws props/ladder_hole.png (CC0, ours): a hole in the cave floor with a ladder going down,
# 32x32 in the LPC palette of props/ladder.png and the castlefloors stone.
# Usage: python3 scripts/art/draw-ladder-hole.py <out.png>
import sys
from PIL import Image

W = H = 32
OUT = (42, 23, 34, 255)      # ladder outline (from props/ladder.png)
WOOD = (96, 52, 41, 255)
WOOD_D = (68, 39, 37, 255)
WOOD_L = (127, 76, 49, 255)
RIM_L = (138, 144, 170, 255)  # stone floor, lit
RIM = (102, 109, 140, 255)    # stone floor mid (castlefloors)
RIM_D = (70, 70, 92, 255)
PIT = (16, 14, 24, 255)
PIT_WALL = (40, 38, 54, 255)

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = img.load()
cx, cy, rx, ry = 15.5, 18.5, 14.0, 11.0


def inside(x, y, grow=0.0):
    return ((x + 0.5 - cx) / (rx + grow)) ** 2 + ((y + 0.5 - cy) / (ry + grow)) ** 2 <= 1


for y in range(H):
    for x in range(W):
        if not inside(x, y, 0):
            continue
        if not inside(x, y, -2):
            # rim: lit on the far (top) edge, shaded at the near edge, outlined outside
            px[x, y] = RIM_L if y < cy - 3 else (RIM_D if y > cy + 3 else RIM)
        elif not inside(x, y, -3):
            px[x, y] = OUT
        else:
            # the far inner wall shows as a band under the top rim; the rest falls into the dark
            px[x, y] = PIT_WALL if y < cy - 2 else PIT
# outline around the rim (from a snapshot, so it doesn't spread)
snap = img.copy().load()
for y in range(H):
    for x in range(W):
        if snap[x, y][3] == 0 and any(0 <= x + dx < W and 0 <= y + dy < H and snap[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px[x, y] = (42, 40, 56, 255)


def dim(c, y):
    # the ladder fades into the dark below the rim
    k = 1.0 if y < 18 else max(0.25, 1 - (y - 18) * 0.12)
    return (int(c[0] * k), int(c[1] * k), int(c[2] * k), 255)


# rails
for x0 in (9, 19):
    for y in range(4, 27):
        for dx in range(4):
            c = OUT if dx in (0, 3) else (WOOD if dx == 1 else WOOD_D)
            px[x0 + dx, y] = dim(c, y)
    px[x0, 4] = (0, 0, 0, 0)
    px[x0 + 3, 4] = (0, 0, 0, 0)
# rungs
for ry0 in (7, 13, 19, 25):
    for x in range(13, 19):
        px[x, ry0] = dim(OUT, ry0)
        px[x, ry0 + 1] = dim(WOOD_L, ry0)
        px[x, ry0 + 2] = dim(OUT, ry0)

img.save(sys.argv[1])
