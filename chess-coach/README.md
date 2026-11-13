# Chess Coach

An AI chess coach built around **your own chess.com games**:

1. **Connect** with just your chess.com username (public API — no password).
2. **Review** — Stockfish checks every move of a game. For each inaccuracy / mistake / blunder you get *what happened*, *why it was wrong* (the tactic you allowed or missed), *the better line*, and a rule of thumb to remember. You can replay the better line, see what happened after your move, or **try it yourself** and get engine-checked feedback.
3. **Find your weaknesses** — mistakes from all reviewed games are grouped by idea (hanging pieces, forks, pins, back-rank mates, …) so you see what actually costs you games.
4. **Train** — puzzles mined from real games and verified by the engine (unique best move). Pick *my weaknesses*, *my own mistakes* (positions from your games), a theme, or a mixed set. A wrong move tells you exactly why it fails; hints escalate (idea → which piece → the move). Failed puzzles come back later.
5. **Learn** — short lessons per theme with real examples you can step through.

```
cd chess-coach
npm install
npm start                      # http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-... npm start   # optional: Claude writes the explanations + "ask the coach" chat
```

Without an API key the app still works end to end: explanations are generated from the engine's facts by a rule-based coach. With a key, Claude rewrites those same verified facts into a personal explanation (it is told not to invent moves), and the review screen gets a chat box. Model: `COACH_MODEL` (default `claude-sonnet-5-5`).

## Reach it from anywhere

The app is a normal Node server, so it can live anywhere. It is **locked down by default**: it only listens on `127.0.0.1`, and it refuses to listen on a public address unless `APP_PASSWORD` is set.

| Setting | What it does |
|---|---|
| `APP_PASSWORD` | Required for any public address. Browser asks for it (any username). 8 wrong tries from one IP locks it for 10 min. |
| `ALLOWED_USERS` | Comma-separated chess.com usernames that may be analysed (others get 403). Stops strangers burning your CPU / API key. |
| `DEFAULT_USER` | Pre-selects and auto-connects this account. |
| `MAX_JOBS` | Concurrent analyses (default 2). Extra requests get a friendly "busy" message. |
| `HOST`, `PORT` | Bind address (default `127.0.0.1:3000`). |

**A. Your own computer + a private link (simplest).** Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (or Tailscale), then:

```
./scripts/share.sh        # starts the app, prints the password and an https://….trycloudflare.com URL
```

The URL works from any device while the script runs (the quick-tunnel URL changes each run). For a stable address use a named Cloudflare tunnel, or `USE_TAILSCALE=1 ./scripts/share.sh` to make it reachable only from your own devices.

**B. Always-on with Docker** (home server, VPS, Raspberry Pi 5):

```
printf 'APP_PASSWORD=choose-a-long-password\nANTHROPIC_API_KEY=\n' > .env
docker compose up -d      # data (analyses, puzzles, progress) lives in a volume
```

Put it behind HTTPS (Caddy, Cloudflare Tunnel or Tailscale) — HTTP Basic auth sends the password with every request, so never expose it over plain `http://` on the open internet.

**C. Fly.io** — `fly.toml` is included; the comments at the top list the 4 commands. It uses a 2-vCPU shared machine; reviews run on the CPU, so a tiny instance is slow.

> Docker/Fly files were written but not build-tested in the environment this was developed in (no Docker daemon). The server, password, allow-list and headers *were* tested directly.

## Use it from Claude (MCP connector)

The same engine is exposed as an MCP server, so Claude Desktop / Claude Code can read your games and coach you in conversation:

```
claude mcp add chess-coach -- node /absolute/path/to/chess-coach/mcp/server.js
```

Tools: `list_games`, `review_game`, `weakness_profile`, `get_puzzles`.

## How it works

| Piece | File | Notes |
|---|---|---|
| chess.com connector | `src/chesscom.js` | Published-Data API: profile, stats, monthly archives; cached in `data/cache` |
| Engine | `src/engine.js` | Stockfish 19 (WASM, from the `stockfish` npm package) in a small process pool; depth 14 for review |
| Move review | `src/analyze.js` | Win-% loss per move (Lichess formula) → best / good / inaccuracy / mistake / blunder |
| Tactic detector | `src/themes.js` | Names the idea in an engine line: fork, pin, skewer, discovered attack, hanging piece, back-rank mate, sacrifice, promotion… |
| Coach | `src/coach.js`, `src/lessons.js` | Rule-based explainer + optional Claude rewrite; lessons per theme |
| Puzzles | `src/puzzles.js`, `src/library.js` | Mines positions after a blunder (or your own blunders), verifies uniqueness with a deeper multi-PV search, accepts alternative moves the engine rates equally |
| Weakness profile | `src/profile.js` | Weighted by severity, split into "allowed" vs "missed" |
| UI | `public/` | Vanilla JS, self-contained board (click or drag) |

`data/seed-puzzles.json` ships ~200 puzzles mined from public games. "Find more like this" in *Train* mines new ones for a theme from games of your recent opponents. Rebuild the seed with `npm run seed`.

## Limits worth knowing

- Theme labels are heuristics on top of the engine's line; the *move evaluation* is the engine's, the *name of the idea* occasionally isn't what a human coach would say.
- Review depth is 14 (≈10–20 s per game). Deeper = slower, slightly more accurate.
- Only standard chess (no variants). Games are matched to your account by username.
- Pieces: the full app loads chess.com's default (Neo) set from chess.com's servers in your browser (header dropdown switches to the original hand-drawn SVG set in `public/js/pieces.js`). The artwork is chess.com's, so it is never copied into this repository. For the hosted drill page, `node scripts/fetch-pieces.js` caches the set locally (git-ignored) so `build-drill.js` can embed it; keep that page private.
- Everything is stored locally in `data/` (analyses, puzzles, progress); nothing is sent anywhere except requests to chess.com and, if you set a key, the position facts to the Anthropic API.

## Tests

`npm test` — theme detector, classification, seed-library legality, and engine-backed puzzle checking.
