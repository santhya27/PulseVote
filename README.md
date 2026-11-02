# PulseVote — Real-Time Audience Polling

PulseVote is a real-time audience polling web application that allows users to create polls, share them with an audience, and view live voting results. It supports standard polls and quiz-style polls, with features for poll management, analytics, and live updates.

## Project Links

- **Live Application:** https://pulsevote-tan.vercel.app/
- **Backend API:** https://pulsevote-r8mu.onrender.com
- **GitHub Repository:** https://github.com/santhya27/PulseVote

## Features

- **User Authentication:** Create an account and sign in securely.
- **Poll Creation:** Create polls with multiple answer options and configurable closing times.
- **Voting:** Submit votes and prevent duplicate voting.
- **Live Results:** View vote counts and percentages with real-time updates.
- **Poll Sharing:** Share polls through direct links and QR codes.
- **Poll Management:** Edit polls before the first vote and delete polls as the creator.
- **Automatic Poll Closure:** Close polls when their configured deadline is reached.
- **Presenter Mode:** Display polls and results for an audience.
- **Analytics Dashboard:** View participation, vote distribution, trends, and poll outcomes.
- **Quiz Mode:** Reveal correct answers and track participation scores.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Go, Gin |
| Database | MongoDB |
| Real-time messaging | Redis Pub/Sub |
| Live communication | WebSockets |
| Frontend deployment | Vercel |
| Backend deployment | Render |

## Project Structure

```text
PulseVote/
├── frontend/             # React frontend
│   ├── src/              # Application source code
│   ├── public/           # Static assets
│   ├── .env.example      # Frontend environment template
│   └── package.json      # Frontend dependencies and scripts
├── backend/              # Go backend
│   ├── .env.example      # Backend environment template
│   ├── go.mod            # Go module and dependencies
│   └── ...               # API, database, and WebSocket code
├── docker-compose.yml     # Local MongoDB and Redis services
└── README.md              # Project documentation
```

## Architecture and Technical Decisions

- **React and Vite** provide a responsive frontend and fast development workflow.
- **Go and Gin** handle API requests, authentication, poll management, and voting.
- **MongoDB** stores application data, including users, polls, and votes.
- **Redis Pub/Sub** distributes poll events between backend instances.
- **WebSockets** deliver live voting updates to connected clients.
- **Vercel and Render** host the frontend and backend separately.

## Getting Started

### Prerequisites

Install the following before running the project locally:

- [Git](https://git-scm.com/)
- [Node.js and npm](https://nodejs.org/)
- [Go](https://go.dev/dl/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Clone the repository

```bash
git clone https://github.com/santhya27/PulseVote.git
cd PulseVote
```

### 2. Configure environment variables

Create local environment files from the example templates.

For the backend, create `backend/.env` using `backend/.env.example`.

For the frontend, create `frontend/.env` using `frontend/.env.example`.

Configure the required values for your local environment. Do not commit `.env` files or expose credentials in the repository.

### 3. Start MongoDB and Redis

From the project root, run:

```bash
docker compose up -d
```

This starts the local database and Redis services defined in `docker-compose.yml`.

### 4. Run the backend

Open a terminal:

```bash
cd backend
go run .
```

The backend runs locally at:

```text
http://localhost:8080
```

### 5. Run the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local frontend URL printed by Vite, usually:

```text
http://localhost:5173
```

## Environment Configuration

### Backend

Configure the backend environment variables in `backend/.env`. Refer to `backend/.env.example` for the exact variable names and required settings.

Typical configuration includes:

- MongoDB connection URI and database name
- Redis address and password
- JWT signing secret
- Frontend origin for CORS
- Port configuration

### Frontend

Configure the frontend API URL in `frontend/.env`, following the variable name in `frontend/.env.example`.

For local development, the API URL should point to the local backend. For production, it should point to the deployed Render backend.

## Deployment

### Frontend — Vercel

The frontend is deployed on Vercel:

https://pulsevote-tan.vercel.app/

Configure the production API environment variable in the Vercel project settings to point to the deployed backend. Redeploy after changing environment variables.

### Backend — Render

The backend is deployed on Render:

https://pulsevote-r8mu.onrender.com

Configure the backend environment variables in the Render dashboard. Ensure the MongoDB Atlas network access settings permit the deployed backend to connect.

## Security Notes

- Keep database credentials, Redis passwords, and JWT secrets in environment variables.
- Do not commit `.env` files or production secrets.
- Configure CORS to allow the deployed frontend origin.
- Validate and sanitize user input on the backend.
- Enforce authentication and poll ownership for protected actions.

## Future Improvements

- Add more detailed poll analytics and export options.
- Improve accessibility and mobile usability.
- Introduce optional ML-based insights for poll trends.
- Expand localization and language support.

## License

This project was developed as a software project submission. Add a license file if you intend to distribute it under a specific open-source license.
