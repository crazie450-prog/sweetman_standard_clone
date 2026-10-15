"""Repair call: re-read only the flagged lines of a finished run, one small call per line, and write a copy of the
run with those lines replaced. Long documents (gold.LONG) are left alone (their flags go to review).

Usage: CHECKS_V2=1 CHECKS_V3=1 python3 repair.py <in arm dir> <out arm dir> <model>
"""
import concurrent.futures as cf, copy, glob, json, os, ssl, sys, time, urllib.request
import score, gold

SRC, DST, MODEL = sys.argv[1], sys.argv[2], sys.argv[3]
KEY = os.environ["GEMINI_API_KEY"]
CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
PROMPT = """You check one ingredient entry read from a restaurant recipe document. You are a transcriber, not a cook:
copy what is printed, never add, convert or compute.

PRINTED LINE: {ev}
ENTRY AS READ: name={name!r} quantity={qt!r} unit={ut!r} note={note!r}
WHY IT WAS FLAGGED: {why}

Return the same ingredient from the printed line, corrected if the reading was wrong:
- nameText: the ingredient words only, without the amount or the unit.
- quantityText: the amount exactly as printed, or null.
- unitText: the unit exactly as printed, or null.
- amountNote: a printed phrase used instead of an amount ("to taste"), or null.
If the entry was already right, return it unchanged."""
SCHEMA = {"type": "OBJECT", "properties": {k: {"type": "STRING", "nullable": True} for k in ("nameText", "quantityText", "unitText", "amountNote")},
          "required": ["nameText", "quantityText", "unitText", "amountNote"]}


def call(raw, why):
    body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(ev=raw.get("evidence"), name=raw.get("nameText"), qt=raw.get("quantityText"),
                                                                          ut=raw.get("unitText"), note=raw.get("amountNote"), why=why)}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "thinkingConfig": {"thinkingLevel": "low"}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t0 = time.time()
    for attempt in range(4):
        try:
            j = json.load(urllib.request.urlopen(req, context=CTX, timeout=120))
            break
        except Exception as e:  # rate limit / transient
            if attempt == 3:
                return None, dict(model=MODEL, error=str(e)[:200].replace(KEY, "***"))
            time.sleep(2 ** attempt)
    u = j.get("usageMetadata", {})
    out = json.loads(j["candidates"][0]["content"]["parts"][0]["text"])
    return out, dict(model=MODEL, modelVersion=j.get("modelVersion"), usage=u, ms=int(1000 * (time.time() - t0)), repair=True)


def repair_file(f):
    r = json.load(open(f))
    case = r["case"]
    if r.get("error") or case in gold.LONG or "ef" not in r or r.get("type") != "recipe":
        return r, 0
    meta = score.SCORE_SRC[case]
    csrc_path = score.CHECK_SRC.get(case, meta.get("src"))
    csrc = open(csrc_path).read() if csrc_path else None
    lines = score.ef_recipe_lines(r["ef"], csrc, gold.CASES[case]["kind"] in ("word", "sheet"))[0]
    todo = [(l["raw"], l["flag"]) for l in lines if l.get("flag")]
    if not todo:
        return r, 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda x: call(*x), todo))
    for (raw, why), (out, meta_call) in zip(todo, res):
        r["calls"].append(meta_call)
        if out and out.get("nameText"):
            raw.update({k: out.get(k) for k in ("nameText", "quantityText", "unitText", "amountNote")})
    r["ms"] += int(1000 * (time.time() - t0))  # repairs run after the read, in parallel per document
    r["repaired"] = len(todo)
    return r, len(todo)


os.makedirs(DST, exist_ok=True)
files = sorted(glob.glob(os.path.join(SRC, "*.json")))
total = 0
with cf.ThreadPoolExecutor(4) as ex:
    for f, (r, n) in zip(files, ex.map(repair_file, files)):
        total += n
        json.dump(r, open(os.path.join(DST, os.path.basename(f)), "w"), indent=1)
print("repaired lines:", total, "files:", len(files))
