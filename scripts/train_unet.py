"""Train the Sen1Floods11 U-Net and compare it with the Otsu baseline.

    uv run --extra cv python scripts/train_unet.py --epochs 15 --pretrained

Each epoch is scored on the valid split (pooled IoU); the checkpoint with the best
valid IoU is kept. Then test IoU is printed for the U-Net and for a per-chip Otsu
threshold on VV, on the same chips: pooled, plus per-chip median and IQR.
Quick run: --limit 40 --valid-limit 10 --test-limit 15. Runs on CPU.
"""

import argparse
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def masked_bce_dice(logits, target):
    """BCE + Dice, both ignoring pixels where target < 0 (no data)."""
    import torch
    import torch.nn.functional as F

    valid = (target >= 0).float()
    t = target.clamp(min=0)
    logits = logits[:, 0]
    bce = (F.binary_cross_entropy_with_logits(logits, t, reduction="none") * valid).sum() / valid.sum().clamp(min=1)
    p = torch.sigmoid(logits) * valid
    inter = (p * t * valid).sum()
    dice = 1 - (2 * inter + 1) / (p.sum() + (t * valid).sum() + 1)
    return bce + dice


def pooled_iou(preds, truths):
    inter = union = 0
    for p, t in zip(preds, truths):
        valid = t != -1
        tt = (t == 1) & valid
        pp = p.astype(bool) & valid
        inter += (pp & tt).sum()
        union += (pp | tt).sum()
    return inter / union if union else float("nan")


def predict(model, chips, flood, threshold=0.5):
    """Thresholded water masks for a list of (x, y) chips."""
    import torch

    model.eval()
    preds = []
    with torch.no_grad():
        for x, _ in chips:
            xn = torch.from_numpy(flood.normalise_db(x)[None])
            p = torch.sigmoid(model(xn))[0, 0].numpy() > threshold
            p[~np.isfinite(x).all(axis=0)] = False
            preds.append(p)
    return preds


def main(argv=None, on_epoch=None):
    """Train and evaluate. on_epoch(epoch, model, loss, valid_iou, ctx) is optional.

    It is called with epoch 0 (untrained model, loss None) and after every epoch.
    ctx holds the loaded chips: ctx["valid"], ctx["test"], ctx["test_pairs"].
    With on_epoch=None the behaviour and outputs are unchanged.
    """
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--limit", type=int, default=None, help="train chips (default all 252)")
    ap.add_argument("--valid-limit", type=int, default=None, help="valid chips (default all 89)")
    ap.add_argument("--test-limit", type=int, default=None, help="test chips (default all 90)")
    ap.add_argument("--data-dir", default=str(ROOT / "data" / "raw" / "sen1floods11"))
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--crop", type=int, default=256, help="random training crop, 0 = full chip")
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--pretrained", action="store_true", help="imagenet encoder weights (downloads)")
    ap.add_argument("--out", default=str(ROOT / "checkpoints" / "unet_sen1floods11.pt"))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    import torch
    from torch.utils.data import DataLoader

    from lambat import flood

    t0 = time.time()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    print("downloading / checking data ...", flush=True)
    train_pairs = flood.download_sen1floods11(args.data_dir, "train", args.limit, seed=args.seed)
    valid_pairs = flood.download_sen1floods11(args.data_dir, "valid", args.valid_limit, seed=args.seed)
    test_pairs = flood.download_sen1floods11(args.data_dir, "test", args.test_limit, seed=args.seed)
    print(f"  {len(train_pairs)} train, {len(valid_pairs)} valid, {len(test_pairs)} test chips ({time.time() - t0:.0f}s)", flush=True)

    valid = [flood.read_chip(*p) for p in valid_pairs]
    test = [flood.read_chip(*p) for p in test_pairs]

    ds = flood.make_dataset(train_pairs, crop=args.crop or None)
    dl = DataLoader(ds, batch_size=args.batch_size, shuffle=True)
    model = flood.build_unet("imagenet" if args.pretrained else None)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    ctx = {"valid": valid, "test": test, "test_pairs": test_pairs}
    valid_truths = [y for _, y in valid]
    if on_epoch is not None:
        on_epoch(0, model, None, pooled_iou(predict(model, valid, flood), valid_truths), ctx)

    best, best_epoch = -1.0, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        for x, y in dl:
            opt.zero_grad()
            loss = masked_bce_dice(model(x), y)
            loss.backward()
            opt.step()
            total += loss.item() * len(x)
        v = pooled_iou(predict(model, valid, flood), valid_truths)
        mark = ""
        if v > best:
            best, best_epoch = v, epoch
            torch.save(model.state_dict(), out)
            mark = "  *best*"
        print(f"epoch {epoch}/{args.epochs}  loss {total / len(ds):.4f}  valid IoU {v:.3f}{mark}  ({time.time() - t0:.0f}s)", flush=True)
        if on_epoch is not None:
            on_epoch(epoch, model, total / len(ds), v, ctx)

    print(f"best epoch {best_epoch} (valid IoU {best:.3f}), saved {out}")
    model.load_state_dict(torch.load(out, map_location="cpu"))

    print("evaluating on test chips ...")
    truths = [y for _, y in test]
    u_preds = predict(model, test, flood)
    o_preds = []
    for x, _ in test:
        if not np.isfinite(x[0]).any():  # all no-data chip: nothing to threshold
            o_preds.append(np.zeros(x[0].shape, dtype=bool))
            continue
        thr = flood.otsu_threshold(x[0])
        o_preds.append(np.isfinite(x[0]) & (x[0] < thr))
    for name, preds in (("U-Net", u_preds), ("Otsu (VV)", o_preds)):
        per = np.array([flood.iou(p, t) for p, t in zip(preds, truths)])
        per = per[~np.isnan(per)]
        q1, med, q3 = np.percentile(per, [25, 50, 75])
        print(f"test IoU  {name}: pooled {pooled_iou(preds, truths):.3f}  per-chip median {med:.3f} IQR [{q1:.3f}, {q3:.3f}] (n={len(per)})")
    print(f"total {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
