/** Where an agent reads the atlas MCP entry: the committed root `.mcp.json`, or a file of its own. */
export class AgentScopes {
  static readonly PROJECT = 'project';
  static readonly SHARED = 'shared';

  static readonly SCHEME_SET = new Set<string>([this.PROJECT, this.SHARED]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** The file formats an agent's MCP entry is written in. */
export class AgentRenderers {
  static readonly MCP_SERVERS = 'mcpServers';
  static readonly SERVERS = 'servers';
  static readonly CODEX_TOML = 'codex-toml';

  static readonly SCHEME_SET = new Set<string>([this.MCP_SERVERS, this.SERVERS, this.CODEX_TOML]);

  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

export class AgentConstants {
  /** The per-developer choice: gitignored, written by sync, never by hand. */
  static readonly LOCAL_FILE = '.agents/vulcan.local.json';
  static readonly LOCAL_SCHEMA_VERSION = 1;
  static readonly LOCAL_NOTE = 'by vulcan sync - your agents on this machine; not committed';
  static readonly FLAG = '--agents';
  static readonly LIST = 'list';
  static readonly NONE = 'none';
  /** The shared MCP file `claude`, `omp` and `copilot-cli` all read. */
  static readonly SHARED_MCP_FILE = '.mcp.json';
  static readonly DEFAULT_AGENT = 'claude';
  static readonly EXAMPLE_LIST = 'claude,omp';
}
