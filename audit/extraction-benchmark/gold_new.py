"""NEW set: real kitchen documents from the owner's archive (Drive folder sweetman_standard_test_recipes).
Never used to tune prompts, checks or settings. Keys were written from the documents themselves.

Same line format as gold.py: (names, qty, unit, flags). Extra flag:
  "compound" - the printed amount is a sum ("1 lb, 2 oz", "1 T + 2 tsp"); qty/unit hold the total in a
               base unit (oz for weight, tsp for volume) and the scorer compares totals in that base.
"""
import os

ND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "documents", "new")
ND = os.path.normpath(ND)
RAW, CONV, FIX = ND + "/raw/", ND + "/conv/", ND + "/fixed/"


def _c(raw, kind="word", conv=None, typ="recipe"):
    stem = os.path.splitext(raw)[0]
    return dict(path=(CONV + conv) if conv else RAW + raw, raw=RAW + raw, type=typ, src=FIX + "x_" + stem + ".txt",
                kind=kind)


NEW = {}
R = {}

# ---------------------------------------------------------------- legacy Word (.doc)
NEW["n_brisket"] = _c("Texas_Barbecued_Beef_Brisket.doc")
R["n_brisket"] = dict(recipes=(1, 4), lines=[
    (["beef brisket", "brisket"], (1, 10, 12), ("ea", "lb"), ""),
    (["all-south barbecue rub", "barbecue rub"], 2, "cup", ""),
    (["basic all-american barbecue sauce", "barbecue sauce"], 2, "cup", ""),
    (["ground"], 1, "tsp", ""),
    (["chili powder"], 1, "tsp", ""),
    (["lime juice"], 4, "tbsp", ""),
    (["cilantro springs", "cilantro sprigs", "cilantro"], 10, ("ea", "sprig", "spring"), ""),
    (["minced ginger", "ginger"], 2, "tsp", ""),
    (["soy sauce"], 8, "tbsp", ""),
    (["rice wine vinegar"], 4, "tbsp", ""),
    (["sugar"], 2, "tbsp", ""),
    (["sesame oil"], 1, "tbsp", ""),
    (["brown sugar"], 2, "tsp", ""),
    (["pineapple juice"], 4, "tbsp", ""),
    (["dark rum"], 4, "tbsp", ""),
    (["caribbean hot sauce", "hot sauce"], 4, "tbsp", ""),
    (["orange juice", "orange", "juice of orange"], 1, "ea", ""),
    (["allspice"], 1, "pinch", "alt_none"),
], unlisted=[])

NEW["n_tamales"] = _c("Unwrapped_Tamales.doc")
R["n_tamales"] = dict(recipes=1, lines=[
    (["corn", "ears corn", "corn kernels", "earscorn"], (10, 12, 7), ("ea", "ear", "cup"), ""),
    (["corn meal", "cornmeal"], 1, "cup", ""),
    (["butter"], (0.25, 3), ("cup", "tbsp"), ""),
    (["sugar"], 1.5, "tsp", ""),
    (["salt"], 1, "pinch", "alt_none"),
    (["jack cheese"], None, None, ""),
], unlisted=["chili", "chilies", "avocado", "sour cream"])

NEW["n_loup"] = _c("WILD_LOUP_DE_MER_EN_CROUTE.doc")  # prose only: nothing is required
R["n_loup"] = dict(recipes=(0, 2), lines=[
    (["black bass", "skinless black bass"], 8, "oz", "opt"),
    (["cream"], 1, "cup", "opt"),
    (["egg white"], 1, "ea", "opt"),
    (["loup de mer", "skinless loup de mer"], 4, "oz", "opt"),
    (["fish mousse"], 3, "oz", "opt"),
    (["salt"], None, None, "opt"), (["pepper"], None, None, "opt"),
    (["carrot"], None, None, "opt"), (["leeks", "leek"], None, None, "opt"), (["onion"], None, None, "opt"),
    (["celery"], None, None, "opt"), (["black trumpet mushrooms"], None, None, "opt"),
    (["chives"], None, None, "opt"), (["parsley"], None, None, "opt"), (["tarragon"], None, None, "opt"),
    (["dill"], None, None, "opt"), (["puff pastry", "puff pastry sheet"], None, None, "opt"),
    (["egg wash"], None, None, "opt"), (["beurre blanc", "beurre blanc sauce"], None, None, "opt"),
    (["seasonal vegetables"], None, None, "opt"), (["vegetable brunoise"], None, None, "opt"),
], unlisted=[])

NEW["n_tuna_tartare"] = _c("Tuna_Tartare_with_Herb_Salad_and_Ginger_Vinaigrette.doc")
NEW["n_tuna_tartare"]["src"] = FIX + "x_Tuna_Tartare_with_Herb_Salad_and_Ginger_.txt"
R["n_tuna_tartare"] = dict(recipes=(1, 3), lines=[
    (["sushi-grade yellow fin tuna", "yellow fin tuna", "yellowfin tuna", "tuna"], 1, "lb", ""),
    (["shiso leaves", "shiso"], 6, ("ea", "leave", "leaf"), ""),
    (["scallions", "sliced scallions"], 1 / 3, "cup", ""),
    (["ginger vinaigrette"], 0.5, "cup", ""),
    (["coarse salt", "salt"], None, None, ""),
    (["white pepper"], None, None, "opt"),
    (["baby frisee", "frisee"], 1, ("ea", "head"), ""),
    (["chervil leaves", "chervil"], 0.5, "cup", ""),
    (["parsley leaves", "parsley"], 1 / 3, "cup", ""),
    (["cilantro leaves", "cilantro"], 1 / 3, "cup", ""),
    (["dikon sprouts", "daikon sprouts"], 0.25, ("pkg", "pack", "package"), ""),
    (["lime juice"], 1 / 3, "cup", ""),
    (["ginger juice", "fresh ginger juice"], 3, "tbsp", ""),
    (["hot red pepper sauce", "tabasco", "hot sauce"], 0.125, "tsp", ""),
    (["minced shallot", "shallot"], 1, "tbsp", ""),
    (["garlic clove", "garlic"], 1, ("ea", "clove"), ""),
    (["coarse salt", "salt"], None, None, ""),
    (["white pepper"], None, None, "opt"),
], unlisted=[])

NEW["n_tempura"] = _c("Tempura_Batter.doc")
R["n_tempura"] = dict(recipes=(1, 2), lines=[
    (["rice flour"], 0.5, "cup", ""),
    (["cornstarch", "corn starch"], 0.5, "cup", ""),
    (["ice water"], 1, "cup", ""),
    (["ap flour", "a.p. flour", "flour"], 4, "cup", ""),
    (["baking powder"], 2, "tbsp", ""),
    (["soda water"], 5, "cup", ""),
    (["salt"], 1.5, "tbsp", ""),
    (["cayenne", "cayenne pepper"], 2, "tsp", ""),
], unlisted=[])

NEW["n_hash_cakes"] = _c("Corned_Beef_Hash_Cakes.doc")
R["n_hash_cakes"] = dict(recipes=(1, 2), lines=[
    (["corn beef", "corned beef"], 7, "cup", ""),
    (["yukon potatoes", "potatoes"], 5, "cup", ""),
    (["yellow onion", "onion"], 2, "cup", ""),
    (["nutmeg"], None, None, ""),
    (["parsley"], 0.125, "cup", ""),
    (["butter"], 99, "tsp", "compound"),  # 2 cups 3 t
    (["olive oil"], 0.25, "cup", ""),
    (["leeks", "leek"], 2, "bunch", ""),
    (["red wine"], 0.5, "cup", ""),
    (["bearnaise sauce", "béarnaise sauce", "bearnaise"], None, None, ""),
    (["salt"], None, None, ""),
    (["sugar"], None, None, ""),
    (["black pepper", "pepper"], None, None, ""),
], unlisted=["spinach", "eggs", "poached eggs", "peanut oil"])

