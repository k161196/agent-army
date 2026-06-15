const schemas = {
  send_agent_message: {
    description: 'Send work or a follow-up to a named agent and wait for its response.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' }, message: { type: 'string' } },
      required: ['agent', 'message'],
    },
  },
  get_agent_status: {
    description: 'Get the current status of a named agent.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' } },
      required: ['agent'],
    },
  },
  list_agent_messages: {
    description: 'List messages associated with a named agent.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: 'string' } },
      required: ['agent'],
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
  manager: ['send_agent_message', 'get_agent_status', 'list_agent_messages'],
  brainstorming: ['report_status'],
};

export function toolDefinitions(role) {
  return (capabilities[role] ?? []).map(name => ({ name, ...schemas[name] }));
}

export async function callTool(role, name, args, request) {
  if (!(capabilities[role] ?? []).includes(name)) throw new Error(`tool ${name} is not available to ${role}`);
  switch (name) {
    case 'send_agent_message':
      return request(`/agents/${args.agent}/messages`, { message: args.message });
    case 'get_agent_status':
      return request(`/agents/${args.agent}/status`);
    case 'list_agent_messages':
      return request(`/agents/${args.agent}/messages`);
    case 'report_status':
      return request(`/agents/${role}/status`, { status: args.status, message: args.message });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
