# Ask Your Data

### Intelligent Business Intelligence & Analytics Platform with Apache Superset Parity, Grounded AI Assistant, and Advanced Data Connectors

**Ask Your Data** is a modern, self-service Business Intelligence (BI) and analytics platform designed to make data exploration intuitive, robust, and lightning fast. 

Seamlessly connect relational databases across multiple schemas, import external REST APIs via OpenAPI/Swagger specifications, upload local files into embedded columnar DuckDB storage, craft complex queries in Monaco SQL Lab, and assemble interactive dashboards with drag-and-drop ease.

Its integrated AI Assistant empowers conversational data analysis while guaranteeing **strict numeric grounding**—every reported metric is validated against executed query results with AST guardrails.

---

## ⚡ Core Principles

1. **AI-Independent Core:** All analytical features—database connectivity, schema browsing, join modeling, file uploads, datasets, SQL Lab, charts, and dashboards—operate fully independently without requiring an AI provider or API key.
2. **Zero-Hallucination Grounding:** AI-generated analytical responses must be strictly grounded in executed SQL query results. Every reported number is checked against returned rows using mathematical and numeric guardrails.
3. **AST Safety & Row-Level Security (RLS):** Every executed SQL statement passes through SQLGlot AST validation to enforce read-only execution (`allow_dml=False`), block harmful functions, and apply non-bypassable Row-Level Security policies.
4. **Instant Ingestion & Columnar Analytics:** Tabular files (CSV, TSV, Excel, Parquet, JSON) and normalized REST API payloads are ingested directly into internal DuckDB columnar storage for lightning-fast aggregation and exploration.
5. **Saveable & Reusable Artifacts:** AI-generated queries, visual join definitions, chart configurations, and dashboards are standard first-class platform entities that can be edited, saved, shared, and reused.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Backend API** | Python 3.11+, FastAPI, Pydantic v2 |
| **Metadata Database** | SQLite (Instant Local Dev) / PostgreSQL 16 (Production) |
| **ORM & Migrations** | SQLAlchemy 2.0 Async, Alembic |
| **Columnar Storage & Engine** | Embedded DuckDB (Multi-threaded In-Process OLAP) |
| **SQL Parsing & AST Security** | SQLGlot AST Engine |
| **AI LLM Providers** | Multi-Provider Engine: Groq, Google Gemini, OpenAI, Anthropic Claude, Ollama |
| **API Connect Engine** | Async HTTPX with SSRF Guard, OpenAPI 3.0/Swagger 2.0 Parser (PyYAML/JSON) |
| **Frontend Framework** | React 18, TypeScript (Strict Mode), Vite |
| **Styling & Icons** | Tailwind CSS, Lucide Icons |
| **Data Visualization** | Apache ECharts (`echarts-for-react`) |
| **Dashboard Canvas** | `react-grid-layout` with responsive drag-and-drop |
| **Code & SQL Editor** | Monaco Editor (`@monaco-editor/react`) |
| **State & Cache Management** | TanStack Query v5, Zustand |
| **Authentication & Secrets** | Cookie-based JWT, Fernet Credential Encryption |

---

## ✨ Key Features & Capabilities

### 1. Database Connectivity & Schema Browser
- **Multi-Engine Support:** Connect PostgreSQL, SQLite, MySQL, and DuckDB analytical databases.
- **Cross-Schema Browser:** Inspect databases across multiple schemas simultaneously (e.g., `public`, `academics`, `exams`, `finance`).
- **Auto-Visualization Engine:**
  - **Separate dashboard per table + one unified dashboard (Recommended):** Generates dedicated dashboards for each table plus an executive, consolidated database dashboard.
  - **Unified dashboard only:** Consolidates all tables into a unified overview dashboard organized by section dividers and KPI cards.
  - **Separate dashboards per table only:** Generates standalone table dashboards.
- **Deep-Linking & Direct URL Slugs:** View dashboards directly by slug or UUID (e.g., `/dashboards/student-db-full-dashboard`).

