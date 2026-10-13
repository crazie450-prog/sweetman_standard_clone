"""Optimization study: accuracy (bar 98%), then time and cost, on the dev set and the untouched holdout set.

Accuracy = lines exactly right / (lines expected + wrong, invented, merged or false lines produced).
Every configuration is scored on runs 1-3 so that all rows compare like with like.
"""
import json, os, statistics, sys
from collections import Counter, defaultdict
import score, gold

DEV = [c for c in gold.CASES if c not in getattr(gold, "HOLDOUT", {})]
HOLD = list(getattr(gold, "HOLDOUT", {}))
ERR = ("wrong_value", "invented", "invented_amount", "merged", "fee_as_stock_item", "false_import")
RUNS = (1, 2, 3)


PHOTO = {"pavlova_pdf", "lasagna_pdf", "linguine_pdf", "invoice_photo", "h3_produce_photo"}
TEXT = set(gold.CASES) - PHOTO


def load_rows(dirs):
    """dirs: output folders, or (folder, cases) pairs to take only those cases from a folder."""
    rows = []
    for d in dirs:
        d, only = d if isinstance(d, tuple) else (d, None)
        p = os.path.join(gold.DOCS, "out", d)
        if os.path.isdir(p):
            rows += [r for r in score.evaluate(p) if r["run"] in RUNS and (only is None or r["case"] in only)]
    seen, out = set(), []
    for r in rows:  # first directory wins for a (case, run)
        k = (r["case"], r["run"])
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def expected(r):
    x = r["res"]
    if "ref_total" in x:
        return x["ref_total"]
    return x.get("gold_required", 0)


def found(r):
    x = r["res"]
    if "ref_total" in x:
        return x.get("ref_found", 0)
    return min(x.get("correct", 0), x.get("gold_required", 0))


def summarize(rows, cases):
    rs = [r for r in rows if r["case"] in cases]
    if not rs:
        return None
    exp = sum(expected(r) for r in rs)
    ok = sum(found(r) for r in rs)
    err = sum(sum(r["res"].get(k, 0) for k in ERR) for r in rs)
    unfl = sum(r["res"].get("err_unflagged", 0) for r in rs) + sum(
        r["res"].get("false_import", 0) for r in rs if not r.get("is_ef"))
    lines = sum(r["res"].get("lines", 0) for r in rs)
    okfl = sum(r["res"].get("ok_flagged", 0) for r in rs)
    fails = sum(1 for r in rs if r.get("error"))
    clean = 0
    for r in rs:
        x = r["res"]
        if r.get("error"):
            continue
        if gold.CASES[r["case"]]["kind"] == "trap":
            clean += x.get("trap_pass", 0)
        elif not any(x.get(k) for k in ERR + ("missed",)) and x.get("ref_found", 0) >= 0.9 * x.get("ref_total", 0):
            clean += 1
    sigs = defaultdict(set)
    for r in rs:
        sigs[r["case"]].add(r.get("sig") if not r.get("error") else ("ERROR", r["run"]))
    ms = sorted(r["ms"] for r in rs)
    cost = [r["cost"] for r in rs]
    tok_in = tok_out = 0
    for r in rs:
        for c in r.get("calls_raw", []):
            pass
    return dict(
        jobs=len(rs), accuracy=100.0 * ok / max(1, exp + err), recall=100.0 * ok / max(1, exp), errors=err,
        unflagged=unfl, review_share=100.0 * okfl / max(1, lines), clean=100.0 * clean / len(rs),
        identical=sum(1 for v in sigs.values() if len(v) == 1), cases=len(sigs), failures=fails,
        p50=statistics.median(ms) / 1000, p95=ms[min(len(ms) - 1, int(round(0.95 * (len(ms) - 1))))] / 1000,
        cost=sum(cost) / len(cost))


