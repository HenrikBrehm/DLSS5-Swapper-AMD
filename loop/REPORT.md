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
