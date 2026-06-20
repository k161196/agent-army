import { join } from 'node:path';

import { createContextStore } from './context-store.js';
import { rankImplementationCandidates } from './context-matcher.js';
import { createContextJira } from './context-jira.js';
import { createContextService } from './context-service.js';

export function openContextService({ cwd = process.cwd(), dbPath, now = () => new Date(), runJira } = {}) {
  const resolvedDbPath = dbPath ?? process.env.AGENT_ARMY_DB_PATH ?? join(cwd, '.agent-army', 'context.db');
  const store = createContextStore({ dbPath: resolvedDbPath, now });
  store.init();

  const jira = createContextJira({
    run: runJira,
    command: process.env.AGENT_ARMY_JIRA_BIN ?? 'jira',
  });

  const service = createContextService({
    store,
    matcher: { rankImplementationCandidates },
    jira,
    now,
  });

  return {
    dbPath: resolvedDbPath,
    store,
    service,
    close() {
      store.close();
    },
  };
}
