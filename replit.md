# Painel de Monitoramento - Portal de Leilões

## Overview

This is a monitoring dashboard application for a Brazilian auction portal (Portal de Leilões). The application displays real-time statistics and monitoring data for auction sites, scraped listings, scraping logs, and URL processing status. It connects to an external Directus CMS instance to fetch and display data about auction site scraping operations.

The dashboard provides visibility into:
- Monitored auction sites and their on/off status
- Extracted auction listings (leilões) with image and publication status
- Scraping operation logs with success/error tracking
- URL processing queue status

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Charts**: Recharts for data visualization (pie charts, bar charts)
- **Build Tool**: Vite with hot module replacement

The frontend follows a component-based architecture with:
- Page components in `client/src/pages/`
- Reusable UI components in `client/src/components/ui/`
- Dashboard-specific components in `client/src/components/dashboard/`
- Custom hooks in `client/src/hooks/`
- Utility functions and providers in `client/src/lib/`

### Backend Architecture
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript compiled with tsx
- **API Pattern**: REST endpoints under `/api/` prefix
- **Development**: Vite middleware integration for HMR

The backend acts primarily as a proxy/aggregation layer that:
- Fetches data from external Directus CMS
- Aggregates statistics for dashboard display
- Serves the static frontend in production

### Data Layer
- **Primary Data Source**: External Directus CMS (headless CMS)
- **Database Schema**: Drizzle ORM configured for PostgreSQL (schema in `shared/schema.ts`)
- **Session Storage**: connect-pg-simple for PostgreSQL sessions (configured but may not be actively used)

The application primarily reads data from Directus collections:
- `input_library_url` - Sites to monitor
- `leiloes_imovel` - Auction listings (note: state field is `estado_uf`, not `uf`)
- `logs_scraping` - Scraping operation logs
- `url_consulta` - URL processing queue

### Shared Types
TypeScript interfaces are defined in `shared/schema.ts` and shared between frontend and backend:
- `Site` - Auction site configuration
- `Leilao` - Individual auction listing
- `LogScraping` - Scraping log entry
- `UrlConsulta` - URL processing status
- `DashboardStats` - Aggregated dashboard statistics
- `LeilaoInsert` - Zod schema type for creating new auctions (used for form validation)
- `leilaoInsertSchema` - Zod validation schema shared between frontend and backend

## External Dependencies

### Directus CMS Integration
- **Purpose**: Primary data source for all dashboard data
- **Authentication**: Bearer token via `DIRECTUS_TOKEN` environment variable
- **Base URL**: Configured via `DIRECTUS_URL` environment variable
- **Collections Accessed**: input_library_url, leiloes_imovel, log_scrapings

### Database
- **Type**: PostgreSQL
- **ORM**: Drizzle ORM
- **Connection**: Via `DATABASE_URL` environment variable
- **Migrations**: Stored in `./migrations/` directory
- **Note**: The database may be used for session storage and future local data persistence

### Required Environment Variables
- `DIRECTUS_URL` - Base URL of the Directus CMS instance (e.g., https://sistema.investleiloesbrasil.com.br)
- `DIRECTUS_TOKEN` - API authentication token for Directus
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret for session management

## Recent Changes (February 2026)
- Created manual auction registration form at `/cadastro`:
  - Comprehensive form with all auction fields (site, property info, values, dates, address, links)
  - Site dropdown (required field) fetched from Directus
  - CEP auto-fill using ViaCEP API for address completion
  - Shared Zod schema (`leilaoInsertSchema`) used for both frontend and backend validation
  - Backend validation before writing to Directus
  - SEO tags for the page
  - Navigation: "Cadastrar Leilão" button in dashboard header
  - **URL-based site detection**: paste auction URL → auto-detects and fills site dropdown
  - **AI Image Extraction**: upload/paste screenshot of auction page → GPT-4o Vision extracts 24+ fields automatically
    - Supports drag-and-drop, file selection, and Ctrl+V paste
    - Extracts: nome, descrição, tipo imóvel/leilão, valores, praças, endereço, links, etc.
    - Zod validation on extracted data for safety
- Backend endpoints added:
  - GET `/api/sites` - fetches all sites for dropdown
  - GET `/api/sites/find-by-url` - finds site by auction URL domain
  - POST `/api/leiloes` - creates new auction with Zod validation
  - POST `/api/extract-from-image` - uses OpenAI GPT-4o Vision to extract auction data from images

### OpenAI Integration
- **File**: `server/openai.ts`
- **Model**: GPT-4o with vision capabilities
- **API Key**: `OPENAI_API_KEY` environment variable (user's own key)
- **Purpose**: Extract structured auction data from screenshots of auction pages

## Changes (January 2026)
- Fixed Directus integration with proper URL validation and error handling
- Updated field mapping: changed `uf` to `estado_uf` to match actual Directus schema
- Dashboard now successfully displays real data from Directus including:
  - 664 monitored sites (658 active, 6 inactive)
  - Auction listings with type, state, and image statistics
  - Scraping logs with success/error rates
  - URL processing queue status
- Added temporal chart (area chart) showing auctions created in last 14 days (`leiloesTemporal` aggregation)
- Updated URL Consulta panel to show category breakdown using `classifica` field (imóvel individual, paginação, categoria, outros)
- Removed "Erros por Site" chart from logs panel (now 2-column layout)
- Created new `/logs` page with detailed scraping logs table:
  - Full table of all logs with site information
  - Filter by status (successes, successes_partial, erro, url_inválida)
  - Search by site name or error reason
  - Navigation link in dashboard header

### Key NPM Dependencies
- `@tanstack/react-query` - Server state management
- `recharts` - Data visualization charts
- `date-fns` - Date formatting (with Portuguese locale)
- `drizzle-orm` / `drizzle-zod` - Database ORM and validation
- `express` - HTTP server framework
- Full shadcn/ui component suite via Radix UI primitives