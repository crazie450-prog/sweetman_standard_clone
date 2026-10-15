"""Hand-labelled answer key for the live extraction benchmark.

Recipe gold line: (names, qty, unit, flags)
  names  - alternative spellings; matching is by token overlap
  qty    - number, a tuple of accepted numbers, or None (no amount printed)
  unit   - canonical unit (see score.canon_unit), a tuple of accepted units, or None
  flags  - "opt": prose-only or component line, not penalised if missing
           "alt_none": a None quantity is also acceptable (e.g. "pinch of")
Unlisted: ingredients that appear only in the method/prose (extracting them is an
"unlisted addition", not an invention).
"""

import os

DOCS = os.path.dirname(os.path.abspath(__file__))          # this folder
REPO = os.path.dirname(os.path.dirname(DOCS))                 # repository root
DOC = DOCS + "/documents"
TXT = DOCS + "/text/"

CASES = {
    "brown_butter": dict(path=REPO + "/backend/test/fixtures/brown-butter-sauce.doc",
                         type="recipe", src=TXT + "brown-butter-sauce.doc.txt", kind="word"),
    "tuna": dict(path=DOC + "/BIG EYE TUNA TARTARE ON CRISP LOTUS CUPS.doc", type="recipe",
                 src=TXT + "BIG EYE TUNA TARTARE ON CRISP LOTUS CUPS.doc.txt", kind="word"),
    "caramelized": dict(path=DOC + "/Caramelized Onion Tartlets.doc", type="recipe",
                        src=TXT + "Caramelized Onion Tartlets.doc.txt", kind="word"),
    "caviar": dict(path=DOC + "/Caviar, Smoked Salmon, and Gravlax with Buckwheat Blini and Sour Cream.doc",
                   type="recipe", src=TXT + "Caviar, Smoked Salmon, and Gravlax with Buckwheat Blini and Sour Cream.doc.txt",
                   kind="word"),
    "duck_doc": dict(path=DOC + "/batter Duck Pancakes.doc", type="recipe",
                     src=TXT + "batter Duck Pancakes.doc.txt", kind="word"),
    "duck_docx": dict(path=DOC + "/batter Duck Pancakes.docx", type="recipe",
                      src=TXT + "batter Duck Pancakes.docx.txt", kind="word"),
    "collard": dict(path=DOC + "/Coming Home^^.Chapter 9^^.Collard Greens and Cornbread (1).docx",
                    type="recipe", src=TXT + "Coming Home^^.Chapter 9^^.Collard Greens and Cornbread (1).docx.txt",
                    kind="word"),
    "bnb_event": dict(path=DOC + "/B&B Top Chef Event 11.6.25.docx", type="recipe",
                      src=TXT + "B&B Top Chef Event 11.6.25.docx.txt", kind="word"),
    "bonds_sheet": dict(path=DOC + "/bonds_subset.xlsx", type="recipe", src=TXT + "bonds_subset.xlsx.txt",
                        kind="sheet"),
    "pavlova_pdf": dict(path=DOC + "/1-Jul-2025-Diego-Salazar.pdf", type="recipe",
                        src=TXT + "pavlova.transcript.txt", kind="handwritten"),
    "lasagna_pdf": dict(path=DOC + "/14-Jul-2025-Diego-Salazar.pdf", type="recipe",
                        src=TXT + "lasagna.transcript.txt", kind="handwritten"),
    "linguine_pdf": dict(path=DOC + "/15-Jul-2025-Diego-Salazar.pdf", type="recipe",
                         src=TXT + "linguine.transcript.txt", kind="handwritten"),
    "invoice_pdf": dict(path=DOC + "/224676_369034.pdf", type="invoice",
                        src=TXT + "224676_369034.pdf.txt", kind="invoice"),
    "invoice_photo": dict(path=DOC + "/invoice_photo.jpg", type="invoice", src=TXT + "224676_369034.pdf.txt",
                          kind="invoice"),
    "synthetic_invoice": dict(path=DOC + "/synthetic_invoice.pdf", type="invoice", src=None, kind="invoice"),
    "trap_invoice_as_recipe": dict(path=DOC + "/224676_369034.pdf", type="recipe",
                                   src=TXT + "224676_369034.pdf.txt", kind="trap"),
    "trap_recipe_as_invoice": dict(path=DOC + "/Caramelized Onion Tartlets.doc", type="invoice",
                                   src=TXT + "Caramelized Onion Tartlets.doc.txt", kind="trap"),
}