### 2. Table Join Assistant & Visual Relationship Engine
- **Automated Foreign Key & Heuristic Discovery:** Detects implicit relationships and cross-table joins automatically.
- **Visual Join Assistant Modal:** Select source and target tables across any schema, configure join types (`INNER`, `LEFT`, `RIGHT`, `FULL`), and map join keys.
- **Live SQL Generation & Data Preview:** Inspect joined query results before saving.
- **Reusable Virtual Datasets:** Saves joined models as semantic virtual datasets without altering raw source tables.

### 3. API Connect & REST Data Ingestion
- **OpenAPI / Swagger Importer:** Import APIs via URL or raw specification (JSON or YAML) with full endpoint and parameter discovery.
- **SSRF Guard:** Comprehensive security client guarding against internal network probes, AWS/GCP metadata endpoints, and unauthorized localhost targets.
- **Smart Multi-Strategy Pagination:** Built-in support for page-based, limit-offset, cursor-based, and Link header pagination.
- **Data Normalization & DuckDB Ingestion:** Automatically flattens complex nested JSON payloads into structured columnar DuckDB tables.
- **Sync Engine:** On-demand and scheduled data synchronization with status tracking.

### 4. File Uploads & Columnar Ingestion
- **Multi-Format Support:** Drag-and-drop upload of CSV, TSV, Excel (`.xlsx`), Parquet, and JSON/JSONL up to 200MB.
- **Automatic Schema Inference:** Detects date formats, numeric columns, and categorical dimensions upon upload.
- **Instant "Build Chart" Flow:** Direct transition from upload success notification straight into the chart builder.
- **Ingested Table Management:** Inspect total rows, format, upload date, with one-click SQL querying and table deletion.

### 5. Multi-Axis & Flexible Chart Explorer
- **Multi-Metric Axis Builder:** Select one or multiple dimensions and metrics on both the X and Y axes.
- **One-Click Field Removal:** Dedicated delete pills (`x`) on every selected dimension/metric for rapid reconfiguration.
- **DuckDB Temporal Column Validation:** Type-safe handling of timestamps and dates across aggregations.
- **Comprehensive Visualizations:** Big Number (KPI), Bar, Line, Area, Pie/Donut, Scatter, Heatmap, and Summary Tables with Apache ECharts.

### 6. Drag-and-Drop Interactive Dashboards
- **Grid Layout Canvas:** Resize, rearrange, and place charts dynamically with `react-grid-layout`.
- **Global Native Filters:** Cross-filter multiple charts across common dimensions.
- **Configurable Auto-Refresh:** Set interval timers (10s, 30s, 1m, 5m) for real-time monitoring.
- **Responsive Layout:** Optimized for desktop analytics workspaces and executive presentations.

### 7. Monaco-Powered SQL Lab
- **Monaco Code Editor:** Syntax highlighting, query formatting, auto-completion, and multi-query execution.
- **Dialect Transpilation:** Transpile queries safely across SQL dialects using SQLGlot.
- **Results Explorer:** Tabular results with row counters, data type badges, execution duration, and CSV export.
- **Query History & Saved Queries:** Track past executions and bookmark frequent analytical queries.

### 8. Grounded AI Assistant (Multi-Provider)
- **Seamless Provider Switching:** Configure your LLM via `.env` without code changes:
  - **Groq:** Ultra-fast inference with `qwen/qwen3.8-27b` or `llama-3.3-70b-versatile`.
  - **Google Gemini:** Native tool calling with `gemini-flash-lite-latest` or `gemini-1.5-flash`.
  - **OpenAI:** `gpt-4o-mini`, `gpt-4o`.
  - **Anthropic Claude:** `claude-3-5-sonnet`.
  - **Ollama / Local:** Private, self-hosted LLMs.
- **Multi-Turn Context & Memory:** Remembers previous analytical questions in the session for seamless follow-ups.
- **Zero-Hallucination Grounding:** Numbers generated by the AI are verified against executed query rows before response display.
- **Saveable Artifacts:** Save AI-generated queries directly into SQL Lab or save AI-recommended charts into your dashboards.

