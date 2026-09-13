# Abschlussbericht: AMD-Port

Lauf vom 12.09.2026 22:04 bis 13.09.2026 00:12. 23 Iterationen, 24 Aufgaben.

## Das Wichtigste zuerst

**Nichts davon wurde an einem laufenden Spiel bestätigt.** 509 Tests sind grün,
und genau so weit reicht die Aussage. Ob FSR 4 in einem echten Spiel anspringt,
weiß bisher niemand. Das ist keine Formalität: der Verify-Schritt, der Aufbau
der OptiScaler-Konfiguration und die Unreal-Schalter beruhen auf Dokumentation
und auf dem echten Archiv, nicht auf einem gesehenen Ergebnis.

Was tatsächlich am Referenzrechner geprüft wurde, steht unten unter
„Gegen echte Hardware geprüft".

## Was gebaut wurde

Ein Weichensteller über drei Stufen. Er erkennt pro Spiel Grafikkarte, Engine
und vorhandene Upscaler und empfiehlt genau eine Route, mit Begründung.

| Stufe | Bedingung | Ergebnis |
|---|---|---|
| 1 | Spiel bringt DLSS, FSR 2+ oder XeSS mit | FSR 4.1 über OptiScaler |
| 2 | Spiel bringt keines mit, läuft auf Unreal | FSR 4.1 über Engine-Steckplatz |
| 3 | alles andere, auch Anti-Cheat | Treiber und räumliches Upscaling |

| | |
|---|---|
| Tests | 509 grün (Ausgangsstand 259) |
| Commits | 50 |
| Geänderte Dateien | 60 |
| Neue Zeilen | rund 15 700 |

## Zustand jeder Aufgabe

Alle 24 Loop-Aufgaben sind `[v]`: vom Guard verifiziert und auf die Abnahme
durch einen Menschen wartend. Keine ist blockiert, keine offen.

| Aufgabe | Zustand | Commit |
|---|---|---|
| 1.1 GPU-Erkennung | [v] | `9e79cf5` |
| 1.2 install-guards an gpu-detect | [v] | `ac93b35` |
| 1.3 Upscaler-Inventar | [v] | `e296c37` |
| 1.4 Engine-Erkennung | [v] | `cf90cbc` |
| 1.5 Routen-Registry | [v] | `75a81da` |
| 1.6 OptiScaler upstream | [v] | `5b9c971` |
| 1.7 configureAmd | [v] | `0644b96` |
| 1.8 Route amd-optiscaler | [v] | `71c31fb` |
| 1.9 Verify | [v] | `8ec7b46` |
| 1.10 UI und i18n | [v] | `9d0bc44` |
| 2.1 Unreal-Config | [v] | `a3dd371` |
| 2.2 Route engine-upscale | [v] | `135b553` |
| 2.3 Engine-Begründungen | [v] | `56a990b` |
| 3.1 Route amd-driver | [v] | `09b2f5d` |
| 3.2 Route spatial | [v] | `e62ba0a` |
| 3.3 Anti-Cheat-Regel | [v] | `6d17f08` |
| 4.1 FG-Planer | [v] | `4a7ee78` |
| 4.2 FG in Routen | [v] | `e53aed6` |
| 5.1 Router | [v] | `a410c45` |
| 5.2 Stufe im UI | [v] | `980efe6` |
| 5.3 Community-Felder | [v] | `5461ea1` |
| 5.4 Diagnose | [v] | `7c2d78e` |
| 5.5 Kompatibilitätsliste | [v] | `53e89bb` |
| 5.6 README | [v] | `fa95143` |
| 5.7 Abschlussbericht | dieser Bericht | – |

## Gegen echte Hardware geprüft

Diese Punkte sind nicht nur getestet, sondern am Referenzrechner nachgesehen:

- **Grafikkarte:** RX 7900 XT, Adrenalin 26.8.1, RDNA3, FSR-4-fähig erkannt.
  Dabei fiel ein echter Fehler auf: ein unlesbarer Registry-Unterschlüssel
  leerte unter der strengen Fehlerbehandlung die gesamte Abfrage, wodurch
  Adrenalin unerkannt blieb und FSR 4 fälschlich als nicht verfügbar galt.
