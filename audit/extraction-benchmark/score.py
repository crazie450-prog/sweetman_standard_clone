"""Score live extraction benchmark outputs against the hand-labelled key in gold.py."""
import glob, json, os, re, statistics, sys, unicodedata, difflib
from collections import defaultdict, Counter
import gold

OUT = os.path.join(gold.DOCS, "out")
TXT = gold.DOCS + "/text/"

# text a production pipeline could check against (no OCR): extracted text / PDF text layer / nothing
CHECK_SRC = {
    "pavlova_pdf": TXT + "1-Jul-2025-Diego-Salazar.pdf.txt",
    "lasagna_pdf": TXT + "14-Jul-2025-Diego-Salazar.pdf.txt",
    "linguine_pdf": TXT + "15-Jul-2025-Diego-Salazar.pdf.txt",
    "invoice_photo": None,
    "synthetic_invoice": TXT + "synthetic_invoice.pdf.txt",
}
if hasattr(gold, "HO"):
    CHECK_SRC.update({k: gold.HO + "/%s.pdf.txt" % k for k in ("h1_template_invoice", "h2_distributor_invoice", "h4_credit_memo")})
    CHECK_SRC["h3_produce_photo"] = None
SCORE_SRC = dict(gold.CASES)
SCORE_SRC["synthetic_invoice"] = dict(gold.CASES["synthetic_invoice"], src=TXT + "synthetic_invoice.pdf.txt")

PRICE = {  # USD per 1M tokens: input, output (thinking billed as output)
    "gemini-3.5-flash-lite": (0.30, 2.50), "gemini-4-argon": (2.00, 10.00), "gemini-3.8-flash": (0.75, 3.75), "gemini-3.1-flash-lite": (0.25, 1.50),
    "claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50),
}

FRAC = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}