NEW["n_herb_mayo"] = _c("Herb_Mayonnaise.doc")
R["n_herb_mayo"] = dict(recipes=1, lines=[
    (["mayonnaise"], 2, "cup", ""),
    (["chervil", "chopped chervil"], 1, "tbsp", ""),
    (["parsley", "chopped parsley"], 1, "tbsp", ""),
    (["tarragon", "chopped tarragon"], 1, "tbsp", ""),
    (["chives", "chopped chives"], 1, "tbsp", ""),
    (["salt"], 1, "tsp", ""),
    (["black pepper"], 0.25, "tsp", ""),
    (["sugar"], 0.5, "tbsp", ""),
], unlisted=[])

NEW["n_white_beans"] = _c("White_Beans_with_Roasted_Tomato.doc")
R["n_white_beans"] = dict(recipes=(1, 2), lines=[
    (["dried cannelloni beans", "cannelloni beans", "cannellini beans", "beans"], (1, 2), ("lb", "cup"), ""),
    (["cipolline onion", "cipollini onions", "onion"], 1, "lb", ""),
    (["salt"], 1.5, "tsp", ""),
    (["heirloom tomatoes"], 2, "lb", ""),
    (["cherry tomato", "cherry tomatoes"], 1, "lb", ""),
    (["salt"], 1, "tsp", ""),
    (["extra virgin olive oil", "olive oil"], 0.5, (None, "cup"), ""),  # unit missing in the document
    (["basil", "torn fresh basil"], 0.25, "cup", ""),
], unlisted=[])

NEW["n_stir_fry"] = _c("Stir_Fry_Beef.doc")
R["n_stir_fry"] = dict(recipes=(1, 7), lines=[
    (["filet", "beef filet"], 6, "oz", ""),
    (["beef velvet"], 1.5, "oz", ""),
    (["soy superior", "superior soy"], 1, "cup", ""),
    (["mushroom soy"], 1, "cup", ""),
    (["corn starch", "cornstarch"], 0.75, "cup", ""),
    (["brown sugar"], 1.5, "cup", ""),
    (["chili goop"], 0.75, "cup", ""),
    (["chili oil"], 0.75, "cup", ""),
    (["lee kum kee chili bean sauce", "chili bean sauce"], 0.5, "cup", ""),
    (["house hoisin"], 1 / 3, "cup", ""),
    (["sugar"], 1 / 3, "cup", ""),
    (["rice wine"], 2 / 3, "cup", ""),
    (["double stock"], 2, "cup", ""),
    (["wok sambal"], 2, "tbsp", ""),
    (["soy mix"], 0.25, "cup", ""),
    (["hoisin", "hoisin kcun chin"], 1, "cup", ""),
    (["soy"], 1, "tbsp", ""),
    (["sugar"], 1, "tbsp", ""),
    (["water"], 1, "tbsp", ""),
    (["sweet bean paste"], 1, "tbsp", ""),
    (["rice vinegar"], 2, "tsp", ""),
    (["mala oil"], 0.5, "tsp", ""),
    (["peanut oil"], 1, "cup", ""),
    (["sesame oil"], 1, "cup", ""),
    (["scallion rings", "scallions"], 0.5, "cup", ""),
    (["ginger coins", "ginger coins smashed"], 15, "ea", ""),
    (["szechuan peppercorns"], 2, "tbsp", ""),
    (["red chili flakes"], 2, "tbsp", ""),
    (["kosher salt"], 2, "tsp", ""),
    (["chili pods"], 2, "ea", ""),
    (["hk garlic"], 1, "tbsp", ""),
    (["red fresno", "thinly sliced red fresno"], 1, "tbsp", ""),
    (["scallion baton"], 6, "ea", ""),
    (["red onion julienne", "red onion"], 0.25, "cup", ""),
    (["blanched budding chive", "budding chive"], 6, "ea", ""),
    (["chinese eggplant baton", "chinese eggplant"], 10, "ea", ""),
    (["budding chive tops"], 6, "ea", ""),
    (["yellow chive"], 10, "ea", ""),
    (["green aromatics"], 2, "tsp", ""),
    (["blanched snow peas", "snow peas"], 0.25, "cup", ""),
    (["blanched snap peas", "snap peas"], 0.25, "cup", ""),
    (["ginger", "ginger julienned"], 1, "tsp", ""),
    (["fried baby spinach", "baby spinach"], 4, "cup", ""),
], unlisted=["curry salt", "curry powder", "s&b curry powder", "slurry"])

NEW["n_octopus"] = _c("Salad_Octopus_Salad.doc")
R["n_octopus"] = dict(recipes=(1, 5), lines=[
    (["cooked baby octopus tentacles", "baby octopus tentacles", "baby octopus"], 2.5, "oz", ""),
    (["octopus cooking liquid"], 1, "oz", ""),
    (["garbanzo beans"], 2, "tbsp", ""),
    (["roasted baby carrots"], 1, "tbsp", ""),
    (["garlic"], 0.25, "tsp", ""),
    (["chili flakes"], 1, "pinch", ""),
    (["parsley"], 0.25, "tsp", ""),
    (["basil leaves", "basil"], 2, ("ea", "leave", "leaf"), ""),
    (["confit tomato", "petals of confit tomato"], 3, ("ea", "petal"), ""),
    (["charmoula"], 1, "tsp", ""),
    (["tuscan evo", "evo"], 5, "tsp", "compound"),  # 1 T + 2 tsp
    (["lemon", "wedge of lemon"], 0.25, ("wedge", "ea"), ""),
    (["baby arugula"], 12, ("ea", "leave", "leaf"), ""),
    (["salt"], None, None, ""),
    (["black pepper"], None, None, ""),
    (["vine ripe tomatoes"], 20, "ea", ""),
    (["sugar"], 2.5, "tbsp", ""),
    (["salt"], 3.5, "tsp", ""),
    (["white pepper"], 1, "tsp", ""),
    (["olive oil"], 1.25, "cup", ""),
    (["garlic cloves", "garlic"], 20, ("ea", "clove"), ""),
    (["thyme", "thyme sprigs"], 25, ("ea", "sprig"), ""),
    (["octopus"], 8, "lb", ""),
    (["extra virgin olive oil"], 0.5, "cup", ""),
    (["white onions", "white onion"], 2, "ea", ""),
    (["carrots"], 2, "ea", ""),
    (["celery"], 3, ("ea", "stalk"), ""),
    (["white wine"], 4, "cup", ""),
    (["red wine"], 4, "cup", ""),
    (["parsley", "parsley sprigs"], 10, ("ea", "sprig"), ""),
    (["thyme", "thyme sprigs"], 10, ("ea", "sprig"), ""),
    (["bay leaves"], 2, ("ea", "leave", "leaf"), ""),
    (["rosemary"], 2, ("ea", "sprig"), ""),
    (["garlic heads", "garlic"], 2, ("ea", "head"), ""),
    (["chicken stock"], 1.5, "gal", ""),
    (["kosher salt"], 0.75, "cup", ""),
    (["sugar"], 0.25, "cup", ""),
    (["wine bottle cork", "cork"], 1, "ea", ""),
    (["parsley"], 0.5, "cup", ""),
    (["cilantro"], 0.5, "cup", ""),
    (["mint"], 0.25, "cup", ""),
    (["garlic"], 2, "clove", ""),
    (["cumin"], 1, "tbsp", ""),
    (["coriander"], 1, "tsp", ""),
    (["caraway"], 1, "tsp", ""),
    (["zest of 2 lemons", "lemon zest", "zest"], 2, "ea", ""),
    (["lemon juiced", "lemon juice", "lemon"], 1, "ea", ""),
    (["saffron"], 2, "tsp", ""),
    (["extra virgin olive oil"], 4 / 3, "cup", ""),
    (["sweet paprika"], 1, "tsp", ""),
    (["minced yellow onion", "yellow onion"], 0.5, "cup", ""),
    (["salt"], 2, "tsp", ""),
    (["pepper"], 1, "tsp", ""),
], unlisted=["lemon juice", "olive oil"])