- **FSR-4-Bibliothek:** `amdxcffx64.dll` 2.3.0.3193 im DriverStore gefunden.
- **OptiScaler 0.9.4:** Archiv wirklich geladen, 55 016 448 Bytes, Prüfsumme
  berechnet, 21 Dateien entpackt, echte INI als Testvorlage übernommen.
- **Adrenalin:** unter `C:\Program Files\AMD\CNext\CNext\RadeonSoftware.exe`
  gefunden. Auch hier fand ein Test einen echten Entwurfsfehler.
- **Engine-Erkennung:** Return to Moria als Unreal mit Projekt „Moria", Risk of
  Rain 2 als Unity, Factorio und Forts als unbekannt.
- **Unreal-Konfiguration:** die berechnete `Engine.ini` existiert tatsächlich,
  2791 Bytes, noch ohne `[SystemSettings]`.
- **Kompatibilitätsliste:** 698 Spiele importiert, Zahlen decken sich mit der
  Wiki-Statistik.

## Was ein Mensch tun muss

### Zuerst: die Spikes (H1)

Ohne sie bleibt alles Obige eine begründete Vermutung. Besonders wichtig:

1. **Ein DX12-Spiel mit DLSS über OptiScaler.** Das prüft Stufe 1 und liefert
   ein echtes `OptiScaler.log`, das die Muster in `src/core/verify.js`
   bestätigt oder korrigiert. Diese Muster sind bisher eine Annahme (H6).
2. **Return to Moria.** Die Kompatibilitätsliste führt es als funktionierend
   mit Eingängen „DLSS, FSR2", obwohl der Scan im Programmordner keine einzige
   Upscaler-Datei fand. Das entscheidet, ob es Stufe 1 oder Stufe 2 ist, und
   ist damit der aussagekräftigste einzelne Test für die ganze Stufe-2-Idee.
3. **Ein Vulkan-Spiel.** Der einzige Weg dorthin führt über OptiScaler, der
   Treiber-Schalter greift nicht.

### Dann die Abnahme (H7)

Alle 24 Aufgaben stehen auf `[v]`. Wer sie prüft, setzt sie auf `[x]` und lässt
bei Bedarf `node scripts/loop-baseline.js` neu laufen.

### Offene Entscheidungen (H5)

Der Name ist unverändert. Ein Werkzeug, das AMD-Upscaling macht, „DLSS 5
Swapper" zu nennen, verwirrt und berührt fremde Marken. Das ist deine
Entscheidung, nicht die des Loops.

### Weitere Mensch-Aufgaben

- **H2** Build Tools, falls je C++ dazukommen soll. Bisher unnötig.
- **H3** Obsidian: `node_modules` von der Indizierung ausschließen.
- **H4** DLSS-NR-on-AMD: ob überhaupt, und Kontakt zum Autor.

## Was bewusst offen blieb

Drei Lücken sind dokumentiert statt heimlich geschlossen worden, weil sie
Dateien betreffen, die keine Aufgabe besaß:

1. **`scan.js` reicht `engine`, `antiCheat` und `upscalers.fsrfg` nicht an die
   Ziele durch.** Die Routenlogik liest sie vom Ziel. In der Praxis liefert
   `main.js` sie inzwischen über den eigenen Scan-Pfad, aber der gemeinsame
   Weg über `scan.js` fehlt weiterhin.
2. **`main.js` reicht Adapterdaten und Engine nicht an `diagnostics.report()`
   durch.** Eine Zeile. Das OptiScaler-Log wird auch ohne sie eingesammelt.
3. **Der Community-Server kennt die neuen Routennamen und Felder womöglich
   nicht.** Falls ein Bericht abgelehnt wird, liegt es daran.

## Was dieser Lauf über sich selbst gelernt hat

Der Guard hat viermal eine echte Regression oder einen echten Entwurfsfehler
gefangen, den ich sonst mitgeschleppt hätte. Zweimal davon dieselbe Klasse:
`main.js` griff auf etwas zu, das seine eigene Testvorrichtung nicht nachbildet.
Die Lösung war beide Male, die Abhängigkeit zu entfernen statt sie defensiv zu
verstecken, und die verbliebene Spiegelung durch einen Test abzusichern.

Kein Test wurde gelöscht, abgeschwächt oder umgeschrieben, um einen Fehlschlag
zu beseitigen. Zweimal war der Test falsch und wurde korrigiert; beides steht
in `loop/STATE.md` mit Begründung.

---

# Nachtrag: Phase 6

