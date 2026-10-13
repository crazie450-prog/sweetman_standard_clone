"""Automatic reference of printed-amount items for the three long documents."""
import re
import score

Q = r"(?:\d+\s+\d/\d|\d+-\d/\d|\d+\s*[½¼¾⅓⅔⅛]|\d*\.?\d+/\d+|\d*\.\d+|\d+|[½¼¾⅓⅔⅛])"
U = (r"(?:cups?|c|tbsp|tablespoons?|tsp|teaspoons?|t|T|oz\.?|ounces?|lbs?\.?|pounds?|quarts?|qts?|pints?|pt|"
     r"gallons?|gal|g|grams?|kg|ml|l|each|ea|bunch(?:es)?|cloves?|slices?|pcs|pc|pieces?|packs?|packets?|bags?|"
     r"bottles?|cases?|flats?|clamshells?|clam shells?|ears?|sticks?|cans?|bones|slice|sprinkle)")
ITEM = re.compile(r"^\s*(" + Q + r")\s*(" + U + r")?\b\.?\s*(.+?)\s*$", re.I)


def parse_item(seg):
    m = ITEM.match(seg)
    if not m:
        return None
    q = score.parse_qty(m.group(1))
    name = re.sub(r"\(.*?\)", "", m.group(3)).strip(" .:-")
    # "Ziplock Bags of Collard Greens" -> "Collard Greens": a container phrase is not part of the ingredient
    name = re.sub(r"^.*?\b(?:bags?|pieces?|ears?|cans?|boxes|box|cases?|packs?|bunch(?:es)?)\s+of\s+", "", name, flags=re.I)
    if q is None or not score.toks(name) or len(name) > 60:
        return None
    return (name, q, score.canon_unit(m.group(2)) if m.group(2) else None, seg)


def ref_text_lists(text):
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.lower().startswith(("step", "place", "preheat", "add", "cook", "set", "remove", "stir",
                                                "bring", "mix", "pound", "now", "allow", "rotate", "flip", "you will")):
            continue
        body = line.split(":", 1)[1] if ":" in line and re.search(r":\s*" + Q, line) else line
        for seg in re.split(r",(?![^()]*\))|\+", body):
            it = parse_item(seg)
            if it:
                out.append(it)
    return out


def ref_bonds(text):
    out = []
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) >= 5 and cols[2].strip() and cols[2].strip().lower() not in ("ingredients",):
            amt = cols[4].strip()
            m = re.match(r"^(" + Q + r")\s*([A-Za-z.]*)", amt)
            if m:
                q = score.parse_qty(m.group(1))
                u = score.canon_unit(m.group(2).rstrip(".")) if m.group(2) else None
                out.append((cols[2].strip(), q, u, line))
    return out


BAD = ("guests", "b&b recipe", "v&c recipe", "batch", "pie per order", "raw pie shells", "morel spice",
       "chanterelle spice", "cinnamon coffee rub", "cocoa chili rub", "turnip and", "cake: see", "of corn",
       "crushed small")
# items hidden by the parsing artefacts above ("5” Raw Pie Shells" is a size, not a count, so it is not an item)
EXTRA = {"bnb_event": [("Morel Powder", 1.0, "qt"), ("Cinnamon Coffee Rub", 1.0, "qt"), ("Turnip", 10.0, "lb"),
                       ("Mustard Greens", 10.0, "lb")],
         "collard": [("Corn", 2.0, "ear")],
         "h_vc_event": [("Chanterelle Powder", 2.0, "qt"), ("Cocoa Chili Rub", 2.0, "qt"), ("Turnip", 14.0, "lb"),
                        ("Mustard Greens", 14.0, "lb")],
         "h_chard": [("Corn", 2.0, "ear")]}


def reference(case):
    src = open(score.SCORE_SRC[case]["src"]).read()
    ref = ref_bonds(src) if case == "bonds_sheet" else ref_text_lists(src)
    ref = [r for r in ref if not any(b in r[0].lower() for b in BAD)]
    return ref + [(n, q, u, n) for (n, q, u) in EXTRA.get(case, [])]


if __name__ == "__main__":
    for c in ("collard", "bnb_event", "bonds_sheet"):
        r = reference(c)
        print("==", c, len(r))
        for x in r: print("   ", x)
