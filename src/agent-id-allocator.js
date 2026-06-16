function nextAgentId(type, existingIds) {
  if (!existingIds.has(type)) return type;
  for (let index = 2; ; index += 1) {
    const id = `${type}-${index}`;
    if (!existingIds.has(id)) return id;
  }
}

export class AgentIdAllocator {
  #activeIds;
  #reserved = new Set();

  constructor(activeIds) {
    this.#activeIds = activeIds;
  }

  reserve(type, requestedId) {
    const existingIds = new Set([...this.#activeIds(), ...this.#reserved]);
    const agentId = requestedId ?? nextAgentId(type, existingIds);
    if (existingIds.has(agentId)) throw new Error(`agent is already active: ${agentId}`);
    this.#reserved.add(agentId);
    return agentId;
  }

  release(agentId) {
    this.#reserved.delete(agentId);
  }
}
