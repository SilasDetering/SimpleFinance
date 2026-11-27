# SimpleFinance dauerhaft aufs iPhone bringen

Die App wird mit **EAS Build** als *Ad-hoc / internal distribution* gebaut. Das Provisioning-Profil gilt
ein Jahr. Änderungen am JavaScript-Code kommen danach per **EAS Update** drahtlos aufs Handy, ohne
neuen Build.

Du brauchst: Node.js, den bezahlten Apple Developer Account und ein kostenloses Konto auf
[expo.dev](https://expo.dev/signup).

Alle Befehle laufen im Projektordner.

## Einmalig einrichten

1. **Abhängigkeiten installieren**
   ```bash
   npm install
   ```

2. **Bei Expo anmelden**
   ```bash
   npx eas-cli@latest login
   ```

3. **Projekt mit EAS verknüpfen und Updates konfigurieren**
   ```bash
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   ```
   Das trägt `extra.eas.projectId` und `updates.url` in `app.json` ein. Diese Änderung bitte
   committen und pushen, sie gehört ins Repo.

4. **iPhone registrieren**
   ```bash
   npx eas-cli@latest device:create
   ```
   Wähle „Website“. Du bekommst einen Link/QR-Code: auf dem iPhone in **Safari** öffnen, das Profil
   laden und unter *Einstellungen → Allgemein → VPN und Geräteverwaltung* installieren. Damit landet
   die UDID deines iPhones im Apple-Account.

5. **Entwicklermodus auf dem iPhone einschalten**
   *Einstellungen → Datenschutz & Sicherheit → Entwicklermodus* aktivieren, iPhone neu starten.
   (Der Schalter erscheint teils erst, nachdem die App einmal installiert wurde.)

## App bauen und installieren

6. **Build starten**
   ```bash
   npx eas-cli@latest build --platform ios --profile preview
   ```
   Beim ersten Mal fragt EAS nach deinem Apple-Login und erstellt Zertifikat und Ad-hoc-Profil
   automatisch (alles mit „Yes“ bestätigen). Der Build läuft in der Cloud und dauert ca. 10–20 Minuten.

7. **Installieren**
   Am Ende zeigt die CLI einen QR-Code und einen Link. Mit der iPhone-Kamera scannen bzw. in Safari
   öffnen und auf „Installieren“ tippen. Fertig, die App bleibt jetzt ein Jahr lang nutzbar.

## Updates einspielen (der Normalfall)

Nach Code-Änderungen (Screens, Logik, Texte, Styles):

```bash
npx eas-cli@latest update --channel preview --message "Kurze Beschreibung"
```

Die App lädt das Update beim nächsten Start im Hintergrund und verwendet es ab dem **übernächsten**
Start. Also: App ganz schließen (wegwischen), öffnen, nochmal schließen und öffnen.

## Wann ist ein neuer Build nötig?

Nur wenn sich **nativer** Code ändert: neue Bibliothek mit nativem Teil (`npx expo install …`),
Expo-SDK-Upgrade, Änderungen an Icon, Name, Berechtigungen oder Plugins in `app.json`.

Die `runtimeVersion` steht auf `fingerprint`. EAS erkennt dadurch selbst, ob ein Update zum
installierten Build passt. Wenn nicht, kommt es einfach nicht an, statt die App zu zerschießen.
Dann Schritt 6 und 7 wiederholen. Die neue Version wird über die alte installiert.

Nach einem Jahr läuft das Profil ab: dann ebenfalls einfach neu bauen (Schritt 6 und 7).

## Bleiben meine Daten erhalten?

Ja. Die Buchungen liegen in einer SQLite-Datenbank im App-Container auf dem iPhone. Die bleibt
erhalten bei
- jedem EAS Update,
- jedem neuen Build, der **über** die bestehende App installiert wird (gleiche Bundle-ID
  `de.silasdetering.simplefinance`, die darf sich deshalb nie ändern).

Schema-Änderungen laufen über die Migrationen in `src/db/schema.ts` (`PRAGMA user_version`) und
ändern bestehende Daten nicht.

Verloren gehen die Daten nur, wenn du die App **löschst**. Darum vorher bzw. regelmäßig unter
*Einstellungen → Backup exportieren (JSON)* sichern. Zurückholen geht mit *Backup wiederherstellen*.
