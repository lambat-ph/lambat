"""Render web/assets/radar/unet_flow.gif (and a static unet_flow.png) from the real U-Net.

    uv run --extra cv python scripts/make_unet_gif.py

Runs the trained checkpoint on one Sen1Floods11 test chip, captures each encoder
stage and decoder block with forward hooks, and draws the activations as a U.
Fixed chip and seed, so the output is reproducible.
"""

from __future__ import annotations

import itertools
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CHIP = "USA_905409"
SEED = 0
TOPK = 8
OUT_DIR = ROOT / "web" / "assets" / "radar"
S1 = ROOT / "data" / "raw" / "sen1floods11" / "S1Hand" / f"{CHIP}_S1Hand.tif"
LAB = ROOT / "data" / "raw" / "sen1floods11" / "LabelHand" / f"{CHIP}_LabelHand.tif"
CKPT = ROOT / "checkpoints" / "unet_sen1floods11.pt"

BLUE, GOLD, INK = (0, 56, 189), (239, 190, 1), (20, 26, 46)
GREY, WHITE, MUTED = (238, 238, 238), (255, 255, 255), (130, 136, 150)
W, H, SS, FPS = 960, 720, 2, 12


# --------------------------------------------------------------------------
# Real activations
# --------------------------------------------------------------------------

def capture():
    """Run the model once. Returns stage thumbnails, VV, mask, label and IoU."""
    import torch

    from lambat import flood

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    model = flood.build_unet()
    model.load_state_dict(torch.load(CKPT, map_location="cpu"))
    model.eval()

    enc, dec = {}, {}

    def enc_hook(_m, _i, out):
        enc["feats"] = [f.detach() for f in out]

    handles = [model.encoder.register_forward_hook(enc_hook)]
    for i, blk in enumerate(model.decoder.blocks):
        handles.append(blk.register_forward_hook(
            lambda _m, _i, out, i=i: dec.__setitem__(i, out.detach())))

    x, y = flood.read_chip(S1, LAB)
    with torch.no_grad():
        logits = model(torch.from_numpy(flood.normalise_db(x)[None]))
    for h in handles:
        h.remove()
    prob = torch.sigmoid(logits)[0, 0].numpy()
    mask = prob > 0.5
    mask[~np.isfinite(x).all(axis=0)] = False
    iou = flood.iou(mask, y)

    # encoder feats: [input, /2, /4, /8, /16, /32]; decoder blocks: /16 ... /1
    stages = {
        "e1": enc["feats"][1], "e2": enc["feats"][2], "e3": enc["feats"][3],
        "e4": enc["feats"][4], "bn": enc["feats"][5],
        "d4": dec[0], "d3": dec[1], "d2": dec[2], "d1": dec[3],
    }
    thumbs = {k: (activation_map(v), v.shape[-1]) for k, v in stages.items()}
    return thumbs, x[0], mask, y, iou


def activation_map(t):
    """Mean of the TOPK most active channels, scaled to 0-1."""
    a = t[0].numpy()
    order = np.argsort(a.mean(axis=(1, 2)))[::-1][:TOPK]
    m = a[order].mean(axis=0)
    lo, hi = np.percentile(m, [2, 98])
    return np.clip((m - lo) / max(hi - lo, 1e-6), 0, 1)


# --------------------------------------------------------------------------
# Drawing
# --------------------------------------------------------------------------

def font(size, bold=False):
    for name in ("segoeuib.ttf" if bold else "segoeui.ttf",
                 "arialbd.ttf" if bold else "arial.ttf"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size * SS)
        except OSError:
            pass
    return ImageFont.load_default()


def ramp(a):
    """0-1 array -> RGB image, light grey to brand blue."""
    a = np.asarray(a, dtype=np.float32)[..., None]
    rgb = np.array(GREY) * (1 - a) + np.array(BLUE) * a
    return Image.fromarray(rgb.astype(np.uint8))


def fit(img, size):
    """Resize to size x size: nearest when enlarging, box filter when shrinking."""
    s = size * SS
    mode = Image.NEAREST if img.width <= s else Image.BOX
    return img.resize((s, s), mode)


def build_assets(thumbs, vv, mask, label):
    lo, hi = np.percentile(vv[np.isfinite(vv)], [1, 99])
    g = np.nan_to_num((vv - lo) / (hi - lo), nan=0.0).clip(0, 1)
    inp = Image.fromarray((g * 255).astype(np.uint8)).convert("RGB")
    two = lambda m: ramp(m.astype(np.float32))
    lab = ramp((label == 1).astype(np.float32))
    return {"in": inp, "out": two(mask), "hand": lab,
            **{k: ramp(v[0]) for k, v in thumbs.items()}}