CONFIGS = {
    "M3 today (gemini mode, default alias)": ["m3-gemini_gemini-flash-lite-latest", "study/m3"],
    "Evidence-first + Gemini 3.8 Flash (brief's recommendation)": ["final-gemini_gemini-3.8-flash", "study/ef-g38"],
    "Evidence-first + Gemini 3.5 Flash-Lite": ["final-gemini_gemini-3.5-flash-lite", "study/ef-g35"],
    "Evidence-first + Claude Haiku 5.5": ["final-claude_claude-haiku-5-5", "study/ef-haiku"],
    "Line-reference + Gemini 3.8 Flash": ["study/lr-g38"],
    "Line-reference + Gemini 3.5 Flash-Lite (low)": ["study/lr-g35"],
    "Line-reference + Gemini 3.5 Flash-Lite (minimal)": ["study/lr-g35min"],
    "Line-reference + Claude Haiku 5.5": ["study/lr-haiku"],
    "Line-reference + Claude Haiku 5.5 (no thinking, cached prompt)": ["study/lr-haiku-nothink"],
    "Line-reference + Claude Sonnet 5.5 (cached prompt)": ["study/lr-sonnet"],
    "LR + 3.8 Flash, compact output keys": ["study/lr-g38-compact", "study/lr-g38"],
    "LR + 3.8 Flash, long text split at recipe starts": ["study/lr-g38-outline", "study/lr-g38"],
    "LR + 3.8 Flash, compact + split": ["study/lr-g38-fast", "study/lr-g38"],
    "LR + 3.8 Flash, photos at medium resolution": ["study/photo-g38-medium", "study/lr-g38"],
    "Route: text -> Flash-Lite LR (minimal); photos -> 3.8 Flash": [("study/lr-g35min", TEXT), "study/lr-g38"],
    "Route: text -> Flash-Lite LR compact + split; photos -> 3.8 Flash": [("study/lr-g35-fast", TEXT), "study/lr-g38"],
    "Route: text -> Haiku LR; photos -> 3.8 Flash": [("study/lr-haiku", TEXT), "study/lr-g38"],
    "Route: text -> Haiku LR (no thinking); photos -> 3.8 Flash": [("study/lr-haiku-nothink", TEXT), "study/lr-g38"],
    "A. 3.8 Flash LR compact + split; photos 3.8 medium": [("study/lr-g38-fast", TEXT), ("study/photo-g38-medium", PHOTO)],
    "B. Haiku LR text; photos 3.8 medium": [("study/lr-haiku", TEXT), ("study/photo-g38-medium", PHOTO)],
    "C. Flash-Lite LR compact + split text; photos 3.8 medium": [("study/lr-g35-fast", TEXT), ("study/photo-g38-medium", PHOTO)],
}


def boot_ci(rows, cases, n=2000, seed=7):
    """95% interval for accuracy, resampling whole documents (all runs of a case move together)."""
    import random
    rnd = random.Random(seed)
    by = defaultdict(list)
    for r in rows:
        if r["case"] in cases:
            by[r["case"]].append(r)
    keys = [k for k in by if any(expected(r) for r in by[k])] + [k for k in by if not any(expected(r) for r in by[k])]
    stats = []
    for _ in range(n):
        ok = den = 0
        for k in (rnd.choice(keys) for _ in keys):
            for r in by[k]:
                e = sum(r["res"].get(x, 0) for x in ERR)
                ok += found(r)
                den += expected(r) + e
        stats.append(100.0 * ok / max(1, den))
    stats.sort()
    return stats[int(0.025 * n)], stats[int(0.975 * n) - 1]

if __name__ == "__main__":
    out = {}
    for label, dirs in CONFIGS.items():
        rows = load_rows(dirs)
        for r in rows:
            r["is_ef"] = not label.startswith("M3")
        out[label] = {s: summarize(rows, cs) for s, cs in (("dev", DEV), ("holdout", HOLD), ("all", DEV + HOLD))}
        out[label]["all"]["ci"] = boot_ci(rows, DEV + HOLD)
    json.dump(out, open(os.path.join(gold.DOCS, os.environ.get("STUDY_OUT", "study.json")), "w"), indent=1)
    for s in ("all", "holdout", "dev"):
        print("\n==", s.upper())
        print("%-60s %6s %6s %5s %5s %6s %6s %5s %5s %5s %8s" % ("config", "acc", "recall", "err", "unfl", "review", "clean", "ident", "p50", "p95", "cost"))
        for label, v in out.items():
            x = v[s]
            if not x:
                continue
            print("%-60s %6.1f %6.1f %5d %5d %5.0f%% %5.0f%% %2d/%-2d %5.1f %5.0f %8.4f" % (
                label[:60], x["accuracy"], x["recall"], x["errors"], x["unflagged"], x["review_share"], x["clean"],
                x["identical"], x["cases"], x["p50"], x["p95"], x["cost"]) + ("  CI %.1f-%.1f" % tuple(x["ci"]) if "ci" in x else ""))
