import study, score, autoref
from collections import Counter, defaultdict
cnt = defaultdict(Counter)
for label in ["Line-reference + Gemini 3.8 Flash", "Line-reference + Gemini 3.5 Flash-Lite (low)", "Line-reference + Claude Haiku 5.5", "Evidence-first + Gemini 3.8 Flash (brief's recommendation)"]:
    rows = study.load_rows(study.CONFIGS[label])
    for r in rows:
        if r["case"] not in ("collard", "h_chard", "bonds_sheet", "bnb_event", "h_vc_event") or r.get("error"): continue
        ref = autoref.reference(r["case"])
        lines = [d[1] for d in r.get("det", []) if isinstance(d[1], dict)]
        taken = set()
        for (rn, rq, ru, rline) in ref:
            hit = False
            for i, ln in enumerate(lines):
                if i in taken or score.merged(ln["name"]): continue
                u_ok = ln["unit"] == ru or (ru in score.COUNT and ln["unit"] in score.COUNT) or (ru is None and ln["unit"] and ln["unit"][:3] in score.norm_src(rline))
                if score.num_eq(ln["qty"], rq) and u_ok and score.sim(ln["name"], rn) >= 0.5:
                    taken.add(i); hit = True; break
            if not hit:
                cnt[(r["case"], rn, rq, ru)][label[:22]] += 1
for k, v in sorted(cnt.items(), key=lambda kv: -sum(kv[1].values())):
    print(sum(v.values()), k, dict(v))
