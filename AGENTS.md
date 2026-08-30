# PATIENT ZERO — Coding Rules (AGENTS.md)

## TypeScript
- Always strict mode. Never use `any` — use `unknown` + type guards instead.
- All async functions use async/await. No raw `.then()` chains.
- All new interfaces go in `src/types/index.ts`.
- Export singletons from their module (e.g., `export const graphStore = new GraphStore()`).

## Module Structure
- RPC interactions → `src/rpc/`
- Parsing logic → `src/parser/`
- Graph algorithms → `src/graph/`
- API routes → `src/api/`
- Frontend → `frontend/src/`
- Python scripts → `python/`
- Build scripts → `scripts/`
- Tests → `tests/`

## Logging
- Always use `logger` from `src/config.ts`. Never raw `console.log` in backend code.
- Frontend may use `console.log` sparingly for debug output.

## Error Handling
- Every async function must have a try/catch.
- Network/RPC calls should return `null` on failure (not throw) and log the error.
- Never let an unhandled rejection crash the process — log and continue.

## Formatting
- 2 space indentation
- Single quotes for strings
- Trailing commas in multiline objects/arrays
- Line length: prefer ≤ 100 chars

## Config
- All magic numbers go in `src/config.ts` as named constants.
- Never hardcode ports, thresholds, or URLs inline.

## Testing
- Tests go in `tests/` and use ts-jest with describe/it/expect pattern.
- Each test is self-contained with its own mock data.
- Mock `src/rpc/solanaConnection.ts` in any test that touches the parser.