R = {}  # recipe gold: case -> dict(lines=[...], unlisted=[...], recipes=int or (min,max))

R["brown_butter"] = dict(recipes=1, lines=[
    (["unsalted butter"], 200, "g", ""),
    (["lemon juice"], 2, "tbsp", ""),
    (["sea salt"], 1, "pinch", "alt_none"),
], unlisted=[])

R["tuna"] = dict(recipes=(1, 2), lines=[
    (["soy sauce"], 0.5, "cup", ""),
    (["lime juice"], 0.5, "cup", ""),
    (["peanut oil"], 0.5, "cup", ""),
    (["rice wine vinegar"], 0.125, "cup", ""),
    (["scallions", "scallion"], 1, "ea", ""),
    (["garlic"], (2, 3), "clove", ""),
    (["shallots", "shallot"], (2, 3), "ea", ""),
    (["ginger root", "ginger"], 1, "ea", ""),
    (["jalapeno pepper", "jalapeño pepper", "jalapeno"], 1, "ea", ""),
    # prose-only main recipe
    (["raw tuna", "tuna", "big eye tuna"], 1, "lb", "opt"),
    (["lotus root"], 1, "ea", "opt"),
    (["black caviar", "caviar"], 1, "oz", "opt"),
    (["salt"], None, None, "opt"),
    (["pepper", "black pepper"], None, None, "opt"),
    (["fried nori", "nori", "seaweed"], None, None, "opt"),
    (["peanut oil for frying"], None, None, "opt"),
    (["soy-lime vinaigrette", "soy lime vinaigrette", "vinaigrette"], None, None, "opt"),
    (["cucumber and red onion salad"], None, None, "opt"),
], unlisted=[])

R["caramelized"] = dict(recipes=1, lines=[
    (["butter"], 2, "tbsp", ""),
    (["onions", "onion", "vidalia onions"], 2, "ea", ""),
    (["sugar"], 1, "tsp", ""),
    (["eggs", "egg"], 5, "ea", ""),
    (["heavy cream"], 0.75, "cup", ""),
    (["dijon mustard"], 2, "tbsp", ""),
    (["celery salt"], 1, "pinch", "alt_none"),
    (["cayenne pepper", "cayenne"], 1, "pinch", "alt_none"),
    (["basic pie dough", "pie dough"], None, None, "opt"),
    (["caramelized onions"], None, None, "opt"),
    (["custard"], None, None, "opt"),
], unlisted=["nonstick cooking spray", "cooking spray", "pie weights", "dried beans"])

R["caviar"] = dict(recipes=(1, 2), lines=[
    (["active dry yeast", "yeast"], 0.5, "tsp", ""),
    (["warm milk"], 0.5, "cup", ""),
    (["egg", "large egg"], 1, "ea", ""),
    (["sugar"], 1, "tsp", ""),
    (["kosher salt"], 0.5, "tsp", ""),
    (["ap flour", "all-purpose flour", "all purpose flour"], (2 / 3, 0.67, 0.667), "cup", ""),
    (["cold whole milk", "whole milk"], 1, "cup", ""),
    (["clarified butter"], 0.25, "cup", ""),
    (["smoked sturgeon"], 4, "slice", ""),
    (["smoked salmon"], 4, "slice", ""),
    (["gravlax", "salmon gravlax", "home-cured salmon gravlax"], 4, "slice", ""),
    (["sour cream"], None, None, ""),
    (["salmon caviar"], 2, "oz", ""),
    (["chives"], 0.5, "bunch", ""),
], unlisted=["buckwheat flour"])

_duck = dict(recipes=(1, 2), lines=[
    (["eggs"], 4, "ea", ""),
    (["whole milk"], 16, "cup", ""),
    (["cream"], 8, "cup", ""),
    (["a.p. flour", "ap flour", "flour"], 17, "cup", ""),
    (["clarified butter"], 6, "tbsp", ""),
    (["sesame oil"], 1, "tbsp", ""),
    (["green onions"], 1, "bunch", ""),
    (["salt"], None, None, ""),
    (["white pepper"], None, None, ""),
    (["duck meat", "duck meat shredded"], 1, ("ea", "whole"), ""),
    (["duck sauce"], 2, "oz", ""),
    (["hoisin sauce"], 1, "tbsp", ""),
    (["chopped cilantro", "cilantro"], 0.5, "tbsp", ""),
    (["pancake batter"], None, None, "opt"),
    (["duck filling"], None, None, "opt"),
], unlisted=[])
R["duck_doc"] = _duck
R["duck_docx"] = _duck

