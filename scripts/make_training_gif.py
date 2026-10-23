"""Replay U-Net training and render web/assets/radar/unet_training.gif (+ .png).

    uv run --extra cv python scripts/make_training_gif.py                # retrain, then render
    uv run --extra cv python scripts/make_training_gif.py --render-only  # re-render from the saved replay

Retrains with the same settings as train_unet.py (seed 0, 15 epochs, pretrained
resnet34, same split and loss) by calling its main() with a per-epoch callback.
After the untrained model (round 0) and after every epoch it records the predicted
water probability for three fixed test chips, the training loss and the validation
pooled IoU, into checkpoints/training_replay.npz. The replay writes its own
checkpoint (checkpoints/replay_unet.pt); the reported model is never touched.

Chips: USA_905409 (easy, as in the process GIF), Spain_7370579, and the harder chip:
the test chip whose per-chip IoU under the reported checkpoint is closest to the
test median (ties broken by name), excluding the other two.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

CKPT = ROOT / "checkpoints" / "unet_sen1floods11.pt"
REPLAY_CKPT = ROOT / "checkpoints" / "replay_unet.pt"
NPZ = ROOT / "checkpoints" / "training_replay.npz"
OUT_DIR = ROOT / "web" / "assets" / "radar"
FIXED = ["USA_905409", "Spain_7370579"]
EPOCHS = 15
REPORTED_BEST = 0.611

BLUE, GOLD, INK = (0, 56, 189), (239, 190, 1), (20, 26, 46)
GREY, WHITE, MUTED = (238, 238, 238), (255, 255, 255), (130, 136, 150)
LIGHT_LINE = (150, 170, 215)
W, H, SS = 960, 700, 2
PANEL = 142


# --------------------------------------------------------------------------
# Recording
# --------------------------------------------------------------------------

def chip_name(pair):
    return pair[0].name.replace("_S1Hand.tif", "")


def pick_hard_chip(test, names):
    """Chip with per-chip IoU under the reported checkpoint closest to the median."""
    import torch

    from lambat import flood
    from train_unet import predict

    model = flood.build_unet()
    model.load_state_dict(torch.load(CKPT, map_location="cpu"))
    preds = predict(model, test, flood)
    per = {n: flood.iou(p, y) for n, p, (_, y) in zip(names, preds, test)}
    valid = {n: v for n, v in per.items() if not np.isnan(v)}
    med = float(np.median(list(valid.values())))
    cands = sorted((abs(v - med), n) for n, v in valid.items() if n not in FIXED)
    pick = cands[0][1]
    print(f"test median IoU {med:.3f}; hard chip {pick} (IoU {valid[pick]:.3f} under the reported checkpoint)", flush=True)
    return pick, valid[pick], med


def record():
    import torch

    import train_unet
    from lambat import flood

    rec = {"loss": [], "val_iou": [], "prob": [], "chip_iou": []}
    state = {}

    def on_epoch(epoch, model, loss, val, ctx):
        if not state:
            names = [chip_name(p) for p in ctx["test_pairs"]]
            hard, hard_iou, med = pick_hard_chip(ctx["test"], names)
            state["chips"] = FIXED + [hard]
            state["hard_iou"], state["median"] = hard_iou, med
            state["data"] = [ctx["test"][names.index(c)] for c in state["chips"]]
        model.eval()
        probs, ious = [], []
        with torch.no_grad():
            for x, y in state["data"]:
                p = torch.sigmoid(model(torch.from_numpy(flood.normalise_db(x)[None])))[0, 0].numpy()
                m = p > 0.5
                m[~np.isfinite(x).all(axis=0)] = False
                probs.append(p.astype(np.float16))
                ious.append(flood.iou(m, y))
        rec["loss"].append(np.nan if loss is None else loss)
        rec["val_iou"].append(val)
        rec["prob"].append(np.stack(probs))
        rec["chip_iou"].append(ious)
        print(f"  replay round {epoch}: val IoU {val:.3f}, chip IoU {np.round(ious, 3).tolist()}", flush=True)

    train_unet.main(["--epochs", str(EPOCHS), "--pretrained", "--seed", "0",
                     "--out", str(REPLAY_CKPT)], on_epoch=on_epoch)

    vv = [x[0].astype(np.float16) for x, _ in state["data"]]
    label = [y for _, y in state["data"]]
    NPZ.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        NPZ, chips=np.array(state["chips"]), loss=np.array(rec["loss"]),
        val_iou=np.array(rec["val_iou"]), prob=np.stack(rec["prob"]),
        chip_iou=np.array(rec["chip_iou"]), vv=np.stack(vv), label=np.stack(label),
        hard_iou=state["hard_iou"], median=state["median"])
    print(f"saved {NPZ}")


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
    return Image.fromarray((np.array(GREY) * (1 - a) + np.array(BLUE) * a).astype(np.uint8))


def vv_image(vv):
    v = vv.astype(np.float32)
    lo, hi = np.percentile(v[np.isfinite(v)], [1, 99])
    g = np.nan_to_num((v - lo) / (hi - lo), nan=0.0).clip(0, 1)
    return Image.fromarray((g * 255).astype(np.uint8)).convert("RGB")


def fit(img):
    return img.resize((PANEL * SS, PANEL * SS), Image.BOX)


class Painter:
    def __init__(self, data):
        self.d = data
        self.chips = [str(c) for c in data["chips"]]
        self.vv = [fit(vv_image(v)) for v in data["vv"]]
        self.lab = [fit(ramp(lab == 1)) for lab in data["label"]]
        self.f_h, self.f_b, self.f_m, self.f_s = font(34, True), font(13, True), font(12), font(11)
        self.f_big = font(26, True)
        self.n = len(data["val_iou"])
        loss = np.asarray(data["loss"], dtype=np.float64)
        loss[0] = loss[1]  # round 0 has no training loss; the chart starts at round 1
        self.loss = loss

    def sc(self, v):
        return int(round(v * SS))

    def text(self, d, xy, s, f, fill=INK, anchor="la"):
        d.text((self.sc(xy[0]), self.sc(xy[1])), s, font=f, fill=fill, anchor=anchor)

    def box(self, im, d, x, y, img):
        im.paste(img, (self.sc(x), self.sc(y)))
        d.rectangle([self.sc(x), self.sc(y), self.sc(x + PANEL), self.sc(y + PANEL)],
                    outline=INK, width=self.sc(1.5))

    def chart(self, d, rect, title, series, first, upto, lo, hi, fmt, line, ticks):
        x0, y0, x1, y1 = rect
        self.text(d, (x0, y0 - 24), title, self.f_b)

        def px(i):
            return x0 + 34 + (x1 - x0 - 50) * i / EPOCHS

        def py(v):
            return y1 - 22 - (y1 - y0 - 32) * (v - lo) / (hi - lo)

        d.rectangle([self.sc(x0), self.sc(y0), self.sc(x1), self.sc(y1)], fill=WHITE)
        for t in ticks:
            d.line([(self.sc(x0 + 34), self.sc(py(t))), (self.sc(x1 - 16), self.sc(py(t)))],
                   fill=GREY, width=self.sc(1))
            self.text(d, (x0 + 28, py(t)), fmt(t), self.f_s, MUTED, "rm")
        for i in range(0, EPOCHS + 1, 5):
            self.text(d, (px(i), y1 - 18), str(i), self.f_s, MUTED, "ma")
        if upto < first:
            return
        pts = [(self.sc(px(i)), self.sc(py(series[i]))) for i in range(first, upto + 1)]
        if len(pts) > 1:
            d.line(pts, fill=line, width=self.sc(2.5), joint="curve")
        r = self.sc(2.5)
        for cx, cy in pts[:-1]:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=line)
        r = self.sc(6.5)
        cx, cy = pts[-1]
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD, outline=INK, width=self.sc(1.5))

    def frame(self, e):
        im = Image.new("RGB", (W * SS, H * SS), GREY)
        d = ImageDraw.Draw(im)
        head = "Before training" if e == 0 else f"Training round {e} of {EPOCHS}"
        self.text(d, (24, 12), head, self.f_h)
        self.text(d, (24, 58), "A re-run with the same settings as the reported model, so the numbers differ slightly.",
                  self.f_m, MUTED)
        xs = [24, 24 + PANEL + 10, 24 + 2 * (PANEL + 10)]
        for x, t in zip(xs, ("Radar image", "Hand label (answer)", "Model's guess")):
            self.text(d, (x, 84), t, self.f_b)
        for r in range(3):
            y = 106 + r * (PANEL + 40)
            self.box(im, d, xs[0], y, self.vv[r])
            self.box(im, d, xs[1], y, self.lab[r])
            prob = self.d["prob"][e, r].astype(np.float32)
            self.box(im, d, xs[2], y, fit(ramp(np.nan_to_num(prob))))
            self.text(d, (xs[0], y + PANEL + 5), self.chips[r], self.f_s, MUTED)
            self.text(d, (xs[2], y + PANEL + 3), f"IoU {self.d['chip_iou'][e, r]:.2f}", self.f_b, BLUE)
        cx0, cx1 = 520, 936
        val = self.d["val_iou"]
        self.chart(d, (cx0, 128, cx1, 360), "Score by round, on 89 unseen images (IoU, higher is better)",
                   val, 0, e, 0.0, 1.0, lambda t: f"{t:.1f}", BLUE, (0.0, 0.5, 1.0))
        top = float(np.ceil(self.loss.max() * 10) / 10)
        self.chart(d, (cx0, 420, cx1, 600), "Training loss by round (lower is better)",
                   self.loss, 1, e, 0.0, top, lambda t: f"{t:.1f}", LIGHT_LINE, (0.0, top / 2, top))
        self.text(d, (cx0, 616), f"Score now: {val[e]:.2f}", self.f_big, BLUE)
        self.text(d, (cx0, 654), "IoU is the overlap between the model's water and the hand-drawn water. 1.0 is perfect.",
                  self.f_s, MUTED)
        self.text(d, (cx0, 670), "Darker blue in the guess means the model is surer it is water.",
                  self.f_s, MUTED)
        return im.resize((W, H), Image.LANCZOS)


def render():
    data = dict(np.load(NPZ))
    p = Painter(data)
    frames = [p.frame(e) for e in range(p.n)]
    durs = [600] * p.n
    frames.append(frames[-1].copy())
    durs.append(2500)
    sample = Image.new("RGB", (W, H * 4))
    for i, idx in enumerate((0, p.n // 3, 2 * p.n // 3, p.n - 1)):
        sample.paste(frames[idx], (0, H * i))
    pal = sample.quantize(255, method=Image.MEDIANCUT, dither=Image.NONE)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gif = OUT_DIR / "unet_training.gif"
    q[0].save(gif, save_all=True, append_images=q[1:], duration=durs, loop=0, optimize=True, disposal=1)
    frames[-1].save(OUT_DIR / "unet_training.png", optimize=True)
    val = data["val_iou"]
    print(f"chips {[str(c) for c in data['chips']]}")
    print("val IoU per round:", " ".join(f"{v:.3f}" for v in val))
    print(f"final {val[-1]:.3f}, best {val.max():.3f} at round {int(val.argmax())}, reported best {REPORTED_BEST}")
    print(f"{len(frames)} frames, {sum(durs) / 1000:.1f}s, {gif.stat().st_size / 1e6:.2f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render-only", action="store_true", help="re-render from checkpoints/training_replay.npz")
    args = ap.parse_args()
    if not args.render_only:
        record()
    render()


if __name__ == "__main__":
    main()