Der Bericht oben endete mit dem Satz, nichts sei an einem laufenden Spiel
bestätigt worden. Das stimmt weiterhin. Aber zwischen „durch Tests
abgesichert" und „an einem Spiel bestätigt" lag eine Stufe, die niemand
genommen hatte: die fertige Kette einmal gegen die Spiele laufen zu lassen,
die auf diesem Rechner wirklich installiert sind, und die echten Dateien
einmal wirklich zu installieren.

Das wurde jetzt gemacht. Es hat in den ersten fünf Minuten einen Fehler
gefunden, der alle 509 Tests überlebt hatte, und danach noch vier weitere.

## Was der erste echte Durchlauf widerlegt hat

**Return to Moria ist Stufe 1, nicht Stufe 2.** Der offene Punkt aus dem
Bericht oben ist geklärt, und die Kompatibilitätsliste hatte recht. Das Spiel
führt sehr wohl `nvngx_dlss.dll`, nur liegt die Datei unter
`Engine/Plugins/Runtime/Nvidia/DLSS/Binaries/ThirdParty/Win64/`, während die
Programmdatei in `Moria/Binaries/Win64` steht. Der Scan sah zwei Ebenen um die
Programmdatei und fand deshalb nie etwas. Das ist genau die Form, die jedes
Unreal-Spiel für Fremdbibliotheken benutzt, also betraf der blinde Fleck eine
ganze Klasse von Spielen und nicht ein einzelnes.

**Das Werkzeug hätte angeboten, in Call of Duty zu injizieren.** Ricochet
arbeitet im Kern des Betriebssystems und hinterlässt im Spielordner nichts,
was eine Dateisuche finden könnte, also meldete die Suche korrekt nichts und
das Spiel sah unbedenklich aus. Das ist der einzige Fehler in diesem Projekt,
der einen Menschen etwas kostet, das er nicht zurückbekommt.

**Bei Forts war die Programmdatei `ffmpeg.exe`.** `Forts.exe` lag daneben.
Jede Antwort danach beschrieb ffmpeg statt das Spiel, und nichts weiter unten
in der Kette konnte das bemerken.

**Die Sicherungskopie der Engine-Konfiguration blieb liegen.** Nach einer
vollständigen Wiederherstellung stand `_DLSS5_Backup/engine-config/Engine.ini`
dauerhaft im Spielordner und hielt eine veraltete Kopie der Einstellungen des
Menschen fest, obwohl das README ausdrücklich das Gegenteil verspricht.

## Was jetzt zusätzlich belegt ist

| Was | Wie belegt |
|---|---|
| Die Anwendung läuft überhaupt | Der Renderer wird in einer Browser-Attrappe geladen und ausgeführt |
| Die Installation mit dem echten Archiv | 13 Dateien, rund 176 MB, Proxy als `dxgi.dll` |
| Die geschriebene FSR-4-Konfiguration | `Dx12Upscaler=fsr31`, `Fsr4Update=true`, `Fsr4ForceEnableInt8=true` |
| Die Wiederherstellung | Jede Ursprungsdatei mit ihrer Ursprungsprüfsumme zurück |
| Stufe 2 von Anfang bis Ende | Engine-Schalter gesetzt und rückstandsfrei entfernt, in beiden Ausgangslagen |
| Anti-Cheat | Fortnite und Call of Duty landen beide auf Stufe 3 |

## Was dieser Rechner tatsächlich bekäme

Zwölf Spiele gefunden. Die Zahl, um die es geht, ist nicht wie viele eine
Antwort bekommen, denn das sind alle, sondern wie viele echtes Upscaling
bekommen.

| | |
|---|---|
| Echtes Upscaling (Stufe 1) | 3 |
| Echtes Upscaling (Stufe 2) | 0 |
| Nur Ausweichlösung (Stufe 3) | 8 |
| Keine Programmdatei gefunden | 1 |

Das ist die ehrliche Antwort auf „geht Upscaling jetzt überall". Jedes Spiel
bekommt eine Antwort. Ein Viertel bekommt echtes Upscaling. Der Rest bekommt
Treibereinstellungen und räumliche Skalierung, und das ist etwas anderes: ein
kleineres Bild schärfen kann keine Details zurückholen, die nie gezeichnet
wurden.

Nachprüfbar mit `node scripts/reality-check.js`.

