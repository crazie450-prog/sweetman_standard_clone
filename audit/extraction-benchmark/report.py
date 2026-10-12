"""Aggregate benchmark results per arm."""
import json, os, statistics, sys
from collections import Counter, defaultdict
import score, gold

GOLD_RECIPES = [c for c, g in gold.R.items() if g["lines"] is not None]
GROUND_ONLY = [c for c, g in gold.R.items() if g["lines"] is None]
INVOICES = list(gold.INV)
TRAPS = [c for c, v in gold.CASES.items() if v["kind"] == "trap"]
HALL = ("wrong_value", "invented", "invented_amount", "merged")
EXTRA = ("unlisted", "grounded_extra", "duplicate")


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))] if xs else float("nan")


def arm_summary(arm_dir):
    rows = score.evaluate(arm_dir)
    s = dict(arm=os.path.basename(arm_dir), jobs=len(rows))
    s["errors"] = sum(1 for r in rows if r.get("error"))
    s["refused"] = sum(1 for r in rows if r.get("refused") and gold.CASES[r["case"]]["kind"] != "trap")
    agg = defaultdict(Counter)
    for r in rows:
        agg[r["case"]].update(r["res"])

    def tot(cases, keys):
        return sum(agg[c][k] for c in cases for k in (keys if isinstance(keys, tuple) else (keys,)))

    # recipes with an answer key
    req = tot(GOLD_RECIPES, "gold_required")
    s["recipe_required_lines"] = req
    s["recipe_correct"] = sum(min(agg[c]["correct"], agg[c]["gold_required"]) for c in GOLD_RECIPES)
    s["recipe_recall"] = pct(s["recipe_correct"], req)
    s["recipe_hallucinations"] = tot(GOLD_RECIPES, HALL)
    s["recipe_extras"] = tot(GOLD_RECIPES, EXTRA)
    s["recipe_lines"] = tot(GOLD_RECIPES, "lines")
    # grounding-only
    s["ground_lines"] = tot(GROUND_ONLY, "lines")
    s["ground_unsupported"] = tot(GROUND_ONLY, ("invented", "invented_amount", "merged"))
    s["ground_recall"] = pct(tot(GROUND_ONLY, "ref_found"), tot(GROUND_ONLY, "ref_total"))
    s["all_recall"] = pct(s["recipe_correct"] + tot(GROUND_ONLY, "ref_found") + tot(INVOICES, "correct"),
                          req + tot(GROUND_ONLY, "ref_total") + tot(INVOICES, "gold_required"))
    # invoices
    s["inv_required"] = tot(INVOICES, "gold_required")
    s["inv_correct"] = tot(INVOICES, "correct")
    s["inv_wrong"] = tot(INVOICES, ("wrong_value", "invented"))
    s["inv_fee_as_item"] = tot(INVOICES, "fee_as_stock_item")
    s["inv_fee_separated"] = tot(INVOICES, "fee_separated")
    s["inv_missed"] = tot(INVOICES, "missed")
    # traps
    trap_jobs = [r for r in rows if r["case"] in TRAPS]
    s["trap_pass"] = sum(r["res"].get("trap_pass", 0) for r in trap_jobs)
    s["trap_jobs"] = len(trap_jobs)
    s["trap_false_lines"] = sum(r["res"].get("false_import", 0) for r in trap_jobs)
    # all-document error count (hallucinated values or lines that would reach the review screen)
    s["all_hallucinations"] = (s["recipe_hallucinations"] + s["ground_unsupported"] + s["inv_wrong"]
                               + s["inv_fee_as_item"] + s["trap_false_lines"])
    s["unflagged"] = sum(agg[c]["err_unflagged"] for c in agg) + (0 if "ef-" in s["arm"] else s["trap_false_lines"])
    s["flagged"] = sum(agg[c]["err_flagged"] for c in agg)
    s["ok_flagged"] = sum(agg[c]["ok_flagged"] for c in agg)
    # clean documents: no hallucination and nothing required missed
    clean = 0
    for r in rows:
        x = r["res"]
        if gold.CASES[r["case"]]["kind"] == "trap":
            clean += x.get("trap_pass", 0)
        elif (not r.get("error") and not any(x.get(k) for k in HALL + ("missed", "fee_as_stock_item"))
              and x.get("ref_found", 0) >= 0.9 * x.get("ref_total", 0)):
            clean += 1
    s["clean_jobs"] = clean
    s["clean_rate"] = pct(clean, len(rows))
    # consistency: identical output across all runs of a case
    sigs = defaultdict(list)
    for r in rows:
        sigs[r["case"]].append(r.get("sig") if not r.get("error") else ("ERROR",))
    s["cases_identical"] = sum(1 for c, v in sigs.items() if len(set(v)) == 1)
    s["cases"] = len(sigs)
    s["distinct_outputs"] = {c: len(set(v)) for c, v in sorted(sigs.items())}
    # speed and cost
    ms = [r["ms"] for r in rows if r.get("ms") is not None]
    s["p50_s"] = statistics.median(ms) / 1000
    s["p95_s"] = p95(ms) / 1000
    s["max_s"] = max(ms) / 1000
    s["cost_total"] = sum(r["cost"] for r in rows)
    s["cost_per_doc"] = s["cost_total"] / len(rows)
    s["models"] = sorted({m for r in rows for m in r["models"]})
    s["per_case"] = {c: dict(v) for c, v in agg.items()}
    return s


if __name__ == "__main__":
    out = [arm_summary(d) for d in sys.argv[1:]]
    keys = ["jobs", "errors", "all_recall", "ground_recall", "recipe_recall", "recipe_hallucinations", "recipe_extras", "ground_unsupported",
            "inv_correct", "inv_required", "inv_wrong", "inv_fee_as_item", "trap_pass", "trap_jobs",
            "all_hallucinations", "unflagged", "flagged", "ok_flagged", "clean_rate", "cases_identical", "p50_s",
            "p95_s", "max_s", "cost_per_doc"]
    print("metric".ljust(24) + "".join(s["arm"][:22].rjust(24) for s in out))
    for k in keys:
        vals = []
        for s in out:
            v = s[k]
            vals.append(("%.4f" % v if k == "cost_per_doc" else "%.1f" % v if isinstance(v, float) else str(v)).rjust(24))
        print(k.ljust(24) + "".join(vals))
    print("models:", [s["models"] for s in out])
    json.dump(out, open(os.path.join(gold.DOCS, "summary.json"), "w"), indent=1, default=str)
