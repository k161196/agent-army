import { createInterface } from 'node:readline';

const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const POLL_INTERVAL_MS = 750;

function truncate(value, width) {
  const text = String(value ?? '');
  if (width <= 0) return '';
  if (text.length <= width) return text.padEnd(width, ' ');
  if (width <= 3) return '.'.repeat(width);
  return `${text.slice(0, width - 3)}...`;
}

function tableWidths(width) {
  const safeWidth = Math.max(width || 80, 60);
  const name = Math.min(14, Math.max(10, Math.floor(safeWidth * 0.18)));
  const status = 12;
  const sessionId = Math.min(20, Math.max(14, Math.floor(safeWidth * 0.28)));
  const summary = Math.max(20, safeWidth - name - status - sessionId - 3);
  return { name, status, sessionId, summary, total: name + status + sessionId + summary + 3 };
}

function renderTable(agents, width) {
  const columns = tableWidths(width);
  const lines = [
    `${truncate('Name', columns.name)} ${truncate('Status', columns.status)} ${truncate('Session ID', columns.sessionId)} ${truncate('Summary', columns.summary)}`,
    '-'.repeat(columns.total),
  ];

  for (const agent of agents) {
    lines.push(
      `${truncate(agent.name, columns.name)} ${truncate(agent.status, columns.status)} ${truncate(agent.sessionId, columns.sessionId)} ${truncate(agent.summary, columns.summary)}`,
    );
  }

  return lines.join('\n');
}

function renderPrompt(prompt, input) {
  return `${prompt}${input ?? ''}`;
}

export function renderManagerScreen({
  ui,
  prompt = '',
  input = '',
  isLoading = false,
  error = '',
  response = '',
  width = process.stdout.columns || 80,
}) {
  const lines = ['Agent Army'];

  if (ui) {
    lines.push(`Run: ${ui.runId}`);
    lines.push(`Manager: ${ui.managerStatus}`);
  } else {
    lines.push('Run: loading');
    lines.push('Manager: loading');
  }

  lines.push('');

  if (isLoading) {
    lines.push('Loading agent roster...');
  } else if (!ui?.agents?.length) {
    lines.push('No agents available for this run yet.');
  } else {
    lines.push(renderTable(ui.agents, width));
  }

  if (error) {
    lines.push('');
    lines.push(`Warning: ${error}`);
  }

  if (response) {
    lines.push('');
    lines.push('Manager Response');
    lines.push(response);
  }

  if (prompt) {
    lines.push('');
    lines.push(renderPrompt(prompt, input));
  }

  return `${lines.join('\n')}\n`;
}

export async function startManagerTui({
  state,
  request,
  attachInitialAgentPanes,
  syncAgentPanes,
  panesFile,
  target,
  exec,
  input = process.stdin,
  output = process.stdout,
  pollIntervalMs = POLL_INTERVAL_MS,
}) {
  const panes = attachInitialAgentPanes(state, { panesFile, target, exec });
  let currentState = state;
  let ui = null;
  let response = '';
  let error = '';
  let rl = null;
  let pollTimer = null;
  let stopping = false;

  const writeScreen = () => {
    output.write(CLEAR_SCREEN);
    output.write(
      renderManagerScreen({
        ui,
        prompt: rl ? '[you] ' : '[loading] ',
        input: rl ? rl.line : 'Waiting for manager UI...',
        isLoading: !ui,
        error,
        response,
        width: output.columns || 80,
      }),
    );
  };

  const refresh = async () => {
    const [nextUi, health] = await Promise.all([
      request(currentState, '/ui-state'),
      request(currentState, '/health'),
    ]);
    ui = nextUi;
    syncAgentPanes(health, panes, { panesFile, target, exec });
    currentState = health;
    error = '';
    writeScreen();
  };

  writeScreen();
  while (!ui) {
    try {
      await refresh();
    } catch (refreshError) {
      error = `unable to refresh agent roster (${refreshError.message}). Retrying...`;
      writeScreen();
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  rl = createInterface({ input, output, terminal: true });
  writeScreen();

  const schedulePoll = () => {
    pollTimer = setInterval(async () => {
      if (stopping) return;
      try {
        await refresh();
      } catch (refreshError) {
        error = `unable to refresh agent roster (${refreshError.message}). Showing last known state.`;
        writeScreen();
      }
    }, pollIntervalMs);
  };

  const close = () => {
    if (stopping) return;
    stopping = true;
    if (pollTimer) clearInterval(pollTimer);
    rl.close();
  };

  rl.on('line', async line => {
    if (!line.trim()) {
      writeScreen();
      return;
    }
    response = '';
    writeScreen();
    try {
      const result = await request(currentState, '/message', { message: line });
      response = result.response ?? '';
      await refresh();
    } catch (lineError) {
      error = lineError.message;
      writeScreen();
    }
  });

  rl.on('SIGINT', () => close());
  rl.on('close', () => {
    if (pollTimer) clearInterval(pollTimer);
  });

  schedulePoll();
}
