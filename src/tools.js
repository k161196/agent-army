const schemas = {
  send_agent_message: {
    description: 'Send work to a runtime agent id returned by spawn_agent. Returns immediately — do NOT wait for a response. The agent will call report_status when done. By default queues behind active work; interrupt: true cancels active work before sending.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' }, message: { type: 'string' }, interrupt: { type: 'boolean' } },
      required: ['agent', 'message'],
    },
  },
  get_agent_status: {
    description: 'Get the current status of a runtime agent id returned by spawn_agent.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' } },
      required: ['agent'],
    },
  },
  list_agent_messages: {
    description: 'List messages associated with a runtime agent id returned by spawn_agent.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' } },
      required: ['agent'],
    },
  },
  spawn_agent: {
    description: 'Start a known specialist Agent type for a task. Returns agentId; use that id for follow-up tools. For closed prior sessions, this resumes context by injecting the prior summary/session ID into a fresh thread.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        agentId: { type: 'string' },
        title: { type: 'string' },
        taskId: { type: 'string' },
        contextKey: { type: 'string' },
        resumeSessionId: { type: 'string' },
        contextSummary: { type: 'string' },
      },
      required: ['agent'],
    },
  },
  close_agent: {
    description: 'Close an active runtime agent id and optionally store a concise completed-task summary for later Manager routing.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        summary: { type: 'string' },
        title: { type: 'string' },
        contextKey: { type: 'string' },
        status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
      },
      required: ['agent'],
    },
  },
  list_run_agents: {
    description: 'List active and historical Agent records for the current Agent Army run.',
    inputSchema: { type: 'object', properties: {} },
  },
  list_completed_contexts: {
    description: 'List completed context summaries and prior session IDs recorded in the current run.',
    inputSchema: { type: 'object', properties: {} },
  },
  record_task_summary: {
    description: 'Record a completed context summary with related Agent session IDs for future routing within this run.',
    inputSchema: {
      type: 'object',
      properties: {
        contextKey: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        agentSessions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string' },
              type: { type: 'string' },
              sessionId: { type: 'string' },
              threadId: { type: 'string' },
            },
          },
        },
      },
      required: ['contextKey', 'title', 'summary'],
    },
  },
  report_status: {
    description: 'Report meaningful progress, completion, or a blocker to the Manager Agent.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['idle', 'working', 'blocked', 'completed', 'failed'] },
        message: { type: 'string' },
      },
      required: ['status', 'message'],
    },
  },
};

const capabilities = {
  manager: [
    'spawn_agent',
    'close_agent',
    'list_run_agents',
    'list_completed_contexts',
    'record_task_summary',
    'send_agent_message',
    'get_agent_status',
    'list_agent_messages',
  ],
  brainstorming: ['report_status'],
  implementation: ['report_status'],
  debug: ['report_status'],
  tester: ['report_status'],
};

function toolContext(value) {
  return typeof value === 'string' ? { role: value, agentId: value } : {
    role: value.role,
    agentId: value.agentId ?? value.role,
  };
}

export function toolDefinitions(role) {
  return (capabilities[toolContext(role).role] ?? []).map(name => ({ name, ...schemas[name] }));
}

export async function callTool(context, name, args, request) {
  const { role, agentId } = toolContext(context);
  if (!(capabilities[role] ?? []).includes(name)) throw new Error(`tool ${name} is not available to ${role}`);
  switch (name) {
    case 'send_agent_message':
      return request(`/agents/${args.agent}/messages`, { message: args.message, interrupt: args.interrupt ?? false });
    case 'get_agent_status':
      return request(`/agents/${args.agent}/status`);
    case 'list_agent_messages':
      return request(`/agents/${args.agent}/messages`);
    case 'spawn_agent': {
      const { agent, ...body } = args;
      return request(`/agents/${agent}/spawn`, body);
    }
    case 'close_agent': {
      const { agent, ...body } = args;
      return request(`/agents/${agent}/close`, body);
    }
    case 'list_run_agents':
      return request('/run');
    case 'list_completed_contexts':
      return request('/contexts');
    case 'record_task_summary':
      return request('/contexts', {
        contextKey: args.contextKey,
        title: args.title,
        summary: args.summary,
        agentSessions: args.agentSessions ?? [],
      });
    case 'report_status':
      return request(`/agents/${agentId}/status`, { status: args.status, message: args.message });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
