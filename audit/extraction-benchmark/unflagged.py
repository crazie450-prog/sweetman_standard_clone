import sys, study, score
for label, dirs in study.CONFIGS.items():
    if label.startswith("M3"): continue
    rows = study.load_rows(dirs)
    for r in rows:
        for d in r.get("det", []):
            if d[0] in ("wrong_value","invented","invented_amount","merged","fee_as_stock_item") and isinstance(d[1], dict) and not d[1].get("flag"):
                g = d[2] if len(d) > 2 else None
                gs = "" if g is None else (str((g[0][0], g[1], g[2])) if isinstance(g, tuple) else str((g["names"][0], g["ok"])))
                print("%-48s %-22s r%d %-15s %-40s q=%s u=%s p=%s | ev=%s | gold=%s" % (label[:48], r["case"], r["run"], d[0], repr(d[1]["name"])[:40], d[1].get("qty"), d[1].get("unit"), d[1].get("price",""), repr(d[1].get("ev",""))[:70], gs))
