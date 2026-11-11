"""BLIND SET: 25 documents the development team never sees. PRIVATE - do not copy into the shared test repository.

20 real archive files (typed recipes, scanned kitchen pages, two non-recipes) and 5 generated invoices. Same key
format and rules as gold_set3.py. The harness loads this pack when NEXUS_BLIND_PACK points at this folder.
"""
import json, os, sys

PACK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "documents")
from gold_set3 import case  # the shared harness must be on sys.path (it is, when run from there)


def _c(raw, **kw):
    return case(PACK, raw, **kw)


BLIND = {}
R = {}
N = None

BLIND["b_chocolate_chip_cookies"] = _c("CHOCOLATE_CHIP_COOKIES.doc")
R["b_chocolate_chip_cookies"] = dict(recipes=1, lines=[
    (["butter"], 6, "lb", ""), (["granulated sugar"], 72, "oz", "compound"), (["brown sugar"], 72, "oz", "compound"),
    (["vanilla extract", "vanilla"], 6, "tbsp", ""), (["salt"], 1, "tbsp", ""), (["baking soda"], 8, "tsp", "compound"),
    (["eggs"], 24, "ea", ""), (["flour"], 120, "oz", "compound"), (["walnuts/pecans", "walnuts", "pecans"], 6, "lb", ""),
    (["chocolate chips"], 9, "lb", "")], unlisted=[])

BLIND["b_corn_bread"] = _c("CORN_BREAD.doc")
R["b_corn_bread"] = dict(recipes=1, lines=[
    (["butter"], 4, "lb", ""), (["eggs"], 48, "ea", ""), (["honey"], 1.5, "cup", ""), (["ap flour", "flour"], 152, "oz", "compound"),
    (["sugar"], 4, "lb", ""), (["p. milk", "p milk", "powdered milk"], 1, "lb", ""), (["salt"], 3, "oz", ""),
    (["corn meal", "cornmeal"], 40, "oz", "compound"), (["baking powder"], 9, "oz", ""), (["milk"], 1, ("gal", "g"), ""),
    (["jalapenos"], 2, "cup", "")], unlisted=[])

BLIND["b_greek_dressing"] = _c("Dressing_Greek_salad_dressing.xls", kind="sheet")
R["b_greek_dressing"] = dict(recipes=1, lines=[
    (["lemon juice"], 0.5, "cup", ""), (["red wine vinegar"], 0.5, "cup", ""), (["dijon mustard"], 0.5, "cup", ""),
    (["garlic"], 1 / 3, "cup", ""), (["shallots"], 1 / 3, "cup", ""), (["thyme"], 1.5, "tbsp", ""), (["parsley"], 2.5, "tbsp", ""),
    (["dill"], 2.5, "tbsp", ""), (["oregano"], 2.5, "tbsp", ""), (["olive oil"], 2, "cup", ""), (["peanut oil"], 1, "cup", ""),
    (["yogurt"], 1, "cup", ""), (["water"], N, N, "opt"), (["salt"], N, N, ""), (["pepper"], N, N, ""), (["sugar"], N, N, "")],
    unlisted=[])

BLIND["b_hummus_tapenade"] = _c("Hummus.doc")  # two recipes in one file
R["b_hummus_tapenade"] = dict(recipes=(1, 2), lines=[
    (["chick peas", "garbanzos", "chick peas garbanzos"], N, N, "opt"),  # "#10" is a can size, not an amount
    (["tahini"], 3, "cup", ""), (["lemon juice"], 1.5, "cup", ""), (["garlic"], 0.5, "cup", ""),
    (["cumin seed", "cumin"], 0.25, "cup", ""), (["salt"], N, N, ""), (["olive oil"], N, N, ""),
    (["nicoise olives"], 4, "cup", ""), (["kalamata olives"], 4, "cup", ""), (["basil oil"], 1, "cup", ""),
    (["medium garlic cloves", "garlic cloves"], 5, ("ea", "clove"), ""), (["olive oil"], N, N, ""),
    (["basil oil"], N, N, "opt")], unlisted=["water", "bean juices"])

BLIND["b_gumbo"] = _c("GUMBO_Chicken_Sausage.doc")
R["b_gumbo"] = dict(recipes=1, lines=[
    (["flour"], 1, "lb", ""), (["butter"], 1, "lb", ""), (["garlic"], 2, "cup", ""), (["onions"], 3, "cup", ""),
    (["bell peppers"], 2, "cup", ""), (["celery"], 2, "cup", ""),
    (["chicken"], N, N, "opt"),  # printed "1 @ 4 2 #"
    (["chicken stock"], 1, "gal", ""), (["andouille sausage"], 2, "lb", ""), (["tomato paste"], 0.75, "cup", ""),
    (["creole spices", "blackening spices"], N, N, ""), (["bay leaves"], N, N, ""), (["thyme"], N, N, ""),
    (["file powder"], N, N, ""), (["hot sauce"], N, N, ""), (["salt"], N, N, ""), (["pepper"], N, N, "opt"),
    (["sugar"], N, N, ""), (["green onions"], 1, "cup", ""), (["parsley chopped", "parsley"], N, N, "")], unlisted=["rice"])