### 9. Enterprise-Grade Security
- **JWT Authentication:** Secure HTTP-only cookies preventing XSS token theft.
- **Fernet Secret Encryption:** Encrypts external database passwords and credentials at rest using AES-128-CBC.
- **AST SQL Guardrails:** Blocks dangerous operations (`DROP`, `DELETE`, `ALTER`, `TRUNCATE`), multi-statement injections, and non-whitelisted SQL functions.
- **Row-Level Security (RLS):** Injects dynamic tenancy and role-based WHERE clauses at the AST level.

---

## 🏗️ System Architecture

```text
                                  ASK YOUR DATA
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
              FRONTEND (SPA)                           BACKEND API
           React 18 + TypeScript                         FastAPI
                    │                                       │
         ┌──────────┼──────────┐                   ┌────────┼────────┐
         │          │          │                   │        │        │
      ECharts   Monaco SQL   Grid Layout         Auth    Query API  AI Layer
     Dashboard    Lab        Canvas                │        │        │
                                                JWT/RLS  SQLGlot  Orchestrator
                                                   │        │        │
                                                   └────────┼────────┘
                                                            │
                                         ┌──────────────────┼──────────────────┐
                                         │                  │                  │
                                     PostgreSQL           Redis              DuckDB
                                  Metadata & State     Cache & Queue     Columnar Files &
                                                            │             API Normalized
                                                          Celery               Data
                                                         Workers
```

---

## 🚀 Getting Started

### Prerequisites

- **Python:** 3.11 or higher
- **Node.js:** 20.x or higher (with npm)
- **Database (Optional for local dev):** SQLite is supported out of the box for instant zero-dependency local development; PostgreSQL 16 is recommended for production.
- **Docker Desktop (Optional):** Version 20.10+ with Docker Compose.

---

### Local Development Setup (Quickstart)

#### 1. Clone the Repository
```bash
git clone https://github.com/puneet-atmanand/Intelligent-BusinessIntell.git
cd Intelligent-BI
```

#### 2. Configure Environment Variables
Copy `.env.example` into `.env` (or configure `backend/.env`):
```bash
cp .env.example .env
```

**Key `.env` Configuration Options:**
```env
# Application
ENVIRONMENT=development
DEBUG=true
AUTH_REQUIRED=false

# Metadata Database (Use SQLite for instant local dev, or PostgreSQL for production)
METADATA_DATABASE_URL=sqlite+aiosqlite:///data/askyourdata.db
METADATA_DATABASE_SYNC_URL=sqlite:///data/askyourdata.db

# Embedded DuckDB Storage
DUCKDB_DATABASE_PATH=data/askyourdata.duckdb

# AI Assistant (Choose Groq or Gemini)
AI_ENABLED=true
LLM_PROVIDER=groq
LLM_MODEL=qwen/qwen3.8-27b
GROQ_API_KEY=gsk_your_groq_api_key

# Alternatively, for Google Gemini:
# LLM_PROVIDER=gemini
# LLM_MODEL=gemini-flash-lite-latest
# GEMINI_API_KEY=AIzaSy_your_gemini_api_key
```

#### 3. Backend Setup
```bash
# Navigate to backend directory
cd backend

# Create & activate a Python virtual environment
python -m venv venv

# Windows (PowerShell):
venv\Scripts\Activate.ps1
# Linux / macOS:
source venv/bin/activate

# Install all backend dependencies
pip install -r requirements.txt

# Start FastAPI backend server (auto-creates database tables & system seeds)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
*The Backend API will be available at:* `http://localhost:8000`  
*Swagger Documentation:* `http://localhost:8000/docs`

#### 4. Frontend Setup
Open a new terminal window:
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev
```
*The Frontend will be available at:* `http://localhost:3000` (or `http://localhost:5173`)

---

### Docker Compose Deployment

To run the complete containerized stack (PostgreSQL 16, Redis 7, Celery Workers, FastAPI Backend, and Frontend):

```bash
docker compose up --build
```

---

## 🔑 Default Credentials

When `AUTH_REQUIRED=true` is enabled:

| Role | Email | Password |
|---|---|---|
| **System Administrator** | `admin@askyourdata.local` | `admin123456` |

