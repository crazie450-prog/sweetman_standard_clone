import sys, statistics
import study, gold
dirs = sys.argv[1:]
rows = study.load_rows(dirs)
by = {}
for r in rows: by.setdefault(r["case"], []).append(r)
print("%-22s %-12s %5s %5s %4s %6s %7s" % ("case","kind","exp","ok","err","ms","cost"))
for c in gold.CASES:
    rs = by.get(c, [])
    if not rs: continue
    e = sum(sum(r["res"].get(k,0) for k in study.ERR) for r in rs)
    print("%-22s %-12s %5d %5d %4d %6.0f %7.4f" % (c, gold.CASES[c]["kind"], sum(study.expected(r) for r in rs), sum(study.found(r) for r in rs), e,
        statistics.mean(r["ms"] for r in rs)/1000, statistics.mean(r["cost"] for r in rs)))
