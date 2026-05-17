import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { getAgentStudioDataDir } from '../agent-studio-data-dir';

const execFileAsync = promisify(execFile);

export const DEFAULT_DB_NAME = 'agent-studio';
export const DEV_BRANCH_DB_NAME = 'agent-studio-dev';
export const PRD_BRANCH_NAME = 'main';

export interface DatabaseLocation {
  branchName: string | null;
  dbDir: string;
  dbName: string;
  dbPath: string;
  source: 'production-runtime' | 'git-main-branch' | 'git-non-main-branch';
}

export interface ResolveDatabaseLocationOptions {
  cwd?: string;
  dbDir?: string;
  detectGitBranch?: (cwd: string) => Promise<string | null>;
  isProductionRuntime?: boolean;
}

export async function detectCurrentGitBranch(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd });
    const branchName = stdout.trim();
    return branchName || null;
  } catch {
    return null;
  }
}

export async function resolveDatabaseLocation(
  options: ResolveDatabaseLocationOptions = {}
): Promise<DatabaseLocation> {
  const dbDir = options.dbDir ?? getAgentStudioDataDir();
  const isProductionRuntime = options.isProductionRuntime ?? (
    process.env.AGENT_STUDIO_PRODUCTION_DB === '1' ||
    process.env.NODE_ENV === 'production' ||
    process.env.AGENT_STUDIO_CLI === '1' ||
    process.env.ELECTRON_CHILD === '1' ||
    process.env.AGENT_STUDIO_ELECTRON_SERVER === '1'
  );

  if (isProductionRuntime) {
    return buildDatabaseLocation({
      branchName: null,
      dbDir,
      dbName: DEFAULT_DB_NAME,
      source: 'production-runtime',
    });
  }

  const cwd = options.cwd ?? process.cwd();
  const getBranch = options.detectGitBranch ?? detectCurrentGitBranch;
  const branchName = await getBranch(cwd);

  if (branchName === PRD_BRANCH_NAME) {
    return buildDatabaseLocation({
      branchName,
      dbDir,
      dbName: DEFAULT_DB_NAME,
      source: 'git-main-branch',
    });
  }

  return buildDatabaseLocation({
    branchName,
    dbDir,
    dbName: DEV_BRANCH_DB_NAME,
    source: 'git-non-main-branch',
  });
}

function buildDatabaseLocation(args: {
  branchName: string | null;
  dbDir: string;
  dbName: string;
  source: DatabaseLocation['source'];
}): DatabaseLocation {
  return {
    branchName: args.branchName,
    dbDir: args.dbDir,
    dbName: args.dbName,
    dbPath: path.join(args.dbDir, `${args.dbName}.db`),
    source: args.source,
  };
}
