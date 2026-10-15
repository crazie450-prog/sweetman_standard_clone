"""Group scored errors and misses by (case, kind, name, value) across runs, for auditing the key."""
import sys
from collections import Counter
import score
for d in sys.argv[1:]:
    c = Counter()
    for r in score.evaluate(d):
        if r.get("error"):
            c[(r["case"], "ERROR", r["error"][:80], "", "")] += 1
            continue
        if r["res"].get("false_import"):
            c[(r["case"], "false_import", str(r["res"]["false_import"]) + " lines", "", "")] += 1
        for t in r.get("det", []):
            if t[0] == "missed":
                c[(r["case"], "missed", t[1], "", "")] += 1
            elif t[0] in ("wrong_value", "invented", "invented_amount", "merged"):
                ln = t[1]
                c[(r["case"], t[0], ln["name"][:40], "%s %s" % (round(ln["qty"], 3) if isinstance(ln["qty"], float) else ln["qty"], ln["unit"]),
                   ("FLAG " + ln["flag"][:28]) if ln.get("flag") else "UNFLAGGED")] += 1
    print("########", d, sum(c.values()))
    for k, v in sorted(c.items()):
        print("  %dx %-22s %-14s %-42s %-14s %s" % ((v,) + k))
