# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Gemini CLI is a Node.js-based command-line AI workflow tool that provides AI-powered automation using Google's Gemini AI model. It's built as a monorepo with two main packages and uses React with Ink for terminal UI.

## Development Commands

### Essential Commands

**Build and Bundle:**
```bash
npm run build           # Build all packages
npm run bundle         # Generate bundled CLI executable at bundle/gemini.js
npm run build:all      # Build packages and sandbox
```

**Testing:**
```bash
npm test               # Run unit tests for all packages
npm run test:ci        # Run tests with coverage
npm run test:e2e       # Run end-to-end integration tests
npm run test:integration:all  # Run all integration tests (none, docker, podman)
```

**Code Quality:**
```bash
npm run lint           # Lint all code
npm run lint:fix       # Fix linting issues
npm run typecheck      # Type check all packages
npm run format         # Format code with Prettier
```

**Development:**
```bash
npm start              # Start the CLI in development mode
npm run debug          # Start with debugger attached
npm run preflight      # Full CI pipeline locally (clean, install, format, lint, build, typecheck, test)
```

### Package-Specific Commands

**CLI Package (`packages/cli/`):**
```bash
npm run build:cli      # Build only CLI package
npm run test --workspace packages/cli  # Test CLI package
```

**Core Package (`packages/core/`):**
```bash
npm run build:core     # Build only core package
npm run test --workspace packages/core  # Test core package
```

### Integration Testing

Run integration tests with different sandbox configurations:
```bash
npm run test:integration:sandbox:none    # No sandbox
npm run test:integration:sandbox:docker  # Docker sandbox
npm run test:integration:sandbox:podman  # Podman sandbox
```

## Architecture

### Monorepo Structure

The project uses npm workspaces with two main packages:

- **`packages/cli/`**: User interface and command-line interaction using React + Ink
- **`packages/core/`**: Core AI functionality, Gemini API client, and built-in tools

### Key Technologies

- **Build System**: esbuild for bundling, TypeScript for compilation
- **Testing**: Vitest for unit tests, custom integration test runner
- **UI Framework**: React with Ink for terminal-based components
- **AI Integration**: Google Gemini API via `@google/genai`
- **Security**: Docker/Podman sandboxing for safe code execution

### Bundle Creation

The CLI is distributed as a single executable bundle:
- Entry point: `packages/cli/index.ts`
- Output: `bundle/gemini.js`
- Bundler: esbuild with ES module format and Node.js compatibility shims

## Core Features

### Built-in Tools

The core package provides these tool categories:
- **File Operations**: Read, write, edit, glob pattern matching
- **Shell Execution**: Sandboxed command execution with Docker/Podman
- **Web Integration**: Web search and content fetching
- **Git Operations**: Repository management and branch operations
- **MCP Integration**: Model Context Protocol for extensible tools

### Security Model

- **Sandboxed Execution**: Docker containers for isolated shell commands
- **macOS Sandbox Profiles**: Multiple security levels for different use cases
- **Permission System**: Controlled access to file system and external resources

### Authentication

Supports multiple authentication methods:
- Personal Google accounts (default, rate-limited)
- API keys from Google AI Studio
- Google Workspace accounts
- Vertex AI authentication

## Testing Strategy

### Unit Tests
- Each package has its own Vitest configuration
- Located in `src/**/*.test.ts` within each package
- Coverage reports available with `npm run test:ci`

### Integration Tests
- Located in `integration-tests/` directory
- Tests actual CLI functionality with different tool combinations
- Supports multiple sandbox configurations (none, docker, podman)
- Run with `integration-tests/run-tests.js`

### Test Execution

When running tests:
- Unit tests: Run per-package with `vitest`
- Integration tests: Use custom runner that spawns CLI processes
- CI tests: Include coverage reporting and strict linting

## Development Workflow

### Making Changes

1. **Code Changes**: Edit files in `packages/cli/` or `packages/core/`
2. **Build**: Run `npm run build` to compile TypeScript
3. **Test**: Run `npm test` for unit tests, `npm run test:e2e` for integration
4. **Bundle**: Run `npm run bundle` to create the CLI executable
5. **Quality**: Run `npm run preflight` for full validation

### Package Dependencies

- CLI package depends on core package
- Version binding happens automatically during release preparation
- Use `npm run prerelease:dev` to update cross-package dependencies

### Debugging

- Use `npm run debug` to start with Node.js debugger
- Integration tests support `--verbose` and `--keep-output` flags
- React DevTools available for terminal UI debugging

## File Patterns

### Package Structure
```
packages/
├── cli/
│   ├── src/
│   │   ├── ui/          # React components with Ink
│   │   ├── config/      # Configuration and auth
│   │   └── utils/       # CLI utilities
│   └── dist/            # Build output
└── core/
    ├── src/
    │   ├── core/        # AI functionality
    │   ├── tools/       # Built-in tools
    │   ├── services/    # Git, file discovery
    │   └── telemetry/   # Usage analytics
    └── dist/            # Build output
```

### Build Artifacts
- `bundle/gemini.js`: Main CLI executable
- `packages/*/dist/`: Compiled TypeScript output
- Coverage reports in `coverage/` directories

## Release Process

The project uses automated version binding and publishing:
1. `npm run prerelease:dev`: Update versions and dependencies
2. `npm run build:packages`: Build both packages
3. `npm run publish:release`: Full release pipeline including Docker sandbox