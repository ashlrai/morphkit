# Changelog

All notable changes to Morphkit are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-03-19

### Added
- Provider-agnostic AI integration (Claude, Grok, OpenAI) with auto-detection
- SwiftData persistence layer — @Model classes, DataManager, cache-first loading
- Production networking — pagination, retry with backoff, file uploads, APIError enum
- Real auth flow generation — login/register views with Keychain, AuthManager
- Accessibility support — .accessibilityLabel, .accessibilityHint throughout
- Error UI components — ErrorBannerView, RetryButton, EmptyStateView, OfflineBannerView
- Watch mode for iterative development
- React + Vite framework support
- Quick Start Checklist and Troubleshooting in generated CLAUDE.md
- Post-generation next-steps guidance in CLI output

### Fixed
- Command injection vulnerability in Swift syntax validation
- Type mismatch in loadData (scalar ← array) now emits TODO instead of broken assignment
- Entity name matching for compound PascalCase names (SavedTemplate → template)

### Changed
- NetworkError replaced with production-quality APIError enum
- Incomplete entities enriched via back-fill pass from non-exported type definitions

## [0.1.0] — 2026-03-18

### Added
- Core pipeline: TypeScript/React → SemanticAppModel → SwiftUI project
- Next.js App Router full support
- AI-optimized scaffold generation with CLAUDE.md
- Reference implementation scoring (top 2 screens get full wiring)
- Web-only state filter (hover, tooltip, dropdown, etc.)
- Settings view with semantic groupings
- MCP server with 3 tools
- CLI with analyze, generate, preview commands
- Supabase auth + Stripe billing backend
- Swift syntax validation with swiftc