def parse_qty(t):
    """First figure of a printed amount: '1 1/2', '½', '2 or 3', '2-3', '4ea', '1-1/2'."""
    if t is None:
        return None
    s = str(t).strip()
    for k, v in FRAC.items():
        s = re.sub(r"(\d)\s*" + k, lambda m: f"{m.group(1)} {v}", s)
        s = s.replace(k, str(v))
    m = re.match(r"^\s*(\d+)[\s-]+(\d+)/(\d+)", s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.match(r"^\s*(\d+)\s+(0\.\d+)", s)
    if m:
        return int(m.group(1)) + float(m.group(2))
    m = re.match(r"^\s*(\d+)/(\d+)", s)
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.match(r"^\s*-?\$?\(?(-?\d*\.?\d+)", s.replace(",", ""))
    if m:
        v = float(m.group(1))
        if s.strip().startswith("-") or s.strip().startswith("(") or s.strip().upper().endswith("CR"):
            v = -abs(v)
        return v
    return None


UNIT = {
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp", "tsps": "tsp",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp", "tbs": "tbsp", "tbl": "tbsp", "tbls": "tbsp",
    "tb": "tbsp", "tbsps": "tbsp",
    "c": "cup", "cup": "cup", "cups": "cup",
    "g": "g", "gram": "g", "grams": "g", "gr": "g", "kg": "kg", "kilogram": "kg",
    "oz": "oz", "ounce": "oz", "ounces": "oz", "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb", "#": "lb",
    "qt": "qt", "qts": "qt", "quart": "qt", "quarts": "qt", "pt": "pt", "pint": "pt", "pints": "pt",
    "gal": "gal", "gallon": "gal", "gallons": "gal", "ml": "ml", "l": "l", "liter": "l", "litre": "l",
    "ea": "ea", "each": "ea", "whole": "ea", "large": "ea", "medium": "ea", "small": "ea", "pc": "ea", "pcs": "ea",
    "piece": "ea", "pieces": "ea", "unit": "ea", "units": "ea", "count": "ea", "ct": "ea", "medium-size": "ea", "medium size": "ea",
    "jumbo": "ea", "whole bunch": "bunch",
    "clove": "clove", "cloves": "clove", "bunch": "bunch", "bunches": "bunch", "slice": "slice",
    "slices": "slice", "pinch": "pinch", "pinches": "pinch", "cs": "case", "case": "case", "cases": "case",
    "can": "can", "pack": "pack", "packs": "pack", "bag": "bag", "bx": "box", "box": "box",
    "floz": "floz", "fl.oz": "floz", "fl.oz.": "floz", "fluidounce": "floz", "fluidounces": "floz",
}
COUNT = {None, "ea"}


def canon_unit(u):
    if u is None:
        return None
    s = str(u).strip().rstrip(".")
    if s == "":
        return None
    if s == "T":
        return "tbsp"
    if s == "t":
        return "tsp"
    lo = s.lower().replace(" ", "")
    if lo in UNIT:
        return UNIT[lo]
    if lo.endswith("s") and lo[:-1] in UNIT:
        return UNIT[lo[:-1]]
    # unit phrases copied verbatim: "(1 Gallon) Ziplock Bags", "ears of", "one Gallon Ziplock Bags"
    words = [w for w in re.sub(r"\(.*?\)", " ", s.lower()).replace(",", " ").split() if w not in ("of", "a", "the")]
    for w in reversed(words):
        w2 = w.rstrip(".")
        if w2 in UNIT:
            return UNIT[w2]
        if w2.endswith("s") and w2[:-1] in UNIT:
            return UNIT[w2[:-1]]
        if w2 in ("ear", "ears", "bag", "bags", "bottle", "bottles", "flat", "flats", "clamshell", "head", "heads",
                  "stick", "sticks", "bone", "bones", "scoop", "scoops", "sheet", "sheets"):
            return w2.rstrip("s") if w2.endswith("s") and len(w2) > 3 else w2
    if not words:
        return None
    return lo[:-1] if lo.endswith("s") and len(lo) > 3 else lo


STOP = set("of and the a an fresh large small medium chopped sliced minced diced cubed thinly very preferably "
           "size room temperature w with for to as needed taste".split())
UNITWORDS = set(UNIT.keys()) | {"t", "T"}


def toks(name):
    s = re.sub(r"\(\$?[\d.,]+\)|\$[\d.,]+", " ", deaccent(str(name or "")).lower())
    out = []
    for w in re.findall(r"[a-z]+", s):
        if w in STOP or w in UNITWORDS:
            continue
        if len(w) > 3 and w.endswith("es") and not w.endswith("ses"):
            w = w[:-2]
        elif len(w) > 3 and w.endswith("s"):
            w = w[:-1]
        out.append(w)
    return out


def sim(a, b):
    A, B = set(toks(a)), set(toks(b))
    if not A or not B:
        return 0.0
    j = len(A & B) / len(A | B)
    if B <= A or A <= B:
        j = max(j, 0.75)
    return j


def qforms(q):
    """Surface forms a number may be printed as."""
    if q is None:
        return []
    out = set()
    whole = int(abs(q))
    frac = round(abs(q) - whole, 3)
    F = {0.5: ["1/2", "½"], 0.25: ["1/4", "¼"], 0.75: ["3/4", "¾"], 0.333: ["1/3", "⅓"], 0.667: ["2/3", "⅔"],
         0.125: ["1/8", "⅛"], 0.67: ["2/3", "⅔"], 0.33: ["1/3", "⅓"]}
    if frac == 0:
        out.add(str(whole))
    else:
        out.add(("%g" % abs(q)))
        out.add(("%g" % abs(q)).lstrip("0"))
        for k, v in F.items():
            if abs(frac - k) < 0.004:
                for f in v:
                    out.add(f if whole == 0 else f"{whole} {f}")
                    out.add(f if whole == 0 else f"{whole}-{f}")
                    out.add(f if whole == 0 else f"{whole}{f}")
    if q < 0:
        out |= {"-" + x for x in list(out)}
    return [x for x in out if x]


_VF = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"}


def deaccent(t):
    for k, v in _VF.items():
        t = re.sub(r"(\d)\s*" + k, lambda m: m.group(1) + " " + v, t).replace(k, v)
    t = t.replace("\u2044", "/")
    return "".join(ch for ch in unicodedata.normalize("NFKD", t) if not unicodedata.combining(ch))


def norm_src(t):
    return re.sub(r"\s+", " ", deaccent(t or "").lower())


def near(src, name, q, window=160):
    """Is some form of q printed within `window` chars of the name's distinctive token?"""
    s = norm_src(src)
    tk = [w for w in sorted(toks(name), key=len, reverse=True) if w[:5] in s]
    if not tk or q is None:
        return False
    forms = qforms(q)
    for m in re.finditer(re.escape(tk[0][:5]), s):
        seg = s[max(0, m.start() - window): m.end() + window]
        for f in forms:
            if re.search(r"(?<![\d/.])" + re.escape(f.lower()) + r"(?![\d/])", seg):
                return True
    return False


_WORDS = {}


def name_in(src, name):
    """Every name token printed in the source (exact prefix, or a one-letter copy slip on long words)."""
    s = norm_src(src)
    t = toks(name)
    if not t:
        return False
    if id(src) not in _WORDS:
        _WORDS[id(src)] = set(re.findall(r"[a-z]+", s))
    words = _WORDS[id(src)]
    for w in t:
        if w[:5] in s:
            continue
        if len(w) >= 6 and difflib.get_close_matches(w, words, n=1, cutoff=0.86):
            continue
        return False
    return True


_QU = r"(?:\d|[½¼¾⅓⅔⅛])[\d/.\s]*\s*(?:cups?|c|tbsp|tsp|t|oz|lbs?|pints?|quarts?|qts?|g|kg|ml|each|ea|bunch|cloves?)\b"


def merged(name):
    """A line whose name holds another ingredient with its own amount ("Hot Water, 1 pint Coconut Milk, ...")."""
    n = str(name or "")
    return bool(re.search(r"[,;]\s*" + _QU, n, re.I)) or len(re.findall(_QU, n, re.I)) >= 2


# ---------------- normalisation of arm outputs into lines ----------------

def m3_recipe_lines(payloads):
    lines, recipes = [], 0
    for p in payloads or []:
        recipes += 1
        for scope in [p] + list(p.get("subRecipes") or []):
            for it in scope.get("items") or []:
                q = it.get("quantity")
                q = None if q in (None, 0) else q
                lines.append(dict(name=it.get("rawName", ""), qty=q, unit=canon_unit(it.get("unit")), flag=None,
                                  section=scope.get("name")))
    return lines, recipes




def ef_recipe_lines(efs, check_src, textual=True):
    lines, recipes, kinds = [], 0, []
    for doc in efs or []:
        kinds.append(doc.get("documentKind"))
        for r in doc.get("recipes") or []:
            recipes += 1
            entries = r.get("lines") or []
            claimed = Counter(ln.get("evidence") for ln in entries if ln.get("quantityText"))
            for ln in entries:
                q = parse_qty(ln.get("quantityText"))
                u = canon_unit(ln.get("unitText"))
                flag = ef_flag(ln, q, check_src, textual)
                # Line accounting: an entry with no amount on a shared printed line ("..., Veal Demi, Rosemary") is
                # only suspect when the line shows more amounts than its sibling entries claim.
                if CHECKS_V2 and flag == "evidence shows an amount the line lacks" and \
                        len(re.findall(_QU, ln.get("evidence") or "", re.I)) <= claimed[ln.get("evidence")]:
                    flag = None
                lines.append(dict(name=ln.get("nameText", ""), qty=q, unit=u, flag=flag,
                                  section=ln.get("section"), ev=ln.get("evidence")))
    return lines, recipes, kinds


CHECKS_V2 = os.environ.get("CHECKS_V2") == "1"  # line accounting + unit-inside-name (added after round 2)
UNIT_WORDS = set("""slice slices bunch bunches ear ears cup cups clove cloves pinch head heads stick sticks bag bags sheet
sheets can cans oz ounce ounces lb lbs pound pounds sprig sprigs dash piece pieces scoop scoops bottle bottles tbsp tsp
tablespoon tablespoons teaspoon teaspoons quart quarts pint pints gallon gallons qt qts pt gal g kg ml liter liters pack
packs packet packets box boxes case cases jar jars container containers clamshell clamshells flat flats""".split())


def ef_flag(ln, q, src, textual=True):
    """Production-style code checks. Returns None (green) or a reason (amber).
    textual: the source is text the app extracted itself (Word/workbook), so a row may be
    flattened; a PDF text layer or a photo must match the evidence contiguously."""
    ev = ln.get("evidence") or ""
    qt, ut, nm = ln.get("quantityText"), ln.get("unitText"), ln.get("nameText") or ""
    evn = norm_src(ev)
    if not toks(nm):
        return "no ingredient name"
    if ln.get("legibility") == "unclear":
        return "unclear"
    if qt and q is None:
        return "unparsed amount"
    if qt and norm_src(qt) not in evn:
        return "amount not in evidence"
    if ut and norm_src(ut) not in evn:
        return "unit not in evidence"
    if not all(w[:4] in evn for w in toks(nm)):
        return "name not in evidence"
    if merged(nm):
        return "several amounts in one line"
    if CHECKS_V2 and not ut and nm.split() and nm.split()[0].lower().strip("(,.") in UNIT_WORDS:
        return "unit inside name"
    if not qt and not ln.get("amountNote") and re.search(_QU, ev, re.I):
        return "evidence shows an amount the line lacks"
    if src is None:
        return "no text layer"
    s = norm_src(src)
    ev_core = re.sub(r"^[\s\-•*]+", "", evn).strip()
    if ev_core and ev_core in s:
        return None
    if textual and name_in(src, nm) and (q is None or near(src, nm, q, window=80)):
        return None
    return "evidence not found in document"


def m3_invoice_lines(payloads):
    out = []
    for p in payloads or []:
        for it in p.get("items") or []:
            out.append(dict(name=it.get("rawName", ""), sku=it.get("sku"), qty=it.get("quantity"),
                            unit=canon_unit(it.get("unit")), price=it.get("unitPrice"), total=it.get("lineTotal"),
                            kind="item", flag=None))
    hdr = [(p.get("vendorName"), p.get("number"), p.get("invoiceDate")) for p in payloads or []]
    return out, hdr


INV_UNIT = {"cs": "case", "case": "case", "ea": "ea", "each": "ea", "lb": "lb", "lbs": "lb", "bx": "box",
            "ct": "ea", "dz": "dozen", "gal": "gal", "pk": "pack"}


def ef_invoice_lines(efs, check_src):
    out, hdr, kinds = [], [], []
    for doc in efs or []:
        kinds.append(doc.get("documentKind"))
        for inv in doc.get("invoices") or []:
            hdr.append((inv.get("vendorText"), inv.get("invoiceNumberText"), inv.get("invoiceDateText")))
            rows = inv.get("rows") or []
            for r in rows:
                qty = parse_qty(r.get("qtyShippedText")) if r.get("qtyShippedText") else parse_qty(r.get("qtyOrderedText"))
                unit = INV_UNIT.get(str(r.get("unitText") or "").strip().lower().rstrip("."), canon_unit(r.get("unitText")))
                price = parse_qty(r.get("unitPriceText"))
                total = parse_qty(r.get("extendedPriceText"))
                flag = None
                pu = str(r.get("priceUnitText") or "") + " " + str(r.get("unitPriceText") or "")
                w = parse_qty(r.get("weightText")) if r.get("weightText") else None
                if w is None and re.search(r"\d\s*lb", str(r.get("packText") or ""), re.I) and re.search(r"/\s*lb", pu, re.I):
                    w = parse_qty(r.get("packText"))
                if re.search(r"/\s*lb|per\s*lb", pu, re.I) and w:
                    qty, unit = w, "lb"
                if price is None and total is not None and qty:
                    price, flag = round(total / qty, 4), "computed price"
                if qty is not None and price is not None and total is not None and abs(qty * price - total) > max(0.02, abs(total) * 0.005):
                    flag = flag or "qty x price != total"
                if r.get("kind") in ("item", "credit") and qty is None and price is None and total is None:
                    flag = flag or "row has no amounts"
                if check_src is None:
                    flag = flag or "no text layer"
                elif norm_src(r.get("evidence"))[:25] not in norm_src(check_src) and not (
                        r.get("itemCodeText") and r["itemCodeText"].lower() in norm_src(check_src)) and not name_in(
                        check_src, r.get("descriptionText") or ""):
                    flag = flag or "evidence not found in document"
                out.append(dict(name=r.get("descriptionText") or "", sku=r.get("itemCodeText"), qty=qty, unit=unit,
                                price=price, total=total, kind=r.get("kind"), flag=flag))
    return out, hdr, kinds


# ---------------- scoring ----------------

def num_eq(a, b, tol=0.011):
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) <= max(tol, abs(float(b)) * 0.004)