NEW["n_raita"] = _c("Raita__Green._Cilantro._Mint.doc")
R["n_raita"] = dict(recipes=1, lines=[
    (["whole milk yogurt", "yogurt"], 1, "cup", ""),
    (["creme fraiche", "crème fraiche"], 1, "cup", ""),
    (["honey"], 0.25, "cup", ""),
    (["cilantro"], 1, "cup", ""),
    (["mint"], 1, "cup", ""),
    (["japanese cucumbers", "cucumbers"], 2, "ea", ""),
    (["red onion"], 0.5, "ea", ""),
    (["salt"], None, None, ""),
    (["black pepper"], None, None, ""),
    (["red vinegar"], 1, "tbsp", ""),
    (["lemon juice"], 1, "tbsp", ""),
    (["garam masala"], 1, "tbsp", ""),
], unlisted=[])

NEW["n_potsticker"] = _c("Pork_Potsticker_Filling.doc")
R["n_potsticker"] = dict(recipes=(1, 3), lines=[
    (["pork butt", "pork butt cubed"], 10, "lb", ""),
    (["sea salt"], 4, "tbsp", ""),
    (["chicken powder"], 1, "tbsp", ""),
    (["chopped garlic", "garlic"], 0.25, "cup", ""),
    (["chopped ginger", "ginger"], 0.25, "cup", ""),
    (["sugar"], 0.5, "cup", ""),
    (["oyster sauce"], 0.75, "cup", ""),
    (["black pepper"], 1, "tbsp", ""),
    (["white pepper"], 1, "tbsp", ""),
    (["cilantro"], 1, "bunch", ""),
    (["scallions"], 1, "bunch", ""),
    (["sesame oil"], 3, "tbsp", ""),
    (["corn starch", "cornstarch"], 3, "tbsp", ""),
    (["dried cherries"], 1, "cup", ""),
    (["dried apricots"], 1, "cup", ""),
    (["golden raisins"], 1, "cup", ""),
    (["kosher salt"], 1, "lb", ""),
    (["sodium nitrate"], 1, "oz", ""),
], unlisted=["egg yolk", "yolk", "whole egg", "egg", "potsticker skin", "potsticker skins"])

NEW["n_bearnaise"] = _c("Sauce_Bearnaise.doc")
R["n_bearnaise"] = dict(recipes=1, lines=[
    (["clarified butter"], 1, "qt", ""),
    (["egg yolks", "egg"], 8, "ea", ""),
    (["tarragon reduction"], 0.5, "cup", ""),
    (["salt"], 2, "tbsp", ""),
    (["sugar"], 1, "tsp", ""),
    (["lemon juice"], 1, "tsp", ""),
    (["chopped tarragon", "tarragon"], 0.25, "cup", ""),
    (["dijon mustard"], 1, "tbsp", ""),
], unlisted=[])

NEW["n_polenta"] = _c("Polenta.doc")
R["n_polenta"] = dict(recipes=(1, 2), lines=[
    (["whole milk", "milk"], 1, "gal", ""),
    (["water"], 0.5, "gal", ""),
    (["salt"], 3, "tbsp", ""),
    (["polenta"], 6, "cup", ""),
    (["cooked polenta"], 8, "cup", ""),
    (["creme fraiche", "crème fraiche"], 1, "cup", ""),
    (["mascarpone"], 0.5, "cup", ""),
    (["grated parmesan", "parmesan"], 1, "cup", ""),
    (["block parmesan"], None, None, ""),
    (["tuscan olive oil", "olive oil"], None, None, ""),
    (["fresh ground black pepper", "black pepper"], None, None, ""),
], unlisted=[])

NEW["n_lime_pickle"] = _c("Lime_Pickle_Puree.doc")
R["n_lime_pickle"] = dict(recipes=1, lines=[
    (["patak's lime pickle", "lime pickle", "lime pickle or relish"], 1, "jar", ""),
    (["water"], 0.5, "jar", ""),
    (["lime juice"], 0.5, "jar", ""),
    (["sugar"], 2, "tbsp", ""),
    (["cilantro leaves", "cilantro"], 0.25, "cup", ""),
], unlisted=[])

NEW["n_spinach_dip"] = _c("Spinach_Dip.doc")
R["n_spinach_dip"] = dict(recipes=1, lines=[
    (["thick mayo", "mayo", "mayonnaise"], 2, "cup", ""),
    (["parsley"], 1 / 3, "cup", ""),
    (["green onion"], 1 / 3, "cup", ""),
    (["spinach leaves", "spinach"], 1 / 3, "cup", ""),
    (["sour cream"], 0.25, "cup", ""),
    (["lemon juice"], 0.25, "cup", ""),
    (["grated onion", "onion"], 2, "tbsp", ""),
    (["worcestershire"], 1, "dash", "alt_none"),
    (["salt"], None, None, ""),
    (["pepper"], None, None, "opt"),
], unlisted=[])

NEW["n_confit_bacon"] = _c("Confit_Bacon.doc")
R["n_confit_bacon"] = dict(recipes=1, lines=[
    (["slab bacon", "bacon"], 1, ("ea", "slab"), ""),
    (["rosemary"], 2, ("ea", "sprig"), ""),
    (["garlic"], 1, ("ea", "head"), ""),
    (["rendered duck fat", "duck fat"], None, None, ""),
], unlisted=[])

NEW["n_smoothies"] = _c("Smoothies.doc")
R["n_smoothies"] = dict(recipes=1, lines=[
    (["fruit"], 4, "oz", ""),
    (["juice"], 4, "oz", ""),
], unlisted=[])

# ---------------------------------------------------------------- Word (.docx)
NEW["n_primavera"] = _c("PASTA_Primavera.docx")
R["n_primavera"] = dict(recipes=1, lines=[
    (["montelbllo strozzapreti pasta", "strozzapreti pasta", "strozzapreti"], 5, "cup", ""),
    (["water"], 1, "gal", ""),
    (["sea salt"], 2, "tbsp", ""),
    (["olive oil"], 2, "tsp", ""),
    (["shallot"], 1, "ea", ""),
    (["garlic"], 3, ("ea", "clove"), ""),
    (["crushed red chili flake", "red chili flake", "chili flake"], 1, "tsp", ""),
    (["carrots"], 3, "ea", ""),
    (["zucchini"], 1, "ea", ""),
    (["crimini mushrooms"], 6, "ea", ""),
    (["pomi chopped tomatoes", "chopped tomatoes"], 26.4, "oz", ""),
    (["yellow bell pepper"], 1, "ea", ""),
    (["broccoli"], 1, "cup", ""),
    (["parmesan cheese", "parmesan"], 2, "tbsp", ""),
    (["basil chiffonade"], None, None, ""),
    (["black pepper"], None, None, ""),
    (["sea salt"], None, None, ""),
    (["basil puree"], None, None, ""),
    (["pine nuts", "pine nuts toasted"], None, None, ""),
], unlisted=["tomato juice", "cooked pasta"])

