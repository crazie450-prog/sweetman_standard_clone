"""Answer-key peer review.

Three models from three vendors each read every test document on their own, without seeing the answer key, and
write down what is printed. Their readings are compared line by line with the key. A key line all three agree with
is certified. Anything else is ruled on by a separate model that sees the document and the competing readings
without knowing whose they are, and must quote the printed line. Every ruled line goes on a sign-off list.

  python3 tools/peer_review/render_pdfs.py out/peer/rendered --set open     # pages as a person sees them
  python3 tools/peer_review/peer_review.py write   out/peer                 # three independent readings
  python3 tools/peer_review/peer_review.py compare out/peer                 # certified / disputed lines
  python3 tools/peer_review/peer_review.py rule    out/peer                 # rulings on the disputed lines
  python3 tools/peer_review/peer_review.py report  out/peer                 # SIGNOFF.md

Keys: GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY in the environment (sent in headers only, never logged).
Models: PEER_GEMINI_MODEL, PEER_CLAUDE_MODEL, PEER_OPENAI_MODEL; the ruling model is PEER_JUDGE=<vendor>:<model>.
See docs/KEY_REVIEW.md.
"""
import base64, hashlib, json, os, random, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
for _k in ("CHECKS_V2", "CHECKS_V3", "NORMALIZE"):
    os.environ.setdefault(_k, "1")
import gold, score

MODELS = dict(gemini=os.environ.get("PEER_GEMINI_MODEL", "gemini-4-argon"),
              claude=os.environ.get("PEER_CLAUDE_MODEL", "claude-opus-5-5"),
              openai=os.environ.get("PEER_OPENAI_MODEL", "gpt-6.1-sol"))
# The ruling model comes from the one vendor that neither wrote the keys (Claude) nor runs the pipelines under test (Gemini).
JUDGE = os.environ.get("PEER_JUDGE", "openai:" + MODELS["openai"])
EFFORT = os.environ.get("PEER_EFFORT", "high")
KEY = lambda name: os.environ.get(name, "set-by-proxy")  # a session proxy may add the real key to the request

# ---------------------------------------------------------------- what the models are asked

WRITER_RECIPE = """You are transcribing a kitchen document for an audit. Report only what is printed.

List every ingredient line of every recipe in the document:
- printed_line: the whole printed line (or table row), copied character for character.
- name: the ingredient as printed, without its amount and unit.
- amount_text: the amount exactly as printed ("2 1/2", "1#8oz", "1/2 c plus 2 Tbsp", "2-3"); empty when none is printed.
- amount: the same amount as a number. A range is its first figure. Null when none is printed or when the
  amount is a sum of two measures.
- unit: the unit exactly as printed; empty when none is printed.
Group the lines under the recipe they belong to. A component printed inside a recipe (a sauce, a garnish) keeps its
lines in that recipe. When one printed line names two ingredients ("salt and pepper"), give each its own entry with
the same printed_line. Ingredients mentioned only in the method text are not ingredient lines.
Do not add, convert, correct, round or skip anything. Do not guess at unreadable figures: copy what is there.
If the document is not a recipe (a menu, a schedule, an article, an equipment list), set is_recipe to false and
return no recipes."""

WRITER_INVOICE = """You are transcribing a supplier document for an audit. Report only what is printed.

For each invoice or credit memo in the document give the vendor name, the invoice number and the invoice date
(YYYY-MM-DD), then every row of its line table:
- printed_line: the whole printed row, copied character for character.
- description, item_code (empty when none), quantity, unit (as printed, empty when none), unit_price, line_total.
  When both an ordered and a shipped quantity are printed, quantity is the shipped one.
- kind: "item" for goods, "credit" for returned or credited goods (negative figures stay negative), "fee" for
  delivery, fuel, packing and similar charges, "deposit", "discount", or "other".
Subtotals, tax and totals are not rows. Do not add, convert, correct, round or skip anything.
If the document is not an invoice or credit memo, set is_invoice to false and return no invoices."""