def score_recipe(case, lines, src_text):
    g = gold.R[case]
    res = Counter()
    det = []
    if g["lines"] is None:  # grounding-only + automatic printed-amount reference
        import autoref
        ref = autoref.reference(case)
        res["ref_total"] = len(ref)
        taken = set()
        for (rn, rq, ru, rline) in ref:
            for i, ln in enumerate(lines):
                if i in taken or merged(ln["name"]):
                    continue
                # a count item may be read with any unit word printed on its own line ("4 ... Ziplock Bags")
                u_ok = ln["unit"] == ru or (ru in COUNT and ln["unit"] in COUNT) or (
                    ru is None and ln["unit"] and ln["unit"][:3] in norm_src(rline))
                if num_eq(ln["qty"], rq) and u_ok and sim(ln["name"], rn) >= 0.5:
                    taken.add(i)
                    res["ref_found"] += 1
                    break
        for ln in lines:
            if merged(ln["name"]):
                c = "merged"
            elif not name_in(src_text, ln["name"]):
                c = "invented"
            elif ln["qty"] is not None and not near(src_text, ln["name"], ln["qty"]):
                c = "invented_amount"
            else:
                c = "grounded"
            res[c] += 1
            det.append((c, ln))
        return res, det
    golds = g["lines"]
    pairs = []
    for i, ln in enumerate(lines):
        for j, (names, gq, gu, fl) in enumerate(golds):
            s = max(sim(ln["name"], n) for n in names)
            if s >= 0.5:
                gqs = gq if isinstance(gq, tuple) else (gq,)
                bonus = 0.3 if any(num_eq(ln["qty"], x) for x in gqs if x is not None) else 0
                pairs.append((s + bonus, i, j))
    pairs.sort(reverse=True)
    used_i, used_j, match = set(), set(), {}
    for s, i, j in pairs:
        if i in used_i or j in used_j:
            continue
        used_i.add(i); used_j.add(j); match[i] = j
    for i, ln in enumerate(lines):
        if merged(ln["name"]):
            res["merged"] += 1
            det.append(("merged", ln))
            used_j.discard(match.pop(i)) if i in match else None
            continue
        if i in match:
            names, gq, gu, fl = golds[match[i]]
            gqs = gq if isinstance(gq, tuple) else (gq,)
            gus = gu if isinstance(gu, tuple) else (gu,)
            if gq is None and "opt" in fl and ln["qty"] is not None:
                q_ok = near(src_text, ln["name"], ln["qty"])  # component line: amount must be printed nearby
            elif gq is None:
                q_ok = ln["qty"] is None
            else:
                q_ok = any(num_eq(ln["qty"], x) for x in gqs) or ("alt_none" in fl and ln["qty"] is None)
            if gq is None or (ln["qty"] is None and "alt_none" in fl):
                u_ok = True
            elif "ea" in gus:
                u_ok = ln["unit"] in COUNT or ln["unit"] in gus
            else:
                u_ok = ln["unit"] in gus
            c = "correct" if (q_ok and u_ok) else "wrong_value"
            res[c] += 1
            det.append((c, ln, golds[match[i]]))
        else:
            dup = any(sim(ln["name"], lines[k]["name"]) >= 0.75 and k in match for k in range(len(lines)) if k != i)
            if dup:
                c = "duplicate"
            elif any(sim(ln["name"], u) >= 0.5 for u in g["unlisted"]):
                c = "unlisted"
            elif not name_in(src_text, ln["name"]):
                c = "invented"
            elif ln["qty"] is not None and not near(src_text, ln["name"], ln["qty"]):
                c = "invented_amount"
            else:
                c = "grounded_extra"
            res[c] += 1
            det.append((c, ln))
    for j, (names, gq, gu, fl) in enumerate(golds):
        if j not in used_j and "opt" not in fl:
            res["missed"] += 1
            det.append(("missed", names[0]))
    res["gold_required"] = sum(1 for x in golds if "opt" not in x[3])
    return res, det