NEW["n_tikka"] = _c("CHICKEN_Tikka_Masala.docx")
R["n_tikka"] = dict(recipes=(1, 2), lines=[
    (["chicken boneless skinless thighs", "chicken thighs", "chicken"], 5, "lb", ""),
    (["garlic ginger onion lime puree"], 1, "cup", ""),
    (["garlic"], 0.25, "cup", "opt"), (["ginger"], 0.25, "cup", "opt"),
    (["onion"], 0.25, "cup", "opt"), (["lime juice"], 0.25, "cup", "opt"),
    (["ground fenugreek"], 2, "tbsp", ""),
    (["cumin seed"], 1, "tbsp", ""),
    (["ground coriander"], 1, "tbsp", ""),
    (["cayenne pepper", "cayenne"], 1, "tsp", ""),
    (["paprika"], 2, "tbsp", ""),
    (["lite greek yogurt", "greek yogurt"], 0.5, "cup", ""),
    (["kosher salt"], 1, "tbsp", ""),
    (["ghee"], 1, "tbsp", ""),
    (["onion slices", "onion"], 1, "cup", ""),
    (["ginger sliced", "ginger"], 0.25, "cup", ""),
    (["sliced garlic", "garlic"], 1, "tbsp", ""),
    (["garlic ginger onion lime puree"], 0.5, "cup", ""),
    (["fenugreek seed"], 0.25, "cup", ""),
    (["coriander"], 2, "tbsp", ""),
    (["cumin"], 2, "tbsp", ""),
    (["crushed red pepper flakes", "red pepper flakes"], 1, "tbsp", ""),
    (["curry leaves", "curry leaves or bay leaves"], 3, ("ea", "leave", "leaf"), ""),
    (["crushed tomatoes"], 1, "qt", ""),
    (["heavy cream"], 0.5, "cup", ""),
    (["kosher salt"], 1, "tbsp", ""),
], unlisted=[])

NEW["n_crab_cake"] = _c("CRAB_Cake.docx")
R["n_crab_cake"] = dict(recipes=1, lines=[
    (["bread"], 2, "slice", ""),
    (["mayonnaise"], 2, "tbsp", ""),
    (["lemon juice"], 1, "tbsp", ""),
    (["sweet paprika", "paprika"], 1, "tsp", ""),
    (["old bay seasoning", "old bay"], 2, "tsp", ""),
    (["parsley"], 2, "tsp", ""),
    (["garlic"], 1, "clove", ""),
    (["prepared yellow mustard", "yellow mustard"], 1, "tsp", ""),
    (["egg"], 1, "ea", ""),
    (["lump crab meat", "crab meat"], 1, "lb", ""),
], unlisted=[])

NEW["n_black_cod"] = _c("FISH_Miso_Marinated_Black_Cod.docx")
R["n_black_cod"] = dict(recipes=1, lines=[
    (["mirin"], 0.5, "cup", ""),
    (["white miso paste", "white miso"], 0.25, "cup", ""),
    (["dark brown sugar", "brown sugar"], 1, "tbsp", ""),
    (["low-sodium soy sauce", "soy sauce"], 1, "tbsp", ""),
    (["garlic"], 1, "clove", ""),
    (["ginger"], 1, "tsp", ""),
    (["black cod", "portions of black cod"], (4, 16), ("ea", "portion", "oz"), ""),
], unlisted=[])

NEW["n_short_ribs"] = _c("SHORT_RIBS_Boneless_Beef_Shortribs.docx")
R["n_short_ribs"] = dict(recipes=1, lines=[
    (["boneless chuck short rib", "chuck short rib", "short rib"], 2.5, "lb", ""),
    (["sea salt"], 1, "tsp", ""),
    (["canola oil"], 1, "tsp", ""),
    (["yellow onions", "yellow onion"], 2, "ea", ""),
    (["carrots"], 2, "ea", ""),
    (["celery"], 2, ("ea", "rib"), ""),
    (["garlic"], 3, "clove", ""),
    (["tomato paste"], 1, "tsp", ""),
    (["dried ground chipotle pepper", "chipotle pepper"], 0.5, "tsp", ""),
    (["bordeaux wine"], 2, "cup", ""),
    (["worcestershire sauce"], 1, "tbsp", ""),
    (["rosemary"], 3, ("ea", "sprig"), ""),
    (["bonafide provisions restorative beef bone broth", "beef bone broth"], 3, "cup", ""),
    (["freshly ground black pepper", "black pepper"], 0.5, "tsp", ""),
], unlisted=[])

NEW["n_aioli"] = _c("AIOLI_GARLIC.docx")
R["n_aioli"] = dict(recipes=1, lines=[
    (["garlic", "garlic smashed"], 6, "ea", ""),
    (["mayonnaise"], 3, "cup", ""),
    (["water"], 0.5, "cup", ""),
    (["lemon juice"], 1, "tbsp", ""),
    (["olive oil"], 1, "cup", ""),
    (["salt"], None, None, ""),
    (["pepper"], None, None, ""),
    (["sugar"], None, None, ""),
], unlisted=[])

NEW["n_bordelaise"] = _c("SAUCE_BORDELAISE_.docx")
R["n_bordelaise"] = dict(recipes=(1, 4), lines=[
    (["red wine"], 1, "bottle", ""),
    (["port"], 2, "cup", ""),
    (["thyme"], 1, ("ea", "sprig"), ""),
    (["black peppercorns"], 1, "tbsp", ""),
    (["shallots"], 1, "lb", ""),
    (["garlic"], 2, ("ea", "pice", "piece"), ""),
    (["beef scraps"], 1, "lb", ""),
    (["sherry vinegar"], 0.5, "cup", ""),
    (["olive oil"], 1, "tbsp", ""),
    (["veal demi"], 1.25, "cup", ""),
    (["chicken stock"], 0.5, "gal", ""),
    (["butter"], 6, "oz", ""),
    (["salt"], None, None, ""),
    (["pepper"], None, None, ""),
    (["truffle jus"], 1, "oz", ""),
    (["truffle peelings"], 3, "oz", ""),
    (["shallots"], 2, "ea", ""),
    (["white wine"], 1, "cup", ""),
    (["chicken stock"], 1, "cup", ""),
    (["heavy cream"], 0.5, "cup", ""),
    (["salt"], None, None, ""),
    (["pepper"], None, None, ""),
    (["butter"], 1, "tbsp", ""),
    (["truffle puree"], 4, "oz", ""),
    (["red wine"], 10, "gal", ""),
    (["port"], 6, "bottle", ""),
    (["thyme"], 1, "gal", ""),
    (["black peppercorns"], 0.5, "cup", ""),
    (["veal demi"], 2.5, "cup", ""),
    (["chicken stock"], 5, "gal", ""),
    (["sherry vinegar"], 3, "bottle", ""),
    (["shallots"], 3, "gal", ""),
    (["garlic"], 0.5, "gal", ""),
    (["beef scraps"], 5, "lb", ""),
    (["salt"], None, None, ""),
    (["olive oil"], 2, "cup", ""),
], unlisted=[])

NEW["n_huckleberry"] = _c("Huckleberry_Compote.docx")
R["n_huckleberry"] = dict(recipes=1, lines=[
    (["red wine"], 2, "cup", ""),
    (["port wine"], 2, "cup", ""),
    (["plum wine"], 1, "cup", ""),
    (["star anise"], 0.5, "ea", ""),
    (["cinnamon stick", "cinnamon"], 0.5, ("ea", "stick"), ""),
    (["huckleberries"], 2, "cup", ""),
    (["sugar"], 0.75, "cup", ""),
], unlisted=[])

