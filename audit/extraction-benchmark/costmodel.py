"""Cost model: measured tokens per document type -> cost per document and per month, at today's prices and at the
announced 1 Jan 2027 Gemini 3.8 Flash price. Reads the recorded calls directly, so any price table can be applied."""
import json, os, statistics
import score, study, gold

TYPES = {
    "Short recipe (Word/PDF text)": ["brown_butter", "tuna", "caramelized", "caviar", "duck_doc", "duck_docx", "h_kanpachi", "h_leek", "h_roe", "h_quail"],
    "Long multi-recipe document": ["collard", "h_chard", "bnb_event", "h_vc_event"],
    "Workbook (recipe sheets)": ["bonds_sheet"],
    "Handwritten recipe photo": ["pavlova_pdf", "lasagna_pdf", "linguine_pdf"],
    "Invoice PDF (text layer)": ["invoice_pdf", "synthetic_invoice", "h1_template_invoice", "h2_distributor_invoice", "h4_credit_memo"],
    "Invoice photo": ["invoice_photo", "h3_produce_photo"],
}
SCENARIOS = {  # documents per month
    "Onboard one restaurant (one-off)": {"Short recipe (Word/PDF text)": 120, "Long multi-recipe document": 10, "Workbook (recipe sheets)": 3, "Handwritten recipe photo": 25},
    "One location, a normal month": {"Short recipe (Word/PDF text)": 10, "Long multi-recipe document": 1, "Handwritten recipe photo": 3, "Invoice PDF (text layer)": 90, "Invoice photo": 30},
    "100 locations, a normal month (+8 onboardings)": None,  # built below
}
PRICES_NOW = dict(score.PRICE)
PRICES_2027 = dict(score.PRICE, **{"gemini-3.8-flash": (1.50, 7.50), "gemini-4-argon": (4.00, 20.00)})


def calls_for(dirs):
    """(case, run) -> list of recorded calls, first folder wins (same rule as study.load_rows)."""
    out = {}
    for d in dirs:
        d, only = d if isinstance(d, tuple) else (d, None)
        p = os.path.join(gold.DOCS, "out", d)
        if not os.path.isdir(p):
            continue
        for f in sorted(os.listdir(p)):
            if not f.endswith(".json") or "__" not in f:
                continue
            case, run = f[:-5].rsplit("__", 1)
            if int(run) not in study.RUNS or (only is not None and case not in only) or (case, int(run)) in out:
                continue
            j = json.load(open(os.path.join(p, f)))
            out[(case, int(run))] = (j.get("calls", []), j.get("ms"))
    return out


def per_type(dirs, prices):
    score.PRICE.clear(); score.PRICE.update(prices)
    data = calls_for(dirs)
    res = {}
    for t, cases in TYPES.items():
        cs = [score.cost_of(c) for (case, _), (c, ms) in data.items() if case in cases]
        ms = sorted(ms for (case, _), (c, ms) in data.items() if case in cases)
        if cs:
            res[t] = dict(cost=statistics.mean(cs), p50=statistics.median(ms) / 1000, max=ms[-1] / 1000)
    score.PRICE.clear(); score.PRICE.update(PRICES_NOW)
    return res


def month(pt, mix):
    return sum(pt[t]["cost"] * n for t, n in mix.items() if t in pt)


def scenarios():
    one, onboard = SCENARIOS["One location, a normal month"], SCENARIOS["Onboard one restaurant (one-off)"]
    big = {t: 100 * one.get(t, 0) + 8 * onboard.get(t, 0) for t in TYPES}
    return {**{k: v for k, v in SCENARIOS.items() if v}, "100 locations, a normal month (+8 onboardings)": big}


CANDIDATES = {
    "M3 today": ["m3-gemini_gemini-flash-lite-latest", "study/m3"],
    "Evidence-first + 3.8 Flash (audit brief)": ["final-gemini_gemini-3.8-flash", "study/ef-g38"],
    "A. Recommended": [("study/lr-g38-fast", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
    "B. Haiku for text": [("study/lr-haiku", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
    "C. Flash-Lite for text": [("study/lr-g35-fast", study.TEXT), ("study/photo-g38-medium", study.PHOTO)],
    "G4. Gemini 4 Argon": [("study/lr-g4-fast", study.TEXT), ("study/photo-g4-medium", study.PHOTO)],
}
SECOND_READER = ["study/lr-haiku"]  # Haiku 5.5 reads each photo in parallel (cross-vendor agreement)


if __name__ == "__main__":
    out = {}
    for label, dirs in CANDIDATES.items():
        now, later = per_type(dirs, PRICES_NOW), per_type(dirs, PRICES_2027)
        if label[:2] in ("A.", "B.", "C.") or label.startswith("G4."):  # add the Haiku second read on photos
            sr_now, sr_later = per_type([(SECOND_READER[0], study.PHOTO)], PRICES_NOW), per_type([(SECOND_READER[0], study.PHOTO)], PRICES_2027)
            for t in ("Handwritten recipe photo", "Invoice photo"):
                now[t]["cost"] += sr_now[t]["cost"]; later[t]["cost"] += sr_later[t]["cost"]
        out[label] = dict(per_type_now=now, per_type_2027=later,
                          months_now={s: month(now, m) for s, m in scenarios().items()},
                          months_2027={s: month(later, m) for s, m in scenarios().items()})
        print("\n==", label)
        for t in TYPES:
            if t in now:
                print("  %-30s $%.4f -> 2027 $%.4f  p50 %4.1fs max %4.0fs" % (t, now[t]["cost"], later[t]["cost"], now[t]["p50"], now[t]["max"]))
        for s in scenarios():
            print("  %-50s $%8.2f -> 2027 $%8.2f" % (s, out[label]["months_now"][s], out[label]["months_2027"][s]))
    out["_scenarios"] = scenarios()
    json.dump(out, open(os.path.join(gold.DOCS, "costmodel.json"), "w"), indent=1)