def score_invoice(case, lines, hdr):
    g = gold.INV[case]
    res, det = Counter(), []
    used = set()
    for gl in g["lines"]:
        best, bs = None, 0
        for i, ln in enumerate(lines):
            if i in used:
                continue
            s = 1.0 if (gl["sku"] and ln.get("sku") and gl["sku"].lower() == str(ln["sku"]).lower()) else max(
                sim(ln["name"], n) for n in gl["names"])
            if s > bs:
                best, bs = i, s
        if best is None or bs < 0.5:
            if gl["kind"] == "item" or gl["kind"] == "credit":
                res["missed"] += 1
                det.append(("missed", gl["names"][0]))
            else:
                res["fee_not_captured"] += 1
            continue
        used.add(best)
        ln = lines[best]
        if gl["kind"] == "fee":
            if ln.get("kind") in ("fee", "deposit", "discount", "other"):
                res["fee_separated"] += 1
                det.append(("fee_separated", ln))
            else:
                res["fee_as_stock_item"] += 1
                det.append(("fee_as_stock_item", ln))
            continue
        ok = False
        for q, u, p in gl["ok"]:
            if num_eq(ln["qty"], q) and (ln["unit"] == u or (u == "ea" and ln["unit"] in COUNT)) and (
                    (p is None and ln["price"] is None) or (p is not None and num_eq(ln["price"], p))):
                ok = True
        if gl["kind"] == "credit":
            neg = (ln["qty"] or 0) < 0 or (ln["total"] or 0) < 0 or (ln["price"] or 0) < 0
            ok = ok and neg
        c = "correct" if ok else "wrong_value"
        res[c] += 1
        det.append((c, ln, gl))
    for i, ln in enumerate(lines):
        if i not in used:
            if ln.get("kind") not in ("item", "credit"):
                res["non_stock_row"] += 1  # fee/discount/other rows never become stock lines
                det.append(("non_stock_row", ln))
            else:
                res["invented"] += 1
                det.append(("invented", ln))
    res["gold_required"] = sum(1 for x in g["lines"] if x["kind"] in ("item", "credit"))
    # header
    hd = hdr[0] if hdr else (None, None, None)
    res["hdr_date_ok"] = int(bool(hd[2]) and (g["date"] in str(hd[2]) or _date_eq(str(hd[2]), g["date"])))
    res["hdr_number_ok"] = int(bool(hd[1]) and g["number"].lower() in str(hd[1]).lower())
    return res, det


