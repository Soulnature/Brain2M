"""Convert a skull-stripped T1 NIfTI into the voxel grid the Brain2M page renders.

Usage:
    python tools/build_brain.py /path/to/T1.nii.gz [--mask brain_mask.nii.gz] [--voxels 150000]

Writes data/brain.bin (uint8 intensities, 0 = outside the brain) and
data/brain.json (grid metadata) next to index.html.

Grid axes in the output: i = right→left, j = inferior→superior,
k = posterior→anterior (a right-handed frame for the 3D scene).
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import struct
from pathlib import Path
from typing import NamedTuple

import numpy as np
from scipy import ndimage

LOG = logging.getLogger("build_brain")
OUT_DIR = Path(__file__).resolve().parent.parent / "data"
DTYPES = {2: "u1", 4: "i2", 8: "i4", 16: "f4", 64: "f8", 256: "i1", 512: "u2", 768: "u4"}


class Volume(NamedTuple):
    data: np.ndarray  # RAS-oriented, float32
    voxel_mm: tuple[float, float, float]


def _quaternion_affine(raw: bytes, endian: str, pixdim: tuple[float, ...]) -> np.ndarray:
    b, c, d, qx, qy, qz = struct.unpack(f"{endian}6f", raw[256:280])
    a = np.sqrt(max(0.0, 1.0 - (b * b + c * c + d * d)))
    rot = np.array([
        [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
        [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
        [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - b * b - c * c],
    ])
    qfac = -1.0 if pixdim[0] < 0 else 1.0
    scale = np.diag([pixdim[1], pixdim[2], pixdim[3] * qfac])
    return np.column_stack([rot @ scale, [qx, qy, qz]])


def read_nifti(path: Path) -> Volume:
    """Minimal NIfTI-1 reader: returns the first volume reoriented to RAS."""
    raw = gzip.open(path).read() if path.suffix == ".gz" else path.read_bytes()
    endian = "<" if struct.unpack("<i", raw[:4])[0] == 348 else ">"
    if struct.unpack(f"{endian}i", raw[:4])[0] != 348:
        raise ValueError(f"{path} is not a NIfTI-1 file")
    dim = struct.unpack(f"{endian}8h", raw[40:56])
    datatype = struct.unpack(f"{endian}h", raw[70:72])[0]
    pixdim = struct.unpack(f"{endian}8f", raw[76:108])
    offset = int(struct.unpack(f"{endian}f", raw[108:112])[0])
    slope, inter = struct.unpack(f"{endian}2f", raw[112:120])
    qform_code, sform_code = struct.unpack(f"{endian}2h", raw[252:256])
    if datatype not in DTYPES:
        raise ValueError(f"Unsupported NIfTI datatype {datatype}")

    shape = dim[1:4]
    count = int(np.prod(shape))
    data = np.frombuffer(raw, dtype=f"{endian}{DTYPES[datatype]}", count=count, offset=offset)
    data = data.reshape(shape, order="F").astype(np.float32)
    if slope not in (0.0, 1.0) or inter != 0.0:
        data = data * (slope or 1.0) + inter

    if sform_code > 0:
        affine = np.frombuffer(raw[280:328], dtype=f"{endian}f4").reshape(3, 4)
    elif qform_code > 0:
        affine = _quaternion_affine(raw, endian, pixdim)
    else:
        LOG.warning("No orientation in header; assuming the file is already RAS")
        affine = np.column_stack([np.diag(pixdim[1:4]), [0, 0, 0]])

    # Reorient to RAS by permuting/flipping axes (ignores small oblique angles).
    rot = affine[:, :3]
    world_axis = [int(np.argmax(np.abs(rot[:, v]))) for v in range(3)]
    if sorted(world_axis) != [0, 1, 2]:
        raise ValueError("Cannot resolve image orientation from its affine")
    order = [world_axis.index(w) for w in range(3)]
    data = np.transpose(data, order)
    for w in range(3):
        if rot[w, order[w]] < 0:
            data = np.flip(data, axis=w)
    voxel_mm = tuple(float(np.linalg.norm(rot[:, order[w]])) for w in range(3))
    return Volume(np.ascontiguousarray(data), voxel_mm)


def build_grid(volume: Volume, target_voxels: int, tissue: float) -> tuple[np.ndarray, float]:
    """Resample to isotropic voxels so the brain holds about `target_voxels`."""
    data = np.clip(volume.data, 0, None)
    ceiling = float(np.percentile(data[data > 0], 99.5))
    brain_mm3 = float((data > tissue * ceiling).sum()) * float(np.prod(volume.voxel_mm))
    step_mm = round((brain_mm3 / target_voxels) ** (1 / 3), 2)

    zoom = [mm / step_mm for mm in volume.voxel_mm]
    smooth = ndimage.gaussian_filter(data, sigma=[0.35 / z for z in zoom])
    small = ndimage.zoom(smooth, zoom, order=1)
    mask = small > tissue * ceiling  # drops CSF so sulci stay open
    labels, n = ndimage.label(mask)
    if n > 1:  # keep the brain, drop stray specks
        sizes = ndimage.sum(mask, labels, range(1, n + 1))
        mask = labels == (int(np.argmax(sizes)) + 1)

    # Crop to the brain with a one-voxel margin.
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(axis=0) - 1, 0)
    hi = np.minimum(idx.max(axis=0) + 2, mask.shape)
    crop = tuple(slice(a, b) for a, b in zip(lo, hi))
    scaled = np.clip(small[crop] / ceiling, 0, 1)
    grid = np.where(mask[crop], np.maximum(1, np.round(scaled * 255)), 0).astype(np.uint8)

    # RAS (x→right, y→anterior, z→superior)  →  scene (left, superior, anterior).
    grid = np.flip(grid, axis=0).transpose(0, 2, 1)
    return np.ascontiguousarray(grid), step_mm


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("nifti", type=Path, help="skull-stripped T1 image (.nii or .nii.gz)")
    parser.add_argument("--voxels", type=int, default=150_000, help="approximate voxels to draw")
    parser.add_argument("--tissue", type=float, default=0.3, help="intensity cut-off (fraction of white matter) below which a voxel counts as CSF")
    parser.add_argument("--mask", type=Path, default=None, help="brain mask on the same grid, if the T1 still has its skull")
    parser.add_argument("--label", default=None, help="source description stored in brain.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    volume = read_nifti(args.nifti)
    if args.mask is not None:
        mask = read_nifti(args.mask)
        if mask.data.shape != volume.data.shape:
            raise ValueError(f"Mask grid {mask.data.shape} does not match the T1 grid {volume.data.shape}")
        volume = Volume(volume.data * (mask.data > 0.5), volume.voxel_mm)
    grid, step_mm = build_grid(volume, args.voxels, args.tissue)
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "brain.bin").write_bytes(grid.tobytes(order="C"))
    meta = {
        "dims": list(grid.shape),
        "voxelMm": step_mm,
        "voxels": int((grid > 0).sum()),
        "source": args.label or args.nifti.name,
    }
    (OUT_DIR / "brain.json").write_text(json.dumps(meta, indent=2) + "\n")
    LOG.info("Wrote %s: dims %s, %.2f mm voxels, %d inside the brain", OUT_DIR, meta["dims"], step_mm, meta["voxels"])


if __name__ == "__main__":
    main()
