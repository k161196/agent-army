import { homedir } from 'node:os';
import { join } from 'node:path';

import { createContextStore } from './context-store.js';
import { rankImplementationCandidates } from './context-matcher.js';
import { createContextJira } from './context-jira.js';
import { createContextService } from './context-service.js';

export function openContextService({ cwd = process.cwd(), now = () => new Date(), runJira } = {}) {
  const dbPath = join(homedir(), '.agent-army', 'context.db');
  const store = createContextStore({ dbPath, now });
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
    dbPath,
    store,
    service,
    close() {
      store.close();
    },
  };
}