NEW["n_pastrami"] = _c("Pastrami_Brine.docx")
R["n_pastrami"] = dict(recipes=1, lines=[
    (["mustard seed"], 1, "cup", ""),
    (["cloves", "whole cloves"], 0.125, "cup", ""),
    (["black peppercorn"], 1, "cup", ""),
    (["bay leaves"], 20, "ea", ""),
    (["allspice"], 0.25, "cup", ""),
    (["coriander"], 0.5, "cup", ""),
    (["juniper"], 0.125, "cup", ""),
    (["thyme"], 1, "bunch", ""),
    (["whole onion", "onion"], 8, "ea", ""),
    (["garlic cloves", "garlic"], 1, "qt", ""),
    (["red wine vinegar"], 2, "cup", ""),
    (["sugar"], 3, "cup", ""),
    (["water"], 2, "gal", ""),
    (["curing salt"], 3, "cup", ""),
], unlisted=[])

NEW["n_lentil"] = _c("French_Green_Lentil_Soup.docx")
R["n_lentil"] = dict(recipes=1, lines=[
    (["organic french green lentils", "french green lentils", "lentils"], 2, "cup", ""),
    (["yellow onion"], 0.5, "cup", ""),
    (["celery"], 0.5, "cup", ""),
    (["garlic"], 3, "clove", ""),
    (["serrano pepper"], 1 / 3, "cup", ""),
    (["chicken stock"], 6, "cup", ""),
    (["bay leaf"], 2, "ea", ""),
    (["thyme"], 10, ("ea", "sprig"), ""),
    (["salt"], None, None, ""),
    (["black pepper"], None, None, "opt"),
    (["tomato concasse"], 0.5, "cup", ""),
], unlisted=[])

NEW["n_meatloaf"] = _c("Turkey_Meatloaf.docx")
R["n_meatloaf"] = dict(recipes=(1, 2), lines=[
    (["carrot"], 1, "ea", ""),
    (["onion"], 0.5, "ea", ""),
    (["celery stalk", "celery"], 1, ("ea", "stalk"), ""),
    (["garlic"], 3, "clove", ""),
    (["ground black pepper", "black pepper"], 0.25, "tsp", ""),
    (["kosher salt"], 0.5, "tsp", ""),
    (["turkey thigh", "ground turkey thigh"], 1, "lb", ""),
    (["egg"], 0.5, "ea", ""),
    (["chicken stock"], 0.25, "cup", ""),
    (["bread crumbs", "panko"], 0.25, "cup", ""),
    (["thyme", "dried thyme"], 1, "tsp", ""),
    (["blackening spice"], 1, "tsp", ""),
    (["parsley"], 1, "tsp", ""),
    (["chipotle glaze"], None, None, "opt"),
    (["ketchup"], 1 / 3, "cup", ""),
    (["cumin"], 1, "tsp", ""),
    (["worcestershire sauce"], 0.5, "tsp", ""),
    (["chipotle paste"], 1, "tsp", ""),
    (["agave"], 1, "tsp", ""),
    (["ground black pepper", "black pepper"], 0.25, "tsp", ""),
    (["kosher salt"], 0.5, "tsp", ""),
], unlisted=[])

NEW["n_fattoush"] = _c("SALAD_FATTOUSH_SUMMER_AUGUST.docx")
R["n_fattoush"] = dict(recipes=(1, 4), lines=[
    (["pita bread chips"], None, None, "opt"), (["vinaigrette"], None, None, "opt"), (["salad"], None, None, "opt"),
    (["pita breads", "pita bread"], None, None, ""),
    (["blended oil", "oil blend"], 1 / 3, "cup", ""),
    (["garlic"], 1, "tsp", ""),
    (["freshly squeezed lemon juice", "lemon juice"], 0.25, "cup", ""),
    (["evoo", "extra virgin olive oil"], 0.5, "cup", ""),
    (["kosher salt"], 1, "tsp", ""),
    (["cumin seed", "cumin"], 0.125, "tsp", ""),
    (["hearts of romaine", "romaine"], (3, 6), ("ea", "heart", "cup"), ""),
    (["sheep's milk feta cheese", "feta cheese", "feta"], 0.75, "cup", ""),
    (["cherry tomatoes"], 0.75, "cup", ""),
    (["english cucumber", "cucumber"], 0.75, "cup", ""),
    (["kalamata olives"], 1 / 3, "cup", ""),
    (["red onion"], 0.25, "cup", ""),
    (["cilantro"], 1 / 3, "cup", ""),
    (["mint"], 1 / 3, "cup", ""),
    (["sumac"], None, None, ""),
], unlisted=["pepper", "black pepper"])

NEW["n_sea_bass"] = _c("FISH_Chilean_Sea_Bass_LemonFennelChutney.docx")
R["n_sea_bass"] = dict(recipes=(1, 2), lines=[
    (["chilean sea bass portions", "chilean sea bass", "sea bass"], (8, 48), ("ea", "portion", "oz", "individual"), ""),
    (["fine ground sea salt", "sea salt"], 1, "tsp", ""),
    (["granulated garlic"], 0.25, "tsp", ""),
    (["freshly ground white pepper", "white pepper"], 0.5, "tsp", ""),
    (["la tourangelle olive oil spray", "olive oil spray"], 1, "bottle", ""),
    (["lemon"], 1, "ea", ""),
    (["lemon fennel chutney"], None, None, "opt"),
    (["yellow onion"], 1, "ea", ""),
    (["bulb fennel", "fennel"], 1, ("ea", "bulb"), ""),
    (["kosher salt"], 0.25, "tsp", ""),
    (["water"], 1, "cup", ""),
    (["brown mustard seeds"], 0.5, "tsp", ""),
    (["honey"], 1, "tsp", ""),
    (["coriander", "coriander ground"], 1, "tsp", ""),
    (["lemons", "lemons zest and juice"], 3, "ea", ""),
    (["golden raisins"], 0.25, "cup", ""),
    (["rice vinegar"], 0.5, "cup", ""),
    (["champagne vinegar"], 0.5, "cup", ""),
    (["pernod"], 0.25, "cup", ""),
    (["fresh ground black pepper", "black pepper"], 0.25, "tsp", ""),
    (["cilantro leaves", "cilantro"], 16, ("ea", "leave", "leaf"), ""),
], unlisted=["garlic", "lemon juice"])

NEW["n_har_gow"] = _c("Filling_-_Shrimp_Har_Gow_L_copy.docx")
R["n_har_gow"] = dict(recipes=1, lines=[
    (["shrimp"], 13, "lb", ""),
    (["salt", "sea salt"], 4.5, "oz", ""),
    (["sugar"], 10, "oz", ""),
    (["chicken powder", "chicken powder knorr"], 1.5, "oz", ""),
    (["white pepper"], 1, "tbsp", ""),
    (["corn starch", "cornstarch"], 0.75, "cup", ""),
    (["chicken fat"], 10, "oz", ""),
    (["pork fat back", "pork fatback", "pork fat"], 10, "oz", ""),
], unlisted=[])

NEW["n_fried_chicken"] = _c("2024-09-13_Recipe_Fried-Chicken-Sandwich.docx")
R["n_fried_chicken"] = dict(recipes=(1, 2), lines=[
    (["boneless skinless chicken breasts", "chicken breasts"], 2, "ea", ""),
    (["buttermilk"], 1, "cup", ""),
    (["hot sauce"], 1, "tsp", ""),
    (["all-purpose flour", "flour"], 1, "cup", ""),
    (["cornstarch"], 0.5, "cup", ""),
    (["paprika"], 1, "tsp", ""),
    (["garlic powder"], 0.5, "tsp", ""),
    (["onion powder"], 0.5, "tsp", ""),
    (["salt"], None, None, ""),
    (["pepper"], None, None, "opt"),
    (["vegetable oil", "vegetable oil for frying"], None, None, ""),
    (["brioche buns"], 4, "ea", ""),
    (["tomato"], 4, "slice", ""),
    (["iceberg lettuce leaves", "iceberg lettuce"], None, None, ""),
    (["pickles"], None, None, ""),
    (["mayonnaise"], None, None, ""),
], unlisted=["fries", "salad"])