BLIND["b_corn_salad"] = _c("2017-06-12_Recipe_Corn-Salad.docx")
R["b_corn_salad"] = dict(recipes=(1, 2), lines=[
    (["vinegar rice", "rice vinegar"], 0.5, "cup", ""), (["salt"], 1, "tsp", ""), (["pepper"], 0.5, "tsp", ""),
    (["lemon"], 2, "ea", ""), (["dijon mustard"], 1, "tbsp", ""), (["honey"], 1, "tbsp", ""), (["grape seed oil"], 2, "cup", ""),
    (["shallot"], 0.5, "ea", ""), (["tarragon leaves", "tarragon"], 0.5, "cup", ""), (["corn"], 8, ("ear", "ea"), ""),
    (["heirloom tomatoes"], 10, "ea", ""), (["red onion"], 1, "ea", ""), (["chives"], 0.25, "cup", ""),
    (["salt"], N, N, ""), (["pepper"], N, N, "opt"), (["goat cheese"], 6, "oz", ""),
    (["bacon"], N, N, "opt"), (["prosciutto"], N, N, "opt"), (["vinaigrette"], N, N, "opt")], unlisted=[])

BLIND["b_asian_pesto"] = _c("Asian_Pesto.doc")
R["b_asian_pesto"] = dict(recipes=1, lines=[
    (["thai basil leaves", "thai basil"], 4, "cup", ""), (["cilantro leaves", "cilantro"], 2, "cup", ""),
    (["garlic cloves", "garlic"], 4, ("ea", "clove"), ""), (["toasted pinenuts", "pinenuts", "pine nuts"], 2, "tbsp", ""),
    (["olive oil"], 1, "cup", ""), (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

BLIND["b_crepes"] = _c("CREPES.doc")
R["b_crepes"] = dict(recipes=1, lines=[
    (["all purpose flour", "flour"], 2 / 3, "cup", ""), (["granulated sugar", "sugar"], 0.25, "cup", ""),
    (["ground ginger", "ginger"], 2, "tsp", ""), (["salt"], 0.25, "tsp", ""), (["milk"], 54, "tsp", "compound"),  # 1 cup + 2 Tbl.
    (["eggs"], 4, "ea", ""), (["clarified butter"], 5, "tbsp", "")], unlisted=[])

BLIND["b_cherry_glaze"] = _c("Glaze_cherry.xls", kind="sheet")
R["b_cherry_glaze"] = dict(recipes=1, lines=[
    (["port"], 1, ("gal", "g"), ""), (["dried cherry"], 1, "lb", ""), (["chicken stock"], 4, "cup", ""),
    (["balsamic"], 2, "cup", ""), (["brown sugar"], 0.5, "cup", ""), (["cinnamon"], 2, ("stick", "ea"), ""),
    (["clove"], 10, "ea", "")], unlisted=[])

BLIND["b_basil_aioli"] = _c("AIOLI_BASIL_.docx")
R["b_basil_aioli"] = dict(recipes=1, lines=[
    (["water"], 0.5, "gal", ""), (["salt"], 1, "tbsp", ""), (["basil fresh", "basil"], 0.5, "lb", ""),
    (["o.v. blend", "ov blend", "blend"], 2, "oz", ""), (["mayonnaise"], 30, "oz", "")], unlisted=[])

BLIND["b_turkey_brine"] = _c("Brine_Turkey.doc")
R["b_turkey_brine"] = dict(recipes=1, lines=[
    (["water"], 3, "gal", ""), (["red vinegar"], 3, "cup", ""), (["coarse sea salt"], 1.5, "cup", ""),
    (["kosher salt"], 1.5, "cup", ""), (["white onions"], 8, "ea", ""), (["celery"], 0.5, "bunch", ""), (["carrots"], 2, "ea", ""),
    (["garlic cloves", "garlic"], 1, "cup", ""), (["black peppercorns"], 0.5, "cup", ""), (["bay leaves"], 10, "ea", ""),
    (["juniper"], 0.125, "cup", ""), (["thyme"], 1, "bunch", ""), (["rosemary"], 1, "bunch", ""), (["parsley"], 1, "bunch", ""),
    (["mustard seed"], 1, "cup", ""), (["cloves", "whole cloves"], 0.125, "cup", ""), (["allspice"], 0.25, "cup", ""),
    (["coriander"], 2, "cup", "")], unlisted=[])

BLIND["b_shaking_beef"] = _c("2016-02-08_Recipe_Shaking-Beef.docx")
R["b_shaking_beef"] = dict(recipes=1, lines=[
    (["boneless beef sirloin", "beef sirloin", "beef"], 2, "lb", ""), (["garlic cloves", "garlic"], 10, ("ea", "clove"), ""),
    (["shallot"], 1, "ea", ""), (["maggi seasoning or soy sauce", "maggi seasoning"], 1, "tbsp", ""), (["sugar"], 2, "tbsp", ""),
    (["fish sauce"], 0.25, "cup", ""), (["sea salt"], 1, "tsp", ""), (["black pepper"], 2, "tbsp", "")], unlisted=["cornstarch"])

BLIND["b_pico_de_gallo"] = _c("Pico_De_Gallo.doc")
R["b_pico_de_gallo"] = dict(recipes=1, lines=[
    (["roma tomatoes"], 2, "ea", ""), (["jalapeno"], 1, "ea", ""), (["red onion"], 0.5, "ea", ""),
    (["lime juiced", "lime juice", "lime"], 1, "ea", ""), (["cilantro"], N, N, ""), (["salt"], N, N, ""), (["sugar"], N, N, "")],
    unlisted=[])

BLIND["b_carrot_mary"] = _c("Carrot_mary_base.xls", kind="sheet")
R["b_carrot_mary"] = dict(recipes=1, lines=[
    (["red onion"], 2, "ea", ""), (["kerby cucumbers", "kirby cucumbers"], 6, "ea", ""), (["jalapeno"], 1, "ea", ""),
    (["parsley"], 0.5, "bunch", ""), (["horseradish"], 2, "tbsp", ""), (["tabasco"], 2, "tbsp", ""),
    (["orange juice"], 4, "cup", ""), (["tomato juice"], 4, "cup", ""), (["lemon juice"], 0.5, "cup", ""),
    (["fleur de sel"], 3, "tbsp", "")], unlisted=[])

BLIND["b_blackening_spice"] = _c("Blackening_Spice.doc")  # names only
R["b_blackening_spice"] = dict(recipes=1, lines=[(([n] if isinstance(n, str) else n), N, N, "") for n in (
    "cumin", "coriander", ["black pepper corns", "black peppercorns"], "fennel seed", "mustard seed", "paprika", "cayenne",
    "garlic salt", "salt", "sugar", "allspice", "cloves", ["fresh rosemary", "rosemary"], "thyme", "oregano")], unlisted=[])

BLIND["b_scan_mustard_vinaigrette"] = _c("scan_sauce_p4.jpg", kind="photo", photo=True)
R["b_scan_mustard_vinaigrette"] = dict(recipes=1, lines=[
    (["grain mustard"], 3, "cup", ""), (["dijon mustard"], 2, "cup", ""), (["white balsamic vinegar"], 6, "cup", ""),
    (["blended olive oil", "olive oil"], 8, "cup", ""), (["honey"], 8, "tbsp", ""), (["sugar"], 8, "tbsp", ""),
    (["chopped chives", "chives"], 8, "tbsp", ""), (["salt"], N, N, ""), (["pepper"], N, N, "opt")], unlisted=[])

BLIND["b_scan_coconut_curry"] = _c("scan_fleet_p8.pdf", kind="photo", photo=True)
R["b_scan_coconut_curry"] = dict(recipes=1, lines=[
    (["cream friche", "creme fraiche"], 3, "qt", ""), (["dijon mustard"], 1, "cup", ""), (["green curry paste"], 4, "tbsp", ""),
    (["curry powder"], 4, "tbsp", ""), (["coconut milk"], 10, "can", ""), (["ginger"], 6, ("inch", "inche", "in"), ""),
    (["lemon grass", "lemongrass"], 4, ("stalk", "ea"), ""), (["cilantro"], 1, "bunch", ""),
    (["salt"], 1, "ea", "alt_none"), (["pepper"], 1, "ea", "opt")], unlisted=[])

BLIND["b_scan_mashed_potatoes"] = _c("scan_fleet_p4.jpg", kind="photo", photo=True)
R["b_scan_mashed_potatoes"] = dict(recipes=1, lines=[
    (["baking potatoes", "potatoes"], 15, "ea", ""), (["cubed butter", "butter"], 2, "lb", ""), (["hot cream", "cream"], 2, "cup", ""),
    (["salt"], 1, "ea", "alt_none"), (["water"], N, N, "opt")], unlisted=[])  # water is printed "1-1/2x"

BLIND["b_trap_dining_room_menu"] = _c("2019-06-07_Menu_Paramount-DiningRoom.docx", kind="trap")
BLIND["b_trap_equipment_inventory"] = _c("2016-03-03_Telluride-Inventory.xlsx", kind="trap")
for _k in ("b_trap_dining_room_menu", "b_trap_equipment_inventory"):
    R[_k] = dict(recipes=(0, 1), lines=[], unlisted=[])

BLIND["b_inv_meat"] = _c("inv_atlantic_meat.pdf", kind="invoice", typ="invoice")
BLIND["b_inv_credit"] = _c("inv_sierra_credit.pdf", kind="invoice", typ="invoice")
BLIND["b_inv_mushroom_photo"] = _c("inv_hillside_photo.jpg", kind="invoice", typ="invoice", photo=True)
BLIND["b_inv_import_docx"] = _c("inv_olive_branch.docx", kind="invoice", typ="invoice")
BLIND["b_inv_drygoods_xlsx"] = _c("inv_coastal_dry_goods.xlsx", kind="invoice", typ="invoice")
INV = json.load(open(os.path.join(PACK, "gold_invoices.json")))
