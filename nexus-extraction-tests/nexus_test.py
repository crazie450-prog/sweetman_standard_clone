#!/usr/bin/env python3
"""Nexus extraction acceptance test.

  python3 nexus_test.py check                      verify this checkout (documents, keys, scorer self-tests)
  python3 nexus_test.py cases [--raw]              write the case list a runner reads (cases_open.json)
  python3 nexus_test.py score <results folder>     score a run and print PASS or FAIL against the bar

Options for score:
  --runs N        runs per document that must be present (default 3)
  --set NAME      open (default), blind (needs NEXUS_BLIND_PACK) or all
  --json FILE     also write the summary as JSON
  --details       list every wrong, invented and missed line

The bar (docs/TEST_PROCEDURE.md): line accuracy >= 98.0%, the lower end of its 95% interval >= 98.0%, zero
unflagged errors, and no failed or missing job. Python 3.9+, no packages needed.
"""
import argparse, json, os, sys
from collections import Counter, defaultdict

# The reference pipeline's code checks are part of the recommended set-up; an application under test supplies its
# own review flags in the results format, so these only affect results written by reference/runner.ts.
for _k in ("CHECKS_V2", "CHECKS_V3", "NORMALIZE"):
    os.environ.setdefault(_k, "1")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
BAR_ACCURACY = 98.0
ERR = ("wrong_value", "invented", "invented_amount", "merged", "fee_as_stock_item", "false_import")


def expected_lines(gold, case):
    meta = gold.CASES[case]
    if meta["kind"] == "trap":
        return 0
    if meta["type"] == "invoice":
        return sum(1 for x in gold.INV[case]["lines"] if x["kind"] in ("item", "credit"))
    g = gold.R[case]
    if g["lines"] is None:
        import autoref
        return len(autoref.reference(case))
    return sum(1 for x in g["lines"] if "opt" not in x[3])


def collect(folder, cases, runs):
    """Scored rows for every (case, run); a failed or missing job counts all its expected lines as missed."""
    import gold, score
    got = {(r["case"], r["run"]): r for r in score.evaluate(folder)}
    rows, failed, missing = [], [], []
    for c in cases:
        for n in range(1, runs + 1):
            r = got.get((c, n))
            if r is None or r.get("error"):
                (missing if r is None else failed).append((c, n, (r or {}).get("error")))
                exp = expected_lines(gold, c)
                key = "ref_total" if gold.CASES[c]["kind"] != "trap" and gold.CASES[c]["type"] == "recipe" and gold.R[c]["lines"] is None else "gold_required"
                r = dict(case=c, run=n, ms=(r or {}).get("ms"), cost=(r or {}).get("cost", 0.0), error=(r or {}).get("error") or "missing",
                         res=Counter({key: exp, "missed": exp, "job_failed": 1}), det=[], sig=("FAILED", n))
            rows.append(r)
    return rows, failed, missing