JUDGE_RULES = """You are settling disagreements about what a document prints. Several readers transcribed the document
attached. For each numbered question below you get the competing readings as lettered options, in random order.
You are not told who gave which.

For each question:
- Find the place in the document yourself.
- printed_line: copy the printed line (or row) that settles it, character for character. Leave it empty only when
  the right answer is that nothing of the kind is printed.
- choice: the letter of the option the document supports. If none of them is right, answer "none" and say in
  "reason" what is printed.
- ambiguous: true only when the document itself can honestly be read two ways (an illegible figure, an amount
  printed two different ways, a line that may or may not be an ingredient). Still give your best choice.
- reason: one sentence.
Rule from the document only. Amounts written differently but equal ("1/2" and "0.5", "lb" and "pound") are the
same reading. An amount printed as a sum ("1 Tbsp plus 2 tsp") is given as its total in the smaller unit ("5 tsp").
When two options describe the same printed amount, choose the one that states it most completely
(amount and unit)."""

NUM = {"type": ["number", "null"]}
STR = {"type": "string"}


def load(path):
    with open(path) as f:
        return json.load(f)


def save(data, path):
    with open(path, "w") as f:
        json.dump(data, f, indent=1)


def text_of(path):
    with open(path) as f:
        return f.read()


def obj(**props):
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def arr(items):
    return {"type": "array", "items": items}


RECIPE_SCHEMA = obj(is_recipe={"type": "boolean"}, recipes=arr(obj(title=STR, lines=arr(obj(
    printed_line=STR, name=STR, amount_text=STR, amount=NUM, unit=STR)))))
INVOICE_SCHEMA = obj(is_invoice={"type": "boolean"}, invoices=arr(obj(vendor=STR, number=STR, date=STR, lines=arr(obj(
    printed_line=STR, description=STR, item_code=STR, quantity=NUM, unit=STR, unit_price=NUM, line_total=NUM,
    kind={"type": "string", "enum": ["item", "credit", "fee", "deposit", "discount", "other"]})))))
JUDGE_SCHEMA = obj(rulings=arr(obj(id=STR, printed_line=STR, choice=STR, ambiguous={"type": "boolean"}, reason=STR)))

# ---------------------------------------------------------------- vendor calls

MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def post(url, headers, body, tries=5):
    data = json.dumps(body).encode()
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=dict({"content-type": "application/json"}, **headers))
            with urllib.request.urlopen(req, timeout=900) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg, retry = "HTTP %s: %s" % (e.code, e.read().decode("utf8", "replace")[:300]), e.code in (408, 429, 500, 502, 503, 529)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            msg, retry = "network: %s" % e, True
        if not retry or k == tries - 1:
            raise RuntimeError(msg)
        time.sleep(5 * 2 ** k)


def gemini_schema(s):
    """Standard JSON schema -> the Gemini responseSchema dialect."""
    if isinstance(s, list):
        return [gemini_schema(x) for x in s]
    if not isinstance(s, dict):
        return s
    out = {k: gemini_schema(v) for k, v in s.items() if k != "additionalProperties"}
    if "type" in s:
        t = s["type"]
        if isinstance(t, list):
            out["type"], out["nullable"] = [x for x in t if x != "null"][0].upper(), True
        else:
            out["type"] = t.upper()
    if "properties" in s:
        out["properties"] = {k: gemini_schema(v) for k, v in s["properties"].items()}
    return out


