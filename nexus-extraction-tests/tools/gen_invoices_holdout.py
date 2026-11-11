"""Generate holdout invoices whose answer keys come from the same data that draws them."""
import json, os, subprocess
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image, ImageEnhance, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = letter
gold = {}


def money(x):
    return f"{x:,.2f}"


# ---------------------------------------------------------------- H1: clean template (fees, discount, tax)
def h1():
    items = [("Arborio Rice 10 lb bag", 6, "BAG", 18.40), ("San Marzano Tomatoes #10", 12, "CAN", 7.85),
             ("Parmigiano Reggiano wedge", 4, "LB", 21.50), ("Delivery & Handling", 1, "", 35.00)]
    c = canvas.Canvas(f"{OUT}/h1_template_invoice.pdf", pagesize=letter)
    c.setFont("Helvetica-Bold", 20); c.drawString(50, H - 70, "INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(50, H - 95, "Tuscan Pantry Wholesale  ·  88 Mercer St, Newark NJ 07102")
    c.drawRightString(W - 50, H - 70, "Invoice No. TP-22841"); c.drawRightString(W - 50, H - 85, "Date: Sept 9, 2026")
    c.drawString(50, H - 130, "Bill to: Golden Fork - Downtown")
    y = H - 175
    c.setFont("Helvetica-Bold", 10)
    for x, t in [(50, "DESCRIPTION"), (330, "QTY"), (380, "UNIT"), (440, "RATE"), (510, "AMOUNT")]:
        c.drawString(x, y, t)
    c.line(50, y - 5, W - 50, y - 5); c.setFont("Helvetica", 10)
    sub = 0
    for d, q, u, r in items:
        y -= 20
        amt = round(q * r, 2); sub += amt
        c.drawString(50, y, d); c.drawString(330, y, str(q)); c.drawString(380, y, u)
        c.drawString(440, y, f"${money(r)}"); c.drawString(510, y, f"${money(amt)}")
    disc = round(sub * 0.05, 2); tax = round((sub - disc) * 0.06625, 2); tot = round(sub - disc + tax, 2)
    y -= 40
    for k, v in [("Subtotal", sub), ("Discount (5%)", -disc), ("Sales Tax 6.625%", tax), ("TOTAL DUE", tot)]:
        c.drawRightString(470, y, k); c.drawRightString(W - 50, y, ("-$" if v < 0 else "$") + money(abs(v))); y -= 16
    c.save()
    gold["h1_template_invoice"] = dict(vendor="tuscan pantry", number="TP-22841", date="2026-09-09", lines=[
        dict(names=["arborio rice"], sku=None, ok=[(6, "bag", 18.40)], total=110.40, kind="item"),
        dict(names=["san marzano tomatoes", "tomatoes"], sku=None, ok=[(12, "can", 7.85)], total=94.20, kind="item"),
        dict(names=["parmigiano reggiano"], sku=None, ok=[(4, "lb", 21.50)], total=86.00, kind="item"),
        dict(names=["delivery handling", "delivery"], sku=None, ok=[(1, None, 35.00)], total=35.00, kind="fee"),
    ])


# ---------------------------------------------------------------- H2: dense distributor, two pages, catch weight
def h2():
    rows = [
        ("1", "1", "CS", "4/5 LB", "PACKER", "CHICKEN BREAST BNLS SKNLS", "553120", "3.19/LB", 63.80, ("20.0 LB",)),
        ("2", "2", "CS", "6/#10", "SYSCO", "BEANS CANNELLINI", "418833", "42.10", 84.20, None),
        ("1", "1", "CS", "1/14 LB AVG", "BUTCHER", "PORK BELLY SKIN-ON", "609112", "4.25/LB", 61.20, ("14.4 LB",)),
        ("3", "3", "CS", "12/1 QT", "IMPERIAL", "CREAM HEAVY 40%", "220076", "38.95", 116.85, None),
        ("2", "1", "CS", "25 LB", "AREZZIO", "FLOUR 00 PIZZA", "771209", "27.60", 27.60, None),
        ("4", "4", "EA", "1 EA", "WHLFCLS", "BASIL FRESH BUNCH", "102344", "1.85", 7.40, None),
        ("1", "1", "CS", "2/5 LB", "AREZZIO", "MOZZARELLA FIOR DI LATTE", "330981", "36.75", 36.75, None),
        ("1", "1", "CS", "6/1 GAL", "ROLAND", "VINEGAR RED WINE", "514470", "29.90", 29.90, None),
    ]
    c = canvas.Canvas(f"{OUT}/h2_distributor_invoice.pdf", pagesize=letter)

    def header(page):
        c.setFont("Helvetica-Bold", 13); c.drawString(40, H - 45, "HARBOR FOODSERVICE DIST. CO.")
        c.setFont("Helvetica", 8); c.drawString(40, H - 58, "Invoice 0094417726   Inv Date 10/02/26   Cust 7781-GF   Route 14   Page %d of 2" % page)
        y = H - 85; c.setFont("Helvetica-Bold", 7)
        for x, t in [(40, "ORD"), (65, "SHP"), (90, "UM"), (112, "PACK/SIZE"), (172, "BRAND"), (222, "DESCRIPTION"),
                     (395, "ITEM#"), (445, "PRICE"), (510, "EXTENSION")]:
            c.drawString(x, y, t)
        c.line(40, y - 3, W - 40, y - 3)
        return y

    y = header(1); c.setFont("Helvetica", 7.5)
    for i, (o, s, um, pk, br, desc, item, price, ext, cw) in enumerate(rows):
        if i == 5:
            c.setFont("Helvetica", 7); c.drawString(40, 60, "CONTINUED ON NEXT PAGE"); c.showPage(); y = header(2)
            c.setFont("Helvetica", 7.5)
        y -= 14
        for x, t in [(40, o), (65, s), (90, um), (112, pk), (172, br), (222, desc), (395, item)]:
            c.drawString(x, y, t)
        c.drawRightString(480, y, price); c.drawRightString(W - 45, y, money(ext))
        if cw:
            y -= 10; c.setFont("Helvetica-Oblique", 7); c.drawString(222, y, f"CATCH WEIGHT {cw[0]}"); c.setFont("Helvetica", 7.5)
    y -= 16; c.drawString(222, y, "FUEL SURCHARGE"); c.drawRightString(W - 45, y, "6.50")
    sub = round(sum(r[8] for r in rows) + 6.50, 2)
    y -= 30; c.setFont("Helvetica-Bold", 8)
    c.drawRightString(480, y, "INVOICE SUBTOTAL"); c.drawRightString(W - 45, y, money(sub))
    c.drawRightString(480, y - 12, "TAX"); c.drawRightString(W - 45, y - 12, "0.00")
    c.drawRightString(480, y - 24, "TOTAL"); c.drawRightString(W - 45, y - 24, money(sub))
    c.save()
    gold["h2_distributor_invoice"] = dict(vendor="harbor foodservice", number="0094417726", date="2026-10-02", lines=[
        dict(names=["chicken breast bnls sknls", "chicken breast"], sku="553120", ok=[(20.0, "lb", 3.19), (1, "case", 63.80)], total=63.80, kind="item"),
        dict(names=["beans cannellini"], sku="418833", ok=[(2, "case", 42.10)], total=84.20, kind="item"),
        dict(names=["pork belly skin-on", "pork belly"], sku="609112", ok=[(14.4, "lb", 4.25), (1, "case", 61.20)], total=61.20, kind="item"),
        dict(names=["cream heavy 40%", "cream heavy"], sku="220076", ok=[(3, "case", 38.95)], total=116.85, kind="item"),
        dict(names=["flour 00 pizza", "flour"], sku="771209", ok=[(1, "case", 27.60)], total=27.60, kind="item"),
        dict(names=["basil fresh bunch", "basil"], sku="102344", ok=[(4, "ea", 1.85)], total=7.40, kind="item"),
        dict(names=["mozzarella fior di latte", "mozzarella"], sku="330981", ok=[(1, "case", 36.75)], total=36.75, kind="item"),
        dict(names=["vinegar red wine"], sku="514470", ok=[(1, "case", 29.90)], total=29.90, kind="item"),
        dict(names=["fuel surcharge"], sku=None, ok=[(1, None, 6.50)], total=6.50, kind="fee"),
    ])


# ---------------------------------------------------------------- H3: produce vendor as a phone photo
def h3():
    items = [("Heirloom Tomatoes", "12", "LB", "3.40", 40.80), ("Romaine Hearts 24ct", "2", "CS", "34.50", 69.00),
             ("Italian Parsley", "6", "BU", "1.15", 6.90), ("Meyer Lemons", "1", "CS", "48.00", 48.00),
             ("Shallots", "10", "LB", "2.25", 22.50), ("Pallet / crate deposit", "2", "EA", "15.00", 30.00)]
    c = canvas.Canvas(f"{OUT}/_h3.pdf", pagesize=letter)
    c.setFont("Times-Bold", 18); c.drawString(60, H - 70, "Valley Fresh Produce")
    c.setFont("Times-Roman", 11); c.drawString(60, H - 88, "Ticket #  VF-50392        Date 10/07/2026")
    y = H - 130; c.setFont("Times-Bold", 11)
    for x, t in [(60, "Item"), (290, "Qty"), (330, "Unit"), (380, "Price"), (470, "Total")]:
        c.drawString(x, y, t)
    c.setFont("Times-Roman", 11)
    for d, q, u, p, t in items:
        y -= 22
        for x, s in [(60, d), (290, q), (330, u), (380, p)]:
            c.drawString(x, y, s)
        c.drawRightString(520, y, money(t))
    y -= 34; tot = round(sum(i[4] for i in items), 2)
    c.setFont("Times-Bold", 12); c.drawString(380, y, "Total"); c.drawRightString(520, y, money(tot))
    c.save()
    subprocess.run(["pdftoppm", "-r", "100", "-png", "-singlefile", f"{OUT}/_h3.pdf", f"{OUT}/_h3"], check=True)
    im = Image.open(f"{OUT}/_h3.png").convert("RGB")
    im = im.crop((0, 0, im.width, int(im.height * 0.55)))
    im = ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(0.9)).enhance(0.85)
    bg = Image.new("RGB", (int(im.width * 1.1), int(im.height * 1.12)), (96, 88, 76))
    bg.paste(im, (int(im.width * 0.05), int(im.height * 0.06)))
    im = bg.rotate(-3.1, resample=Image.BICUBIC, expand=True, fillcolor=(96, 88, 76)).filter(ImageFilter.GaussianBlur(0.8))
    im.save(f"{OUT}/h3_produce_photo.jpg", quality=68)
    for f in ("_h3.pdf", "_h3.png"):
        os.remove(f"{OUT}/{f}")
    gold["h3_produce_photo"] = dict(vendor="valley fresh", number="VF-50392", date="2026-10-07", lines=[
        dict(names=["heirloom tomatoes"], sku=None, ok=[(12, "lb", 3.40)], total=40.80, kind="item"),
        dict(names=["romaine hearts"], sku=None, ok=[(2, "case", 34.50)], total=69.00, kind="item"),
        dict(names=["italian parsley"], sku=None, ok=[(6, "bunch", 1.15), (6, "bu", 1.15)], total=6.90, kind="item"),
        dict(names=["meyer lemons"], sku=None, ok=[(1, "case", 48.00)], total=48.00, kind="item"),
        dict(names=["shallots"], sku=None, ok=[(10, "lb", 2.25)], total=22.50, kind="item"),
        dict(names=["pallet crate deposit", "crate deposit", "deposit"], sku=None, ok=[(2, "ea", 15.00)], total=30.00, kind="fee"),
    ])


