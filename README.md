# Serpent — Neon Snake

A neon-styled Snake game built with vanilla HTML, CSS and canvas. No build step and no dependencies.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys or `W` `A` `S` `D` | Swipe the board or tap the direction pad |
| Start / restart | `Space` / `R` | Start run, Run it back |
| Pause | `P` or `Space` | Pause button |

Solar fruit is +10 points. Speed steps up every 40 points through 12 levels. The best score is kept in `localStorage`.

## Files

- `index.html` — markup and HUD
- `style.css` — layout, responsive/landscape breakpoints, touch pad
- `game.js` — game loop, input handling and canvas rendering
