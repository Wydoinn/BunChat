# BunChat

Temporary, private chat rooms powered by Bun and WebSockets.

BunChat is designed for conversations that should disappear. Rooms, messages,
password hashes, images, and voice notes live only in the server process
memory. There is no database, persistent file storage, analytics, cookies, or
message-content logging.

> **Privacy note:** Transport is protected by HTTPS/WSS when deployed behind
> TLS. BunChat is not end-to-end encrypted: the server process handles room
> authentication and relays message data while a room is active.

## Features

- Create an open or password-protected room without an account.
- Share an invite URL or short room ID.
- Ephemeral text, image, and voice messages.
- Room names, configurable lifetime, participant limits, and image controls.
- Reply snapshots, presence, typing indicators, and reconnect handling.
- Responsive, mobile-first interface for phones, tablets, and desktops.
- Keyboard-accessible controls with reduced-motion support.
- Rate limits, payload limits, input validation, and security headers.
- Health endpoint for deployment monitoring.

## How it works

The application is a single Bun process:

- [`server/server.ts`](server/server.ts) serves the client, HTTP API, and
  WebSocket endpoint.
- [`server/roomManager.ts`](server/roomManager.ts) owns the in-memory room
  lifecycle and application limits.
- [`server/rateLimiter.ts`](server/rateLimiter.ts) provides per-user and
  per-IP token buckets.
- [`client/`](client/) contains a framework-free ES-module client. There is no
  bundler or frontend build step.

The client has four views:

1. Landing page
2. Room setup at `/start`
3. Password/name gate at `/room/:id`
4. Live chat room

Room lifetime is fixed at creation. Joining, messaging, and sharing media do
not extend it. Empty rooms are destroyed immediately, and expired rooms are
removed by a periodic sweeper.

## Room options

| Option | Accepted values | Default |
| --- | --- | --- |
| Password | 1–128 characters, or empty | No password |
| Room name | 1–40 characters, or empty | `Room <id>` |
| Lifetime | 5m, 15m, 30m, 1h, 3h, 12h, 24h | 30 minutes |
| Participants | 2, 5, 10, or 20 | 20 |
| Images | Enabled or disabled | Enabled |

Invalid lifetime and participant values are rejected rather than silently
coerced.

## Requirements

- [Bun](https://bun.sh/) 1.1 or newer
- A modern browser with WebSocket support

## Run locally

```sh
bun install
bun run dev
```

Open <http://localhost:3000>.

For a production-style local run:

```sh
bun run start
```

The server reads `PORT` from the environment and defaults to `3000`.
See [`.env.example`](.env.example).

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start Bun with file watching |
| `bun run start` | Start the server |
| `bun run check` | Run TypeScript validation |
| `bun test` | Run the server unit tests |

The test suite covers room lifecycle behavior, password handling, expiry, and
rate limiting.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serve the application |
| `GET` | `/start` | Serve the room setup view |
| `GET` | `/room/:id` | Serve the invite/join view |
| `POST` | `/api/rooms` | Create a room |
| `GET` | `/api/rooms/:id` | Return non-sensitive room metadata |
| `GET` | `/health` | Return process and room-count health |
| WebSocket | `/ws` | Join rooms and exchange ephemeral events |

Room metadata never includes messages or password hashes.

## Security and privacy safeguards

- Passwords are hashed with Bun's Argon2id password API.
- Text is rendered through DOM text nodes rather than interpolated HTML.
- Room membership and password checks occur during the WebSocket join flow.
- Per-IP room-creation limits prevent uncontrolled room creation.
- Per-user event limits protect chat and media handling.
- HTTP and WebSocket payload sizes are bounded.
- Images and voice notes are validated by type, size, and data URL structure.
- CSP, frame, content-type, referrer, and opener security headers are sent.
- Shutdown destroys rooms and clears in-memory data.
- No application data is written to disk.

## Browser compatibility

BunChat uses standards-based HTML, CSS, JavaScript, and WebSockets. The
interface adapts to narrow phones, tablets, laptops, large displays, portrait
mode, landscape mode, browser zoom, safe-area insets, touch input, mouse input,
and keyboard navigation.

Clipboard sharing, native share sheets, microphone recording, and drag-and-drop
are progressive enhancements. If a browser denies permission or does not
support one of those capabilities, text chat remains available.

Voice notes use mono 16 kHz WAV data for broad browser playback compatibility.
Microphone recording requires a secure context (`https://` or localhost) and
user permission.

## Deployment

BunChat requires one continuously running Bun process with WebSocket support.
Northflank is the recommended deployment platform for this repository. Other
long-running container hosts can be used when they support persistent
WebSockets and a single application instance.

Configure the service to run:

```sh
bun install
bun run start
```

Configure the platform's health check to use `/health`, expose the configured
`PORT`, and terminate TLS at the platform so browser clients can use WSS and
microphone permissions work correctly.

### Northflank deployment

Create a service from the GitHub repository and configure it to build from the
root [`Dockerfile`](Dockerfile):

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
```

Use one replica, expose port `3000`, and configure `/health` as the health
check path. The server also respects a platform-provided `PORT` value.

### Important deployment constraints

- Run exactly one replica. Room state exists only in that process's memory.
- Do not deploy as a static-only site such as GitHub Pages.
- Do not use a serverless-only deployment model without redesigning room state
  and WebSocket handling around shared infrastructure.
- Restarting or redeploying the process permanently destroys active rooms.
- Scaling horizontally requires shared room storage and a pub/sub layer; that
  is outside the current architecture.

## Project status

BunChat is intentionally small and dependency-light. It has no database,
authentication account system, frontend framework, or persistence layer.
Changes should preserve the ephemeral-room model and keep the client and
server limits synchronized through
[`client/js/constants.js`](client/js/constants.js) and
[`server/roomManager.ts`](server/roomManager.ts).

Before opening a pull request, run:

```sh
bun run check
bun test
```

## License

See [`LICENSE`](LICENSE).
