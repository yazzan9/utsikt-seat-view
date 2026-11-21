# Utsikt · Ullevi seat view (Gothenburg)

Interactive 3D tool to preview the view from any seat in Ullevi stadium in Gothenburg. 
Orbit the stadium, click or search a seat, and see what you would see, by day (football) or night (concert).

**Live demo:** https://yazzan9.github.io/utsikt-seat-view/

## Features
- 3D drone view with orbit, plus 360° look-around from any seat
- Search ("A 12 8"), section/row/seat dropdowns, or click in 3D / on the map
- Concert (night, stage lights, light show) and football (day) layouts
- Nearest entrance suggestion and walking route
- Rain-cover and best-view filters, colour-blind-safe palettes
- Phone-friendly bottom sheet, adaptive quality for smooth performance

## Disclaimer
Approximate model, **not official seat data**. Not affiliated with the stadium or its operator.
Always check your ticket for your real seat.

## Develop
```
npm install
bash build.sh      # bundles src/ with esbuild into a single index.html
```
Built with Three.js. License: MIT.