*(Note: Always change default administrative credentials and configure a secure `SECRET_KEY` and `ENCRYPTION_KEY` in production.)*

---

## 🧪 Testing & Verification

### Backend Automated Test Suite
Run unit tests, API integration tests, and coverage reporting:
```bash
cd backend
pytest tests/ -v
```

Run specific test modules:
```bash
# Test unified dashboard generation and slug routing
pytest tests/test_unified_dashboard.py -v

# Test bulk dataset provisioning
pytest tests/test_bulk_datasets.py -v
```

### Frontend Typechecking & Tests
```bash
cd frontend

# TypeScript strict type checking
npm run typecheck

# Production build test
npm run build

# Unit test suite
npm run test:run
```

---

## 📁 Project Directory Structure

```text
Intelligent-BI/
├── backend/
│   ├── alembic/                      # Database migration scripts
│   ├── app/
│   │   ├── ai/                       # Grounded AI Assistant
│   │   │   ├── guardrails/           # SQL AST guard & numeric grounding verifier
│   │   │   ├── providers/            # Groq, Gemini, Claude, OpenAI, Ollama providers
│   │   │   ├── orchestrator.py       # Multi-turn conversation orchestrator
│   │   │   ├── prompts.py            # System prompts & grounding templates
│   │   │   └── tools.py              # LLM tool definitions (SQL execution & schema)
│   │   ├── api/                      # FastAPI Routers & Dependencies
│   │   │   └── v1/endpoints/         # Auth, Databases, Datasets, Charts, Dashboards,
│   │   │                             # SQL Lab, Uploads, API Connect, AI Assistant, Admin
│   │   ├── core/                     # Configuration, errors, logging, encryption, security
│   │   ├── db/                       # SQLAlchemy models, session factory, system seeds
│   │   ├── schemas/                  # Pydantic v2 validation models
│   │   └── services/                 # Business logic
│   │       ├── api_connect/          # REST API sync, pagination, SSRF guard, OpenAPI parser
│   │       ├── database_dashboard_builder.py  # Bulk auto-visualization & unified dashboard engine
│   │       ├── dataset_provisioner.py         # Semantic dataset provisioner
│   │       └── table_join_service.py          # Visual table join & FK inference service
│   ├── tests/                        # Pytest suite with mock databases & API tests
│   ├── pyproject.toml                # Build configuration & dependencies
│   └── requirements.txt              # Pinned backend dependencies
│
├── frontend/
│   ├── src/
│   │   ├── app/                      # React Router configuration & entry points
│   │   ├── charts/                   # Apache ECharts plugin definitions & registry
│   │   ├── components/               # AppShell, Navigation, Shared UI primitives
│   │   ├── features/                 # Modular application features
│   │   │   ├── ai/                   # AI Assistant drawer & conversational interface
│   │   │   ├── api_connect/          # API Connect & OpenAPI specification importer
│   │   │   ├── auth/                 # Login & user management
│   │   │   ├── charts/               # Multi-axis Chart Builder & gallery
│   │   │   ├── dashboards/           # Drag-and-drop dashboard canvas & slug view
│   │   │   ├── databases/            # Database manager & Schema Browser visualizer
│   │   │   ├── datasets/             # Semantic dataset editor & Table Join Assistant
│   │   │   ├── sqllab/               # Monaco Editor SQL Lab
│   │   │   └── uploads/              # Drag-and-drop file upload manager
│   │   └── store/                    # Zustand stores (Auth, UI state)
│   ├── package.json                  # Node dependencies and scripts
│   ├── tailwind.config.js            # Tailwind CSS design system
│   └── vite.config.ts                # Vite build configuration
│
├── requirements.txt                  # Root requirements pointer
├── docker-compose.yml                # Multi-container local deployment
├── docker-compose.prod.yml           # Production multi-stage container deployment
├── CHANGELOG.md                      # Changelog & version history
└── README.md                         # Project documentation
```

---

## 📜 License

This project is licensed under the **Apache License 2.0**.

---

**Ask Your Data — Intelligent, Self-Service Analytics with Grounded AI.**
