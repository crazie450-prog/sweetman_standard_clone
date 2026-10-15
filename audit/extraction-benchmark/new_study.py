"""NEW set results: real archive documents, never used for tuning. Same accuracy definition as study.py.

Usage: CHECKS_V2=1 [CHECKS_V3=1] python3 new_study.py [out.json]
"""
import json, os, sys
from collections import Counter
import gold, study

PHOTO_FIXED = {"n_meatball", "n_trap_dish_photo"}
TEXT_FIXED = set(gold.NEW) - PHOTO_FIXED
KINDS = {k: [c for c in study.NEWSET if gold.CASES[c]["kind"] == k] for k in ("word", "sheet", "pdf", "photo", "trap")}

CONFIGS = {
    "A. 3.8 Flash LR fast; photos 3.8 medium (readers as delivered)": ["new/A-delivered"],
    "A. 3.8 Flash LR fast; photos 3.8 medium (reader fixes)": ["new/A-fixed"],
    "B. Haiku LR text; photos 3.8 medium (reader fixes)": [("new/B-fixed", TEXT_FIXED), ("new/A-fixed", PHOTO_FIXED)],
    "C. Flash-Lite LR fast text; photos 3.8 medium (reader fixes)": [("new/C-fixed", TEXT_FIXED), ("new/A-fixed", PHOTO_FIXED)],
    "Route: text -> gpt-6-luna; photos -> 3.8 Flash medium (reader fixes)": [("new/luna-fixed", TEXT_FIXED), ("new/A-fixed", PHOTO_FIXED)],
}
for k, v in json.loads(os.environ.get("EXTRA_CONFIGS", "{}")).items():
    CONFIGS[k] = [tuple(x) if isinstance(x, list) else x for x in v]


def run():
    out = {}
    for label, dirs in CONFIGS.items():
        rows = study.load_rows(dirs)
        if not rows:
            continue
        for r in rows:
            r["is_ef"] = True
        o = {"new": study.summarize(rows, study.NEWSET), "long": study.summarize(rows, study.LONGSET)}
        if o["new"]:
            o["new"]["ci"] = study.boot_ci(rows, study.NEWSET)
        for k, cs in KINDS.items():
            o["kind_" + k] = study.summarize(rows, cs)
        o["_rows"] = rows
        out[label] = o
    return out


if __name__ == "__main__":
    out = run()
    print("%-72s %6s %13s %5s %5s %6s %6s %5s %5s %8s" % ("config (NEW set, %d docs)" % len(study.NEWSET), "acc", "95% CI", "err", "unfl", "review", "clean", "p50", "p95", "cost"))
    for label, o in out.items():
        x = o["new"]
        if not x:
            continue
        print("%-72s %6.2f %5.1f-%-6.1f %5d %5d %5.0f%% %5.0f%% %5.1f %5.0f %8.4f" % (
            label, x["accuracy"], x["ci"][0], x["ci"][1], x["errors"], x["unflagged"], x["review_share"], x["clean"],
            x["p50"], x["p95"], x["cost"]))
    print("\nby document kind (accuracy / errors / unflagged / jobs)")
    for label, o in out.items():
        print("  " + label[:60].ljust(60), "  ".join("%s %s" % (k[5:], ("%.1f/%d/%d/%d" % (v["accuracy"], v["errors"], v["unflagged"], v["jobs"])) if v else "-")
                                              for k, v in o.items() if k.startswith("kind_")))
    print("\nlong packet (n_saucier: printed-amount reference; recall / errors / unflagged / p50)")
    for label, o in out.items():
        x = o["long"]
        if x:
            print("  " + label[:60].ljust(60), "recall %.1f  err %d  unfl %d  p50 %.0fs  cost %.4f" % (x["recall"], x["errors"], x["unflagged"], x["p50"], x["cost"]))
    if len(sys.argv) > 1:
        json.dump({k: {kk: vv for kk, vv in v.items() if kk != "_rows"} for k, v in out.items()}, open(sys.argv[1], "w"), indent=1)
