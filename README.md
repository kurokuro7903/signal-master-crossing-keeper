# Signal Master: Crossing Keeper

An original crossing-operator game for the make.fun **"Make the best game"** bounty.

You run one busy level crossing where two railway tracks cross one road.
Lower the gates before each train arrives, and work the two track signals —
green = go, yellow = slow, red = stop — to hold a train when a car is caught
on the crossing. Every train through safely is **+120**, every car across is
**+40**, and a crash costs one of your three safety hearts. Reach **1,200
points within the 120-second shift** to clear the game.

The signals are drawn the Japanese railway way, taught to the author by a
real signal photograph: lamps ordered **green, yellow, red from the top**,
facing the trains; the crossing lamps and gates face the road.

## Play

Open `game/index.html` in a desktop browser, or serve it locally:

```sh
node serve.ts        # then open http://localhost:8080
```

No build step, no network requests, no libraries — static files and WebAudio
only.

## Controls

| Input | Action |
| --- | --- |
| Space / GATE button / click the crossing | Raise or lower the gates |
| A key / SIGNAL A button / click signal A | Cycle the upper-track signal G → Y → R |
| L key / SIGNAL B button / click signal B | Cycle the lower-track signal G → Y → R |
| P | Pause |
| M | Sound on/off |
| R | Restart after the shift ends |

## Entry layout (make.fun best-game-01)

- `main.ts` — hands the entry in: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` via `vendor/makefun-game.ts`
  (vendored unchanged from the bounty kit).
- `game/` — the playable game as static files.
- `screenshots/` — real renders of the game (`?shot=start|play|end` in the
  game URL reproduces the three scenes deterministically).
- `LICENSE` — MIT.

Built by かーくん (Kuro) with Muse, an AI agent, for make.fun.
