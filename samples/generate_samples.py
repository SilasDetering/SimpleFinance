import datetime as dt, sys
out_dir = sys.argv[1]
# (date, empfaenger, buchungstext, verwendungszweck, betrag_cents)
tx = []
def add(d, who, bt, vz, cents): tx.append((dt.date.fromisoformat(d), who, bt, vz, cents))
for m in (8, 9, 10, 11):
    y = 2026
    p = lambda day: f"{y}-{m:02d}-{day:02d}"
    if m != 8: pass
    add(p(1), "Hausverwaltung Müller & Söhne", "Dauerauftrag/Terminüberweisung", "Miete Wohnung Kölner Straße 12", -85000)
    add(p(2), "Spotify AB", "Lastschrift", "Spotify Premium P1234567", -1199)
    add(p(3), "REWE Markt GmbH", "Lastschrift", "REWE SAGT DANKE 12345678", {8:-4237,9:-6815,10:-2950,11:-5480}[m])
    add(p(16), "REWE Markt GmbH", "Lastschrift", "REWE SAGT DANKE 87654321", {8:-1899,9:-3340,10:-5120,11:-2275}[m])
    add(p(4), "Netflix International B.V.", "Lastschrift", "Netflix Monatsabo", -1399)
    add(p(5), "Stadtwerke Köln GmbH", "Lastschrift", "Abschlag Strom/Gas Kundennr. 4711", -9800)
    add(p(6), "VISA LIDL DIENSTLEISTUNG", "Lastschrift", "Lidl sagt Danke", {8:-2389,9:-4120,10:-1876,11:-3310}[m])
    add(p(8), "VISA SPARKASSE KOELNBONN", "Bargeldauszahlung", "GAA Köln Hbf Karte 1234", -10000)
    add(p(10), "DB Vertrieb GmbH", "Lastschrift", "Deutschlandticket Abo", -5800)
    add(p(12), "Lieferando.de", "Lastschrift", "Bestellung Pizza Pasta", {8:-2450,9:-3890,10:-1990,11:-4560}[m])
    add(p(14), "HUK-COBURG Versicherung", "Lastschrift", "Kfz-Haftpflicht Beitrag", -4512)
    add(p(15), "ARAL Station 123", "Lastschrift", "Tankstelle Aachener Str.", {8:-6012,9:-4870,10:-6630,11:-5540}[m])
    add(p(17), "Edeka Center Schäfer", "Lastschrift", "Einkauf", {8:-3120,9:-1590,10:-4475,11:-2260}[m])
    add(p(18), "Max Mustermann", "Überweisung", "Umbuchung Extra-Konto Sparen", -20000)
    add(p(20), "Café Kranz", "Lastschrift", "Kartenzahlung", {8:-1480,9:-870,10:-2260,11:-1130}[m])
    add(p(22), "Amazon EU S.a.r.L.", "Lastschrift", "AMZN Mktp DE Bestellung 302-1234567", {8:-2999,9:-8950,10:-3999,11:-1299}[m])
    add(p(25), "Muster Tech GmbH", "Gehalt/Rente", "Gehalt " + f"{m:02d}/{y}", 285000)
    if m in (8, 10): add(p(26), "Apotheke am Dom", "Lastschrift", "Kartenzahlung", {8:-1295,10:-2340}[m])
    add(p(27), "Unbekannter Händler XY", "Lastschrift", "Kartenzahlung 4711", {8:-1750,9:-990,10:-3120,11:-640}[m])
    if m == 9:
        add(p(9), "Fitnessstudio FitX", "Lastschrift", "Mitgliedsbeitrag", -2499)
        add(p(28), "Sparkasse KölnBonn", "Bareinzahlung", "Bareinzahlung Einzahlautomat", 5000)
    if m in (9,10,11):
        add(p(9) if m!=9 else p(10), "Fitnessstudio FitX", "Lastschrift", "Mitgliedsbeitrag", -2499) if m!=9 else None
    if m == 10:
        add(p(3), "dm-drogerie markt", "Lastschrift", "dm sagt Danke", -1867)
        add(p(19), "Kino Cinedom", "Lastschrift", "Ticketkauf", -2400)
    if m == 11:
        add(p(21), "Zalando SE", "Gutschrift", "Retoure Erstattung", 4995)
tx = [t for t in tx if t is not None and t[0] <= dt.date(2026, 11, 25)]
tx.sort(key=lambda t: t[0])
start_balance = 120000
bal = start_balance
rows = []
for t in tx:
    bal += t[4]
    rows.append((t, bal))
def money(c):
    s = f"{abs(c)/100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("-" if c < 0 else "") + s
def write(name, frm, to, encoding):
    sel = [(t, b) for (t, b) in rows if frm <= t[0] <= to]
    sel_desc = list(reversed(sel))
    lines = [
        "Umsatzanzeige;Datei erstellt am: 26.11.2026 18:30",
        ";Letztes Update: aktuell",
        "",
        "IBAN;DE89 3704 0044 0532 0130 00",
        "Kontoname;Girokonto",
        "Bank;ING",
        "Kunde;Max Mustermann",
        f"Zeitraum;{frm:%d.%m.%Y} - {to:%d.%m.%Y}",
        f"Saldo;{money(sel[-1][1])};EUR",
        "",
        "Sortierung;Datum absteigend",
        "",
        "In der CSV-Datei finden Sie alle bereits gebuchten Umsätze. Die vorgemerkten Umsätze werden nicht aufgenommen, auch wenn sie in Ihrem Internetbanking angezeigt werden.",
        "",
        "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung",
    ]
    for (t, b) in sel_desc:
        d = t[0].strftime("%d.%m.%Y")
        lines.append(f"{d};{d};{t[1]};{t[2]};{t[3]};{money(b)};EUR;{money(t[4])};EUR")
    data = ("\r\n".join(lines) + "\r\n").encode(encoding)
    open(f"{out_dir}/{name}", "wb").write(data)
    print(name, len(sel))
write("ing-beispiel-aug-okt.csv", dt.date(2026,8,1), dt.date(2026,10,31), "iso-8859-1")
write("ing-beispiel-okt-nov-ueberlappend.csv", dt.date(2026,10,15), dt.date(2026,11,25), "iso-8859-1")
