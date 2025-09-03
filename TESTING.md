# Testing Guide

This document describes the comprehensive testing strategy for the TigerBeetle Deno Port, modeled after the original TigerBeetle test suite.

## Test Structure

### 1. **Unit Tests** (`tests/unit/test.ts`)
Basic tests for core functionality:
- ID generation and validation
- Type validation 
- Account and transfer validation rules
- Flag handling and constraints

**Run with:** `deno task test:unit`

### 2. **Functional Tests** (`tests/integration/functional_test.ts`)
Comprehensive tests matching the original TigerBeetle Node.js test suite:
- Account creation and validation
- Transfer workflows (regular, pending, linked)
- Balance constraints and overflow detection
- Flag combinations and mutual exclusions
- Query filter validation
- Edge cases and error conditions

**Run with:** `deno task test:functional`

### 3. **Integration Tests** (`tests/integration/integration_test.ts`)
Full database integration tests supporting MySQL and Turso/SQLite:
- End-to-end account and transfer workflows
- Balance updates and constraints
- Two-phase transfer lifecycle
- Batch operations
- Query operations with real data
- Error handling with database constraints

**Run with:** `deno task test:integration`

## Test Coverage

The test suite covers the same scenarios as the original TigerBeetle tests:

### Core Functionality
- ✅ ID generation (monotonic, parsing, validation)
- ✅ Account creation and validation
- ✅ Transfer creation and validation 
- ✅ Balance constraint enforcement
- ✅ Two-phase transfer workflows
- ✅ Linked transfer chains
- ✅ Account and transfer queries
- ✅ Batch operations
- ✅ Error handling and validation

### Advanced Features
- ✅ Pending transfer timeout handling
- ✅ Account closing transfers
- ✅ Balance overflow detection
- ✅ Flag mutual exclusion validation
- ✅ Import functionality (custom timestamps)
- ✅ Filter-based querying
- ✅ Pagination support

## Running Tests

### Quick Start
```bash
# Run all tests (excluding integration)
deno task test

# Run specific test suites
deno task test:unit
deno task test:functional

# Run with specific database backends
deno task test:functional:turso        # Turso/SQLite functional tests
deno task test:integration:turso       # Turso/SQLite integration tests
deno task test:matrix                  # Test both MySQL and Turso

# Run with verbose output  
deno task test:all
```

### Integration Tests Setup

Integration tests support multiple database backends:

#### MySQL Setup
1. **Create test database:**
   ```sql
   CREATE DATABASE tigerbeetle_test;
   ```

2. **Load schema:**
   ```bash
   mysql tigerbeetle_test < schemas/mysql/schema.sql
   ```

3. **Set environment variables:**
   ```bash
   export TB_INTEGRATION_TESTS=1
   export TIGERBEETLE_DB_TYPE=mysql
   export TB_TEST_HOST=localhost
   export TB_TEST_PORT=3306
   export TB_TEST_DB=tigerbeetle_test
   export TB_TEST_USER=root
   export TB_TEST_PASSWORD=your_password
   ```

4. **Run MySQL integration tests:**
   ```bash
   deno task test:integration
   ```

#### Turso/SQLite Setup
1. **Set environment variables:**
   ```bash
   export TIGERBEETLE_DB_TYPE=turso
   export TURSO_DATABASE_URL=libsql://your-database.turso.io
   export TURSO_AUTH_TOKEN=your_auth_token
   ```

2. **Run Turso integration tests:**
   ```bash
   deno task test:integration:turso
   ```

#### Matrix Testing (Both Databases)
```bash
# Set up both MySQL and Turso configurations, then:
deno task test:matrix
```

### Test Runner Options

The test runner (`tests/runner.ts`) provides advanced options:

```bash
# Show help
deno task test:help

# Run tests matching pattern
deno run --allow-all tests/runner.ts --pattern "transfer"

# Skip integration tests
deno run --allow-all tests/runner.ts --skip-integration

# Run specific test by name
deno run --allow-all tests/runner.ts --test "ID Generation"

# Verbose output
deno run --allow-all tests/runner.ts --verbose
```

## Test Patterns

### Validation Tests
Tests follow TigerBeetle's validation rules:
- Zero IDs are invalid
- Timestamps must be zero for new objects (except imported)
- Required fields (ledger, code) must be non-zero
- Balance constraints must be enforced
- Flag combinations must follow mutual exclusion rules

### Workflow Tests
Tests cover complete accounting workflows:
- Create accounts → Create transfers → Verify balances
- Pending transfer → Post/void → Verify state changes
- Linked transfers → Verify atomicity
- Query operations → Verify filtering and ordering

### Error Condition Tests
Tests verify proper error handling:
- Invalid inputs return appropriate error codes
- Database constraints are enforced
- Overflow conditions are detected
- Missing references return not-found errors

## Performance Considerations

While the Deno port doesn't focus on performance like the original TigerBeetle, tests include:
- Batch operation testing (up to BATCH_MAX items)
- Large dataset querying
- Multiple concurrent operations
- Memory usage validation

## Continuous Integration

For CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Unit Tests
  run: deno task test:unit

- name: Run Functional Tests  
  run: deno task test:functional

- name: Setup MySQL for Integration Tests
  run: |
    # Setup MySQL service
    mysql -e "CREATE DATABASE tigerbeetle_test;"
    mysql tigerbeetle_test < schemas/mysql/schema.sql
    
- name: Run Integration Tests - MySQL
  run: deno task test:integration
  env:
    TB_INTEGRATION_TESTS: 1
    TIGERBEETLE_DB_TYPE: mysql
    TB_TEST_HOST: localhost
    TB_TEST_DB: tigerbeetle_test

- name: Run Integration Tests - Turso
  run: deno task test:integration:turso
  env:
    TIGERBEETLE_DB_TYPE: turso
    TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
    TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

## Adding New Tests

When adding new tests:

1. **Unit tests** go in `tests/unit/test.ts` for pure validation logic
2. **Functional tests** go in `tests/integration/functional_test.ts` for business logic
3. **Integration tests** go in `tests/integration/integration_test.ts` for database operations

Follow the existing patterns:
- Use descriptive test names
- Test both success and error cases
- Include edge cases and boundary conditions
- Verify all relevant state changes
- Clean up resources in finally blocks

## Test Data Management

Tests use:
- **Generated unique IDs** via `id()` function to avoid conflicts
- **Helper functions** to create test accounts and transfers
- **Cleanup patterns** to ensure test isolation
- **Mocking strategies** for database-free testing where appropriate

This comprehensive test suite ensures the Deno port maintains compatibility with TigerBeetle's behavior while providing confidence in the implementation's correctness.