# Chess Local Arena

A static chess web app that supports:

- Local human vs human play
- Local human vs AI play
- Highlighted legal move targets after selecting a piece
- Undo in both modes
- Installable PWA with local asset caching and offline play

## Run locally with Docker

```bash
docker compose up --build
```

Open:

```bash
http://localhost:8080
```

After the first successful load, the app shell and chess assets are cached by a
Service Worker. The installed PWA can then be reopened and played offline.
