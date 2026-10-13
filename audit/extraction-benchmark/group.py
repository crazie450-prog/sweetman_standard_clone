"""Grouping check: does each ingredient line land in the same recipe as in a reference run?
Lines are matched by their printed line text; a candidate recipe is mapped to the reference recipe it shares most lines with."""
import json, sys, os, re
from collections import Counter

def assign(path):
    j = json.load(open(path))
    out = {}
    for a in j.get("ef") or []:
        for k, r in enumerate((a or {}).get("recipes") or []):
            for l in r.get("lines") or []:
                ev = re.sub(r"\s+", " ", (l.get("evidence") or "")).strip().lower()
                if ev: out.setdefault(ev, k if False else (id(a), k))
    return out

def mismatch(cand, ref):
    shared = [e for e in cand if e in ref]
    if not shared: return 0, 0
    best = {}
    for c in set(cand[e] for e in shared):
        best[c] = Counter(ref[e] for e in shared if cand[e] == c).most_common(1)[0][0]
    bad = sum(1 for e in shared if best[cand[e]] != ref[e])
    return bad, len(shared)

if __name__ == "__main__":
    cdir, rdir = sys.argv[1], sys.argv[2]
    for f in sorted(os.listdir(cdir)):
        if not f.endswith(".json"): continue
        case = f.split("__")[0]
        ref = os.path.join(rdir, case + "__1.json")
        if not os.path.exists(ref): continue
        bad, n = mismatch(assign(os.path.join(cdir, f)), assign(ref))
        print("%-28s regrouped %3d of %3d shared lines" % (f, bad, n))
