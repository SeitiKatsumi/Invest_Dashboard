# Painel de Monitoramento - Portal de Leilões

## Overview
This project is a monitoring dashboard for a Brazilian auction portal, "Portal de Leilões." It provides real-time statistics and monitoring data for auction sites, extracted listings, scraping logs, and URL processing statuses. The dashboard integrates with an external Directus CMS to manage and display data related to auction scraping operations. The system aims to provide comprehensive visibility into the health and performance of the auction data collection pipeline, enabling efficient management and monitoring of auction listings and scraping activities. It includes modules for AI-driven scraping, manual auction registration with AI image extraction, and WhatsApp broadcast capabilities for auction listings.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **UI Components**: shadcn/ui built on Radix UI
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Build Tool**: Vite

### Backend Architecture
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript
- **API Pattern**: REST endpoints under `/api/`
- **Functionality**: Acts as a proxy/aggregation layer for Directus CMS data and serves the static frontend. Includes an internal scraping engine and WhatsApp integration.

### Data Layer
- **Primary Data Source**: External Directus CMS (all data storage)
- **No local database**: All persistence is handled through Directus collections (`openai_usage`, `scheduler_config`, etc.)
- **Shared Types**: TypeScript interfaces defined in `shared/schema.ts` for consistent data structures across frontend and backend.

### Key Features
- **Dashboard**: Displays monitored sites, auction listings, scraping logs, and URL processing queue status.
- **AI Scraping Integration**: Features an internal, TypeScript-based scraping engine with Explorer, Analyst, Crawler, and Job Manager modules. It supports AI-driven configuration generation and parallel crawling. An external AI scraping API is also integrated for comparison and dual-engine support. Includes a shared browser pool (max 3 browsers), config confidence scorer, mini-scrape onboarding validation, result classification (success/empty/config_suspect/config_invalid/error), batch diagnostic reporting with JSON export, and real-time resource monitoring (browser pool stats, memory, timing estimates). Enhanced with: **auto fetch↔Playwright fallback** (SPA/blocked detection triggers automatic engine escalation), **expanded exploration** (60 pages default, pagination-first prioritization, 500 link / 200 detail URL limits), and **auto re-onboarding** (empty/suspect crawl results trigger automatic re-onboarding with error context, persisting improved configs).
- **Scheduled Scraping (Cron)**: Weekly scraping scheduler using `node-cron`. Active sites are automatically distributed into groups by day of week (round-robin by site ID). Configurable execution time (default 3:00 AM São Paulo timezone), active days, concurrent limits, and onboarding inclusion. Supports manual per-group execution, cancellation, and detailed run result history. Backend: `server/scraper-scheduler.ts`, API: `/api/scheduler/*`, Frontend: `client/src/components/scheduler-panel.tsx`.
- **WhatsApp Broadcast Module**: Allows sending auction listings to WhatsApp community groups with QR code authentication, group management, and dispatch history. Supports community announcement groups.
- **Manual Registration**: Provides a form for manual auction registration with comprehensive fields, CEP auto-fill via ViaCEP API, and AI Image Extraction using OpenAI GPT-4o Vision for automated data population from screenshots.
- **Detailed Logs Page**: Offers a dedicated page for detailed scraping logs with filtering and search capabilities.
- **Settings Page**: Allows runtime configuration of the OpenAI API key and displays token usage tracking with cost estimates per model and operation (scraping onboarding, image extraction). Usage data includes 24h/7d summaries, breakdowns by model/operation, and recent call history with token counts.

## External Dependencies

- **Directus CMS**: Primary and sole data source, accessed via `DIRECTUS_URL` and `DIRECTUS_TOKEN`. Collections include `openai_usage` (API token tracking) and `scheduler_config` (singleton, scraping schedule configuration).
- **OpenAI API**: Utilized for AI-driven scraping configuration (GPT-4o mini via external API), AI Image Extraction (GPT-4o Vision), and error analysis, requiring `OPENAI_API_KEY`.
- **ViaCEP API**: Used for auto-filling address details during manual auction registration.
- **@whiskeysockets/baileys**: For WhatsApp Web protocol integration in the WhatsApp broadcast module.
- **`cheerio`**: For server-side HTML parsing in the internal scraping engine.
- **`playwright`**: For headless browser automation in the internal scraping engine.
- **`SCRAPING_API_URL`**: External AI scraping API (`https://api-scrap-invest.server04.11mind.com.br`).