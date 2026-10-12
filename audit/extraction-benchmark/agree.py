"""Cross-vendor agreement on documents without a text layer: a line turns green only when an
independent second read (other vendor) gives the same name, amount and unit."""
import sys
from collections import Counter
import score, gold

A, B = sys.argv[1], sys.argv[2]
CASES = sys.argv[3].split(",") if len(sys.argv) > 3 else ["pavlova_pdf", "lasagna_pdf", "linguine_pdf", "invoice_photo"]


def key_lines(r, case):
    meta = gold.CASES[case]
    if r["type"] == "recipe":
        return score.ef_recipe_lines(r["ef"], None, False)[0]
    return score.ef_invoice_lines(r["ef"], None)[0]


rowsA = {(r["case"], r["run"]): r for r in score.evaluate("out/" + A)}
rowsB = {(r["case"], r["run"]): r for r in score.evaluate("out/" + B)}
tot = Counter()
for case in CASES:
    c = Counter()
    for run in range(1, 6):
        ra, rb = rowsA.get((case, run)), rowsB.get((case, run))
        if not ra or not rb or ra.get("error") or rb.get("error"):
            c["skipped"] += 1
            continue
        det = [d for d in ra["det"] if isinstance(d[1], dict)]
        other = [d[1] for d in rb["det"] if isinstance(d[1], dict)]
        used = set()
        for d in det:
            ln = d[1]
            best = None
            for j, o in enumerate(other):
                if j in used:
                    continue
                if score.sim(ln["name"], o["name"]) >= 0.5 and score.num_eq(ln["qty"], o["qty"]) and (
                        ln["unit"] == o["unit"] or (ln["unit"] in score.COUNT and o["unit"] in score.COUNT)) and (
                        ln.get("price") is None or score.num_eq(ln.get("price"), o.get("price"))):
                    best = j
                    break
            agreed = best is not None
            if agreed:
                used.add(best)
            ok = d[0] in ("correct", "grounded", "fee_separated")
            c[("green" if agreed else "amber") + ("_ok" if ok else "_err")] += 1
        missed = sum(1 for d in ra["det"] if d[0] == "missed")
        c["missed"] += missed
    tot.update(c)
    print(case.ljust(15), dict(c))
print("TOTAL", dict(tot))
g = tot["green_ok"] + tot["green_err"]
a = tot["amber_ok"] + tot["amber_err"]
print("green lines %d (errors among them %d) | amber lines %d (errors %d) | review share %.0f%%" % (
    g, tot["green_err"], a, tot["amber_err"], 100 * a / max(1, a + g)))
