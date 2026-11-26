"""Turn scanned drawings on dark paper into square transparent avatars + a Cinder atlas.

python reymenta/tools/avatars.py <scans folder> <out folder> [--only name1,name2] [--sheet]

Per scan: paper colour = the most common colour among the darkest 40% (pure-black scanner margins left out), ink alpha = colour distance from the paper (grain blurred,
specks removed by an opening), the drawing = the largest blob after a coarse dilation (ignores page edges),
cropped to a square around it, a soft circular mask, the paper unmixed from the colours, 512 px.
Writes <out>/<id>.webp (512, for the phones), <out>/atlas.png (16x16 cells of 256 px, for Cinder),
<out>/avatars.json (id -> source scan, atlas cell).
python reymenta/tools/avatars.py --publish <out folder> <reymenta repo>: 256 px copies into the phone app.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

SKIP = {  # smaller copies of other scans, white-background copies
    "Save0003-400.jpg", "Save0004-500.jpg", "img016.jpg", "rip0034.jpg", "save0034.png",
    "img042.jpg",     # too faint on the paper
    "Scan10049.JPG",  # photo of the whole sketchbook page
    # the same drawing as another scan (identical after cleaning): the img/fox scan is kept
    "25.jpg", "45.jpg", "50.jpg", "54.jpg", "55.jpg", "65.jpg", "79.jpg", "82.jpg", "86.jpg", "89.jpg",
    "145.PNG", "144.PNG", "img039.jpg",
}
WORK = 1400   # processing size
OUT = 512     # avatar size
CELL = 256    # atlas cell
GRID = 16     # atlas grid (256 cells)


def largest_blob_bbox(mask):
    """mask: bool HxW at work size. Returns the bbox (x0,y0,x1,y1) of the main dilated blob and its mask."""
    h, w = mask.shape
    s = 256 / max(h, w)
    small = Image.fromarray((mask * 255).astype(np.uint8)).resize((max(1, int(w * s)), max(1, int(h * s))), Image.BOX)
    small = np.array(small.point(lambda v: 255 if v > 20 else 0).filter(ImageFilter.MaxFilter(9))) > 0
    sh, sw = small.shape
    labels = np.zeros((sh, sw), np.int32)
    best, best_n, cur, best_label = None, 0, 0, 0
    blobs = []  # (label, pixel count, centre distance, bbox)
    for y0 in range(sh):
        for x0 in range(sw):
            if not small[y0, x0] or labels[y0, x0]:
                continue
            cur += 1
            stack = [(y0, x0)]
            labels[y0, x0] = cur
            n, xs, ys = 0, [], []
            while stack:
                y, x = stack.pop()
                n += 1; xs.append(x); ys.append(y)
                for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= yy < sh and 0 <= xx < sw and small[yy, xx] and not labels[yy, xx]:
                        labels[yy, xx] = cur
                        stack.append((yy, xx))
            # prefer big blobs near the centre (page edges sit on the border)
            mx, my = sum(xs) / n / sw - 0.5, sum(ys) / n / sh - 0.5
            blobs.append((cur, n, (mx * mx + my * my) ** 0.5, (min(xs), min(ys), max(xs) + 1, max(ys) + 1)))
            score = n * max(0.05, 1 - 2 * (mx * mx + my * my) ** 0.5)
            if score > best_n:
                best_n, best, best_label = score, (min(xs), min(ys), max(xs) + 1, max(ys) + 1), cur
    if best is None:
        return (0, 0, w, h), np.ones((h, w), bool)
    main_n = next(b[1] for b in blobs if b[0] == best_label)
    chosen = [b for b in blobs if b[0] == best_label or (b[1] >= 0.05 * main_n and b[2] < 0.35)]
    best = (min(b[3][0] for b in chosen), min(b[3][1] for b in chosen),
            max(b[3][2] for b in chosen), max(b[3][3] for b in chosen))
    keep = Image.fromarray((np.isin(labels, [b[0] for b in chosen]) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    keep = np.asarray(keep) > 0
    # the dilation (9 px at 256) grew the blob by ~4 px each side
    g = 4
    x0, y0, x1, y1 = best
    return (max(0, (x0 + g) / s), max(0, (y0 + g) / s), min(w, (x1 - g) / s), min(h, (y1 - g) / s)), keep


def process(path):
    im = Image.open(path)
    im.draft("RGB", (WORK * 2, WORK * 2))
    im = im.convert("RGB")
    im.thumbnail((WORK, WORK), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    # paper = the most common colour among the darker pixels: the ink is lighter than the paper, and a dense
    # drawing can cover more than half the page. Black scanner margins (the Save* scans) are left out, unless
    # the paper itself is black (they then cover most of the image).
    flat = a.reshape(-1, 3)
    fl = lum.ravel()
    black = fl < 10
    cand = fl <= np.percentile(fl, 40)
    if black.mean() < 0.4:
        cand &= ~black
    c = flat[cand]
    q = (c // 16).astype(np.int32)
    key = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    top = np.bincount(key).argmax()
    paper = np.median(c[key == top], axis=0)
    dark = np.sqrt(((a - paper) ** 2).sum(axis=2)) < 40

    dist = np.sqrt(((a - paper) ** 2).sum(axis=2))
    dist = np.asarray(Image.fromarray(np.clip(dist, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    noise = dist[dark]
    low = np.percentile(noise, 90) + 10
    high = low + 45
    alpha = np.clip((dist - low) / (high - low), 0, 1)
    # the ink is lighter than the paper: black margins and shadows are not ink
    plum = float(paper @ np.array([0.299, 0.587, 0.114], np.float32))
    alpha *= np.clip((lum - plum - 4) / 16, 0, 1)

    # specks: opening on the hard mask, then keep alpha only near what survived
    hard = Image.fromarray(((alpha > 0.5) * 255).astype(np.uint8))
    opened = hard.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    near = np.asarray(opened.filter(ImageFilter.MaxFilter(5))) > 0
    alpha *= near

    (x0, y0, x1, y1), keep = largest_blob_bbox(np.asarray(opened) > 0)
    alpha *= keep  # stray specks and page edges outside the drawing
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0) * 1.04

    # unmix the paper: ink = (pixel - paper*(1-a)) / a
    am = np.maximum(alpha, 0.15)[..., None]
    rgb = np.clip((a - paper * (1 - am)) / am, 0, 255)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    full = Image.fromarray(rgba, "RGBA")

    box = (int(round(cx - side / 2)), int(round(cy - side / 2)), int(round(cx + side / 2)), int(round(cy + side / 2)))
    sq = full.crop(box)  # outside the image -> transparent
    sq = sq.resize((OUT, OUT), Image.LANCZOS)

    # soft circular mask (the drawings are round)
    yy, xx = np.mgrid[0:OUT, 0:OUT].astype(np.float32)
    r = np.sqrt((xx - OUT / 2 + 0.5) ** 2 + (yy - OUT / 2 + 0.5) ** 2)
    circle = np.clip((OUT / 2 - r) / 4, 0, 1)
    arr = np.asarray(sq).copy()
    arr[..., 3] = (arr[..., 3] * circle).astype(np.uint8)
    return Image.fromarray(arr, "RGBA"), paper


def ahash(img):
    g = img.convert("RGBA").resize((16, 16), Image.BOX)
    v = np.asarray(g).astype(np.float32)
    v = v[..., :3].mean(axis=2) * v[..., 3] / 255
    return v > v.mean()


def main():
    src, out = sys.argv[1], sys.argv[2]
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    os.makedirs(out, exist_ok=True)
    files = sorted(f for f in os.listdir(src)
                   if f.lower().endswith((".jpg", ".jpeg", ".png")) and f not in SKIP and (only is None or f in only))
    entries, hashes = [], []
    for i, f in enumerate(files):
        av, paper = process(os.path.join(src, f))
        aid = f"av{i:03d}"
        av.save(os.path.join(out, aid + ".webp"), "WEBP", quality=88, method=6)
        entries.append({"id": aid, "source": f, "cell": i})
        hashes.append(ahash(av))
        print(aid, f, "paper", paper.astype(int).tolist(), flush=True)

    # near-duplicates (same drawing scanned twice): report only, the user decides
    dups = []
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            d = int((hashes[i] != hashes[j]).sum())
            if d <= 12:
                dups.append([entries[i]["source"], entries[j]["source"], d])

    n = len(entries)
    atlas = Image.new("RGBA", (GRID * CELL, GRID * CELL), (0, 0, 0, 0))
    for e in entries:
        im = Image.open(os.path.join(out, e["id"] + ".webp")).resize((CELL, CELL), Image.LANCZOS)
        c = e["cell"]
        atlas.paste(im, ((c % GRID) * CELL, (c // GRID) * CELL))
    atlas.save(os.path.join(out, "atlas.png"), optimize=True)
    json.dump({"count": n, "size": OUT, "atlas": {"file": "atlas.png", "grid": GRID, "cell": CELL},
               "avatars": entries, "nearDuplicates": dups},
              open(os.path.join(out, "avatars.json"), "w"), indent=1)
    print(n, "avatars,", len(dups), "near-duplicate pairs")


def publish(out, repo):
    """Copies the avatars into the phone app: <repo>/web/public/avatars/<id>.webp (256 px, shipped with the page
    and the Android app, so nothing to download at the show) and <repo>/src/room/avatarCount.ts."""
    meta = json.load(open(os.path.join(out, "avatars.json")))
    dst = os.path.join(repo, "web", "public", "avatars")
    os.makedirs(dst, exist_ok=True)
    for e in meta["avatars"]:
        im = Image.open(os.path.join(out, e["id"] + ".webp")).resize((256, 256), Image.LANCZOS)
        im.save(os.path.join(dst, e["id"] + ".webp"), "WEBP", quality=85, method=6)
    with open(os.path.join(repo, "src", "room", "avatarCount.ts"), "w", encoding="utf-8", newline="\n") as f:
        f.write("// Written by tools/avatars.py --publish: the avatars in web/public/avatars (av000.webp...),\n"
                "// the same order as assets/avatars/avatars.json and the Cinder atlas cells.\n"
                f"export const AVATAR_COUNT = {meta['count']};\n")
    print("published", meta["count"], "avatars to", dst)


if __name__ == "__main__":
    if "--publish" in sys.argv:  # python avatars.py --publish <out folder> <reymenta repo>
        i = sys.argv.index("--publish")
        publish(sys.argv[i + 1], sys.argv[i + 2])
    else:
        main()