def layout(thumbs):
    """Return node list: key, label, size text, centre x/y, display size."""
    sizes = {"in": 104, "e1": 92, "e2": 80, "e3": 68, "e4": 56, "bn": 68}
    keys = ["in", "e1", "e2", "e3", "e4", "bn"]
    tops, y = {}, 50
    for k in keys:
        tops[k] = y
        y += sizes[k] + 28
    cy = {k: tops[k] + sizes[k] // 2 for k in keys}
    cy["bn"] = tops["bn"] + sizes["bn"] // 2
    names = {"e1": "Step 1: fine detail", "e2": "Step 2: shapes",
             "e3": "Step 3: regions", "e4": "Step 4: scene"}
    dnames = {"d1": "Step 1: sharp edges", "d2": "Step 2: shapes",
              "d3": "Step 3: regions", "d4": "Step 4: scene"}
    nodes = {}
    nodes["in"] = {"label": "Radar in (VV and VH)", "cx": 80, "cy": cy["in"], "s": 104,
                       "side": "r", "dim": "512 x 512"}
    for k in ("e1", "e2", "e3", "e4"):
        nodes[k] = {"label": names[k], "cx": 80, "cy": cy[k], "s": sizes[k], "side": "r",
                        "dim": f"{thumbs[k][1]} x {thumbs[k][1]}"}
    nodes["bn"] = {"label": "Compact summary of the image", "cx": 480, "cy": cy["bn"],
                       "s": 68, "side": "b", "dim": f"{thumbs['bn'][1]} x {thumbs['bn'][1]}"}
    for e, d in (("e1", "d1"), ("e2", "d2"), ("e3", "d3"), ("e4", "d4")):
        nodes[d] = {"label": dnames[d], "cx": 880, "cy": cy[e], "s": sizes[e], "side": "l",
                        "dim": f"{thumbs[d][1]} x {thumbs[d][1]}"}
    nodes["out"] = {"label": "Water mask", "cx": 880, "cy": cy["in"], "s": 104, "side": "t",
                        "dim": ""}
    nodes["hand"] = {"label": "Hand label (the answer key)", "cx": 730, "cy": cy["in"],
                         "s": 104, "side": "t", "dim": ""}
    return nodes


def edge(n, where):
    x, y, h = n["cx"], n["cy"], n["s"] // 2
    return {"t": (x, y - h), "b": (x, y + h), "l": (x - h, y), "r": (x + h, y)}[where]


def paths(nodes):
    """Polyline for each main-flow transition."""
    p = {}
    chain = ["in", "e1", "e2", "e3", "e4"]
    for a, b in itertools.pairwise(chain):
        p[(a, b)] = [edge(nodes[a], "b"), edge(nodes[b], "t")]
    a, b = nodes["e4"], nodes["bn"]
    ax, ay = edge(a, "b")
    bx, by = edge(b, "l")
    p[("e4", "bn")] = [(ax, ay), (ax, by), (bx, by)]
    a, b = nodes["bn"], nodes["d4"]
    ax, ay = edge(a, "r")
    bx, by = edge(b, "b")
    p[("bn", "d4")] = [(ax, ay), (bx, ay), (bx, by)]
    up = ["d4", "d3", "d2", "d1", "out"]
    for a, b in itertools.pairwise(up):
        p[(a, b)] = [edge(nodes[a], "t"), edge(nodes[b], "b")]
    return p


def point_on(poly, f):
    seg = [np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in itertools.pairwise(poly)]
    d = f * sum(seg)
    for (a, b), n in zip(itertools.pairwise(poly), seg):
        if d <= n or n == seg[-1]:
            t = min(d / max(n, 1e-6), 1)
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        d -= n
    return poly[-1]


class Painter:
    def __init__(self, nodes, assets, iou):
        self.nodes, self.assets, self.iou = nodes, assets, iou
        self.paths = paths(nodes)
        self.f_b, self.f_m, self.f_s = font(13, True), font(12), font(11)
        self.f_t = font(18, True)
        self.cache = {}

    def sc(self, v):
        return round(v * SS)

    def line(self, d, pts, color, width, dash=None):
        pts = [(self.sc(x), self.sc(y)) for x, y in pts]
        if dash is None:
            d.line(pts, fill=color, width=self.sc(width), joint="curve")
            return
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        length = np.hypot(x1 - x0, y1 - y0)
        n, on, off = 0.0, self.sc(dash[0]), self.sc(dash[1])
        while n < length:
            a, b = n / length, min(n + on, length) / length
            d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a),
                    (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)],
                   fill=color, width=self.sc(width))
            n += on + off

    def arrow_head(self, d, poly, color):
        (x0, y0), (x1, y1) = poly[-2], poly[-1]
        ang = np.arctan2(y1 - y0, x1 - x0)
        pts = [(x1, y1)]
        for da in (2.6, -2.6):
            pts.append((x1 + 8 * np.cos(ang + da), y1 + 8 * np.sin(ang + da)))
        d.polygon([(self.sc(x), self.sc(y)) for x, y in pts], fill=color)

    def text(self, d, xy, s, f, fill=INK, anchor="la"):
        d.text((self.sc(xy[0]), self.sc(xy[1])), s, font=f, fill=fill, anchor=anchor)

    def draw_node(self, im, d, k, state):
        n = self.nodes[k]
        x0, y0 = n["cx"] - n["s"] // 2, n["cy"] - n["s"] // 2
        box = [self.sc(x0), self.sc(y0), self.sc(x0 + n["s"]), self.sc(y0 + n["s"])]
        live = state != "off"
        if live:
            im.paste(fit(self.assets[k], n["s"]), (box[0], box[1]))
        else:
            d.rectangle(box, fill=(246, 246, 246))
        if state == "hot":
            pad = self.sc(4)
            d.rectangle([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad],
                        outline=GOLD, width=self.sc(3))
        else:
            d.rectangle(box, outline=INK if live else (205, 205, 210),
                        width=self.sc(1.5))
        col = INK if live else MUTED
        side = n["side"]
        if side == "r":
            p, a = (x0 + n["s"] + 12, n["cy"] - 16), "la"
        elif side == "l":
            p, a = (x0 - 12, n["cy"] - 16), "ra"
        elif side == "t":
            p, a = (n["cx"], y0 - 20), "ma"
        else:
            p, a = (n["cx"], y0 + n["s"] + 6), "ma"
        self.text(d, p, n["label"], self.f_b, col, a)
        if n["dim"] and side != "t":
            q = (p[0], p[1] + 18)
            self.text(d, q, n["dim"] if live else "", self.f_m, MUTED, a)
        elif n["dim"] and live:
            self.text(d, (n["cx"], y0 + n["s"] + 4), n["dim"], self.f_s, MUTED, "ma")

    def skip_lines(self):
        out = []
        for e, dd in (("e1", "d1"), ("e2", "d2"), ("e3", "d3"), ("e4", "d4")):
            a, b = self.nodes[e], self.nodes[dd]
            xa = a["cx"] + a["s"] // 2 + 12 + 150
            xb = b["cx"] - b["s"] // 2 - 12 - 150
            out.append((dd, (xa, a["cy"]), (xb, b["cy"])))
        return out

    def frame(self, shown, hot=None, dot=None, flash=None, show_iou=False):
        im = Image.new("RGB", (W * SS, H * SS), WHITE)
        d = ImageDraw.Draw(im)
        self.text(d, (20, 10), "How LAMBAT's U-Net reads one radar image", self.f_t)
        # skip connections (faint until the decoder step is reached)
        for dd, a, b in self.skip_lines():
            if flash == dd:
                self.line(d, [a, b], GOLD, 5, (9, 5))
            elif dd in shown:
                self.line(d, [a, b], GOLD, 3, (7, 5))
            else:
                self.line(d, [a, b], (250, 236, 170), 2, (7, 5))
        # main arrows
        for (a, b), poly in self.paths.items():
            done = a in shown and b in shown
            col = INK if done else (200, 202, 210)
            self.line(d, poly, col, 1.8)
            self.arrow_head(d, poly, col)
        for k in self.nodes:
            if k == "hand":
                state = "on" if "out" in shown else "off"
            else:
                state = "hot" if k == hot else ("on" if k in shown else "off")
            self.draw_node(im, d, k, state)
        if dot:
            x, y = dot
            r = self.sc(7)
            d.ellipse([self.sc(x) - r, self.sc(y) - r, self.sc(x) + r, self.sc(y) + r],
                      fill=GOLD, outline=INK, width=self.sc(1.5))
        if show_iou:
            self.text(d, (805, 162), f"IoU {self.iou:.2f} on this chip", self.f_b,
                      BLUE, "ma")
        return im.resize((W, H), Image.LANCZOS)