R["pavlova_pdf"] = dict(recipes=(1, 3), lines=[
    (["egg whites", "large egg whites"], 12, "ea", ""),
    (["cream of tartar"], 1, "tsp", ""),
    (["sugar"], 550, "g", ""),
    (["corn starch", "cornstarch"], 2, "tbsp", ""),
    (["vanilla"], 2, "tsp", ""),
    (["cubed mangoes", "mangoes", "mango"], 4, "cup", ""),
    (["passion fruit puree"], 3, "tsp", ""),
    (["lime juice"], 2, "tsp", ""),
    (["whipped cream"], 3, "cup", ""),
    (["toasted coconut flakes", "coconut flakes"], 12, "tsp", ""),
    (["edible flower petals", "edible flowers"], None, None, ""),
    (["pavlova"], None, None, "opt"),
    (["mango filling"], None, None, "opt"),
    (["toppings"], None, None, "opt"),
], unlisted=[])

R["lasagna_pdf"] = dict(recipes=(2, 4), lines=[
    (["lasagna sheets"], 8, "oz", ""),
    (["mushroom sauce"], 3, "qt", ""),
    (["ricotta"], 2, "lb", ""),
    (["mozzarella"], 1, "lb", ""),
    (["shiitake mushrooms", "shitake mushrooms", "shittake mushrooms"], 6, "oz", ""),
    (["heavy cream"], 1.5, "qt", ""),
    (["milk"], 1, "qt", ""),
    (["truffle oil"], 0.5, "oz", ""),
    (["morels", "morrels"], 1, "oz", ""),
    (["fiocchi"], (10, 12), "oz", ""),
    (["macho sauce"], 8, "oz", ""),
    (["white wine"], 3, "oz", ""),
    (["parm cheese", "parmesan cheese", "parmesan"], 1, "oz", ""),
    (["panca paste"], 8, "oz", ""),
    (["aji amarillo paste"], 32, "oz", ""),
    (["heavy cream"], 2, "qt", ""),
    (["milk"], 1.5, "qt", ""),
    (["parm cheese", "parmesan cheese", "parmesan"], 8, "oz", ""),
    (["garlic"], 2, "oz", ""),
], unlisted=["oil"])

R["linguine_pdf"] = dict(recipes=1, lines=[
    (["fresh linguine pasta", "linguine pasta", "linguine"], 12, "oz", ""),
    (["clams"], 10, "ea", ""),
    (["white wine"], 12, "oz", ""),
    (["shallots"], 1, "oz", ""),
    (["garlic"], 1, "oz", ""),
    (["butter cubed", "butter"], 2, "oz", ""),
    (["tomato baby", "baby tomato", "baby tomatoes", "tomatoes"], 2, "oz", ""),
    (["lemon juice"], 2, "oz", ""),
], unlisted=["cooking oil", "parsley", "pasta water"])

# grounding-only cases: no line gold; expected recipe count range
R["collard"] = dict(recipes=(5, 22), lines=None, unlisted=[])
R["bnb_event"] = dict(recipes=(1, 40), lines=None, unlisted=[])
R["bonds_sheet"] = dict(recipes=(13, 15), lines=None, unlisted=[])