# ---------------------------------------------------------------- H4: credit memo
def h4():
    rows = [("771054", "ROMAINE HEARTS 24CT", "-1", "CS", "32.10", "-32.10"),
            ("518800", "TOMATO DICED IN JUICE 6/#10", "-2", "CS", "31.75", "-63.50"),
            ("", "RESTOCKING FEE", "1", "", "5.00", "5.00")]
    c = canvas.Canvas(f"{OUT}/h4_credit_memo.pdf", pagesize=letter)
    c.setFont("Helvetica-Bold", 16); c.drawString(50, H - 60, "COASTLINE FOODSERVICE INC.  —  CREDIT MEMO")
    c.setFont("Helvetica", 9); c.drawString(50, H - 78, "Credit Memo CM-20981   Date 10/05/26   Ref. Invoice CF-0098812")
    y = H - 115; c.setFont("Helvetica-Bold", 9)
    for x, t in [(50, "Item #"), (110, "Description"), (330, "Qty"), (370, "U/M"), (420, "Price"), (500, "Amount")]:
        c.drawString(x, y, t)
    c.setFont("Helvetica", 9)
    for r in rows:
        y -= 16
        for x, t in zip([50, 110, 330, 370], r[:4]):
            c.drawString(x, y, t)
        c.drawRightString(460, y, r[4]); c.drawRightString(545, y, r[5])
    y -= 30; c.setFont("Helvetica-Bold", 9); c.drawRightString(460, y, "Total Credit"); c.drawRightString(545, y, "-90.60")
    c.save()
    gold["h4_credit_memo"] = dict(vendor="coastline", number="CM-20981", date="2026-10-05", lines=[
        dict(names=["romaine hearts"], sku="771054", ok=[(-1, "case", 32.10), (1, "case", -32.10), (-1, "case", -32.10)], total=-32.10, kind="credit"),
        dict(names=["tomato diced in juice", "tomato diced"], sku="518800", ok=[(-2, "case", 31.75), (2, "case", -31.75), (-2, "case", -31.75)], total=-63.50, kind="credit"),
        dict(names=["restocking fee"], sku=None, ok=[(1, None, 5.00)], total=5.00, kind="fee"),
    ])


h1(); h2(); h3(); h4()
json.dump(gold, open(f"{OUT}/gold_invoices.json", "w"), indent=1)
print("wrote", sorted(gold))