def _date_eq(text, iso):
    y, m, d = iso.split("-")
    return text.strip() in (f"{m}/{d}/{y[2:]}", f"{m}/{d}/{y}", iso)


def cost_of(calls):
    total = 0.0
    for c in calls:
        u = c.get("usage") or {}
        model = c.get("modelVersion") or c.get("model")
        key = next((k for k in PRICE if str(model).startswith(k)), None)
        if not key:
            continue
        pin, pout = PRICE[key]
        if "promptTokenCount" in u:  # Gemini: implicit-cache hits are billed at 10% of input
            cached = u.get("cachedContentTokenCount", 0) or 0
            i = u.get("promptTokenCount", 0) - cached + 0.1 * cached
            o = u.get("candidatesTokenCount", 0) + (u.get("thoughtsTokenCount", 0) or 0)
        else:  # Claude: cache reads 0.1x, 5-minute cache writes 1.25x
            i = (u.get("input_tokens", 0) or 0) + 0.1 * (u.get("cache_read_input_tokens", 0) or 0) + \
                1.25 * (u.get("cache_creation_input_tokens", 0) or 0)
            o = u.get("output_tokens", 0)
        tier = 0.5 if u.get("serviceTier") == "flex" else 1.0  # Gemini Flex: half price, best-effort queue
        total += tier * (i / 1e6 * pin + o / 1e6 * pout)
    return total


