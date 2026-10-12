import score, sys, json
arm, case = sys.argv[1], sys.argv[2]
runs = [int(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else [1]
for r in score.evaluate("out/" + arm):
    if r["case"] != case or r["run"] not in runs: continue
    print("## run", r["run"], "err:", r.get("error"), "refused:", r.get("refused"), dict(r["res"]))
    for d in r.get("det", []):
        if d[0] == "missed": print("   MISSED", d[1]); continue
        ln = d[1]
        g = d[2] if len(d) > 2 else None
        gs = "" if g is None else ("  <- gold %s %s %s" % ((g[0][0], g[1], g[2]) if isinstance(g, tuple) else (g["names"][0], g["ok"], "")))
        print("  ", d[0].ljust(16), repr(ln.get("name"))[:60].ljust(62), ln.get("qty"), ln.get("unit"), ln.get("price", ""), ("FLAG:" + ln["flag"]) if ln.get("flag") else "", gs)
