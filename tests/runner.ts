/**
 * Comprehensive test runner for TigerBeetle Deno Port
 * Runs unit tests, functional tests, and integration tests
 */

import * as colors from 'https://deno.land/std@0.201.0/fmt/colors.ts';

interface TestSuite {
  name: string;
  file: string;
  description: string;
  requiresDatabase?: boolean;
}

const testSuites: TestSuite[] = [
  {
    name: 'Unit Tests',
    file: 'tests/unit/test.ts',
    description: 'Basic unit tests for core functionality',
    requiresDatabase: false,
  },
  {
    name: 'Functional Tests',
    file: 'tests/integration/functional_test.ts', 
    description: 'Comprehensive functional tests matching TigerBeetle test suite',
    requiresDatabase: false,
  },
  {
    name: 'Integration Tests',
    file: 'tests/integration/integration_test.ts',
    description: 'Database integration tests (requires MySQL)',
    requiresDatabase: true,
  },
];

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

class TestRunner {
  private results: TestResult[] = [];
  
  async runAllTests(options: { 
    skipIntegration?: boolean; 
    verbose?: boolean;
    pattern?: string;
  } = {}): Promise<void> {
    const startTime = Date.now();
    
    console.log(colors.blue('🧪 TigerBeetle Deno Port - Test Runner\n'));
    
    let suitesToRun = testSuites;
    
    // Filter by pattern if provided
    if (options.pattern) {
      suitesToRun = suitesToRun.filter(suite => 
        suite.name.toLowerCase().includes(options.pattern!.toLowerCase()) ||
        suite.description.toLowerCase().includes(options.pattern!.toLowerCase())
      );
    }
    
    // Skip integration tests if requested or if database not configured
    if (options.skipIntegration || !this.isDatabaseConfigured()) {
      if (options.skipIntegration) {
        console.log(colors.yellow('⏭️  Skipping integration tests (--skip-integration flag)'));
      } else {
        console.log(colors.yellow('⏭️  Skipping integration tests (no database configuration)'));
        console.log('   Set TB_INTEGRATION_TESTS=1 and configure database connection to run integration tests\n');
      }
      suitesToRun = suitesToRun.filter(suite => !suite.requiresDatabase);
    }
    
    for (const suite of suitesToRun) {
      await this.runTestSuite(suite, options.verbose || false);
    }
    
    const totalTime = Date.now() - startTime;
    this.printSummary(totalTime);
  }
  
  private async runTestSuite(suite: TestSuite, verbose: boolean): Promise<void> {
    console.log(colors.cyan(`\n📋 Running ${suite.name}`));
    console.log(colors.dim(`   ${suite.description}`));
    
    const startTime = Date.now();
    
    try {
      const cmd = new Deno.Command('deno', {
        args: [
          'test',
          '--allow-net',
          '--allow-env',
          '--allow-read',
          suite.file,
        ],
        stdout: 'piped',
        stderr: 'piped',
      });
      
      const process = cmd.spawn();
      const { code, stdout, stderr } = await process.output();
      
      const duration = Date.now() - startTime;
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);
      
      const passed = code === 0;
      
      this.results.push({
        suite: suite.name,
        passed,
        duration,
        output,
        error: errorOutput,
      });
      
      if (passed) {
        console.log(colors.green(`   ✅ ${suite.name} passed (${duration}ms)`));
      } else {
        console.log(colors.red(`   ❌ ${suite.name} failed (${duration}ms)`));
        if (verbose || !passed) {
          console.log(colors.dim('   Output:'));
          console.log(this.indentText(output, 4));
          if (errorOutput) {
            console.log(colors.red('   Errors:'));
            console.log(this.indentText(errorOutput, 4));
          }
        }
      }
      
      if (verbose && passed) {
        console.log(colors.dim('   Output:'));
        console.log(this.indentText(output, 4));
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(colors.red(`   ❌ ${suite.name} failed to run (${duration}ms)`));
      console.log(colors.red(`   Error: ${error.message}`));
      
      this.results.push({
        suite: suite.name,
        passed: false,
        duration,
        output: '',
        error: error.message,
      });
    }
  }
  
