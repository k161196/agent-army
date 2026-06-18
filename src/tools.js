const schemas = {
  send_agent_message: {
    description:
      'Send work to a runtime agent id returned by spawn_agent. Returns immediately and queues by default.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        message: { type: 'string' },
        interrupt: { type: 'boolean' },
      },
      required: ['agent', 'message'],
    },
  },
  get_agent_status: {
    description: 'Get the current status of a runtime agent id returned by spawn_agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
    },
  },
  list_agent_messages: {
    description: 'List messages associated with a runtime agent id returned by spawn_agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
      },
      required: ['agent'],
    },
  },
  spawn_agent: {
    description: 'Start a known specialist agent type for a task.',
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
    description: 'Close an active runtime agent id and optionally record a summary.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string' },
        summary: { type: 'string' },
        title: { type: 'string' },
        contextKey: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['agent'],
    },
  },
  list_run_agents: {
    description: 'List active and historical agent records for the current Agent Army run.',
    inputSchema: { type: 'object', properties: {} },
  },
  list_completed_contexts: {
    description: 'List completed context summaries recorded in the current run.',
    inputSchema: { type: 'object', properties: {} },
  },
  record_task_summary: {
    description: 'Record a completed task summary for future routing in this run.',
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
  context_intake_issue: {
    description: 'Fetch a Jira issue, store its snapshot locally, and return ranked implementation matches.',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string' },
      },
      required: ['issueKey'],
    },
  },
  context_match_issue: {
    description: 'Return ranked implementation candidates for a stored issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string' },
      },
      required: ['issueKey'],
    },
  },
  context_get_implementation: {
    description: 'Fetch one implementation record and its attached repos.',
    inputSchema: {
      type: 'object',
      properties: {
        implementationId: { type: 'number' },
      },
      required: ['implementationId'],
    },
  },
  context_add_note: {
    description: 'Append an attributed note to an implementation or issue.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string', enum: ['implementation', 'issue'] },
        entityId: { type: 'number' },
        authorType: { type: 'string', enum: ['user', 'agent'] },
        authorId: { type: 'string' },
        trustLevel: { type: 'string', enum: ['hint', 'verified'] },
        body: { type: 'string' },
      },
      required: ['entityType', 'entityId', 'authorType', 'authorId', 'trustLevel', 'body'],
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
    'context_intake_issue',
    'context_match_issue',
    'context_get_implementation',
    'context_add_note',
  ],
  brainstorming: ['report_status'],
  implementation: ['report_status'],
  debug: ['report_status'],
  tester: ['report_status'],
};

function toolContext(value) {
  return typeof value === 'string'
    ? { role: value, agentId: value }
    : { role: value.role, agentId: value.agentId ?? value.role };
}

export function toolDefinitions(role) {
  return (capabilities[toolContext(role).role] ?? []).map((name) => ({ name, ...schemas[name] }));
}

export async function callTool(context, name, args, request) {
  const { role, agentId } = toolContext(context);

  if (!(capabilities[role] ?? []).includes(name)) {
    throw new Error(`tool ${name} is not available to ${role}`);
  }

  switch (name) {
    case 'send_agent_message':
      return request(`/agents/${args.agent}/messages`, {
        message: args.message,
        interrupt: args.interrupt ?? false,
      });
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
    case 'context_intake_issue':
      return request('/context/issues/intake', { issueKey: args.issueKey });
    case 'context_match_issue':
      return request(`/context/issues/${args.issueKey}/candidates`);
    case 'context_get_implementation':
      return request(`/context/implementations/${args.implementationId}`);
    case 'context_add_note':
      return request('/context/notes', args);
    case 'report_status':
      return request(`/agents/${agentId}/status`, { status: args.status, message: args.message });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
