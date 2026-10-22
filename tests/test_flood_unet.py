import importlib.util
from pathlib import Path

import numpy as np
import pytest

from lambat import flood

torch = pytest.importorskip("torch")
pytest.importorskip("segmentation_models_pytorch")


def test_unet_shapes_and_tiled_inference(tmp_path):
    model = flood.build_unet()
    ckpt = tmp_path / "m.pt"
    torch.save(model.state_dict(), ckpt)
    x = np.random.default_rng(0).normal(-15, 5, (2, 70, 90)).astype(np.float32)
    x[:, 0, 0] = np.nan
    mask = flood.unet_extent(x, ckpt, tile=64)
    assert mask.shape == (70, 90) and mask.dtype == bool
    assert not mask[0, 0]


def test_masked_loss_ignores_nodata():
    spec = importlib.util.spec_from_file_location(
        "train_unet", Path(__file__).parents[1] / "scripts" / "train_unet.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    logits = torch.zeros(1, 1, 4, 4)
    target = torch.zeros(1, 4, 4)
    target[0, 0, 0] = -1
    logits2 = logits.clone()
    logits2[0, 0, 0, 0] = 50.0  # wild logit on an ignored pixel
    assert mod.masked_bce_dice(logits, target).item() == pytest.approx(
        mod.masked_bce_dice(logits2, target).item(), abs=1e-4)
