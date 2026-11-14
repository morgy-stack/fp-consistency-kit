#!/usr/bin/env python3
"""Compare two result exports from the kit: a baseline and a build under test.

Usage:
    python3 compare.py baseline.json candidate.json

Prints a Markdown table of every check, marking the ones whose status changed
or whose details differ. Paste it straight into a report.

A "warn" in the candidate that is also "warn" with the same details in the
baseline is a property of the device (e.g. GPU raster vs CPU raster), not of
the build, so it is not flagged.
"""
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data, {r["id"]: r for r in data["results"]}


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    base_meta, base = load(sys.argv[1])
    cand_meta, cand = load(sys.argv[2])

    print(f"Baseline:  {base_meta.get('userAgent', '?')}")
    print(f"Candidate: {cand_meta.get('userAgent', '?')}\n")
    print("| ID | Check | Baseline | Candidate | Flag |")
    print("|----|-------|----------|-----------|------|")

    flagged = 0
    # Keep the kit's run order (canvas, audio, natives); dicts preserve insertion order.
    ids = list(cand) + [i for i in base if i not in cand]
    for cid in ids:
        b, c = base.get(cid), cand.get(cid)
        name = (c or b)["name"]
        bs = b["status"] if b else "-"
        cs = c["status"] if c else "-"
        flag = ""
        if bs != cs:
            flag = "STATUS CHANGED"
        elif cs == "fail":
            flag = "fails in both"
        elif b and c and b["status"] == "info" and b["details"] != c["details"]:
            flag = "value differs"
        if flag:
            flagged += 1
        print(f"| {cid} | {name} | {bs} | {cs} | {flag} |")

    print(f"\n{flagged} check(s) flagged.")


if __name__ == "__main__":
    main()