## Die wichtigste verbleibende Lücke

**Stufe 2 ist an keinem echten Spiel eingetreten.** Sie ist die Idee, auf der
das ganze Projekt ruht, und von zwölf installierten Spielen fällt keines
hinein. Sie läuft im Trockenlauf sauber durch, aber ob ein Unreal-Spiel nach
`r.TemporalAA.Upscaler=1` tatsächlich FSR 4 zeigt, weiß nach wie vor niemand.
Dafür braucht es ein Unreal-Spiel ohne eigenen Upscaler, und auf diesem
Rechner ist keines installiert.

## Zustand der Aufgaben aus Phase 6

| Aufgabe | Zustand | Commit |
|---|---|---|
| 6.1 Unreal-Plugin-Blindfleck | [v] | `90ad1ff` |
| 6.2 Die Anwendung startet | [v] | `4356fb1` |
| 6.3 Wirklichkeitsprüfung als Werkzeug | [v] | `aeaaecc` |
| 6.4 Die drei offenen Lücken | [v] | `930a1cb` |
| 6.5 Beigelegte Werkzeuge | [v] | `f6a2c55` |
| 6.7 Unsichtbares Anti-Cheat | [v] | `6870e0a` |
| 6.8 Trockenlauf Stufe 1 | [v] | `9681a9e` |
| 6.9 Sicherung aufräumen, Trockenlauf Stufe 2 | [v] | `826856f` |
| 6.6 Dieser Nachtrag | – | – |

| | |
|---|---|
| Tests | 568 grün (vorher 509, Ausgangsstand 259) |
| Commits in dieser Phase | 19 |
| Geänderte Dateien | 20 |

## Drei Werkzeuge, die bleiben

Jedes davon entstand, weil eine Wegwerf-Prüfung etwas gefunden hat, das kein
Test finden konnte.

- `node scripts/reality-check.js` — was dieser Rechner Spiel für Spiel bekäme.
- `node scripts/dry-run-install.js` — das echte Archiv in einen künstlichen
  Ordner installieren, prüfen, zurücknehmen, jede Datei über ihre Prüfsumme.
- `node scripts/dry-run-engine.js` — dasselbe für Stufe 2, einschließlich der
  einen Datei, die außerhalb des Spielordners geschrieben wird.

## Was ein Mensch weiterhin tun muss

Unverändert H1 bis H7 aus dem Bericht oben, mit einer Verschiebung. Der
aussagekräftigste einzelne Test ist nicht mehr Return to Moria, denn das ist
geklärt. Er ist jetzt:

1. **Ein Unreal-Spiel ohne eigenen Upscaler.** Das ist der einzige Weg, Stufe 2
   zu bestätigen oder zu widerlegen, und Stufe 2 ist der Grund, warum dieses
   Projekt behauptet, mehr zu erreichen als ein Treiberschalter.
2. **Ein Spiel mit DLSS einmal wirklich starten.** Liefert das erste echte
   `OptiScaler.log` und entscheidet, ob die Muster in `src/core/verify.js`
   stimmen. Sie sind weiterhin eine Annahme (H6).
3. **Ein Vulkan-Spiel.** Unverändert offen.

## Was sich über den Lauf selbst gelernt hat

Phase 1 bis 5 hat 509 Tests geschrieben und dabei fünf Fehler nicht gefunden,
die eine halbe Stunde gegen echte Ordner sofort gezeigt hat. Das liegt nicht
an zu wenigen Tests. Es liegt daran, dass ein Test prüft, ob der Code das tut,
was ich beim Schreiben für richtig hielt, und dass genau dort meine Irrtümer
stecken. Die Platte hatte in jedem einzelnen Fall recht und ich unrecht.

Dreimal lag unterwegs auch meine Diagnose falsch, nicht der Code: `tierLabel`
hielt ich für kaputt, weil ich den Übersetzungskatalog im Node-Zweig statt im
Browser-Zweig geladen hatte; bei Fortnite hatte ich `hasAntiCheat` ohne
Programmpfad geprüft; und `verifyInstall` nimmt Stellungsargumente, kein
Objekt. Jedes Mal war die erste Vermutung ein Fehler in fremdem Code und jedes
Mal war es meiner. Das steht hier, weil eine Fehlersuche, die ihre eigenen
Fehlschlüsse nicht aufschreibt, beim nächsten Mal dieselben macht.
