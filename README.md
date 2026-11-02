# PulseVote — Real-time polling assessment starter

## Architecture
React (Vite) → Go/Gin REST API → MongoDB  
Go vote handler → Redis Pub/Sub → Go WebSocket hub → React clients

MongoDB stores users, polls, and votes. Redis is used for cross-instance vote-event distribution (not merely as an unused cache). WebSockets push refreshed poll state to every viewer.

## Requirements
- Go 1.22+
- Node.js 20+
- Docker Desktop (or local MongoDB and Redis)

## 1. Start infrastructure
From the project root:
```bash
docker compose up -d
```

## 2. Start backend
```bash
cd backend
cp .env.example .env
go mod tidy
go run .
```
Backend: http://localhost:8080

## 3. Start frontend
In a second terminal:
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Frontend: http://localhost:5173

Create an account, create a poll, copy its share link, and open it in another browser window. Vote and watch the results update live.

## Environment
Backend values are in `backend/.env.example`. Frontend API URL is in `frontend/.env.example`.

## API
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/polls`
- `POST /api/polls` (JWT)
- `GET /api/polls/:id`
- `POST /api/polls/:id/vote` (JWT)
- `GET /ws/polls/:id` (WebSocket)

## Production checklist
Use managed MongoDB/Redis, HTTPS/WSS, strong JWT secret, CORS restricted to your deployed frontend, rate limiting, request size limits, structured logs, and deployment secrets. Add automated tests and enforce poll expiry in the vote handler (already included).