def signature(lines):
    return tuple(sorted((" ".join(sorted(toks(l["name"]))), "" if l["qty"] is None else "%g" % round(l["qty"], 3),
                         l["unit"] or "") for l in lines))


def load(arm_dir):
    out = defaultdict(dict)
    for f in glob.glob(os.path.join(arm_dir, "*.json")):
        r = json.load(open(f))
        out[r["case"]][r["run"]] = r
    return out


def evaluate(arm_dir):
    data = load(arm_dir)
    rows = []
    for case, runs in sorted(data.items()):
        meta = SCORE_SRC[case]
        src = open(meta["src"]).read() if meta.get("src") else ""
        csrc_path = CHECK_SRC.get(case, meta.get("src"))
        csrc = open(csrc_path).read() if csrc_path else None
        for run, r in sorted(runs.items()):
            row = dict(case=case, run=run, ms=r.get("ms"), cost=cost_of(r.get("calls", [])), error=r.get("error"),
                       refused=r.get("refused"), models=sorted({c.get("modelVersion") or c["model"] for c in r.get("calls", [])}),
                       retries=sum(c.get("retries", 0) for c in r.get("calls", [])))
            is_ef = "ef" in r
            if r.get("error"):
                row["res"] = Counter(error=1)
                rows.append(row)
                continue
            if gold.CASES[case]["kind"] == "trap":
                if r["type"] == "recipe":
                    lines = (ef_recipe_lines(r["ef"], csrc)[0] if is_ef else m3_recipe_lines(r.get("payloads"))[0])
                else:
                    lines = (ef_invoice_lines(r["ef"], csrc)[0] if is_ef else m3_invoice_lines(r.get("payloads"))[0])
                row["res"] = Counter(false_import=len(lines), trap_pass=int(len(lines) == 0))
                row["sig"] = signature([dict(name=l["name"], qty=l["qty"], unit=l["unit"]) for l in lines])
                rows.append(row)
                continue
            if r["type"] == "recipe":
                if is_ef:
                    lines, nrec, kinds = ef_recipe_lines(r["ef"], csrc, gold.CASES[case]["kind"] in ("word", "sheet"))
                else:
                    lines, nrec = m3_recipe_lines(r.get("payloads"))
                res, det = score_recipe(case, lines, src)
                lo, hi = (gold.R[case]["recipes"] if isinstance(gold.R[case]["recipes"], tuple)
                          else (gold.R[case]["recipes"],) * 2)
                res["recipes"] = nrec
                res["recipe_count_ok"] = int(lo <= nrec <= hi)
            else:
                if is_ef:
                    lines, hdr, kinds = ef_invoice_lines(r["ef"], csrc)
                else:
                    lines, hdr = m3_invoice_lines(r.get("payloads"))
                res, det = score_invoice(case, lines, hdr)
            # flagged vs unflagged errors (EF only; M3 has no flags)
            bad = {"wrong_value", "invented", "invented_amount", "fee_as_stock_item", "merged"}
            for d in det:
                if d[0] in bad and isinstance(d[1], dict):
                    res["err_flagged" if d[1].get("flag") else "err_unflagged"] += 1
                if d[0] in ("correct", "grounded") and isinstance(d[1], dict) and d[1].get("flag"):
                    res["ok_flagged"] += 1
            res["lines"] = len(lines)
            row["res"], row["det"] = res, det
            row["sig"] = signature(lines)
            rows.append(row)
    return rows