def ask(vendor, model, system, path, question, schema):
    """One question about one file (PDF or image) to one model; returns the parsed JSON answer."""
    with open(path, "rb") as f:
        mime, data = MIME[os.path.splitext(path)[1].lower()], base64.b64encode(f.read()).decode()
    if vendor == "gemini":
        j = post("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % model,
                 {"x-goog-api-key": KEY("GEMINI_API_KEY")},
                 {"systemInstruction": {"parts": [{"text": system}]},
                  "contents": [{"role": "user", "parts": [{"inline_data": {"mime_type": mime, "data": data}}, {"text": question}]}],
                  "generationConfig": {"mediaResolution": "MEDIA_RESOLUTION_HIGH", "responseMimeType": "application/json",
                                       "responseSchema": gemini_schema(schema), "thinkingConfig": {"thinkingLevel": EFFORT},
                                       "maxOutputTokens": 32768}})
        cand = (j.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        used = j.get("modelVersion", model)
    elif vendor == "claude":
        part = ({"type": "document", "source": {"type": "base64", "media_type": mime, "data": data}} if mime == "application/pdf"
                else {"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}})
        j = post("https://api.anthropic.com/v1/messages", {"x-api-key": KEY("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
                 {"model": model, "max_tokens": 32000, "system": system,
                  "messages": [{"role": "user", "content": [part, {"type": "text", "text": question}]}],
                  "output_config": {"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}}})
        text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
        used = j.get("model", model)
    else:
        part = ({"type": "file", "file": {"filename": "document.pdf", "file_data": "data:application/pdf;base64," + data}}
                if mime == "application/pdf" else {"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (mime, data), "detail": "high"}})
        j = post("https://api.openai.com/v1/chat/completions", {"authorization": "Bearer " + KEY("OPENAI_API_KEY")},
                 {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": [part, {"type": "text", "text": question}]}],
                  "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}},
                  "max_completion_tokens": 32000, "reasoning_effort": EFFORT})
        text = ((j.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        used = j.get("model", model)
    if not text:
        raise RuntimeError("%s returned no content" % vendor)
    return json.loads(text), used

# ---------------------------------------------------------------- 1. write: three independent readings


def to_results(case, typ, answer, model):
    """A reviewer's answer in the results format the scorer reads (docs/RESULTS_FORMAT.md), plus the printed lines."""
    out = dict(format=score.RESULTS_FORMAT, case=case, run=1, type=typ, model=model)
    if typ == "recipe":
        out["recipes"] = []
        for rec in (answer.get("recipes") or []) if answer.get("is_recipe") else []:
            lines = []
            for ln in rec.get("lines") or []:
                text, unit, q = (ln.get("amount_text") or "").strip(), (ln.get("unit") or "").strip() or None, ln.get("amount")
                if text and (q is None or score.compound_total(" ".join(x for x in (text, unit) if x))):
                    q = None  # the scorer works a sum ("1 lb 2 oz") out from the printed text
                lines.append(dict(name=ln.get("name") or "", quantity=q, unit=unit, quantity_text=text or None,
                                  printed_line=ln.get("printed_line") or ""))
            out["recipes"].append(dict(title=rec.get("title"), lines=lines))
    else:
        out["invoices"] = [dict(vendor=inv.get("vendor"), number=inv.get("number"), date=inv.get("date"), lines=[
            dict(name=ln.get("description") or "", sku=(ln.get("item_code") or "").strip() or None, quantity=ln.get("quantity"),
                 unit=(ln.get("unit") or "").strip() or None, unit_price=ln.get("unit_price"), line_total=ln.get("line_total"),
                 kind=ln.get("kind") or "item", printed_line=ln.get("printed_line") or "") for ln in inv.get("lines") or []])
            for inv in (answer.get("invoices") or []) if answer.get("is_invoice")]
    return out


def rendered(out):
    path = os.path.join(out, "rendered", "cases_rendered.json")
    if not os.path.exists(path):
        sys.exit("No rendered pages. Run: python3 tools/peer_review/render_pdfs.py %s" % os.path.join(out, "rendered"))
    return load(path)


def cmd_write(out, args):
    cases = rendered(out)
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    readers = args[args.index("--readers") + 1].split(",") if "--readers" in args else list(MODELS)
    jobs = [(r, c) for r in readers for c in cases if not only or c["id"] in only]

    def one(job):
        reader, c = job
        dst = os.path.join(out, "readings", reader, c["id"] + "__1.json")
        if os.path.exists(dst):
            return None
        recipe = c["type"] == "recipe"
        try:
            answer, used = ask(reader, MODELS[reader], WRITER_RECIPE if recipe else WRITER_INVOICE, c["path"],
                               "Transcribe the document above following the rules.", RECIPE_SCHEMA if recipe else INVOICE_SCHEMA)
        except Exception as e:  # leave no file: the next run retries it, and compare reports it as not reviewed
            return "%s %s: %s" % (reader, c["id"], e)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        save(to_results(c["id"], c["type"], answer, used), dst)
        return None

    with ThreadPoolExecutor(int(os.environ.get("PEER_PARALLEL", "6"))) as ex:
        failed = [f for f in ex.map(one, jobs) if f]
    print("%d readings wanted, %d failed" % (len(jobs), len(failed)))
    for f in failed:
        print("  FAILED", f)
    return 1 if failed else 0

# ---------------------------------------------------------------- 2. compare: certified and disputed lines


def show(ln):
    """A reading as one short text: name - amount unit."""
    if ln is None:
        return None
    q = ln.get("qty")
    amount = " ".join(str(x) for x in ("%g" % q if isinstance(q, (int, float)) else None, ln.get("unit")) if x) or "no amount"
    if "price" in ln:
        amount += " at %s" % ("%g" % ln["price"] if ln.get("price") is not None else "no price")
    return "%s - %s" % (ln.get("name"), amount)


def show_key(typ, k):
    if typ == "recipe":
        names, q, u, fl = k
        one = lambda x: " or ".join("%g" % v if isinstance(v, (int, float)) else str(v) for v in (x if isinstance(x, tuple) else (x,)) if v is not None)
        amount = " ".join(x for x in (one(q), one(u)) if x) or "no amount"
        return "%s - %s%s" % (names[0], amount, " (total of a printed sum)" if "compound" in fl else "")
    return "%s - %s" % (k["names"][0], " or ".join("%g %s at %s" % (q, u or "", "%g" % p if p is not None else "no price") for q, u, p in k["ok"]))


def review_case(case, readings):
    """Compare every reader's reading of one document with its key. readings: {reader: results json}."""
    meta = gold.CASES[case]
    typ, src_path = meta["type"], score.SCORE_SRC[case].get("src")
    src = text_of(src_path) if src_path else ""
    disputes, lines = [], []

    def dispute(kind, key, by_reader, agree=()):
        # readings: what each reader has against the key (None: nothing listed); agree: readers scored the same as the key
        disputes.append(dict(id="%s#%d" % (case, len(disputes) + 1), case=case, kind=kind, key=key, readings=by_reader, agree=sorted(agree)))

    parsed = {}
    for reader, r in readings.items():
        rl = score.v1_recipe_lines(r)[0] if r.get("recipes") is not None else []
        il, hdr = score.v1_invoice_lines(r) if r.get("invoices") is not None else ([], [])
        parsed[reader] = (rl, il, hdr)
    if meta["kind"] == "trap":
        seen = {reader: "; ".join(show(l) for l in (rl + il)[:4]) for reader, (rl, il, _h) in parsed.items() if rl or il}
        if seen:
            dispute("trap", "nothing to import: not a recipe or invoice", dict({r: None for r in readings}, **seen))
        return lines, disputes
    golds = gold.R[case]["lines"] if typ == "recipe" else gold.INV[case]["lines"]
    status = [dict() for _ in golds]  # per key line: reader -> ("agree" | "differ" | "absent", reading)
    extras = []  # [name, {reader: reading}]
    for reader, (rl, il, hdr) in parsed.items():
        res, det = score.score_recipe(case, rl, src) if typ == "recipe" else score.score_invoice(case, il, hdr)
        for d in det:
            if d[0] in ("correct", "wrong_value"):
                j = next(i for i, x in enumerate(golds) if x is d[2])
                status[j][reader] = ("agree" if d[0] == "correct" else "differ", show(d[1]))
            elif d[0] in ("invented", "invented_amount", "grounded_extra", "merged", "fee_as_stock_item"):
                for e in extras:
                    if score.sim(e[0], d[1]["name"]) >= 0.75:
                        e[1][reader] = show(d[1])
                        break
                else:
                    extras.append([d[1]["name"], {reader: show(d[1])}])
        if typ == "invoice":
            g, hd = gold.INV[case], (hdr[0] if hdr else (None, None, None))
            if not res["hdr_number_ok"] or not res["hdr_date_ok"]:
                extras.append(["__header__", {reader: "number %s, date %s" % (hd[1], hd[2])}])
    for j, k in enumerate(golds):
        optional = "opt" in k[3] if typ == "recipe" else k["kind"] == "fee"
        got = {r: status[j].get(r, ("absent", None)) for r in readings}
        differ = {r: v for r, (s, v) in got.items() if s == "differ"}
        absent = [r for r, (s, _v) in got.items() if s == "absent"]
        ok = not differ and (optional or not absent)
        lines.append(dict(key=show_key(typ, k), optional=optional, certified=ok))
        if not ok:
            dispute("value" if differ else "absent", show_key(typ, k), {r: differ.get(r) for r in readings},
                    [r for r, (s, _v) in got.items() if s == "agree"])
    for name, by in extras:
        if name == "__header__":
            g = gold.INV[case]
            dispute("header", "number %s, date %s" % (g["number"], g["date"]), dict({r: None for r in readings}, **by))
        else:
            dispute("extra", None, dict({r: None for r in readings}, **by))
    return lines, disputes


def reviewed_cases(out):
    return [c for c in rendered(out) if c["id"] in gold.CASES]


def cmd_compare(out, args):
    readers = sorted(os.listdir(os.path.join(out, "readings")))
    review, total, cert, clean, incomplete = {}, 0, 0, 0, []
    for c in reviewed_cases(out):
        case, readings = c["id"], {}
        for r in readers:
            p = os.path.join(out, "readings", r, case + "__1.json")
            if os.path.exists(p):
                readings[r] = load(p)
        if len(readings) < len(readers):
            incomplete.append("%s (no reading from %s)" % (case, ", ".join(r for r in readers if r not in readings)))
            continue
        lines, disputes = review_case(case, readings)
        review[case] = dict(file=os.path.relpath(gold.CASES[case].get("raw", gold.CASES[case]["path"]), ROOT), lines=lines, disputes=disputes)
        total += len(lines)
        cert += sum(1 for l in lines if l["certified"])
        clean += not disputes
    nd = sum(len(v["disputes"]) for v in review.values())
    summary = dict(readers={r: MODELS.get(r, r) for r in readers}, documents=len(review), documents_fully_certified=clean,
                   key_lines=total, key_lines_certified=cert, disputes=nd, not_reviewed=incomplete)
    save(dict(summary=summary, cases=review), os.path.join(out, "review.json"))
    print("%d documents compared with %d readers (%s)" % (len(review), len(readers), ", ".join(readers)))
    print("  key lines certified by all readers: %d of %d" % (cert, total))
    print("  documents with every line certified: %d of %d" % (clean, len(review)))
    print("  points to rule on: %d" % nd)
    if incomplete:
        print("  NOT REVIEWED (%d): run `write` again" % len(incomplete))
        for x in incomplete:
            print("   ", x)
    return 1 if incomplete else 0

# ---------------------------------------------------------------- 3. rule: a separate model settles each dispute

NOT_PRINTED = "no such line: the document does not print this as an ingredient or invoice row"


def options(d):
    """The competing readings of one dispute as lettered options in an order fixed by the dispute id.
    Returns [(letter, text, holders)]; the key is one holder among the others."""
    held = {}
    plain = lambda t: t.replace(" (total of a printed sum)", "").lower()  # nothing in the wording gives the key away
    key_text = plain(d["key"]) if d["key"] is not None else NOT_PRINTED
    held.setdefault(key_text, []).append("key")
    for reader, v in sorted(d["readings"].items()):
        if v is not None:
            text = "a recipe or invoice with lines such as: %s" % plain(v) if d["kind"] == "trap" else plain(v)
        elif d["kind"] in ("value", "absent") and reader not in d["agree"]:
            text = NOT_PRINTED  # the reader did not list the key's line at all
        else:
            text = key_text  # scored the same as the key, or nothing against it on this point
        held.setdefault(text, []).append(reader)
    items = sorted(held.items())
    random.Random(int(hashlib.sha256(d["id"].encode()).hexdigest(), 16)).shuffle(items)
    return [("ABCDEFGH"[i], text, holders) for i, (text, holders) in enumerate(items)]


def norm(t):
    return re.sub(r"\s+", " ", score.norm_src(t or "")).strip()


def quote_found(case, quote):
    """True/False when the document has text to check the quoted line against, None for scans and photos."""
    p = score.CHECK_SRC.get(case, score.SCORE_SRC[case].get("src"))
    if not p or not os.path.exists(p):
        return None
    words = lambda t: re.sub(r"[^a-z0-9/.#]+", " ", norm(t)).strip()
    return bool(words(quote)) and words(quote) in words(text_of(p))


def decide(d, ruling, case):
    """Turn the ruling model's answer for one dispute into an outcome."""
    opts = options(d)
    chosen = next((o for o in opts if o[0] == (ruling.get("choice") or "").strip().upper()[:1]), None)
    quote = ruling.get("printed_line") or ""
    found = quote_found(case, quote) if quote else None
    if ruling.get("ambiguous"):
        outcome = "not scored"
    elif chosen is None:
        outcome = "owner to decide"
    elif "key" in chosen[2]:
        outcome = "key stands"
    else:
        outcome = "key changes"
    if outcome in ("key stands", "key changes") and quote and found is False:
        outcome = "owner to decide"  # the quoted line is not in the file's text: the ruling proves nothing
    return dict(id=d["id"], case=case, kind=d["kind"], key=d["key"], options=[dict(letter=a, reading=t, held_by=h) for a, t, h in opts],
                choice=chosen[0] if chosen else "none", ruled_reading=chosen[1] if chosen else None, printed_line=quote,
                quote_in_file_text=found, ambiguous=bool(ruling.get("ambiguous")), reason=ruling.get("reason"), outcome=outcome)


def judge_question(disputes):
    parts = []
    for d in disputes:
        what = {"value": "What does the document print for this line?", "absent": "Is this an ingredient line (or invoice row) of the document?",
                "extra": "Is this an ingredient line (or invoice row) of the document, and what does it print?",
                "trap": "Is this document a recipe or an invoice with lines to import?",
                "header": "What invoice number and date does the document print?"}[d["kind"]]
        parts.append("Question %s. %s\n%s" % (d["id"], what, "\n".join("  %s) %s" % (a, t) for a, t, _h in options(d))))
    return "\n\n".join(parts) + "\n\nAnswer every question, using its id."


def cmd_rule(out, args, ask=ask):
    review = load(os.path.join(out, "review.json"))["cases"]
    pages = {c["id"]: c["path"] for c in rendered(out)}
    vendor, model = JUDGE.split(":", 1)
    path = os.path.join(out, "rulings.json")
    done = load(path) if os.path.exists(path) else {}
    todo = [(case, v["disputes"]) for case, v in review.items() if v["disputes"] and not all(d["id"] in done for d in v["disputes"])]

    def one(job):
        case, disputes = job
        try:
            answer, used = ask(vendor, model, JUDGE_RULES, pages[case], judge_question(disputes), JUDGE_SCHEMA)
        except Exception as e:
            return case, None, str(e)
        by_id = {r.get("id"): r for r in answer.get("rulings") or []}
        return case, [dict(decide(d, by_id.get(d["id"], {}), case), ruled_by=used) for d in disputes], None

    failed = []
    with ThreadPoolExecutor(int(os.environ.get("PEER_PARALLEL", "6"))) as ex:
        for case, rulings, err in ex.map(one, todo):
            if err:
                failed.append("%s: %s" % (case, err))
                continue
            done.update({r["id"]: r for r in rulings})
    save(done, path)
    count = {}
    for r in done.values():
        count[r["outcome"]] = count.get(r["outcome"], 0) + 1
    print("%d points ruled by %s: %s" % (len(done), JUDGE, ", ".join("%d %s" % (n, k) for k, n in sorted(count.items())) or "none"))
    for f in failed:
        print("  FAILED", f)
    return 1 if failed else 0

# ---------------------------------------------------------------- 4. report: the sign-off list


def cmd_report(out, args):
    data = load(os.path.join(out, "review.json"))
    s, review = data["summary"], data["cases"]
    path = os.path.join(out, "rulings.json")
    rulings = load(path) if os.path.exists(path) else {}
    cell = lambda t: str(t if t not in (None, "") else "-").replace("|", "/").replace("\n", " ")
    md = ["# Answer-key peer review: sign-off list", "",
          "Readers: %s. Ruling model: %s." % (", ".join("%s (%s)" % (v, k) for k, v in s["readers"].items()), JUDGE), "",
          "- Documents reviewed: %d" % s["documents"],
          "- Key lines certified by all readers: %d of %d" % (s["key_lines_certified"], s["key_lines"]),
          "- Documents with every line certified: %d" % s["documents_fully_certified"],
          "- Points that needed a ruling: %d" % s["disputes"]]
    if s["not_reviewed"]:
        md.append("- **Not reviewed: %d documents** (%s)" % (len(s["not_reviewed"]), "; ".join(s["not_reviewed"])))
    order = ["key changes", "not scored", "owner to decide", "key stands", "not ruled yet"]
    rows = {k: [] for k in order}
    for case, v in sorted(review.items()):
        for d in v["disputes"]:
            r = rulings.get(d["id"])
            others = "; ".join("%s: %s" % (" + ".join(h), t) for _a, t, h in sorted(options(d)) if h != ["key"])
            if not r:
                rows["not ruled yet"].append((d["id"], v["file"], "", d["key"], others, "", ""))
                continue
            proof = r["printed_line"] and "%s%s" % (r["printed_line"], {True: " (found in the file text)", False: " (NOT found in the file text)",
                                                                       None: " (scan: check the page)"}[r["quote_in_file_text"]])
            rows[r["outcome"]].append((d["id"], v["file"], proof, d["key"], others, r["ruled_reading"], r["reason"]))
    title = {"key changes": "Key to be corrected", "not scored": "Ambiguous in the document: line not scored",
             "owner to decide": "Needs the owner's eyes", "key stands": "Key confirmed", "not ruled yet": "Not ruled yet"}
    for k in order:
        if rows[k]:
            md += ["", "## %s (%d)" % (title[k], len(rows[k])), "",
                   "| Point | File | Printed line | Key says | Readers said | Ruling | Reason |", "|---|---|---|---|---|---|---|"]
            md += ["| " + " | ".join(cell(x) for x in row) + " |" for row in rows[k]]
    with open(os.path.join(out, "SIGNOFF.md"), "w") as f:
        f.write("\n".join(md) + "\n")
    print("wrote %s: %s" % (os.path.join(out, "SIGNOFF.md"), ", ".join("%d %s" % (len(rows[k]), k) for k in order if rows[k]) or "nothing to rule on"))
    return 0


if __name__ == "__main__":
    cmds = dict(write=cmd_write, compare=cmd_compare, rule=cmd_rule, report=cmd_report)
    if len(sys.argv) < 3 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    sys.exit(cmds[sys.argv[1]](os.path.abspath(sys.argv[2]), sys.argv[3:]))