NEW["n_scampi"] = _c("Classic_Shrimp_Scampi.docx")
R["n_scampi"] = dict(recipes=1, lines=[
    (["large shrimp", "shrimp"], 1.25, "lb", ""),
    (["kosher salt"], None, None, ""),
    (["freshly ground black pepper", "black pepper"], None, None, ""),
    (["all-purpose flour", "flour"], 1, "tbsp", ""),
    (["extra-virgin olive oil", "olive oil"], 3, "tbsp", ""),
    (["unsalted butter", "butter"], (4, 0.5), ("tbsp", "stick"), ""),
    (["garlic"], 4, "clove", ""),
    (["shallots", "shallot"], 3, "ea", ""),
    (["dry white wine", "white wine"], 0.5, "cup", ""),
    (["fresh lemon juice", "lemon juice"], 2, "tbsp", ""),
    (["crushed red pepper flakes", "red pepper flakes"], (2, 3), "pinch", ""),
    (["italian parsley", "parsley"], 2, "tbsp", ""),
    (["cooked white rice", "white rice"], 3, "cup", ""),
], unlisted=[])

NEW["n_corn_fritters_doc"] = _c("APPETIZER_CORN_FRITTERS_SUMMER_AUGUST.docx")
R["n_corn_fritters_doc"] = dict(recipes=1, lines=[
    (["oil"], None, None, ""),
    (["bisquick baking mix", "bisquick"], 2, "cup", ""),
    (["salt"], 0.5, "tsp", ""),
    (["milk"], 2 / 3, "cup", ""),
    (["egg"], 1, "ea", ""),
    (["corn kernels", "corn"], 2, "cup", ""),
], unlisted=["cornmeal", "sugar", "maple syrup", "honey"])

NEW["n_cocktails"] = _c("Cocktails_OW.docx")
R["n_cocktails"] = dict(recipes=(3, 8), lines=[
    (["jalapeno peppers", "jalapeño peppers", "jalapenos"], 3, "ea", ""),
    (["vodka", "vodka or blanco tequila", "vodka or blanco silver tequila"], (1, 750), ("bottle", "ml"), ""),
    (["simple syrup"], 2, "tbsp", ""),
    (["basil leaves", "basil"], 4, ("ea", "leave", "leaf"), ""),
    (["roasted-jalapeno-infused vodka", "roasted-jalapeño-infused vodka", "jalapeno infused vodka", "infused vodka"],
     0.25, "cup", ""),
    (["fresh cucumber juice", "cucumber juice"], 0.5, "cup", ""),
    (["fresh lime juice", "lime juice"], 1, "tbsp", ""),
    (["cucumber slices"], None, None, ""),
    (["large cucumber", "cucumber"], 0.5, "ea", "opt"),
    (["mint leaves", "mint"], 6, ("ea", "leave", "leaf"), ""),
    (["simple syrup"], 1, "tbsp", ""),
    (["fresh lemon juice", "lemon juice"], 1, "tbsp", ""),
    (["watermelon cubes", "watermelon"], 1, "cup", ""),
    (["vodka"], 0.5, "cup", ""),
    (["granulated sugar", "sugar"], 1, "cup", "opt"),
    (["water"], 1, "cup", "opt"),
    (["vodka"], 0.25, "cup", ""),
    (["green apple syrup"], 2, "tbsp", ""),
    (["cloudy apple juice", "apple juice"], 0.25, "cup", ""),
    (["lemon juice"], 1, "tbsp", ""),
    (["thyme syrup"], 1, "tbsp", ""),
    (["elderflower cordial"], 0.5, "tbsp", ""),
    (["cubed ice", "ice"], None, None, ""),
    (["thyme"], 2, ("ea", "sprig"), ""),
    (["water"], 1, "cup", ""),
    (["superfine sugar"], 1, "cup", ""),
    (["thyme"], 6, ("ea", "sprig"), ""),
    (["granulated sugar"], None, None, ""),
    (["agave syrup"], 0.25, "cup", ""),
    (["roasted-jalapeno-infused vodka", "roasted-jalapeño-infused vodka", "jalapeno infused vodka", "infused vodka"],
     0.25, "cup", ""),
    (["fresh passion fruit puree", "passion fruit puree", "passion fruit puree or guava juice"], 0.5, "cup", ""),
    (["kumquat"], None, None, "opt"),
    (["vodka"], None, None, "opt"),
], unlisted=["habanero", "habaneros", "habanero peppers", "ice"])

# a flow-chart image inside a Word file: ingredients named, no amounts printed
NEW["n_meatball"] = _c("2024-11-13_Recipe_Meatball-Production.docx", kind="photo")
NEW["n_meatball"]["src"] = ND + "/transcripts/meatball.txt"
R["n_meatball"] = dict(recipes=(0, 2), lines=[], unlisted=[])
# sauce descriptions for a menu: ingredients named, no amounts printed
NEW["n_cut_sauces"] = _c("CUT_Sauces.doc")
R["n_cut_sauces"] = dict(recipes=(0, 8), lines=[], unlisted=[])

# ---------------------------------------------------------------- traps: not recipes
NEW["n_trap_donuts"] = _c("DONUTS_RICHES_RETHERM_GLAZE.docx", kind="trap")
NEW["n_trap_xmas_menu"] = _c("Christmas_2016_Telluride_OW.docx", kind="trap")
NEW["n_trap_party_menu"] = _c("Chef_Wolfgang_Party_2.docx", kind="trap")
NEW["n_trap_blank_template"] = _c("Blank_Template_WPBG_recipe.xls", kind="trap", conv="Blank_Template_WPBG_recipe.xlsx")
NEW["n_trap_dish_photo"] = _c("BEET_CURED_HIMACHI__3855.JPG", kind="trap")
NEW["n_trap_dish_photo"]["src"] = None
for _k in [k for k in NEW if k.startswith("n_trap_")]:
    R[_k] = dict(recipes=(0, 1), lines=[], unlisted=[])

# ---------------------------------------------------------------- workbooks (.xls converted to .xlsx for the reader)
NEW["n_corn_fritters_xls"] = _c("Corn_Fritters.xls", kind="sheet", conv="Corn_Fritters.xlsx")
R["n_corn_fritters_xls"] = dict(recipes=(1, 2), lines=[
    (["ears of fresh corn", "fresh corn", "corn"], (3, 12, 336), ("ea", "ear", "oz", "g"), ""),
    (["yellow corn meal", "corn meal", "cornmeal"], 224, "g", ""),
    (["ap flour", "flour"], 280, "g", ""),
    (["baking powder"], 1, "tbsp", ""),
    (["salt"], 1, "tsp", ""),
    (["pepper"], 0.5, "tsp", ""),
    (["cayenne pepper", "cayenne"], 0.25, "tsp", ""),
    (["thick slices of bacon", "bacon"], 2, ("ea", "slice"), ""),
    (["eggs"], 2, "ea", ""),
    (["milk"], 224, "g", ""),
    (["red bell pepper"], 1, "ea", ""),
    (["small onion", "onion"], 1, "ea", ""),
    (["fresh chives", "chives"], 1, "tbsp", ""),
], unlisted=[])