# Invoice gold: (names, qty_options, unit_options, unit_price_options, line_total, kind)
# qty/unit/price options are matched as aligned tuples in "ok" combos.
INV = {}
_real = dict(vendor="matt and nat", number="224676", date="2025-11-04", lines=[
    dict(names=["bar fudge brownie"], sku="BAR10FS96", ok=[(1, "case", 81.47)], total=81.47, kind="item"),
    dict(names=["cake tiramisu", "tiramisu"], sku="CAK21R", ok=[(1, "case", 75.90)], total=75.90, kind="item"),
    dict(names=["delivery charge", "delivery"], sku=None, ok=[(1, None, 15.00)], total=15.00, kind="fee"),
])
INV["invoice_pdf"] = _real
INV["invoice_photo"] = _real
INV["synthetic_invoice"] = dict(vendor="coastline", number="CF-0098812", date="2026-09-22", lines=[
    dict(names=["olive oil pomace blend", "olive oil"], sku="204417", ok=[(2, "case", 48.50)], total=97.00, kind="item"),
    dict(names=["beef tenderloin psmo", "beef tenderloin"], sku="611093",
         ok=[(41.6, "lb", 12.89), (1, "case", 536.22)], total=536.22, kind="item"),
    dict(names=["lemons fancy", "lemons"], sku="300120", ok=[(3, "ea", 0.80), (3, "ea", None)], total=2.40,
         kind="item", computed_price=True),
    dict(names=["tomato diced in juice", "tomato diced"], sku="518800", ok=[(3, "case", 31.75)], total=95.25,
         kind="item"),
    dict(names=["onion yellow jumbo", "onion yellow", "onion"], sku="102230", ok=[(10, "lb", 0.62)], total=6.20,
         kind="item"),
    dict(names=["fuel surcharge"], sku=None, ok=[(1, None, 4.95)], total=4.95, kind="fee"),
    dict(names=["return romaine hearts", "romaine hearts", "romaine"], sku="771054",
         ok=[(-1, "case", 32.10), (1, "case", -32.10), (-1, "case", -32.10)], total=-32.10, kind="credit"),
])


# =============================================================== HOLDOUT SET (never used to tune prompts or checks)
HO = DOC + "/holdout"
HOLDOUT = {
    "h_kanpachi": dict(path=HO + "/kanpachi.txt", type="recipe", src=HO + "/kanpachi.txt", kind="word"),
    "h_leek": dict(path=HO + "/leek.txt", type="recipe", src=HO + "/leek.txt", kind="word"),
    "h_roe": dict(path=HO + "/roe.txt", type="recipe", src=HO + "/roe.txt", kind="word"),
    "h_quail": dict(path=HO + "/quail.docx", type="recipe", src=HO + "/quail.docx.txt", kind="word"),
    "h_vc_event": dict(path=HO + "/vc_event.txt", type="recipe", src=HO + "/vc_event.txt", kind="word"),
    "h_chard": dict(path=HO + "/chard.txt", type="recipe", src=HO + "/chard.txt", kind="word"),
    "h1_template_invoice": dict(path=HO + "/h1_template_invoice.pdf", type="invoice", src=None, kind="invoice"),
    "h2_distributor_invoice": dict(path=HO + "/h2_distributor_invoice.pdf", type="invoice", src=None, kind="invoice"),
    "h3_produce_photo": dict(path=HO + "/h3_produce_photo.jpg", type="invoice", src=None, kind="invoice"),
    "h4_credit_memo": dict(path=HO + "/h4_credit_memo.pdf", type="invoice", src=None, kind="invoice"),
}
CASES.update(HOLDOUT)

