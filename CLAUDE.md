# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript/Deno port of TigerBeetle's core accounting semantics with support for multiple database backends (MySQL and Turso/SQLite). The project focuses on double-entry accounting logic and TigerBeetle-compatible client API rather than high-performance database characteristics.

## Development Commands

### Testing Commands

```bash
# Core test suites
deno task test:unit              # Basic validation, ID generation, type checking
deno task test:comprehensive     # Batch limits, range validation, error conditions  
deno task test:edge-cases        # Boundary values, concurrent operations
deno task test:nodejs-scenarios  # Node.js client compatibility scenarios
deno task test:performance       # Throughput, latency, memory benchmarks

# Database integration tests
deno task test:functional        # Business logic with MySQL database
deno task test:integration       # End-to-end integration with MySQL
deno task test:functional:turso  # Business logic with Turso/SQLite
deno task test:integration:turso # End-to-end integration with Turso/SQLite

# Turso automated testing
deno task test:turso:demo        # Demo of automated Turso database lifecycle
deno task test:turso:cloud       # Integration tests with Turso cloud (requires auth)

# Matrix testing (both databases)
deno task test:matrix            # Test both MySQL and Turso backends

# All tests
deno task test:all              # Complete test suite with runner
deno task test                  # All tests excluding integration
```

### Development Commands

```bash
deno task dev                   # Watch mode with basic usage example
deno task db:reset              # Reset database using local config
deno task db:reset:remote       # Reset remote database
```

### Test Environment Setup

**MySQL Integration Tests:**
```bash
export TB_INTEGRATION_TESTS=1
export TIGERBEETLE_DB_TYPE=mysql
export TB_TEST_HOST=localhost
export TB_TEST_PORT=3306
export TB_TEST_DB=tigerbeetle_test
export TB_TEST_USER=root
export TB_TEST_PASSWORD=your_password

# Create database and load schema
mysql -u root -p -e "CREATE DATABASE tigerbeetle_test;"
mysql -u root -p tigerbeetle_test < schemas/mysql/schema.sql
```

**Turso/SQLite Integration Tests:**

For automated test database creation and teardown:
```bash
export TB_INTEGRATION_TESTS=1
export TIGERBEETLE_DB_TYPE=turso

# For Turso cloud (automated database creation):
export TURSO_DATABASE_URL=libsql://your-org.turso.io
export TURSO_AUTH_TOKEN=your_auth_token

# Demo without cloud access:
deno task test:turso:demo
```

**Turso Cloud Setup for Full Integration Testing:**
```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Authenticate
turso auth login

# Get auth token
export TURSO_AUTH_TOKEN=$(turso auth token)

# Set your organization URL
export TURSO_DATABASE_URL=libsql://YOUR_ORG.turso.io

# Run cloud integration tests
deno task test:turso:cloud
```

## Architecture

### Core Components

- **`src/client.ts`**: TigerBeetle-compatible client API that maintains identical method signatures with the Node.js client
- **`src/database.ts`**: Main database class that delegates to backend-specific implementations
- **`src/database/`**: Database abstraction layer supporting MySQL and Turso/SQLite backends
- **`src/types.ts`**: Complete type definitions matching TigerBeetle's data structures
- **`src/id.ts`**: 128-bit ID generation system with 48-bit timestamps, fully compatible with TigerBeetle Node.js client
- **`src/validation.ts`**: Business rule validation matching TigerBeetle's constraints

### Database Architecture

The project uses a database abstraction layer with two implementations:

- **MySQLDatabase** (`database/mysql-database.ts`): Production MySQL backend with native SQL types
- **TursoDatabase** (`database/turso-database.ts`): Turso/SQLite backend for development and edge deployment

Database selection is controlled by `TIGERBEETLE_DB_TYPE` environment variable or explicit configuration.

### Key Design Patterns

- **Client API Compatibility**: Maintains identical method signatures and error codes as TigerBeetle Node.js client
- **Database Abstraction**: `IDatabaseInterface` allows seamless switching between MySQL and Turso/SQLite
- **Environment-based Configuration**: Supports both environment variables and explicit configuration objects
- **Legacy Compatibility**: Automatically converts legacy MySQL configurations to new unified format

### Schema Files

- **`schemas/mysql/schema.sql`**: MySQL-specific schema with `DECIMAL(39,0)` for 128-bit integers
- **`schemas/sqlite/schema.sql`**: SQLite-compatible schema using `TEXT` for BigInt storage

Both schemas include complete table structure with triggers, views, and indexes for optimal performance.

### Testing Strategy

The test suite is modeled after the original TigerBeetle tests with 70+ scenarios:

- **Unit tests**: Core validation and ID generation
- **Functional tests**: Business logic matching TigerBeetle Node.js test suite  
- **Integration tests**: Full database workflows with real data
- **Performance tests**: Throughput and memory usage benchmarks
- **Edge case tests**: Boundary conditions and error scenarios

Tests support both MySQL and Turso/SQLite backends with matrix testing capabilities.

### Automated Turso Database Testing

The project includes comprehensive automated database lifecycle management for Turso integration tests:

- **`src/test-utils/turso-test-setup.ts`**: Automated Turso database creation and teardown using Turso CLI
- **`tests/test-setup.ts`**: Unified test setup utilities supporting both MySQL and Turso with automatic cleanup
- **Database isolation**: Each test gets a fresh, isolated database instance
- **Parallel testing**: Support for multiple concurrent test databases
- **Automatic cleanup**: Databases are automatically destroyed after tests complete
- **Schema loading**: SQLite schema is automatically loaded into test databases

Key benefits:
- Complete test isolation prevents data contamination
- No manual database setup required
- Supports both local development and CI/CD environments
- Automatic cleanup prevents database accumulation
- Works with both Turso cloud and local SQLite

## File Validation

Always verify that imports use the correct database implementation and configuration. The project supports both environment-based and explicit configuration patterns.