NEW["n_caesar"] = _c("Dressing_Caesar_dressing_3-29-07.xls", kind="sheet", conv="Dressing_Caesar_dressing_3-29-07.xlsx")
R["n_caesar"] = dict(recipes=1, lines=[
    (["egg yolks"], 4, "ea", ""),
    (["whole eggs"], 4, "ea", ""),
    (["lemon juice"], 3.5, "cup", ""),
    (["dijon mustard"], 1.5, "cup", ""),
    (["whole garlic cloves", "garlic cloves", "garlic"], 2, "cup", ""),
    (["chili flakes"], 3, "tbsp", ""),
    (["worchestershire sauce", "worcestershire sauce"], 1 / 3, "cup", ""),
    (["anchovy filet", "anchovy"], 12, "oz", ""),
    (["olive oil"], 1.5, "qt", ""),
    (["parmesan cheese", "parmesan"], 3, "cup", ""),
    (["peanut oil or vegetable", "peanut oil"], 3.5, "qt", ""),
], unlisted=[])

NEW["n_falafel"] = _c("Falafal_Batter.xls", kind="sheet", conv="Falafal_Batter.xlsx")
R["n_falafel"] = dict(recipes=1, lines=[
    (["iqf fresh chickpeas", "chickpeas"], (18, 10), ("cup", "lb"), ""),
    (["rough chopped parlsey", "parsley", "parlsey"], 2, "cup", ""),
    (["rough chopped cilantro", "cilantro"], 2, "cup", ""),
    (["jalepeno", "jalapeno"], 2, "ea", ""),
    (["ch garlic", "chopped garlic", "garlic"], 6, "tbsp", ""),
    (["salt"], 6, "tsp", ""),
    (["cayenne"], 3, "tsp", ""),
    (["cumin"], 6, "tbsp", ""),
    (["corriando", "coriander"], 12, "tbsp", ""),
    (["baking powder"], 6, "tsp", ""),
    (["ap flour", "flour"], 3, "cup", ""),
], unlisted=[])

NEW["n_fatty_raisins"] = _c("Fatty_Raisins.xls", kind="sheet", conv="Fatty_Raisins.xlsx")
R["n_fatty_raisins"] = dict(recipes=1, lines=[
    (["raisins", "thompson seedless raisins", "white raisins"], 10, "lb", ""),
    (["white wine"], 1, "gal", ""),
    (["orange juice"], 8, "oz", ""),
    (["myers rum", "rum"], 8, "oz", ""),
    (["sugar"], 1, "lb", ""),
], unlisted=[])

NEW["n_cider_glaze"] = _c("Glaze_cider.xls", kind="sheet", conv="Glaze_cider.xlsx")
R["n_cider_glaze"] = dict(recipes=1, lines=[
    (["cider vinegar"], 2, "qt", ""),
    (["dark brown sugar"], 12, "oz", ""),
    (["demi"], 2, "cup", ""),
    (["thyme"], 2, "sprig", ""),
    (["shallots"], 5, "ea", ""),
    (["bay leaves"], 2, "ea", ""),
    (["cracked black pepper", "black pepper"], 1, "tsp", ""),
    (["salt"], 1, "tsp", ""),
    (["chicken stock"], 1, "qt", ""),
], unlisted=[])

NEW["n_pad_thai"] = _c("Pad_thai_sauce_2_nam_pla.xls", kind="sheet", conv="Pad_thai_sauce_2_nam_pla.xlsx")
R["n_pad_thai"] = dict(recipes=1, lines=[
    (["fish sauce"], 1, "cup", ""),
    (["rice vinegar"], 0.25, "cup", ""),
    (["water"], 0.25, "cup", ""),
    (["sugar"], 1 / 3, "cup", ""),
    (["garlic"], 0.25, "cup", ""),
    (["thai green chilies"], 0.25, "cup", ""),
    (["cilantro"], 0.5, "cup", ""),
], unlisted=[])

NEW["n_blood_orange"] = _c("Sauce_Blood_orange_duck_sauce.xls", kind="sheet", conv="Sauce_Blood_orange_duck_sauce.xlsx")
R["n_blood_orange"] = dict(recipes=1, lines=[
    (["blood orange juice"], 0.5, "gal", ""),
    (["coconut milk"], 0.75, "can", ""),
    (["shallots"], 2, "tbsp", ""),
    (["ginger"], 2, "tbsp", ""),
    (["garlic"], 2, "tbsp", ""),
    (["5- spice powder", "5-spice powder", "five spice powder", "spice powder"], 1, "tbsp", ""),
    (["cinnamon", "cinnamon stick"], 1, ("ea", "stick"), ""),
    (["cloves", "whole cloves"], 2, "ea", ""),
    (["cracked black pepper", "black pepper"], 1, "pinch", "alt_none"),
    (["red wine"], 1, "cup", ""),
    (["port wine"], 1, "cup", ""),
    (["plum wine"], 1, "cup", ""),
    (["veal demi"], 2, "cup", ""),
    (["chicken stock"], 6, "cup", ""),
], unlisted=["butter", "salt", "pepper"])

NEW["n_wing_sauce"] = _c("Wing_sauce_-_Garlic_Chili.xls", kind="sheet", conv="Wing_sauce_-_Garlic_Chili.xlsx")
R["n_wing_sauce"] = dict(recipes=1, lines=[
    (["garlic"], 2, "cup", ""),
    (["shallot"], 1, "cup", ""),
    (["lemon juice"], 3, "cup", ""),
    (["white wine"], 1, "cup", ""),
    (["rice wine vinegar"], 0.5, "cup", ""),
    (["sugar"], 1.5, "cup", ""),
    (["chili flake"], 1, "tbsp", ""),
    (["chicken stock"], 2, "cup", ""),
    (["olive oil blend"], 2, "tbsp", ""),
    (["salt"], 1, "tsp", ""),
    (["cracked black pepper", "black pepper"], 0.5, "tsp", ""),
], unlisted=[])