R["h_kanpachi"] = dict(recipes=(1, 2), lines=[
    (["soy sauce"], 1 / 3, "cup", ""),
    (["lime juice"], 1 / 3, "cup", ""),
    (["cashew oil"], 1 / 3, "cup", ""),
    (["rice wine vinegar"], 1 / 3, "cup", ""),
    (["scallions", "scallion"], 2, "ea", ""),
    (["garlic"], (2, 4), "clove", ""),
    (["shallots", "shallot"], (2, 4), "ea", ""),
    (["ginger root", "ginger"], 2, "ea", ""),
    (["jalapeno pepper", "jalapeño pepper", "jalapeno"], 2, "ea", ""),
    (["raw kanpachi", "kanpachi"], 1, "lb", "opt"),
    (["taro root"], 1, "ea", "opt"),
    (["black roe", "roe"], 1, "oz", "opt"),
    (["salt"], None, None, "opt"),
    (["pepper", "black pepper"], None, None, "opt"),
    (["fried nori", "nori", "seaweed"], None, None, "opt"),
    (["cashew oil for frying"], None, None, "opt"),
    (["soy-lime vinaigrette", "soy lime vinaigrette", "vinaigrette"], None, None, "opt"),
    (["cucumber and red onion salad"], None, None, "opt"),
], unlisted=[])
R["h_leek"] = dict(recipes=1, lines=[
    (["butter"], 1, "tbsp", ""),
    (["leeks", "leek", "musselburgh leeks"], 2, "ea", ""),
    (["sugar"], 2, "tsp", ""),
    (["eggs", "egg"], 5, "ea", ""),
    (["heavy cream"], 0.5, "cup", ""),
    (["dijon mustard"], 1, "tbsp", ""),
    (["celery salt"], 1, "pinch", "alt_none"),
    (["cayenne pepper", "cayenne"], 1, "pinch", "alt_none"),
    (["basic pie dough", "pie dough"], None, None, "opt"),
    (["caramelized leeks"], None, None, "opt"),
    (["custard"], None, None, "opt"),
], unlisted=["nonstick cooking spray", "cooking spray", "pie weights", "dried beans"])
R["h_roe"] = dict(recipes=(1, 2), lines=[
    (["active dry yeast", "yeast"], 1 / 3, "tsp", ""),
    (["warm milk"], 1 / 3, "cup", ""),
    (["egg", "large egg"], 1, "ea", ""),
    (["sugar"], 2, "tsp", ""),
    (["kosher salt"], 1 / 3, "tsp", ""),
    (["ap flour", "all-purpose flour", "all purpose flour"], 0.5, "cup", ""),
    (["cold whole milk", "whole milk"], 1, "cup", ""),
    (["clarified butter"], 2 / 3, "cup", ""),
    (["smoked whitefish"], 6, "slice", ""),
    (["smoked steelhead"], 6, "slice", ""),
    (["home-cured steelhead", "cured steelhead"], 6, "slice", ""),
    (["sour cream"], None, None, ""),
    (["steelhead roe"], 1, "oz", ""),
    (["chives"], 1 / 3, "bunch", ""),
], unlisted=["buckwheat flour"])
R["h_quail"] = dict(recipes=(1, 2), lines=[
    (["eggs"], 6, "ea", ""),
    (["whole milk"], 10, "cup", ""),
    (["cream"], 4, "cup", ""),
    (["a.p. flour", "ap flour", "flour"], 13, "cup", ""),
    (["clarified butter"], 9, "tbsp", ""),
    (["sesame oil"], 2, "tbsp", ""),
    (["green onions"], 2, "bunch", ""),
    (["salt"], None, None, ""),
    (["white pepper"], None, None, ""),
    (["quail meat", "quail meat shredded"], 1, ("ea", "whole"), ""),
    (["plum sauce"], 1, "oz", ""),
    (["hoisin sauce"], 2, "tbsp", ""),
    (["chopped cilantro", "cilantro"], 1 / 3, "tbsp", ""),
    (["pancake batter"], None, None, "opt"),
    (["quail filling"], None, None, "opt"),
], unlisted=[])
R["h_vc_event"] = dict(recipes=(1, 40), lines=None, unlisted=[])
R["h_chard"] = dict(recipes=(5, 22), lines=None, unlisted=[])
import json as _json
INV.update(_json.load(open(HO + "/gold_invoices.json")))
for _g in INV.values():
    for _l in _g["lines"]:
        _l["ok"] = [tuple(x) for x in _l["ok"]]

# =============================================================== NEW SET (real archive documents; see gold_new.py)
from gold_new import NEW, R as _R_NEW, LONG
CASES.update(NEW)
R.update(_R_NEW)


if __name__ == "__main__":  # writes the case lists for runner.ts (absolute paths for this checkout)
    import json

    def dump(name, cases):
        json.dump([dict(id=k, path=v["path"], type=v["type"]) for k, v in cases.items()],
                  open(os.path.join(DOCS, name), "w"), indent=1)

    dev = {k: v for k, v in CASES.items() if k not in HOLDOUT and k not in NEW}
    dump("cases.json", dev)
    dump("cases_holdout.json", HOLDOUT)
    dump("cases_all.json", {k: v for k, v in CASES.items() if k not in NEW})
    dump("cases_new.json", NEW)  # readers fixed: .xls as converted .xlsx (run with READER_FIX=1)
    json.dump([dict(id=k, path=v["raw"], type=v["type"]) for k, v in NEW.items()],
              open(os.path.join(DOCS, "cases_new_raw.json"), "w"), indent=1)  # the files as received
    missing = [k for k, v in CASES.items() if not os.path.exists(v["path"])]
    print("%d dev + %d held-out + %d new cases written (cases.json, cases_holdout.json, cases_all.json, cases_new.json, "
          "cases_new_raw.json)" % (len(dev), len(HOLDOUT), len(NEW)), "MISSING: %s" % missing if missing else "(all files present)")
