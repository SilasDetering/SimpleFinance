# SimpleFinance

Eine lokale App für die private Finanz-Übersicht. Ein- und Ausgaben kommen per ING-CSV-Import oder als manuelle Bargeld-Buchung in die App, die daraus eine schlichte Übersicht baut. Alle Daten bleiben auf dem Gerät: keine Cloud, kein Login.

## Starten (Expo Go)

```bash
npm install
npx expo start
```

Den QR-Code mit der Kamera (iOS) bzw. in der Expo-Go-App (Android) scannen. Das Projekt nutzt **Expo SDK 58**, die Expo-Go-App muss also aktuell sein. Es werden nur Module verwendet, die in Expo Go enthalten sind, ein eigener Dev-Build ist nicht nötig.

### Beispieldaten testen

In `samples/` liegen zwei Fake-Exporte im ING-Format (ISO-8859-1, Semikolon, deutsche Formate):

- `ing-beispiel-aug-okt.csv`: August bis Oktober 2026, inkl. Geldautomat-Abhebungen und einer Bareinzahlung
- `ing-beispiel-okt-nov-ueberlappend.csv`: 15.10. bis 25.11.2026, überlappt absichtlich mit der ersten Datei (Duplikat-Test)

Die Dateien z. B. per AirDrop, Mail oder in iCloud Drive/Google Drive aufs Handy legen und in der App über **+ → Neuen Monat importieren** auswählen. Neu erzeugen lassen sie sich mit `python3 samples/generate_samples.py samples`.

## Tests

```bash
npm test          # Jest: CSV-Parser, Encoding, Duplikate, Kategorisierung, Bargeld, Auswertungen, Datenbank
npm run typecheck # TypeScript
```

Die Datenbank-Tests laufen gegen echtes SQLite (`node:sqlite`, Node ≥ 22).

## Aufbau

```
src/
  app/            Screens (Expo Router): Verlauf, Auswertungen, Budget, Einstellungen, Details, Bargeld, Kategorie
  domain/         Reine TypeScript-Logik ohne React/Expo, komplett getestet
    ingCsv.ts       ING-CSV-Parser (Kopfzeile wird gesucht, Spalten per Name)
    encoding.ts     UTF-8 / ISO-8859-1 (Windows-1252) erkennen und dekodieren
    dedup.ts        Duplikaterkennung bei überlappenden Importen
    categorize.ts   Regelbasierte Kategorisierung (Erweiterungspunkt für einen lokalen Klassifizierer)
    cash.ts         Bargeld-Kasse und Einnahmen/Ausgaben-Logik
    stats.ts        Auswertungen (Kategorien, Monate, Durchschnitt, Top-Empfänger, Kontostand)
    recurring.ts    Erkennung von Fixkosten/Abos
    budget.ts       Monatsbudget (regelmäßige Einnahmen − Fixkosten − Sparen)
  db/             SQLite-Schema, Migrationen, Repository
  ui/             Theme (hell/dunkel), Komponenten, Bottom Sheet, Kategorie-Auswahl
samples/          Beispiel-CSVs + Generator
```

### Datenmodell

`accounts` (giro, cash, später savings/depot) · `categories` (expense/income/transfer) · `rules` (Schlüsselwort → Kategorie) · `imports` · `transactions` (mit `account_id` an jeder Buchung). Weitere Konten lassen sich später ohne Schemaänderung ergänzen.

### Bargeld-Logik

| Buchung | Kasse | Auswertung |
| --- | --- | --- |
| Abhebung am Automaten (Bank, Kategorie Bargeld) | + Betrag | keine Ausgabe |
| Bareinzahlung (Bank, Kategorie Bargeld) | − Betrag | keine Einnahme |
| Bar-Ausgabe (manuell, z. B. Bäcker → Lebensmittel) | − Betrag | Ausgabe der Kategorie |
| Bargeld erhalten (manuell, z. B. Geschenk) | + Betrag | Einnahme |

Die Kasse fließt nicht in den Kontostand ein. Ist der Bestand negativ, zeigt die App einen Hinweis.

### Monatsbudget

Jede Ausgabe-Kategorie ist **fix** (Miete, Lebensmittel, Abos, Versicherungen), **variabel** (Shopping, Restaurant, Freizeit …) oder **Sparen** (z. B. ETF-Sparplan; Kategorien mit „Spar", „ETF", „Depot" im Namen automatisch). Umbuchungen können als Sparen zählen.

`Frei verfügbar = regelmäßige Einnahmen − Fixkosten − Sparen`, berechnet aus den letzten bis zu 6 abgeschlossenen Monaten:

- Regelmäßige Einnahmen: Absender in mindestens 2/3 der Monate, je Absender der Median (Weihnachtsgeld, Steuererstattung zählen nicht).
- Fixkosten/Sparen: je Kategorie der Median der Monatssummen; was in den letzten 12 Monaten darüber lag (Jahresbeiträge), wird auf 12 Monate umgelegt.
- Der Budget-Tab zeigt, wie viel davon im laufenden Monat schon für variable Ausgaben weg ist, und schlägt wiederkehrende Zahlungen in variablen Kategorien als Fixkosten vor.

### Erstattungen

Für Geld, das man auslegt und zurückbekommt (Bahnticket für die Arbeit, für einen Freund bezahlt):

- In der Buchung „Bekomme ich zurück" einschalten, optional „Von wem". Solange offen, zählt die Ausgabe weder im Budget noch in den Auswertungen.
- Kommt das Geld, den Eingang der Ausgabe zuordnen (in der Ausgabe oder im Eingang). Er zählt dann nicht als Einnahme und nicht als regelmäßiges Einkommen.
- Alles zurück: automatisch erledigt. Teilerstattung: „Abschließen" lässt den Rest als echte Ausgabe im Monat der Ausgabe stehen.
- „Offene Erstattungen" (Budget-Tab und Verlauf) zeigt, wer noch was schuldet. Kontostand und Bargeld-Kasse bleiben unverändert.

### Kategorisierung

Jede Kategorie hat Schlüsselwörter, die case-insensitive gegen Empfänger, Verwendungszweck und Buchungstext geprüft werden. Bei mehreren Treffern gewinnt die höhere Priorität (Bargeld > gelernte Regeln > Umbuchungen > Standard), danach das längere Schlüsselwort. Wird eine Buchung manuell umkategorisiert, fragt die App, ob daraus eine Regel für den Empfänger werden soll.
