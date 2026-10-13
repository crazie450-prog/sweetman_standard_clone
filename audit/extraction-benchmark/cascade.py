"""Simulate routing policies from recorded runs (no new model calls).

cascade(A -> B): read with A; escalate to B when any line is flagged, the missed-line check fires, the read
failed, or a real document came back empty. Photos and photo-carrying PDFs go straight to B (A cannot be
checked there). Cost and time are summed, because escalation happens after A finishes.
"""
import copy, json, os
import score, study, gold

DIRECT_TO_B = {c for c, v in gold.CASES.items() if v["kind"] == "handwritten"} | {"invoice_photo", "h3_produce_photo"}


def trigger(row):
    if row.get("error"):
        return "failed"
    meta = gold.CASES[row["case"]]
    det = [d for d in row.get("det", []) if isinstance(d[1], dict)]
    if any(d[1].get("flag") for d in det):
        return "flagged line"
    if meta["kind"] == "trap":
        return None
    if not det:
        return "empty"
    src_path = score.CHECK_SRC.get(row["case"], score.SCORE_SRC[row["case"]].get("src"))
    src = open(src_path).read() if src_path else ""
    if score.missed_lines(src, [d[1].get("ev") for d in det]):
        return "possible missed line"
    return None


def simulate(a_dirs, b_dirs, label):
    A = {(r["case"], r["run"]): r for r in study.load_rows(a_dirs)}
    B = {(r["case"], r["run"]): r for r in study.load_rows(b_dirs)}
    rows, esc, reasons = [], 0, {}
    for key, b in B.items():
        a = A.get(key)
        if key[0] in DIRECT_TO_B or a is None:
            r = copy.copy(b)
            rows.append(r)
            continue
        why = trigger(a)
        if why:
            esc += 1
            reasons[why] = reasons.get(why, 0) + 1
            r = copy.copy(b)
            r["cost"] = a["cost"] + b["cost"]
            r["ms"] = a["ms"] + b["ms"]
        else:
            r = copy.copy(a)
        rows.append(r)
    return rows, esc, reasons


POLICIES = {
    "Cascade: Flash-Lite (low) -> 3.8 Flash": (["study/lr-g35"], ["study/lr-g38"]),
    "Cascade: Flash-Lite (minimal) -> 3.8 Flash": (["study/lr-g35min"], ["study/lr-g38"]),
    "Cascade: Haiku (no thinking) -> 3.8 Flash": (["study/lr-haiku-nothink"], ["study/lr-g38"]),
    "Cascade: Haiku -> 3.8 Flash": (["study/lr-haiku"], ["study/lr-g38"]),
    "Cascade: Flash-Lite compact+split -> 3.8 compact+split": (["study/lr-g35-fast"], ["study/lr-g38-fast", "study/lr-g38"]),
    "Cascade: Haiku -> 3.8 compact+split": (["study/lr-haiku"], ["study/lr-g38-fast", "study/lr-g38"]),
}

if __name__ == "__main__":
    out = {}
    for label, (a, b) in POLICIES.items():
        rows, esc, reasons = simulate(a, b, label)
        res = {s: study.summarize(rows, cs) for s, cs in (("dev", study.DEV), ("holdout", study.HOLD), ("all", study.DEV + study.HOLD))}
        res["escalated"] = esc
        res["reasons"] = reasons
        res["eligible"] = sum(1 for r in rows if r["case"] not in DIRECT_TO_B)
        out[label] = res
        x = res["all"]
        print("%-46s acc %5.1f recall %5.1f err %3d unfl %2d clean %3.0f%% p50 %4.1f p95 %4.0f cost %.4f | escalated %d/%d %s" % (
            label, x["accuracy"], x["recall"], x["errors"], x["unflagged"], x["clean"], x["p50"], x["p95"], x["cost"],
            esc, res["eligible"], reasons))
    json.dump(out, open(os.path.join(gold.DOCS, os.environ.get("CASCADE_OUT", "cascade.json")), "w"), indent=1, default=str)
