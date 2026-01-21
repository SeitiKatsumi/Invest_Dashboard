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

## Recent Changes (January 2026)
- Fixed Directus integration with proper URL validation and error handling
- Updated field mapping: changed `uf` to `estado_uf` to match actual Directus schema
- Dashboard now successfully displays real data from Directus including:
  - 664 monitored sites (658 active, 6 inactive)
  - Auction listings with type, state, and image statistics
  - Scraping logs with success/error rates
  - URL processing queue status

### Key NPM Dependencies
- `@tanstack/react-query` - Server state management
- `recharts` - Data visualization charts
- `date-fns` - Date formatting (with Portuguese locale)
- `drizzle-orm` / `drizzle-zod` - Database ORM and validation
- `express` - HTTP server framework
- Full shadcn/ui component suite via Radix UI primitives