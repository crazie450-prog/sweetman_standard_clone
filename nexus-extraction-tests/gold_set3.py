"""SET 3: 53 more documents, added November 2026 for the shared test repository.

48 real files from the owner's archive (typed Word and Excel recipes, scanned kitchen recipe pages, a photo of a
product label, two non-recipes) and 5 generated invoices (tools/gen_invoices_set3.py). No file carries a
confidentiality notice. Keys were written from the documents before any model read them.

Line format as in gold.py / gold_new.py: (names, qty, unit, flags); flags "opt", "alt_none", "compound".
An amount the document prints ambiguously is "opt": it is not scored either way.
"""
import json, os

PACK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "documents", "set3")


def case(pack, raw, kind="word", typ="recipe", photo=False):
    stem, ext = os.path.splitext(raw)
    conv = os.path.join(pack, "conv", stem + ".xlsx")
    fixed = os.path.join(pack, "fixed", stem + ".txt")
    c = dict(path=conv if ext.lower() == ".xls" else os.path.join(pack, "raw", raw), raw=os.path.join(pack, "raw", raw),
             type=typ, kind=kind, src=fixed if os.path.exists(fixed) else None)
    if photo:  # scans and photos: the transcript is the scoring source, but a pipeline has no text to check against
        c["check_src"] = None
    return c


def _c(raw, **kw):
    return case(PACK, raw, **kw)


SET3 = {}
R = {}
N = None  # no amount printed

SET3["s_whipped_cream"] = _c("Whipped_Cream.doc")
R["s_whipped_cream"] = dict(recipes=1, lines=[
    (["heavy whipping cream"], 16, "oz", ""), (["sugar"], 1, "tbsp", "")], unlisted=[])

SET3["s_fried_chicken"] = _c("Fried_Chicken.doc")  # a list of names, no amounts
R["s_fried_chicken"] = dict(recipes=1, lines=[(([n], N, N, "")) for n in (
    "buttermilk", "onion", "sage", "cayenne", "salt", "duck fat", "peanut oil", "flour", "garlic powder", "onion powder",
    "celery salt")], unlisted=[])

SET3["s_balsamic_vinaigrette"] = _c("Balsamic_Vinaigrette.doc")
R["s_balsamic_vinaigrette"] = dict(recipes=1, lines=[
    (["olive oil"], 30, "tsp", "compound"),  # 1/2 c plus 2 Tbsp
    (["balsamic vinegar"], 1 / 3, "cup", ""), (["minced shallots", "shallots"], 1, "tbsp", ""),
    (["minced marjoram", "marjoram"], 1, "tsp", "")], unlisted=[])

SET3["s_texas_toast"] = _c("Texas_Toast.doc")
R["s_texas_toast"] = dict(recipes=1, lines=[
    (["italian bread", "slices of italian bread"], N, N, "opt"),  # "3/4 inch thick slices" is a size
    (["minced garlic", "garlic"], 4, "tbsp", "")], unlisted=["oil"])

SET3["s_aioli_chili"] = _c("AIOLI_CHILI_.docx")
R["s_aioli_chili"] = dict(recipes=1, lines=[
    (["mayonnaise"], 3, "cup", ""), (["sriracha"], 1, "cup", ""), (["sesame oil"], 2, "tsp", ""), (["sugar"], 1, "tsp", "")],
    unlisted=[])

SET3["s_brioche"] = _c("BRIOCHE.doc")
R["s_brioche"] = dict(recipes=1, lines=[
    (["a.p. flour", "ap flour", "flour"], 10 / 3, "cup", ""), (["pastry flour"], 0.5, "cup", ""),
    (["granulated sugar", "sugar"], 0.25, "cup", ""), (["table salt", "salt"], 2, "tsp", ""), (["yeast"], 0.6, "oz", ""),
    (["eggs", "large eggs"], 5, "ea", ""), (["cold water", "water"], 0.25, "cup", ""), (["soft butter", "butter"], 7, "oz", "")],
    unlisted=[])

SET3["s_demi"] = _c("Demi.xls", kind="sheet")
R["s_demi"] = dict(recipes=1, lines=[
    (["veal bones"], 50, "lb", ""), (["carrots"], 5, "lb", ""), (["celery"], 5, "lb", ""), (["onion"], 10, "lb", ""),
    (["red wine"], 15, "l", ""), (["port wine"], 5, "l", "")], unlisted=[])

