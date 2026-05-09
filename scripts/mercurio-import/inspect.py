#!/usr/bin/env python3
"""Inspect JSON dumps to understand structure."""
import json
from pathlib import Path

DATA = Path(r"c:\NPMS\GPMS\scripts\mercurio-import\data")

def show(label, sheet_data, max_rows=8, max_cols=10):
    rows = sheet_data["rows"]
    print(f"--- {label} ({sheet_data['dim'][0]}r x {sheet_data['dim'][1]}c, {len(rows)} non-empty) ---")
    for i, r in enumerate(rows[:max_rows]):
        cells = [str(c)[:35] if c is not None else "" for c in r[:max_cols]]
        print(f"  R{i+1:>3} | " + " | ".join(cells))
    if len(rows) > max_rows:
        print(f"  ... ({len(rows) - max_rows} more rows)")
    print()


def inspect(file, max_rows=8, max_cols=8):
    p = DATA / file
    with open(p, encoding="utf-8") as f:
        wb = json.load(f)
    print(f"\n========== {wb['file']} ==========")
    for sn, sd in wb["sheets"].items():
        show(sn, sd, max_rows=max_rows, max_cols=max_cols)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        files = sorted(p.name for p in DATA.glob("*.json"))
        for f in files:
            inspect(f, max_rows=4, max_cols=6)
    else:
        for f in sys.argv[1:]:
            inspect(f, max_rows=20, max_cols=10)
