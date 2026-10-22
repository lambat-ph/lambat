"""Step 1: where is the water?

Three readings of flood extent, compared against each other:
- the UP NOAH hazard map for the matching return period (available on day one)
- a before/after Sentinel-1 backscatter threshold
- a U-Net trained on Sen1Floods11 (optional extra: uv sync --extra cv)
"""


def hazard_extent(noah_raster, return_period):
    raise NotImplementedError


def threshold_extent(s1_before, s1_after, db_drop=3.0):
    raise NotImplementedError


def unet_extent(s1_after, checkpoint):
    raise NotImplementedError