def main():
    thumbs, vv, mask, label, iou = capture()
    print({k: v[1] for k, v in thumbs.items()}, "IoU", round(iou, 4))
    nodes = layout(thumbs)
    p = Painter(nodes, build_assets(thumbs, vv, mask, label), iou)

    order = ["in", "e1", "e2", "e3", "e4", "bn", "d4", "d3", "d2", "d1", "out"]
    frames, durs = [], []

    def add(im, ms=1000 // FPS):
        frames.append(im)
        durs.append(ms)

    shown = ["in"]
    for _ in range(4):
        add(p.frame(shown, hot="in"))
    for a, b in itertools.pairwise(order):
        poly = p.paths[(a, b)]
        for j in range(1, 5):
            add(p.frame(shown, dot=point_on(poly, j / 5)))
        shown = shown + [b]
        for j in range(2):
            add(p.frame(shown, hot=b, flash=b if j == 0 else None))
    add(p.frame(shown, show_iou=True), 2500)

    # one shared palette keeps colours steady and the file small
    sample = Image.new("RGB", (W, H * 4))
    for i, idx in enumerate((10, 30, 55, len(frames) - 1)):
        sample.paste(frames[idx], (0, H * i))
    pal = sample.quantize(255, method=Image.MEDIANCUT, dither=Image.NONE)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gif = OUT_DIR / "unet_flow.gif"
    q[0].save(gif, save_all=True, append_images=q[1:], duration=durs, loop=0,
              optimize=True, disposal=1)
    frames[-1].save(OUT_DIR / "unet_flow.png", optimize=True)
    total = sum(durs) / 1000
    print(f"{len(frames)} frames, {total:.1f}s, {gif.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