  private printSummary(totalTime: number): void {
    console.log(colors.blue('\n📊 Test Summary'));
    console.log('='.repeat(50));
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    
    console.log(`Total test suites: ${total}`);
    console.log(colors.green(`Passed: ${passed}`));
    
    if (failed > 0) {
      console.log(colors.red(`Failed: ${failed}`));
      console.log('\nFailed suites:');
      
      for (const result of this.results) {
        if (!result.passed) {
          console.log(colors.red(`  - ${result.suite} (${result.duration}ms)`));
        }
      }
    } else {
      console.log(colors.green('All test suites passed! 🎉'));
    }
    
    console.log(`\nTotal time: ${totalTime}ms`);
    
    // Exit with error code if any tests failed
    if (failed > 0) {
      Deno.exit(1);
    }
  }
  
  private isDatabaseConfigured(): boolean {
    return Deno.env.get('TB_INTEGRATION_TESTS') === '1';
  }
  
  private indentText(text: string, spaces: number): string {
    const indent = ' '.repeat(spaces);
    return text
      .split('\n')
      .map(line => line.trim() ? indent + line : line)
      .join('\n');
  }
  
  async runSpecificTest(testName: string, options: { verbose?: boolean } = {}): Promise<void> {
    console.log(colors.blue(`🔍 Running specific test: ${testName}\n`));
    
    try {
      const cmd = new Deno.Command('deno', {
        args: [
          'test',
          '--allow-net',
          '--allow-env',
          '--allow-read',
          '--filter',
          testName,
          'src/',
        ],
        stdout: 'inherit',
        stderr: 'inherit',
      });
      
      const process = cmd.spawn();
      const { code } = await process.output();
      
      if (code === 0) {
        console.log(colors.green('\n✅ Test completed successfully'));
      } else {
        console.log(colors.red('\n❌ Test failed'));
        Deno.exit(1);
      }
      
    } catch (error) {
      console.log(colors.red(`❌ Failed to run test: ${error.message}`));
      Deno.exit(1);
    }
  }
  
  printHelp(): void {
    console.log(colors.blue('TigerBeetle Deno Port - Test Runner'));
    console.log('\nUsage:');
    console.log('  deno run --allow-all src/test_runner.ts [options]');
    console.log('\nOptions:');
    console.log('  --help, -h              Show this help message');
    console.log('  --verbose, -v           Show detailed output');
    console.log('  --skip-integration      Skip integration tests');
    console.log('  --pattern <pattern>     Run only tests matching pattern');
    console.log('  --test <name>           Run specific test by name');
    console.log('\nEnvironment Variables:');
    console.log('  TB_INTEGRATION_TESTS=1  Enable integration tests');
    console.log('  TB_TEST_HOST            MySQL test host (default: localhost)');
    console.log('  TB_TEST_PORT            MySQL test port (default: 3306)');
    console.log('  TB_TEST_DB              MySQL test database (default: tigerbeetle_test)');
    console.log('  TB_TEST_USER            MySQL test user (default: root)');
    console.log('  TB_TEST_PASSWORD        MySQL test password (default: empty)');
    console.log('\nExamples:');
    console.log('  # Run all tests');
    console.log('  deno run --allow-all src/test_runner.ts');
    console.log('');
    console.log('  # Run only unit tests with verbose output');
    console.log('  deno run --allow-all src/test_runner.ts --pattern unit --verbose');
    console.log('');
    console.log('  # Skip integration tests');
    console.log('  deno run --allow-all src/test_runner.ts --skip-integration');
    console.log('');
    console.log('  # Run specific test');
    console.log('  deno run --allow-all src/test_runner.ts --test "ID Generation"');
  }
}

// Command line interface
async function main() {
  const args = Deno.args;
  const runner = new TestRunner();
  
  if (args.includes('--help') || args.includes('-h')) {
    runner.printHelp();
    return;
  }
  
  const verbose = args.includes('--verbose') || args.includes('-v');
  const skipIntegration = args.includes('--skip-integration');
  
  // Check for pattern filter
  const patternIndex = args.findIndex(arg => arg === '--pattern');
  const pattern = patternIndex >= 0 && args[patternIndex + 1] ? args[patternIndex + 1] : undefined;
  
  // Check for specific test
  const testIndex = args.findIndex(arg => arg === '--test');
  const testName = testIndex >= 0 && args[testIndex + 1] ? args[testIndex + 1] : undefined;
  
  if (testName) {
    await runner.runSpecificTest(testName, { verbose });
  } else {
    await runner.runAllTests({ 
      skipIntegration, 
      verbose, 
      pattern 
    });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(colors.red('Test runner error:'), error);
    Deno.exit(1);
  });
}