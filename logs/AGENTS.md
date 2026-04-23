<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-22 | Updated: 2026-04-22 -->

# logs

## Purpose
Rotating log files for the Claude Code Router server. The upstream CCR uses two logging systems:
- **Server-level logs** (here): HTTP requests, API calls, routing decisions — written by pino logger to `ccr-*.log` files
- **Application-level logs**: Routing decisions and business logic — written to `claude-code-router.log` (in root directory, separate from this logs/ dir)

## Key Files

| File | Description |
|------|-------------|
| `ccr-*.log` | Timestamped server log files (format: `ccr-YYYYMMDDHHMMSS.log`). Contains pino-formatted JSON logs for HTTP requests, routing, transformer actions, errors, and performance |

## For AI Agents

### Working In This Directory
- Do not edit log files
- Use `tail -f` to monitor live routing decisions
- Logs rotate automatically; old logs are safe to delete for disk space
- Search logs with `grep` for specific model names, errors, or request IDs
- Log level controlled by `LOG_LEVEL` in `config.json` (fatal/error/warn/info/debug/trace)
- `LOG: false` in config disables file logging entirely

### Testing Requirements
- No tests for this directory
- Verify logging works by checking that new log files appear after `ccr restart`