def summarize(rows, cases):
    import study
    rs = [r for r in rows if r["case"] in cases]
    if not rs:
        return None
    exp = sum(study.expected(r) for r in rs)
    ok = sum(study.found(r) for r in rs)
    err = sum(sum(r["res"].get(k, 0) for k in ERR) for r in rs)
    ms = sorted(r["ms"] for r in rs if r.get("ms"))
    out = dict(documents=len({r["case"] for r in rs}), jobs=len(rs), expected=exp, correct=ok, errors=err,
               missed=sum(r["res"].get("missed", 0) for r in rs),
               unflagged=sum(r["res"].get("err_unflagged", 0) for r in rs),
               flagged_correct=sum(r["res"].get("ok_flagged", 0) for r in rs), lines=sum(r["res"].get("lines", 0) for r in rs),
               accuracy=100.0 * ok / max(1, exp + err), recall=100.0 * ok / max(1, exp))
    out["review_share"] = 100.0 * (out["flagged_correct"] + err - out["unflagged"]) / max(1, out["lines"])
    if ms:
        out["median_s"] = ms[len(ms) // 2] / 1000
        out["p95_s"] = ms[min(len(ms) - 1, int(round(0.95 * (len(ms) - 1))))] / 1000
    if exp:
        out["ci"] = list(study.boot_ci(rs, cases))
    return out


def cmd_score(a):
    import gold, study
    blind, long_ = list(gold.BLIND), list(gold.LONG)
    if a.set in ("blind", "all") and not blind:
        sys.exit("The blind set needs NEXUS_BLIND_PACK=<folder holding gold_blind.py>.")
    cases = {"open": gold.OPEN, "blind": blind, "all": gold.OPEN + blind}[a.set]
    main = [c for c in cases if c not in long_]
    rows, failed, missing = collect(a.folder, cases, a.runs)
    s = summarize(rows, main)
    print("Nexus extraction test: %s set, %d documents x %d runs  (results: %s)" % (a.set, len(cases), a.runs, a.folder))
    print("=" * 96)
    ci = s.get("ci", [0, 0])
    print("Line accuracy        %6.2f%%   (95%% interval %.1f-%.1f)   bar: >= %.1f%%, interval low end >= %.1f%%" % (
        s["accuracy"], ci[0], ci[1], BAR_ACCURACY, BAR_ACCURACY))
    print("Unflagged errors     %6d     bar: 0     (wrong or invented lines shown with no review flag)" % s["unflagged"])
    print("Failed/missing jobs  %6d     bar: 0" % (len(failed) + len(missing)))
    print("Lines: %d expected, %d read exactly right, %d missed, %d wrong/invented (%d of them flagged)" % (
        s["expected"], s["correct"], s["missed"], s["errors"], s["errors"] - s["unflagged"]))
    dups = sum(r["res"].get("duplicate", 0) for r in rows if r["case"] in main)
    if dups:
        print("Duplicate lines (a second line for an ingredient already matched; not scored): %d" % dups)
    print("Lines a person must check: %.1f%% of extracted lines" % s["review_share"], end="")
    print("   |   time per document: median %.1f s, 95th percentile %.0f s" % (s["median_s"], s["p95_s"]) if "median_s" in s else "")
    print("\nBy document kind %s" % ("(accuracy / wrong / unflagged / missed / documents)"))
    kinds = defaultdict(list)
    for c in main:
        kinds[gold.CASES[c]["kind"]].append(c)
    by_kind = {}
    for k in ("word", "sheet", "pdf", "handwritten", "photo", "invoice", "trap"):
        if kinds.get(k):
            x = by_kind[k] = summarize(rows, kinds[k])
            label = {"word": "Word / text", "sheet": "Excel workbooks", "pdf": "PDF with text", "handwritten": "handwritten cards",
                     "photo": "scans and photos", "invoice": "invoices", "trap": "not the stated type"}[k]
            if k == "trap":
                passed = sum(r["res"].get("trap_pass", 0) for r in rows if r["case"] in kinds[k])
                print("  %-20s returned nothing in %d of %d jobs; %d lines returned (%d unflagged)" % (label, passed, x["jobs"], x["errors"], x["unflagged"]))
            else:
                print("  %-20s %6.2f%% / %3d / %3d / %3d / %3d" % (label, x["accuracy"], x["errors"], x["unflagged"], x["missed"], x["documents"]))
    inv = [r for r in rows if gold.CASES[r["case"]]["type"] == "invoice" and gold.CASES[r["case"]]["kind"] != "trap" and not r.get("error")]
    if inv:
        print("  invoice headers: number right in %d of %d jobs, date right in %d of %d" % (
            sum(r["res"].get("hdr_number_ok", 0) for r in inv), len(inv), sum(r["res"].get("hdr_date_ok", 0) for r in inv), len(inv)))
    longs = {}
    for c in [c for c in cases if c in long_]:
        x = longs[c] = summarize(rows, [c])
        print("\nLong document %s (reported separately): %.1f%% of %d printed amounts found, %d wrong lines (%d unflagged)" % (
            c, x["recall"], x["expected"] // a.runs, x["errors"], x["unflagged"]))
    per = defaultdict(Counter)
    for r in rows:
        if r["case"] in main:
            per[r["case"]].update({k: r["res"].get(k, 0) for k in ERR + ("missed", "err_unflagged")})
    worst = sorted(((sum(v[k] for k in ERR) + v["missed"], c, v) for c, v in per.items()), reverse=True)
    worst = [w for w in worst if w[0]][:15]
    if worst:
        print("\nDocuments with the most wrong or missed lines (all runs)")
        for n, c, v in worst:
            print("  %-34s wrong/invented %3d (unflagged %d)   missed %3d" % (c, sum(v[k] for k in ERR), v["err_unflagged"], v["missed"]))
    if failed or missing:
        print("\nFailed or missing jobs")
        for c, n, e in (failed + missing)[:40]:
            print("  %s run %d: %s" % (c, n, (e or "no result file")[:100]))
    if a.details:
        print("\nEvery wrong, invented or missed line")
        for r in rows:
            for d in r.get("det", []):
                if d[0] == "missed":
                    print("  %s#%d missed: %s" % (r["case"], r["run"], d[1]))
                elif d[0] in ERR and isinstance(d[1], dict):
                    ln = d[1]
                    print("  %s#%d %s: %r amount=%s unit=%s %s%s" % (r["case"], r["run"], d[0], ln["name"][:50], ln.get("qty"), ln.get("unit"),
                          "[flagged: %s]" % ln["flag"] if ln.get("flag") else "[NOT FLAGGED]", "  key: %s %s" % (d[2][1], d[2][2]) if len(d) > 2 and isinstance(d[2], tuple) else ""))
    checks = [("accuracy >= %.1f%%" % BAR_ACCURACY, s["accuracy"] >= BAR_ACCURACY),
              ("95%% interval low end >= %.1f%%" % BAR_ACCURACY, ci[0] >= BAR_ACCURACY),
              ("zero unflagged errors", s["unflagged"] + sum(x["unflagged"] for x in longs.values()) == 0),
              ("no failed or missing job", not failed and not missing)]
    print("\n" + "=" * 96)
    for name, ok in checks:
        print("  [%s] %s" % ("pass" if ok else "FAIL", name))
    verdict = all(ok for _, ok in checks)
    print("RESULT: %s" % ("PASS" if verdict else "FAIL"))
    if a.json:
        json.dump(dict(set=a.set, runs=a.runs, summary=s, by_kind=by_kind, long=longs, failed=len(failed), missing=len(missing),
                       checks={n: ok for n, ok in checks}, verdict="PASS" if verdict else "FAIL"), open(a.json, "w"), indent=1)
    return 0 if verdict else 1


def cmd_check(a):
    import gold
    problems = []
    for k, v in gold.CASES.items():
        for f in (v["path"], v.get("src")):
            if f and not os.path.exists(f):
                problems.append("%s: missing %s" % (k, f))
        if v["type"] == "recipe" and v["kind"] != "trap" and k not in gold.R:
            problems.append("%s: no recipe key" % k)
        if v["type"] == "invoice" and v["kind"] != "trap" and k not in gold.INV:
            problems.append("%s: no invoice key" % k)
    kinds = Counter(v["kind"] for k, v in gold.CASES.items() if k in gold.OPEN)
    lines = sum(expected_lines(gold, c) for c in gold.OPEN if c not in gold.LONG)
    print("%d open documents (%s), %d scored key lines%s" % (len(gold.OPEN), ", ".join("%d %s" % (n, k) for k, n in kinds.most_common()),
                                                           lines, "; blind pack loaded: %d documents" % len(gold.BLIND) if gold.BLIND else ""))
    import unittest
    suite = unittest.defaultTestLoader.discover(os.path.join(HERE, "tests"), pattern="test_*.py")
    res = unittest.TextTestRunner(verbosity=0).run(suite)
    for p in problems:
        print("PROBLEM:", p)
    ok = not problems and res.wasSuccessful()
    print("CHECK: %s" % ("OK" if ok else "FAILED"))
    return 0 if ok else 1


def cmd_cases(a):
    import gold
    ids = gold.OPEN if a.set == "open" else list(gold.BLIND) if a.set == "blind" else gold.OPEN + list(gold.BLIND)
    out = a.out or os.path.join(HERE, "cases_%s%s.json" % (a.set, "_raw" if a.raw else ""))
    json.dump(gold.case_list(ids, raw=a.raw), open(out, "w"), indent=1)
    print("%d cases written to %s" % (len(ids), out))
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    c = sub.add_parser("cases"); c.add_argument("--raw", action="store_true"); c.add_argument("--set", default="open", choices=("open", "blind", "all")); c.add_argument("--out")
    sc = sub.add_parser("score"); sc.add_argument("folder"); sc.add_argument("--runs", type=int, default=3)
    sc.add_argument("--set", default="open", choices=("open", "blind", "all")); sc.add_argument("--json"); sc.add_argument("--details", action="store_true")
    a = p.parse_args()
    sys.exit({"check": cmd_check, "cases": cmd_cases, "score": cmd_score}[a.cmd](a))
