"""Staff review load: share of extracted lines a person must look at (amber), and errors that stay green.
v1 = code checks as in the audit brief; v2 = + line accounting + unit-inside-name; +agree = photos turn green only when
Haiku 5.5 (second vendor) reads the same name, amount and unit."""
import json, os, sys, importlib
import score, study, gold

CONFIGS = {
    "A. Recommended": [("study/lr-g38-fast", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
    "B. Haiku for text": [("study/lr-haiku", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
    "C. Flash-Lite for text": [("study/lr-g35-fast", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
}
OKK = ("correct", "grounded", "fee_separated")


def agree_map(a_dir, b_dir):
    """(case, run, line index) -> agreed? for photo cases."""
    A = {(r["case"], r["run"]): r for r in study.load_rows([(a_dir, study.PHOTO)])}
    B = {(r["case"], r["run"]): r for r in study.load_rows([(b_dir, study.PHOTO)])}
    out = {}
    for k, ra in A.items():
        rb = B.get(k)
        other = [d[1] for d in (rb or {}).get("det", []) if isinstance(d[1], dict)]
        used = set()
        for i, d in enumerate(x for x in ra.get("det", []) if isinstance(x[1], dict)):
            ln, hit = d[1], None
            for j, o in enumerate(other):
                if j not in used and score.sim(ln["name"], o["name"]) >= 0.5 and score.num_eq(ln["qty"], o["qty"]) and (
                        ln["unit"] == o["unit"] or (ln["unit"] in score.COUNT and o["unit"] in score.COUNT)) and (
                        ln.get("price") is None or score.num_eq(ln.get("price"), o.get("price"))):
                    hit = j
                    break
            if hit is not None:
                used.add(hit)
            out[(k[0], k[1], i)] = hit is not None
    return out


def load(dirs):
    rows = study.load_rows(dirs)
    return rows


def review(rows, agree=None):
    lines = amber = amber_ok = green_err = 0
    for r in rows:
        dets = [d for d in r.get("det", []) if isinstance(d[1], dict)]
        for i, d in enumerate(dets):
            lines += 1
            if agree is not None and r["case"] in study.PHOTO:
                is_amber = not agree.get((r["case"], r["run"], i), False)
            else:
                is_amber = bool(d[1].get("flag"))
            ok = d[0] in OKK
            amber += is_amber
            amber_ok += is_amber and ok
            green_err += (not is_amber) and (not ok) and d[0] not in ("non_stock_row",)
    return dict(lines=lines, amber=amber, amber_pct=100.0 * amber / max(1, lines), amber_ok=amber_ok, green_err=green_err)


if __name__ == "__main__":
    out = {}
    for label, dirs in CONFIGS.items():
        res = {}
        for mode in ("v1", "v2", "v2+agree"):
            score.CHECKS_V2 = mode != "v1"
            rows = load(dirs)
            ag = agree_map(dirs[1][0], "study/lr-haiku") if mode == "v2+agree" else None
            res[mode] = review(rows, ag)
        out[label] = res
        print(label, {m: "%.1f%% amber (%d of %d), green errors %d" % (v["amber_pct"], v["amber"], v["lines"], v["green_err"]) for m, v in res.items()})
    json.dump(out, open("review.json", "w"), indent=1)