def summarize(rows):
    agg = Counter()
    for r in rows:
        agg.update(r["res"])
    return agg


if __name__ == "__main__":
    for d in sys.argv[1:]:
        rows = evaluate(d)
        print("==", os.path.basename(d), len(rows), "jobs")
        print(dict(summarize(rows)))


# ---------------- missed-line check (recall guard, production-style) ----------------
_LEAD = re.compile(r"^\s*[-•*]?\s*(?:\d+\s+\d/\d|\d+-\d/\d|\d*\.?\d+/\d+|\d*\.\d+|\d+|[½¼¾⅓⅔⅛])\s*(?:[a-zA-Z#\"”]|\()")


def ingredient_like(line):
    """A printed line that starts with an amount, as ingredient lines do (method sentences start with a verb)."""
    t = line.strip()
    if len(t) > 90 or not _LEAD.match(t):
        return False
    return not re.match(r"^\s*\d+\s*(?:min|minutes|hours?|degrees|°|servings?|guests?|portions?|tartlets?)\b", t, re.I)


def missed_lines(source_text, evidences):
    """Ingredient-like source lines that no extracted entry points at."""
    if not source_text:
        return []
    covered = norm_src(" || ".join(e or "" for e in evidences))
    out = []
    for line in source_text.splitlines():
        if ingredient_like(line):
            key = norm_src(line).strip()[:40]
            if key and key not in covered:
                out.append(line.strip())
    return out
