# Contributing to Morphkit

Thank you for your interest in contributing to Morphkit! This guide will help you get set up and productive.

## Prerequisites

- **Bun** 1.0+ (primary runtime and test runner)
- **Node.js** 18+ (for compatibility)
- **TypeScript** 5.7+ (strict mode enforced)

## Getting Started

```bash
# Clone your fork
git clone https://github.com/<your-username>/morphkit.git
cd morphkit

# Install dependencies
bun install

# Run tests
bun test

# Type-check
bun run typecheck
```

Verify everything passes before making changes.

## Architecture Overview

Morphkit uses a three-stage pipeline:

```
CLI → Analyzer → Semantic Model → Generator
```

1. **Analyzer** (`src/analyzer/`) — Parses TypeScript/React source using ts-morph. Extracts components, routes, state, and API calls.
2. **Semantic Model** (`src/semantic/`) — Transforms analyzer output into a framework-agnostic `SemanticAppModel`, then adapts it for iOS patterns.
3. **Generator** (`src/generator/`) — Produces SwiftUI views, models, navigation, and networking code from the semantic model.

Each stage is independent and independently testable. The `SemanticAppModel` is the boundary between analysis and generation.

## Code Style

### TypeScript

- Strict mode is enforced (`bun run typecheck` must pass with zero errors).
- Use `const` by default. Use `let` only when reassignment is necessary.
- Prefer explicit return types on exported functions.

### Zod-First Types

All shared types are defined as Zod schemas in `src/semantic/model.ts` and inferred via `z.infer<>`. This is the single source of truth.

```typescript
// Correct: define the schema, infer the type
export const ScreenSchema = z.object({ ... });
export type Screen = z.infer<typeof ScreenSchema>;

// Incorrect: defining standalone interfaces for shared types
export interface Screen { ... }
```

When adding new fields, update the Zod schema in `model.ts` first, then update the builder and generators.

### Pipeline Conventions

- Analyzers have their own types (`ExtractedComponent`, `ExtractedRoute`, etc.) that are mapped to semantic model types in the builder.
- Generators must conform to model types, not define their own.
- Reuse the `typeDefToSwift()` function in `swiftui-generator.ts` for TypeScript-to-Swift type conversion. Do not duplicate it.

## Testing

### Requirements

- All existing tests must pass before submitting a PR.
- Add tests for any new feature or bug fix.
- Tests should verify generated output structure, not exact string matches.

### Test Structure

```
test/
├── analyzer/       # Unit tests for each extractor
├── semantic/       # Builder tests
├── generator/      # Generator output tests
├── e2e/            # Full pipeline integration tests
└── __fixtures__/   # Sample Next.js app for integration tests
```

### Running Tests

```bash
bun test                     # Run all tests
bun test test/analyzer/      # Run analyzer tests only
bun run typecheck            # TypeScript strict checking
```

### Integration Tests

Use `test/__fixtures__/` for integration test data. The fixture directory contains a sample Next.js e-commerce app that exercises the full pipeline. Add new fixture files there when testing new patterns.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Branch naming**: `feat/description`, `fix/description`, or `docs/description`.
3. **Make your changes** following the code style guidelines above.
4. **Test**: Run `bun test` and `bun run typecheck`. Both must pass.
5. **Commit** with clear, descriptive messages.
6. **Open a PR** against `main` with:
   - A summary of what changed and why.
   - How to test the changes.
   - Any relevant issue numbers.

PRs require review before merging. Maintainers may request changes.

## Adding Support for New Frameworks

Morphkit is designed to be extensible. To add support for a new source framework (e.g., Vue, Svelte) or a new generation target:

### New Source Framework

1. Add extractors in `src/analyzer/` following the pattern of existing extractors (component, route, state, API).
2. Update `src/analyzer/repo-scanner.ts` to detect the framework.
3. Map extracted data to the existing `SemanticAppModel` types in `src/semantic/builder.ts`.
4. Add fixture files in `test/__fixtures__/` and write tests.

### New Generation Target

1. Add a new generator directory under `src/generator/`.
2. Consume the `SemanticAppModel` — do not add analyzer-specific logic to generators.
3. Add templates in `templates/` if needed.
4. Write tests that verify output structure.

### New Layout or View Pattern

1. Add the pattern to the appropriate Zod schema in `src/semantic/model.ts`.
2. Update the adapter in `src/semantic/adapter.ts` to map web patterns to the new pattern.
3. Add generation logic in the relevant generator.
4. Add test coverage.

## Questions?

Open an issue on [GitHub](https://github.com/ashlrai/morphkit/issues) or start a discussion. We're happy to help.