# ---------------------------------------------------------------- multi-sheet workbook, 14 recipes
NEW["n_seafood"] = _c("SEAFOOD_RECIPES_WPC_Sustainable_Seafood.xlsx", kind="sheet")
R["n_seafood"] = dict(recipes=(5, 16), lines=[
    (["yellowfin tuna sashimi"], 28, "slice", ""),
    (["yellowfin tuna loin"], 4, "oz", ""),
    (["avocado"], 1, "ea", ""),
    (["scallions"], 2, "ea", ""),
    (["carrot"], 0.25, "ea", ""),
    (["japanese cucumber"], 1, "ea", ""),
    (["red endive"], 1, "ea", ""),
    (["kaiware sprouts"], 1, "oz", ""),
    (["beet"], 1, "ea", ""),
    (["pickled ginger"], 1, "oz", ""),
    (["soy-yuzu dressing"], None, None, "opt"),
    (["asian vinaigrette"], None, None, "opt"),
    (["salt"], None, None, ""), (["pepper"], None, None, "opt"),
    (["yuzu zest"], 0.5, "cup", ""),
    (["shallots"], 0.25, "cup", ""),
    (["ginger"], 0.25, "cup", ""),
    (["green onions"], 0.5, "cup", ""),
    (["fresh wasabi", "wasabi"], 0.25, "cup", ""),
    (["sambal"], 2, "tbsp", ""),
    (["yuzu juice"], 0.75, "cup", ""),
    (["kikoman soy sauce", "soy sauce"], 1, "cup", ""),
    (["pickled ginger"], 1 / 3, "cup", ""),
    (["sesame oil"], 0.25, "cup", ""),
    (["extra virgin olive oil"], 0.5, "cup", ""),
    (["ginger vinegar"], 1, "cup", ""),
    (["chili oil"], 1, "tbsp", ""),
    (["sesame oil"], 2, "tbsp", ""),
    (["peanut oil"], 1, "cup", ""),
    (["salt"], 1, "tsp", ""),
    (["white pepper"], 1, "tsp", ""),
    (["toasted sesame seeds", "sesame seeds"], 2, "tbsp", ""),
    (["farm raised mussels", "mussels"], 20, "ea", ""),
    (["thai coconut broth"], 0.75, "cup", ""),
    (["fresh thai chilies", "thai chilies"], 3, "ea", ""),
    (["sliced garlic", "garlic"], 2, "clove", ""),
    (["red bell pepper"], 1, "ea", ""),
    (["scallions"], 2, "ea", ""),
    (["fresh ginger", "ginger"], 1, "oz", ""),
    (["peanut oil"], 2, "tbsp", ""),
    (["lemongrass stalk", "lemongrass"], 1, "ea", ""),
    (["thai basil"], 0.25, "cup", ""),
    (["fresh thai chilis", "thai chilis"], 5, "ea", ""),
    (["garlic"], 5, "clove", ""),
    (["shallots"], 2, "ea", ""),
    (["coconut milk"], 5, "can", ""),
    (["galangal"], 1, "oz", ""),
    (["fish sauce"], 2, "tbsp", ""),
    (["lemon juice"], 1, "tbsp", ""),
    (["sugar"], 2, "tbsp", ""),
    (["kaffir lime leaf"], 0.25, "cup", ""),
    (["salt"], None, None, ""), (["pepper"], None, None, "opt"),
    (["wild salmon pieces", "wild salmon"], 8, "ea", ""),
    (["tandoori marinade"], 2, "cup", ""),
    (["pickled cucumbers"], None, None, "opt"),
    (["cilantro mint chutney"], None, None, "opt"),
    (["scallions"], 2, "ea", ""),
    (["garam masala"], 1, "pinch", "alt_none"),
    (["japanese cucumbers"], 4, "ea", ""),
    (["salt"], 0.5, "tbsp", ""),
    (["yogurt"], 2, "tbsp", ""),
    (["chopped dill", "dill"], 0.5, "tsp", ""),
    (["caraway seed"], 0.5, "tsp", ""),
    (["salt"], None, None, ""), (["pepper"], None, None, "opt"),
    (["rice vinegar"], 1, "tbsp", ""),
    (["sugar"], 1, "tbsp", ""),
    (["paprika"], 0.5, "cup", ""),
    (["turmeric"], 0.25, "cup", ""),
    (["cayenne"], 0.25, "cup", ""),
    (["coriander"], 0.5, "cup", ""),
    (["cumin"], 0.25, "cup", ""),
    (["ground ginger"], 2, "tbsp", ""),
    (["ground cardamon", "ground cardamom"], 0.75, "cup", ""),
    (["nutmeg"], 1, "cup", ""),
    (["black pepper"], 1 / 3, "cup", ""),
    (["sea salt"], 0.25, "cup", ""),
    (["garlic"], 2, "clove", ""),
    (["tamarind paste"], 1, "tbsp", ""),
    (["honey"], 0.75, "cup", ""),
    (["yogurt"], 0.75, "cup", ""),
    (["coconut milk"], 1, "cup", ""),
    (["shredded coconut"], 1, "tbsp", ""),
    (["garlic"], 3, "clove", ""),
    (["yogurt"], 4, "oz", ""),
    (["honey"], 1, "oz", ""),
    (["cayenne"], 0.25, "tsp", ""),
    (["cumin"], 1, "tbsp", ""),
    (["coriander"], 1, "tbsp", ""),
    (["fennugreek", "fenugreek"], 1, "tsp", ""),
    (["sugar"], 1, "tbsp", ""),
    (["salt"], None, None, ""), (["pepper"], None, None, "opt"),
    (["cilantro leaves"], 2, "cup", ""),
    (["mint leaves"], 1.5, "cup", ""),
    (["lemon juice"], 0.5, "cup", ""),
    (["whole wild striped bass", "striped bass"], 1, "ea", ""),
    (["ginger"], 10, "ea", ""),
    (["cilantro leaves"], 30, "ea", ""),
    (["peanut oil for frying", "peanut oil"], None, None, ""),
    (["salt"], None, None, ""), (["pepper"], None, None, "opt"),
    (["cornstarch"], None, None, ""),
    (["ponzu sauce"], 1, "cup", ""),
    (["cilantro sprigs"], 1, ("ea", "sprig"), ""),
    (["scallions"], 1, "ea", ""),
    (["kikoman soy sauce", "soy sauce"], 1.5, "cup", ""),
    (["yuzu juice"], 1, "tbsp", ""),
    (["rice vinegar"], 1, "cup", ""),
    (["mirin"], 2, "cup", ""),
    (["lemon"], 1, ("cup", "ea"), ""),
    (["lemongrass stalk", "lemongrass"], 1, "ea", ""),
    (["ginger"], 1, "ea", ""),
    (["jalapeno"], 1, "ea", ""),
    (["black cod pieces", "black cod"], 8, "ea", ""),
    (["miso marinade"], 1, "cup", ""),
    (["scallions"], 2, "ea", ""),
    (["carrot"], 0.25, "ea", ""),
    (["micro pea shoots"], 3, "oz", ""),
    (["asian vinaigrette"], 2, "oz", ""),
    (["sesame miso vinaigrette"], None, None, "opt"),
    (["egg yolk"], 2, "ea", ""),
    (["dijon mustard"], 2, "tbsp", ""),
    (["garlic cloves", "garlic"], 2, ("ea", "clove"), ""),
    (["pickled ginger"], 0.25, "cup", ""),
    (["red miso paste"], 0.25, "cup", ""),
    (["white sesame seeds", "sesame seeds"], 0.25, "cup", ""),
    (["ginger vinegar"], 2, "tbsp", ""),
    (["rice vinegar"], 0.5, "cup", ""),
    (["peanut oil"], 2, "cup", ""),
    (["sesame oil"], 2, "tbsp", ""),
    (["togarashi spice", "togarashi"], 1, "tsp", ""),
    (["ginger vinegar"], 1, "cup", ""),
    (["chili oil"], 1, "tbsp", ""),
    (["sesame oil"], 2, "tbsp", ""),
    (["peanut oil"], 1, "cup", ""),
    (["salt"], 1, "tsp", ""),
    (["white pepper"], 1, "tsp", ""),
    (["toasted sesame seeds", "sesame seeds"], 2, "tbsp", ""),
], unlisted=["butter"])

# ---------------------------------------------------------------- long banquet production packet (66k characters)
# Grounding-only with an automatic reference of printed amounts (see autoref.ref_saucier); reported separately.
NEW["n_saucier"] = _c("2025-08-15_Recipe_Saucier-Packet.doc", kind="word")
R["n_saucier"] = dict(recipes=(20, 120), lines=None, unlisted=[])

LONG = {"n_saucier"}


# Key audit after the first runs: every disagreement between a model and the key was checked against the document.
# Changes made (all others were model errors and stand):
KEY_AUDIT = [
    ("n_tamales", "added the name 'earscorn': the document prints 'earscorn' (no space) and models copy it verbatim"),
    ("n_octopus, n_stir_fry, n_bordelaise, n_cocktails", "recipe-count ranges widened: sub-recipes used by the main dish are "
     "components under the prompt's rule 7 (recipe count is not part of accuracy)"),
]

# Keys for the six documents that carry a third-party confidentiality notice (the Compass "Recipe Print" PDFs and
# Wolfgang Puck Fine Dining's Ricotta Gnocchi) live in gold_new_private.py, which is not in the repository; with the
# file and the documents present locally, those cases are scored like the rest.
try:
    from gold_new_private import NEW as _NEW_P, R as _R_P
    NEW.update(_NEW_P)
    R.update(_R_P)
except ImportError:
    pass
