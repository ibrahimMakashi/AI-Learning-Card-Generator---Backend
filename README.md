# AI Learning Card Generator

A full-stack application that generates AI-powered learning cards in real time using OpenAI and WebSockets. Cards are produced **one at a time** on the server (sequential GPT calls) and pushed to the client over a **single persistent WebSocket** connection.

## Features

- **AI-powered content** — configurable **1–10 cards** per topic, each with a rotating focus (Core Concept, Applications, Misconceptions, and more)
- **Real-time delivery** — cards appear one by one via WebSocket as each finishes (save to MongoDB, then push to client)
- **Success / Failure modes** — Failure mode randomly fails **one** card to demo the retry flow
- **Stop generation** — abort the in-flight OpenAI request mid-run; remaining slots show as skipped
- **Retry without reconnect** — retry only the failed card over the same WebSocket
- **Session history** — past sessions via REST at `/history` and detail view at `/session/:id`
- **Single shared WebSocket** — one connection for the whole app (React Context), with client-side handler fan-out
- **Auto-reconnect** — exponential backoff (up to 5 attempts)
- **Toast notifications** — success, error, warning, and info feedback
- **Copy card content** — one-click copy per card
- **Progress UI** — step track and skeleton loading between cards
- **Responsive UI** — sidebar layout on desktop, mobile-friendly

---

## Tech Stack

| Layer      | Technology                                      |
|------------|-------------------------------------------------|
| Frontend   | React 18, Vite, Tailwind CSS, React Router      |
| UI         | Radix UI primitives, Lucide icons               |
| Backend    | Node.js, Express.js                             |
| Realtime   | WebSocket (`ws` package)                        |
| Database   | MongoDB, Mongoose                               |
| AI         | OpenAI API (`gpt-4o-mini`)                      |

---

## Architecture (high level)

```
Browser (React)
  └── WebSocketProvider — one socket, shared via Context
        ├── sendMessage()        → server
        └── addMessageHandler()  → fan-out to Home, SessionDetails, etc.

Server (Node)
  └── wsHandler — GENERATE loop: GPT → MongoDB → ws.send(CARD)
        └── REST /api/sessions — history only (no WebSocket)
```

---

## Project Structure

```
root/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── TopicForm.jsx
│   │   │   ├── LearningCard.jsx
│   │   │   ├── SkeletonCard.jsx
│   │   │   ├── ErrorCard.jsx
│   │   │   ├── SessionCard.jsx
│   │   │   ├── ProgressBar.jsx
│   │   │   ├── Layout.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── ui/              # button, input, card, badge, etc.
│   │   ├── context/
│   │   │   ├── WebSocketContext.jsx
│   │   │   └── ToastContext.jsx
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── History.jsx
│   │   │   └── SessionDetails.jsx
│   │   ├── lib/
│   │   │   └── utils.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.example
│   └── package.json
│
├── server/
│   ├── config/
│   │   └── db.js
│   ├── controllers/
│   │   └── sessionController.js
│   ├── models/
│   │   └── GenerationSession.js
│   ├── routes/
│   │   └── sessionRoutes.js
│   ├── services/
│   │   └── openaiService.js
│   ├── websocket/
│   │   └── wsHandler.js
│   ├── server.js
│   ├── .env.example
│   └── package.json
│
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB (local instance or [MongoDB Atlas](https://www.mongodb.com/atlas))
- OpenAI API key ([platform.openai.com](https://platform.openai.com))

---

### 1 — Backend Setup

```bash
cd server
npm install
```

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/ai-learning-cards
OPENAI_API_KEY=sk-...
```

Start the dev server:

```bash
npm run dev
```

The server runs on `http://localhost:5000`.

---

### 2 — Frontend Setup

```bash
cd client
npm install
```

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

```env
VITE_WS_URL=ws://localhost:5000
VITE_API_URL=http://localhost:5000
```

Start the dev client:

```bash
npm run dev
```

The client runs on `http://localhost:3000`.

---

## API Reference

### REST Endpoints

| Method | Endpoint              | Description            |
|--------|-----------------------|------------------------|
| GET    | `/api/sessions`       | Get all sessions       |
| GET    | `/api/sessions/:id`   | Get session by ID      |
| GET    | `/health`             | Server health check    |

### WebSocket Events

**Client → Server**

| Event      | Payload                                                                 | Description                    |
|------------|-------------------------------------------------------------------------|--------------------------------|
| `GENERATE` | `{ type, topic, mode: "success" \| "failure", cardCount: 1–10 }`       | Start generation               |
| `STOP`     | `{ type }`                                                              | Abort current generation       |
| `RETRY`    | `{ type, sessionId, cardNumber }`                                       | Retry one failed card          |

**Server → Client**

| Event             | Payload                                                          | Description                          |
|-------------------|------------------------------------------------------------------|--------------------------------------|
| `SESSION_CREATED` | `{ type, sessionId }`                                            | Session created in DB                |
| `CARD`            | `{ type, cardNumber, data: { title, concept, funFact } }`        | One card ready                       |
| `ERROR`           | `{ type, cardNumber, message, sessionId? }`                      | Card failed (`cardNumber: null` = critical) |
| `COMPLETE`        | `{ type, anyFailed }`                                            | All cards processed                  |
| `STOPPED`         | `{ type, sessionId, completedCards, total }`                       | Generation aborted mid-run           |
| `STOP_ACK`        | `{ type }`                                                       | Stop request acknowledged            |

---

## Database Schema

```js
GenerationSession {
  topic: String,
  totalCards: Number,           // default 3
  status: "pending" | "completed" | "failed" | "stopped",
  cards: [{
    cardNumber: Number,
    title: String,
    concept: String,
    funFact: String,
    status: "pending" | "completed" | "failed"
  }],
  createdAt: Date
}
```

---

## Usage Guide

1. Open `http://localhost:3000`
2. Enter a topic (e.g. "Photosynthesis")
3. Choose card count (**1–10**) and **Success Mode** or **Failure Mode**
4. Click **Generate Learning Cards**
5. Watch cards arrive one by one (skeleton → card → next skeleton)
6. Use **Stop** to cancel mid-generation if needed
7. In Failure Mode, one random card fails — click **Retry** on that card only
8. Open **History** in the sidebar to browse past sessions (`/history`)
9. Click a session for **View Details** (`/session/:id`) — retry works there too via WebSocket

---

## Environment Variables

### Server

| Variable         | Description                          | Default  |
|------------------|--------------------------------------|----------|
| `PORT`           | Server port                          | `5000`   |
| `MONGO_URI`      | MongoDB connection string            | —        |
| `OPENAI_API_KEY` | OpenAI API key                       | —        |

### Client

| Variable          | Description              | Default                     |
|-------------------|--------------------------|-----------------------------|
| `VITE_WS_URL`     | WebSocket server URL     | `ws://localhost:5000`       |
| `VITE_API_URL`    | REST API base URL        | `http://localhost:5000`     |
