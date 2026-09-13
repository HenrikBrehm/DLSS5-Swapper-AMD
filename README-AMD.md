# Upscaling on a Radeon

This is the AMD half of [DLSS 5 Swapper](https://github.com/rakanki911/DLSS5-Swapper). The original
brings NVIDIA's neural rendering to games; none of it runs on a Radeon, because
every route it has ends in NVIDIA's NGX runtime. This fork adds routes that do.

*Deutsche Fassung weiter unten.*

**Work in progress.** Everything here is covered by tests, and nothing here has
been confirmed by running a real game yet. Treat it as a build you help test,
not as a finished tool.

What *has* been checked against real files: the install places the real
OptiScaler release, writes the FSR 4 configuration, and comes back out leaving
the folder byte for byte as it was. See **Checking it yourself** below. What
nobody has seen is a game rendering a frame with any of it.

## What it does

It looks at a game and works out the best upscaling it can actually reach, then
says why. There are three tiers, and they are ranked by result rather than by
convenience.

| Tier | When | What you get |
|---|---|---|
| 1 | The game already ships DLSS, FSR 2+ or XeSS | FSR 4.1, by replacing what is there |
| 2 | The game ships none, but runs on Unreal | FSR 4.1, by opening the engine's upscaler slot |
| 3 | Anything else | Driver settings and spatial upscaling |

Tier 1 and tier 2 give the same picture. Tier 3 is a lesser thing and the tool
says so rather than letting you find out.

### Why tier 2 works at all

A game with temporal anti-aliasing already produces exactly what FSR needs:
motion vectors and a camera that shifts slightly each frame. AMD's own FSR 2
documentation says FSR replaces the game's TAA rather than running after it.
What is normally missing is a way in, and Unreal has one. Opening it gets a
game that shipped no upscaler the same FSR 4 as one that did.

## The routes

The four NVIDIA routes are untouched. On a Radeon they are never offered; on an
NVIDIA card nothing about them changed.

| Route | Tier | For |
|---|---|---|
| `amd-optiscaler` | 1 | Replacing the game's own upscaler with FSR 4 |
| `engine-upscale` | 2 | Opening Unreal's upscaler slot, then the same |
| `amd-driver` | 3 | Guided Adrenalin settings; installs nothing |
| `spatial` | 3 | A lower render resolution scaled back up |
| `native` | – | NVIDIA, unchanged |
| `feeder` | – | NVIDIA, unchanged |
| `optiscaler` | – | NVIDIA, unchanged |
| `renodx` | – | NVIDIA, unchanged |

## What you need

- A Radeon RX 7000 or newer for FSR 4. An RX 6000 gets FSR 3.1 instead.
- On an RX 7000, **Adrenalin 26.6.2 or newer**. That release brought the INT8
  model that makes FSR 4 possible on RDNA3, and without it the tool falls back
  to FSR 3.1 and tells you so.
- Windows 10 or 11, 64-bit.

Nothing is bundled. OptiScaler is downloaded from its own release page and
checked against a pinned checksum before a single file is copied. AMD's FSR 4
library is read from your installed driver and never redistributed.

## What does not work

Said plainly, because finding out the hard way costs an evening.

- **Anti-cheat games get driver settings only.** Nothing is placed beside the
  executable. The driver reaches them anyway, and that is worth more than the
  risk.
- **RDNA2 has no FSR 4** until AMD ships it, announced for early 2027.
- **The Adrenalin FSR 4 toggle does not reach Vulkan.** A Vulkan game with
  FSR 3.1 still gets there, but through OptiScaler rather than the driver.
- **There is no real upscaling for a game with no motion vectors.** Tier 3
  sharpens a smaller picture; it cannot reconstruct detail. That limit is
  information-theoretic, not effort.
- **Machine-learning frame generation is RDNA4 only.** On an RX 7000 the same
  option runs the FSR 3 generator.

## Checking it worked

Install, start the game once, then look at the game entry again. The tool reads
OptiScaler's own log and says which upscaler actually ran. "Installed" and
"running" are different statements, and only the second one is worth anything.

## Checking it yourself

Three scripts, all read-only about your games and none of which starts one.

```
node scripts/reality-check.js     what each installed game would actually get
node scripts/dry-run-install.js   install the real release into a temporary
                                  folder, check it, take it back out
node scripts/dry-run-engine.js    the same for tier 2, including the one file
                                  written outside the game folder
```

The first is the one worth running before you believe anything here. It says
how many of your games reach real upscaling rather than how many got an
answer, because those are different numbers and only the first one matters.

## Undoing it

**Restore originals** puts the game folder back byte for byte. Tier 2 also
edits one file outside the game folder, under `%LOCALAPPDATA%`, because that is
where Unreal keeps its per-game configuration; that is undone too, including
whether the file was read-only or did not exist at all.

## Credits

- [DLSS 5 Swapper](https://github.com/rakanki911/DLSS5-Swapper) by Rakan Alkhaldi, MIT — the application this forks.
- [OptiScaler](https://github.com/optiscaler/OptiScaler), GPL-3.0 — what actually does the upscaling.
- [OptiScaler's compatibility list](https://github.com/optiscaler/OptiScaler/wiki/Compatibility-List) — 698 games, tried by the people who wrote it down.
- AMD FidelityFX, Intel XeSS, Nukem9's DLSSG-to-FSR3, fakenvapi. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

# Upscaling auf einer Radeon

Das ist die AMD-Hälfte von [DLSS 5 Swapper](https://github.com/rakanki911/DLSS5-Swapper). Das Original
bringt NVIDIAs Neural Rendering in Spiele; davon läuft auf einer Radeon nichts,
weil jede seiner Routen in NVIDIAs NGX-Laufzeitumgebung endet. Dieser Fork
ergänzt Routen, die es tun.

**In Arbeit.** Alles hier ist durch Tests abgesichert, aber nichts davon wurde
bisher mit einem echten Spiel bestätigt. Betrachte es als Bauversion zum
Mittesten, nicht als fertiges Werkzeug.

Was gegen echte Dateien geprüft ist: die Installation legt das echte
OptiScaler-Release ab, schreibt die FSR-4-Konfiguration und lässt den Ordner
beim Zurücknehmen byteweise so zurück, wie er war. Siehe **Selbst nachprüfen**
weiter unten. Was niemand gesehen hat, ist ein Spiel, das damit ein Bild
zeichnet.

## Was es tut

Es sieht sich ein Spiel an, ermittelt das beste Upscaling, das dort wirklich
erreichbar ist, und sagt warum. Es gibt drei Stufen, sortiert nach Ergebnis und
nicht nach Bequemlichkeit.

| Stufe | Wann | Was du bekommst |
|---|---|---|
| 1 | Das Spiel bringt DLSS, FSR 2+ oder XeSS mit | FSR 4.1, durch Ersetzen des Vorhandenen |
| 2 | Es bringt keines mit, läuft aber auf Unreal | FSR 4.1, durch Öffnen des Engine-Steckplatzes |
| 3 | Alles andere | Treibereinstellungen und räumliches Upscaling |

Stufe 1 und 2 liefern dasselbe Bild. Stufe 3 ist weniger, und das Werkzeug sagt
es, statt es dich selbst herausfinden zu lassen.

### Warum Stufe 2 überhaupt funktioniert

Ein Spiel mit temporalem Antialiasing erzeugt bereits genau das, was FSR
braucht: Bewegungsvektoren und eine pro Bild leicht versetzte Kamera. AMDs
eigene FSR-2-Dokumentation sagt, dass FSR das TAA des Spiels ersetzt und nicht
dahinter läuft. Was normalerweise fehlt, ist ein Zugang, und Unreal hat einen.
Öffnet man ihn, bekommt ein Spiel ohne eigenen Upscaler dasselbe FSR 4 wie
eines mit.

## Was du brauchst

- Eine Radeon RX 7000 oder neuer für FSR 4. Eine RX 6000 bekommt FSR 3.1.
- Auf einer RX 7000 **Adrenalin 26.6.2 oder neuer**. Mit dieser Fassung kam das
  INT8-Modell, das FSR 4 auf RDNA3 möglich macht. Ohne sie weicht das Werkzeug
  auf FSR 3.1 aus und sagt dir das.
- Windows 10 oder 11, 64 Bit.

Nichts wird mitgeliefert. OptiScaler wird von seiner eigenen
Veröffentlichungsseite geladen und gegen eine hinterlegte Prüfsumme geprüft,
bevor eine einzige Datei kopiert wird. AMDs FSR-4-Bibliothek wird aus deinem
installierten Treiber gelesen und niemals weitergegeben.

## Was nicht geht

Deutlich gesagt, weil es einen Abend kostet, es selbst herauszufinden.

- **Spiele mit Anti-Cheat bekommen nur Treibereinstellungen.** Neben die
  Programmdatei wird nichts gelegt. Der Treiber erreicht sie ohnehin, und das
  ist mehr wert als das Risiko.
- **RDNA2 hat kein FSR 4**, bis AMD es liefert, angekündigt für Anfang 2027.
- **Der FSR-4-Schalter im Adrenalin greift bei Vulkan nicht.** Ein Vulkan-Spiel
  mit FSR 3.1 kommt trotzdem hin, aber über OptiScaler statt über den Treiber.
- **Für ein Spiel ohne Bewegungsvektoren gibt es kein echtes Upscaling.**
  Stufe 3 schärft ein kleineres Bild, sie kann keine Details rekonstruieren.
  Diese Grenze ist eine Frage fehlender Information, nicht fehlenden Aufwands.
- **ML-gestützte Frame Generation gibt es nur auf RDNA4.** Auf einer RX 7000
  läuft dieselbe Option mit dem FSR-3-Verfahren.

## Prüfen, ob es gewirkt hat

Installieren, das Spiel einmal starten, dann den Eintrag erneut ansehen. Das
Werkzeug liest OptiScalers eigenes Protokoll und sagt, welcher Upscaler
tatsächlich lief. „Installiert" und „läuft" sind zwei verschiedene Aussagen,
und nur die zweite ist etwas wert.

## Selbst nachprüfen

Drei Skripte. Alle lesen deine Spiele nur, keines startet eines.

```
node scripts/reality-check.js     was jedes installierte Spiel wirklich bekäme
node scripts/dry-run-install.js   das echte Release in einen temporären Ordner
                                  installieren, prüfen, zurücknehmen
node scripts/dry-run-engine.js    dasselbe für Stufe 2, samt der einen Datei
                                  außerhalb des Spielordners
```

Das erste ist das, was man laufen lassen sollte, bevor man hier irgendetwas
glaubt. Es sagt, wie viele deiner Spiele echtes Upscaling erreichen, nicht wie
viele eine Antwort bekommen. Das sind zwei verschiedene Zahlen, und nur die
erste zählt.

## Rückgängig machen

**Originale wiederherstellen** setzt den Spielordner byteweise zurück. Stufe 2
ändert zusätzlich eine Datei außerhalb des Spielordners unter
`%LOCALAPPDATA%`, weil Unreal dort seine spielbezogene Konfiguration ablegt.
Auch das wird zurückgenommen, einschließlich der Frage, ob die Datei
schreibgeschützt war oder gar nicht existierte.

## Dank

- [DLSS 5 Swapper](https://github.com/rakanki911/DLSS5-Swapper) von Rakan Alkhaldi, MIT — die Anwendung, von der dies abzweigt.
- [OptiScaler](https://github.com/optiscaler/OptiScaler), GPL-3.0 — was das Upscaling tatsächlich macht.
- [OptiScalers Kompatibilitätsliste](https://github.com/optiscaler/OptiScaler/wiki/Compatibility-List) — 698 Spiele, ausprobiert von denen, die es aufgeschrieben haben.
- AMD FidelityFX, Intel XeSS, Nukem9s DLSSG-to-FSR3, fakenvapi. Siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