SET3["s_pad_thai_1"] = _c("Pad_thai_sauce_1.xls", kind="sheet")
R["s_pad_thai_1"] = dict(recipes=1, lines=[
    (["ketchup"], 3, "cup", ""), (["lime juice"], 1, "cup", ""), (["tamarind paste"], 1, "cup", ""), (["paprika"], 1, "tbsp", ""),
    (["palm sugar"], 2.5, "cup", ""), (["salt"], 0.25, "cup", "")], unlisted=[])

SET3["s_dijonnaise"] = _c("Dijonnaise.xls", kind="sheet")
R["s_dijonnaise"] = dict(recipes=1, lines=[
    (["mayonnaise"], 3, "cup", ""), (["dijon"], 0.5, "cup", ""), (["whole grain mustard"], 0.5, "cup", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_ponzu"] = _c("Ponzu_wasabi-yuzu_ponzu.xls", kind="sheet")
R["s_ponzu"] = dict(recipes=1, lines=[
    (["yuzu zest"], 2, "ea", ""), (["fresh wasabi"], 0.25, "cup", ""), (["powder wasabi paste", "wasabi paste"], 0.25, "cup", ""),
    (["yuzu juice"], 1, "cup", ""), (["soy sauce"], 1, "cup", ""),
    (["pickled ginger vinrgar", "pickled ginger vinegar"], 0.25, "cup", ""), (["sesame oil"], 2, "tsp", "")], unlisted=[])

SET3["s_brine_pork"] = _c("2025-01-03_Recipe_Brine.docx")
R["s_brine_pork"] = dict(recipes=1, lines=[
    (["water"], 5, "gal", ""), (["kosher salt"], 2, "cup", ""), (["whole black pepper", "black pepper"], 1, "cup", ""),
    (["bay leaves"], 0.5, "cup", ""), (["thyme sprigs", "thyme"], 3, "cup", "")], unlisted=[])

SET3["s_cesar_dressing"] = _c("Cesar_Dressing.doc")
R["s_cesar_dressing"] = dict(recipes=1, lines=[
    (["anchovy paste"], 0.25, (None, "cup"), ""),  # unit missing in the document
    (["egg"], 1, "ea", ""), (["olive oil"], 1, "cup", ""), (["parmesan cheese", "parmesan"], 1, "cup", ""),
    (["lemon juice"], 0.25, "cup", ""), (["red wine vinegar"], (2, 3), "tbsp", ""),
    (["garlic clove", "garlic"], 1, ("ea", "clove"), ""), (["worcestershire"], 0.5, "tsp", ""),
    (["dry mustard"], 0.5, "tsp", "opt"), (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

SET3["s_russian_dressing"] = _c("Dressing_Russian_dressing.xls", kind="sheet")
R["s_russian_dressing"] = dict(recipes=1, lines=[
    (["mayonaise", "mayonnaise"], 1, "gal", ""), (["ketchup"], 6, "cup", ""), (["horseradish"], 2, "tbsp", ""),
    (["pickles"], 2, "cup", ""), (["parsley"], 1, "cup", ""), (["onion powder"], 2, "tbsp", ""), (["sugar"], 2, "tbsp", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_cocktail_sauce"] = _c("Cocktail_Sauce09.doc")
R["s_cocktail_sauce"] = dict(recipes=1, lines=[
    (["orange juice"], 4, "oz", ""), (["lemon juice"], 2, "oz", ""), (["lime juice"], 2, "oz", ""), (["ketchup"], 3, "cup", ""),
    (["maggie seasoning", "maggi seasoning"], 0.25, "tsp", ""), (["horseradish"], 0.25, "cup", ""),
    (["worcestershire sauce"], 0.25, "cup", ""), (["sugar"], 0.5, "cup", ""), (["salt"], 1, "tbsp", "")], unlisted=[])

SET3["s_clarified_butter"] = _c("Clarified_Butter.docx")
R["s_clarified_butter"] = dict(recipes=1, lines=[(["butter"], 5, "lb", "")], unlisted=[])

SET3["s_cilantro_mint_chutney"] = _c("CHUTNEY_CILANTRO_MINT.docx")
R["s_cilantro_mint_chutney"] = dict(recipes=1, lines=[
    (["garlic cloves", "garlic"], 3, ("ea", "clove"), ""), (["mint"], 1.5, "cup", ""), (["cilantro"], 2, "cup", ""),
    (["yogurt"], 4, "oz", ""), (["honey"], 1, "oz", ""), (["cayenne"], 0.25, "tsp", ""), (["cumin"], 1, "tsp", ""),
    (["coriander"], 1, "tsp", ""), (["fenugreek"], 1, "tsp", ""), (["coconut milk"], 0.5, "can", ""),
    (["salt"], N, N, ""), (["black pepper"], N, N, ""), (["sugar"], N, N, "")], unlisted=[])

SET3["s_banana_cream_pie"] = _c("Banana_Cream_Pie.doc")
R["s_banana_cream_pie"] = dict(recipes=1, lines=[
    (["pastry cream"], 4, "cup", ""), (["banana puree"], 4, "cup", ""), (["whipped heavy cream"], 10, "cup", ""),
    (["heated heavy cream"], 2, "cup", ""), (["sheets of gelatin", "gelatin"], 17, ("ea", "sheet"), "")], unlisted=[])

SET3["s_coleslaw"] = _c("2017-06-12_Recipe_KFC-Cole-Slaw.docx")  # name first, amount after
R["s_coleslaw"] = dict(recipes=1, lines=[
    (["savoy cabbage", "cabbage"], (8, 1), ("cup", "head"), ""), (["carrot"], 0.25, "cup", ""), (["onion"], 2, "tbsp", ""),
    (["sugar"], 1 / 3, "cup", ""), (["salt"], 0.5, "tsp", ""), (["pepper"], 0.25, "tsp", ""), (["poppy seeds"], 2, "tsp", ""),
    (["vinegar white", "white vinegar"], 2, "tbsp", ""), (["lemon juice"], 2, "tbsp", ""), (["buttermilk"], 0.5, "cup", ""),
    (["mayonnaise"], 0.5, "cup", "")], unlisted=[])

SET3["s_beurre_monte"] = _c("BUERRE_MONTE_.docx")  # prose only, no amounts
R["s_beurre_monte"] = dict(recipes=(0, 1), lines=[(["water"], N, N, "opt"), (["butter"], N, N, "opt")], unlisted=[])

SET3["s_pesto_arugula"] = _c("Pesto_Arugula.xls", kind="sheet")
R["s_pesto_arugula"] = dict(recipes=1, lines=[
    (["olive oil"], 3, "cup", ""), (["parsley"], 5, "bunch", ""), (["arugula"], 6, "cup", ""),
    (["chili flake"], 1, "tsp", ""), (["lemon juice"], 1, ("ea", "lemon"), ""),
    (["s & p", "salt and pepper", "salt"], N, N, "opt")], unlisted=["salt", "pepper"])

SET3["s_steak_seasoning"] = _c("2020-05-25_Recipe_Steak-Seasoning-Salt.docx")
R["s_steak_seasoning"] = dict(recipes=1, lines=[
    (["sel gris"], 3, "cup", ""), (["granulated garlic"], 2, "cup", ""), (["granulated onion"], 2, "cup", ""),
    (["black pepper"], 1, "cup", ""), (["celery seed"], 2, "tbsp", ""), (["sweet paprika", "paprika"], 1, "tbsp", "")],
    unlisted=[])

SET3["s_cognac_sauce"] = _c("Cognac_sauce-_lobster.xls", kind="sheet")
R["s_cognac_sauce"] = dict(recipes=1, lines=[
    (["garlic cloves", "garlic"], 3, ("ea", "clove"), ""), (["mushrooms"], 3, "lb", ""), (["butter"], 1, "lb", ""),
    (["sherry"], 1, "cup", ""), (["cognac"], 1, "cup", ""), (["cream"], 2, "cup", "")], unlisted=["salt", "pepper"])

SET3["s_remoulade"] = _c("Remoulade.xls", kind="sheet")
R["s_remoulade"] = dict(recipes=1, lines=[
    (["mayonnaise"], 3, "cup", ""), (["capers"], 0.5, "cup", ""), (["house made pickle", "pickle"], 0.25, "cup", ""),
    (["tomato"], 1, "cup", ""), (["garlic"], 1, "tbsp", ""), (["caper juice"], 2, "tbsp", ""), (["paprika"], 1, "tbsp", ""),
    (["sugar"], 1, "tbsp", ""), (["zest from lemon", "lemon zest"], 1, "ea", ""), (["parsley"], 2, "tbsp", ""),
    (["salt"], N, N, ""), (["cracked black pepper", "black pepper"], N, N, "")], unlisted=[])

SET3["s_melted_leeks"] = _c("Leeks_Melted_Leeks.docx")
R["s_melted_leeks"] = dict(recipes=1, lines=[
    (["leeks"], 2, "ea", ""), (["butter"], 2, "tbsp", ""), (["blanching water", "water"], N, N, "opt"),
    (["chicken stock"], 0.5, "cup", ""), (["salt"], 1, "pinch", "alt_none")], unlisted=[])

SET3["s_sherry_vinaigrette"] = _c("AGED_SHERRY_VINAIGRETTE.doc")
R["s_sherry_vinaigrette"] = dict(recipes=1, lines=[
    (["pasteurized eggs", "eggs"], 2, "oz", ""), (["aged sherry vinegar", "sherry vinegar"], 2, "oz", ""),
    (["canola oil"], 8, "oz", ""), (["dijon mustard"], 2, "tsp", ""), (["sugar"], 1, "tsp", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

SET3["s_salmon_order"] = _c("Alaska_Salmon.docx")  # name first, amount after, no unit column
R["s_salmon_order"] = dict(recipes=1, lines=[
    (["salmon"], 50, "lb", ""), (["smoked salmon"], 1, ("ea", "side"), ""), (["oranges"], 6, "ea", ""),
    (["lemons"], 12, "ea", ""), (["limes"], 6, "ea", ""), (["grapefruit"], 1, "ea", ""), (["honey"], 3, "lb", ""),
    (["kosher salt"], 3, "lb", ""), (["wood chips"], 5, "lb", ""), (["horseradish"], 1, "qt", ""), (["panko"], 6, "lb", ""),
    (["butter"], 20, "lb", ""), (["mustard seeds"], 1, "lb", ""), (["apple cider vinegar"], 1, "gal", ""),
    (["brown sugar"], 3, "lb", ""), (["baby red beets"], 50, "ea", ""), (["baby gold beets"], 50, "ea", ""),
    (["baby heirloom carrots"], 50, "ea", ""), (["dill"], 2, "bunch", "")],
    unlisted=["pickled mustard seeds", "root vegetables", "rye sauce", "horseradish crust"])

SET3["s_goat_cheese_ranch"] = _c("Dressing_goat_cheese_ranch.xls", kind="sheet")
R["s_goat_cheese_ranch"] = dict(recipes=1, lines=[
    (["buttermilk"], 0.5, ("gal", "g"), ""), (["goat cheese"], 4, "lb", ""), (["mayonnaise"], 0.5, ("gal", "g"), ""),
    (["marjoram"], 0.5, "cup", ""), (["parsley"], 0.5, "cup", ""), (["chives"], 0.25, "cup", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_black_bean_deglaze"] = _c("SAUCE_BLACK_BEAN_.docx")
R["s_black_bean_deglaze"] = dict(recipes=1, lines=[
    (["sugar"], 0.5, "cup", ""), (["garlic chili sauce"], 2, "oz", ""), (["soy"], 0.5, "cup", ""),
    (["rice vinegar"], 0.25, "cup", ""), (["chicken stock"], 4, "cup", ""), (["mush soy", "mushroom soy"], 2, "oz", ""),
    (["sake", "sake rice wine"], 1.5, "bottle", ""), (["fermented black bean", "black bean"], 0.25, "cup", "")], unlisted=[])

SET3["s_parsnip_puree"] = _c("ParsnipPuree.doc")
R["s_parsnip_puree"] = dict(recipes=1, lines=[
    (["parsnips"], 5, "lb", ""), (["yukon potatoes", "potatoes"], 2, "lb", ""), (["water"], 18, "cup", ""),
    (["salt"], 0.25, "cup", ""), (["white pepper"], 0.25, "tsp", ""), (["butter"], 1, "cup", ""), (["cream"], 4, "cup", ""),
    (["thyme"], 2, "tbsp", ""), (["sugar"], N, N, "")], unlisted=[])

SET3["s_potato_puree"] = _c("PotatoPuree.doc")
R["s_potato_puree"] = dict(recipes=1, lines=[
    (["peeled yukon gold potatoes", "yukon gold potatoes", "potatoes"], 10, "lb", ""), (["butter"], 2, "cup", ""),
    (["creme fraiche", "crème fraiche"], 2, "cup", ""), (["heavy cream"], 2, "cup", ""), (["salt"], N, N, ""),
    (["chopped parsley", "parsley"], N, N, "")], unlisted=["water"])

SET3["s_romesco"] = _c("Romesco.xls", kind="sheet")
R["s_romesco"] = dict(recipes=1, lines=[
    (["red bell peppers"], 1 / 3, "pan", ""), (["yellow bell peppers"], 1 / 3, "pan", ""), (["white onion"], 1 / 6, "pan", ""),
    (["garlic"], 0.5, "cup", ""), (["fennel seed"], 3, "tbsp", ""), (["almond slivers", "almonds"], 2, "cup", ""),
    (["sugar"], 2, "tbsp", ""), (["white balsamic"], 4, "tbsp", ""), (["salt"], N, N, ""), (["pepper"], N, N, ""),
    (["olive oil"], 3, "tbsp", "")], unlisted=[])

SET3["s_apple_quince_chutney"] = _c("Apple_and_Quince_Chutney.doc")
R["s_apple_quince_chutney"] = dict(recipes=1, lines=[
    (["quince paste"], 2, "lb", ""), (["quince apple"], 1.5, "lb", ""), (["raisins"], 8, "oz", ""),
    (["white wine"], 0.5, "cup", ""), (["vinegar"], 0.25, "cup", ""), (["granulated sugar", "sugar"], 0.25, "cup", ""),
    (["grated orange zest and juice", "orange zest and juice", "orange"], 1, "ea", ""), (["salt"], N, N, ""),
    (["pepper"], N, N, "opt"), (["fresh thyme", "thyme"], N, N, ""), (["fresh sage", "sage"], N, N, "")],
    unlisted=["olive oil", "granny smith", "orange juice", "orange zest"])

SET3["s_chicken_noodle_soup"] = _c("Chicken_Noodle_Soup.docx")
R["s_chicken_noodle_soup"] = dict(recipes=1, lines=[
    (["chicken stock"], 2, "gal", ""), (["onion", "medium dice onion"], 3, "cup", ""), (["celery", "medium dice celery"], 2, "cup", ""),
    (["carrot", "medium dice carrot"], 2, "cup", ""),
    (["thyme"], 1, "bunch", ""), (["crushed garlic", "garlic"], 6, "ea", ""), (["bay leaves"], 3, "ea", ""),
    (["peppercorns"], 10, "ea", ""),  # one printed "Sachet" line holding four ingredients
    (["chickens", "chicken"], 3, "ea", ""),
    (["sachet"], N, N, "opt"), (["picked chicken"], 2, "oz", "opt"), (["cooked noodle", "noodle"], 1.5, "oz", "opt")],
    unlisted=["oil", "olive oil", "low mein noodles", "noodles", "parsley stems", "parsley"])

SET3["s_blue_cheese_sauce"] = _c("Blue_cheese_sauce.xls", kind="sheet")
R["s_blue_cheese_sauce"] = dict(recipes=1, lines=[
    (["butter"], 1, "lb", ""), (["flour"], 1, "cup", ""), (["whole milk", "milk"], 1, "gal", ""),
    (["creme fraiche", "crème fraiche"], 3, "cup", ""), (["maytag blue cheese", "blue cheese"], 3, "lb", ""),
    (["chives"], 0.25, "cup", ""), (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_lemon_aioli"] = _c("Aioli_lemon_aioli.xls", kind="sheet")
R["s_lemon_aioli"] = dict(recipes=1, lines=[
    (["garlic"], 2, "clove", ""), (["egg yolk"], 3, "ea", ""), (["lemon juice"], 0.25, "cup", ""),
    (["olive oil blend", "olive oil"], 2, "cup", ""), (["cool water", "water"], 4, "tbsp", ""),
    (["zest from one lemon", "lemon zest"], 1, "ea", "alt_none"),  # printed "l ea" with a letter l
    (["dijon"], 1, "tsp", ""), (["parsley"], 1, "tbsp", ""), (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_artichoke_puree"] = _c("ArtichokePuree.doc")
R["s_artichoke_puree"] = dict(recipes=1, lines=[
    (["jumbo artichokes", "artichokes"], 8, "ea", ""), (["butter"], 3, "tbsp", ""), (["heavy cream", "cream"], N, N, ""),
    (["salt"], N, N, "")], unlisted=["curry powder", "garam masala", "choke puree", "cream"])

SET3["s_cocktail_sauce_wp"] = _c("Cocktail_sauce.xls", kind="sheet")
R["s_cocktail_sauce_wp"] = dict(recipes=1, lines=[
    (["ketchup"], 3, "cup", ""), (["horseradish"], 0.5, "cup", ""), (["worchestershire", "worcestershire"], 0.25, "cup", ""),
    (["lemon juice"], 4, "tbsp", ""), (["sugar"], 0.5, "tsp", ""), (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

SET3["s_mustard_sauce"] = _c("Mustard_sauce.xls", kind="sheet")
R["s_mustard_sauce"] = dict(recipes=1, lines=[
    (["shallots"], 1, "cup", ""), (["thyme"], 3, ("sprig", "ea"), ""), (["bay leaf"], 1, "ea", ""),
    (["white peppercorns"], 12, "ea", ""), (["white wine"], 4, "cup", ""), (["white port"], 1, "cup", ""),
    (["brandy"], 0.5, "cup", ""), (["chicken stock"], 1, ("gal", "g"), ""), (["heavy cream"], 0.5, ("gal", "g"), ""),
    (["veal demi"], 2, "cup", ""), (["dijon"], 4, "tbsp", ""), (["wholegrain mustard", "whole grain mustard"], 4, "tbsp", ""),
    (["butter"], 0.25, "lb", ""), (["sugar"], 1, "tsp", ""), (["salt"], N, N, ""), (["pepper"], N, N, "")], unlisted=[])

# ---------------------------------------------------------------- scanned kitchen recipe pages and a photo
SET3["s_scan_lobster_stock"] = _c("scan_lobster_stock.pdf", kind="photo", photo=True)
R["s_scan_lobster_stock"] = dict(recipes=1, lines=[
    (["cleaned lobster heads", "lobster heads"], 30, "lb", ""), (["diced onions", "onions"], 2, "qt", ""),
    (["celery"], 2, "qt", ""), (["chopped leeks", "leeks"], 2, "qt", ""), (["carrots"], 2, "qt", ""),
    (["tomato paste"], 3, "qt", ""), (["parsley leaves", "parsley"], 1, "bunch", ""), (["bay leaves"], 5, "ea", ""),
    (["whole black peppercorn", "black peppercorn"], 0.5, "cup", ""), (["chicken stock"], 6, "qt", ""), (["water"], 60, "qt", "")],
    unlisted=["olive oil"])

SET3["s_scan_fish_batter"] = _c("scan_sauce_p3.jpg", kind="photo", photo=True)
R["s_scan_fish_batter"] = dict(recipes=1, lines=[
    (["fry flour", "flour"], 8, "cup", ""), (["cold soda water", "soda water"], 5, "cup", ""), (["salt"], N, N, "")], unlisted=[])

SET3["s_scan_louie_dressing"] = _c("scan_sauce_p5.pdf", kind="photo", photo=True)
R["s_scan_louie_dressing"] = dict(recipes=1, lines=[
    (["ketchup"], 1, "qt", ""), (["chili sauce"], 1, "cup", ""), (["mayonnaise"], 2, "cup", ""), (["dill relish"], 2, "cup", ""),
    (["lemon juice"], 0.5, "ea", ""),  # no unit printed
    (["onion powder"], 4, "tbsp", ""), (["fine diced red onion", "red onion"], 1, "cup", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

SET3["s_scan_baby_artichokes"] = _c("scan_sauce_p6.jpg", kind="photo", photo=True)
R["s_scan_baby_artichokes"] = dict(recipes=1, lines=[
    (["baby artichokes"], 0.5, "case", ""), (["cold water", "water"], 4, "qt", ""), (["parsley"], 0.5, "bunch", ""),
    (["thyme sprigs", "thyme"], 0.5, "cup", ""), (["black peppercorns"], 1, "tbsp", ""), (["bay leaves"], 3, "ea", ""),
    (["white wine"], 3, "cup", ""), (["chopped garlic", "garlic"], 0.5, "cup", ""), (["chopped carrot", "carrot"], 2, "cup", ""),
    (["chopped white onion", "white onion"], 6, "cup", ""), (["celery"], 2, "cup", ""), (["chopped fennel", "fennel"], 2, "cup", ""),
    (["extra virgin olive oil"], 0.75, "cup", ""), (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

SET3["s_scan_fingerling_potatoes"] = _c("scan_fleet_p2.pdf", kind="photo", photo=True)
R["s_scan_fingerling_potatoes"] = dict(recipes=1, lines=[
    (["fingerling potatoes"], 8, "qt", ""), (["fresh rosemary", "rosemary"], 6, ("sprig", "ea"), ""),
    (["garlic cloves", "garlic"], 6, ("ea", "clove"), ""), (["extra virgin olive oil"], 0.25, "cup", ""),
    (["salt"], 1, "ea", "alt_none")], unlisted=["water"])

SET3["s_scan_maui_onions"] = _c("scan_fleet_p3.jpg", kind="photo", photo=True)
R["s_scan_maui_onions"] = dict(recipes=1, lines=[
    (["maui onions"], 20, "ea", ""), (["soy sauce"], 1, "cup", ""), (["olive oil"], 2, "tbsp", ""),
    (["salt"], 1, "ea", "alt_none"), (["pepper"], 1, "ea", "opt")], unlisted=[])

SET3["s_scan_onion_puree"] = _c("scan_fleet_p6.jpg", kind="photo", photo=True)
R["s_scan_onion_puree"] = dict(recipes=1, lines=[
    (["peeled onions", "onions"], 20, "ea", ""), (["fresh thyme", "thyme"], 8, ("sprig", "ea"), ""),
    (["blended olive oil", "olive oil"], 0.25, "cup", ""), (["shallots"], 1, "lb", ""),
    (["salt"], 1, "ea", "alt_none"), (["pepper"], 1, "ea", "opt")], unlisted=[])

SET3["s_photo_miso_label"] = _c("2017-02-05_Recipe_Miso-Dressing.pdf", kind="photo", photo=True)  # prose on a tub lid
R["s_photo_miso_label"] = dict(recipes=(0, 2), lines=[
    (["cold mountain miso", "miso"], 4.5, "tbsp", "opt"), (["honey"], 4.5, "tbsp", "opt"),
    (["rice vinegar or wine vinegar", "rice vinegar"], 3, "tbsp", "opt"), (["mustard"], 3, "tbsp", "opt"),
    (["water"], 0.5, "cup", "opt"), (["miso"], 1, "tsp", "opt")],
    unlisted=["tofu", "sea vegetables", "wakame", "green onions", "lemon peel"])

# ---------------------------------------------------------------- not recipes
SET3["s_trap_legends_menu"] = _c("2014-11-20_Menu_Legends-Dinner.docx", kind="trap")
SET3["s_trap_cioppino_history"] = _c("Cioppino_2013.docx", kind="trap")
for _k in ("s_trap_legends_menu", "s_trap_cioppino_history"):
    R[_k] = dict(recipes=(0, 1), lines=[], unlisted=[])

# ---------------------------------------------------------------- generated invoices (keys from the generator)
SET3["s_inv_seafood"] = _c("inv_pacific_rim_seafood.pdf", kind="invoice", typ="invoice")
SET3["s_inv_dairy"] = _c("inv_sierra_dairy.pdf", kind="invoice", typ="invoice")
SET3["s_inv_farm_photo"] = _c("inv_greenleaf_photo.jpg", kind="invoice", typ="invoice", photo=True)
SET3["s_inv_bakery_xlsx"] = _c("inv_bakers_mill.xlsx", kind="invoice", typ="invoice")
SET3["s_inv_supply_csv"] = _c("inv_metro_supply.csv", kind="invoice", typ="invoice")
INV = json.load(open(os.path.join(PACK, "gold_invoices.json")))
