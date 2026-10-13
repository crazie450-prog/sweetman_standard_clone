"""Collect the final numbers for the brief into results.json."""
import glob, json, os, subprocess, sys
from collections import Counter
import score, report, gold

CONFIGS = [
    ("m3-gemini_gemini-flash-lite-latest", "M3 today: gemini mode, default alias (resolves to Gemini 3.5 Flash-Lite)", "m3"),
    ("m3-pair", "M3 pair mode (3.5 Flash-Lite draft + 3.8 Flash check)", "m3"),
    ("m3-gemini_gemini-3.8-flash", "M3 gemini mode, model name switched to Gemini 3.8 Flash (config only)", "m3"),
    ("m3-claude_claude-opus-5-5", "M3 claude mode (Claude Opus 5.5, effort low)", "m3"),
    ("final-gemini_gemini-3.5-flash-lite", "Recommended pipeline + Gemini 3.5 Flash-Lite", "rec"),
    ("final-gemini_gemini-3.8-flash", "Recommended pipeline + Gemini 3.8 Flash", "rec"),
    ("final-claude_claude-haiku-5-5", "Recommended pipeline + Claude Haiku 5.5", "rec"),
    ("final-claude_claude-sonnet-5-5", "Recommended pipeline + Claude Sonnet 5.5", "rec"),
]
NOTEXT = ["pavlova_pdf", "lasagna_pdf", "linguine_pdf", "invoice_photo"]


def sub(rows, cases, key):
    return sum(r["res"].get(key, 0) for r in rows if r["case"] in cases)


out = dict(configs=[], agree={}, history={})
for arm, label, kind in CONFIGS:
    s = report.arm_summary(os.path.join(gold.DOCS, "out", arm))
    rows = score.evaluate(os.path.join(gold.DOCS, "out", arm))
    hw = ["pavlova_pdf", "lasagna_pdf", "linguine_pdf"]
    out["configs"].append(dict(
        arm=arm, label=label, kind=kind, recall=s["all_recall"], unflagged=s["unflagged"], flagged=s["flagged"],
        clean=s["clean_rate"], identical=s["cases_identical"], cases=s["cases"], p50=s["p50_s"], p95=s["p95_s"],
        cost=s["cost_per_doc"], errors=s["errors"], trap_pass=s["trap_pass"], trap_jobs=s["trap_jobs"],
        inv_correct=s["inv_correct"], inv_required=s["inv_required"], fee_as_item=s["inv_fee_as_item"],
        hw_correct=sum(min(r["res"].get("correct", 0), r["res"].get("gold_required", 0)) for r in rows if r["case"] in hw),
        hw_required=sub(rows, hw, "gold_required"),
        ok_flagged=s["ok_flagged"], models=s["models"], lines=sum(r["res"].get("lines", 0) for r in rows),
        cost_inv=sum(r["cost"] for r in rows if r["case"] in gold.INV) / max(1, sum(1 for r in rows if r["case"] in gold.INV)),
        cost_notext=sum(r["cost"] for r in rows if r["case"] in NOTEXT) / max(1, sum(1 for r in rows if r["case"] in NOTEXT)),
        p95_inv=sorted(r["ms"] for r in rows if r["case"] in gold.INV)[int(0.95 * (sum(1 for r in rows if r["case"] in gold.INV) - 1))] / 1000))

# cross-vendor agreement on documents with no text layer
for b in ("final-claude_claude-haiku-5-5", "final-claude_claude-sonnet-5-5"):
    res = subprocess.run([sys.executable, "agree.py", "final-gemini_gemini-3.8-flash", b], capture_output=True,
                         text=True, cwd=gold.DOCS).stdout.strip().splitlines()[-1]
    out["agree"][b] = res
res = subprocess.run([sys.executable, "agree.py", "ef-gemini_gemini-3.8-flash", "final-claude_claude-sonnet-5-5"],
                     capture_output=True, text=True, cwd=gold.DOCS).stdout.strip().splitlines()[-1]
out["agree"]["stress_v1_vs_sonnet"] = res

# history: how the proposed design changed during the test
for arm in ["ef-gemini_gemini-3.8-flash", "ef2-gemini_gemini-3.8-flash", "v2-final-gemini_gemini-3.8-flash",
            "final-gemini_gemini-3.8-flash", "ef2hi-gemini_gemini-3.8-flash", "ef2img-gemini_gemini-3.8-flash",
            "wholebook-gemini_gemini-3.8-flash"]:
    p = os.path.join(gold.DOCS, "out", arm)
    if os.path.isdir(p):
        rows = score.evaluate(p)
        c = Counter()
        for r in rows:
            c.update(r["res"])
        out["history"][arm] = {k: c[k] for k in ["correct", "gold_required", "ref_found", "ref_total", "merged",
                                                 "err_unflagged", "err_flagged", "wrong_value", "invented"]}

# spend and call count over everything that ran
calls, cost = 0, 0.0
for f in glob.glob(os.path.join(gold.DOCS, "out", "*", "*.json")) + glob.glob(os.path.join(gold.DOCS, "smoke", "*", "*.json")):
    r = json.load(open(f))
    calls += len(r.get("calls", []))
    cost += score.cost_of(r.get("calls", []))
out["calls"], out["spend"] = calls, cost
json.dump(out, open(os.path.join(gold.DOCS, "results.json"), "w"), indent=1)
for c in out["configs"]:
    print("%-36s rec %5.1f unfl %3d fl %3d clean %5.1f ident %2d/%d p50 %4.1f p95 %5.1f $%.4f hw %d/%d inv %d/%d" % (
        c["arm"][:36], c["recall"], c["unflagged"], c["flagged"], c["clean"], c["identical"], c["cases"], c["p50"],
        c["p95"], c["cost"], c["hw_correct"], c["hw_required"], c["inv_correct"], c["inv_required"]))
print(out["agree"])
print("calls", calls, "spend $%.2f" % cost)
