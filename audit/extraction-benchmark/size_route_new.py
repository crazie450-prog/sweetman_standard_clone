"""Size routing on the NEW set: documents whose text is shorter than T characters go to a cheaper text model,
the rest (and photos) to pipeline A. Scored on runs 1-3 like every other row."""
import os, json
import gold, study
LEN = {c: (len(open(gold.CASES[c]["src"]).read()) if gold.CASES[c].get("src") else 10 ** 9) for c in gold.NEW}
PHOTO = {"n_meatball", "n_trap_dish_photo"}
out = {}
for cheap_label, cheap in (("Flash-Lite (C)", "new/C-fixed"), ("Haiku (B)", "new/B-fixed"), ("gpt-6-luna", "new/luna-fixed")):
    for T in (500, 1000, 1500, 2000, 3000):
        small = {c for c in gold.NEW if LEN[c] < T and c not in PHOTO}
        rows = study.load_rows([(cheap, small), ("new/A-fixed", set(gold.NEW) - small)])
        for r in rows:
            r["is_ef"] = True
        x = study.summarize(rows, study.NEWSET)
        x["ci"] = study.boot_ci(rows, study.NEWSET)
        out["%s < %d chars" % (cheap_label, T)] = x
        print("%-28s small docs %2d  acc %6.2f (CI %.1f-%.1f)  err %3d  unfl %2d  review %2.0f%%  p50 %4.1f  p95 %4.0f  cost %.4f" % (
            "%s < %d" % (cheap_label, T), len(small & set(study.NEWSET)), x["accuracy"], x["ci"][0], x["ci"][1], x["errors"], x["unflagged"],
            x["review_share"], x["p50"], x["p95"], x["cost"]))
json.dump(out, open("size_route_new.json", "w"), indent=1)
