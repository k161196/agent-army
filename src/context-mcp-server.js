#!/usr/bin/env node
import { createInterface } from 'node:readline';

import { openContextService } from './context-app.js';

const ctx = openContextService();

process.on('exit', () => ctx.close());
process.on('SIGTERM', () => {
  ctx.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  ctx.close();
  process.exit(0);
});

const ENTITIES = {
  organization: {
    table: 'organizations',
    plural: 'organizations',
    idArg: 'organizationId',
    fields: [{ arg: 'name', column: 'name', type: 'string', required: true }],
    timestamps: 'both',
  },
  project: {
    table: 'projects',
    plural: 'projects',
    idArg: 'projectId',
    fields: [
      { arg: 'organizationId', column: 'organization_id', type: 'number', required: true },
      { arg: 'key', column: 'key', type: 'string', required: true },
      { arg: 'name', column: 'name', type: 'string', required: true },
    ],
    timestamps: 'both',
  },
  feature: {
    table: 'features',
    plural: 'features',
    idArg: 'featureId',
    fields: [
      { arg: 'projectId', column: 'project_id', type: 'number', required: true },
      { arg: 'name', column: 'name', type: 'string', required: true },
      { arg: 'description', column: 'description', type: 'string' },
    ],
    timestamps: 'both',
  },
  repo: {
    table: 'repos',
    plural: 'repos',
    idArg: 'repoId',
    fields: [
      { arg: 'organizationId', column: 'organization_id', type: 'number', required: true },
      { arg: 'name', column: 'name', type: 'string', required: true },
      { arg: 'url', column: 'url', type: 'string' },
    ],
    timestamps: 'both',
  },
  branch: {
    table: 'branches',
    plural: 'branches',
    idArg: 'branchId',
    fields: [
      { arg: 'repoId', column: 'repo_id', type: 'number', required: true },
      { arg: 'name', column: 'name', type: 'string', required: true },
    ],
    timestamps: 'both',
  },
  implementation: {
    table: 'implementations',
    plural: 'implementations',
    idArg: 'implementationId',
    fields: [
      { arg: 'featureId', column: 'feature_id', type: 'number', required: true },
      { arg: 'name', column: 'name', type: 'string', required: true },
      { arg: 'type', column: 'type', type: 'string', required: true },
      { arg: 'status', column: 'status', type: 'string', required: true },
      { arg: 'target', column: 'target', type: 'string' },
      { arg: 'runInstructions', column: 'run_instructions', type: 'string' },
      { arg: 'testInstructions', column: 'test_instructions', type: 'string' },
      { arg: 'invocationExample', column: 'invocation_example', type: 'string' },
      { arg: 'expectedResult', column: 'expected_result', type: 'string' },
      { arg: 'verificationCheck', column: 'verification_check', type: 'string' },
      { arg: 'codePointers', column: 'code_pointers_json', type: 'array' },
    ],
    timestamps: 'both',
  },
  implementationRepo: {
    table: 'implementation_repos',
    plural: 'implementation_repos',
    idArg: 'implementationRepoId',
    fields: [
      { arg: 'implementationId', column: 'implementation_id', type: 'number', required: true },
      { arg: 'repoId', column: 'repo_id', type: 'number', required: true },
      { arg: 'branchId', column: 'branch_id', type: 'number' },
    ],
    timestamps: 'created',
  },
  issue: {
    table: 'issues',
    plural: 'issues',
    idArg: 'issueId',
    fields: [
      { arg: 'issueKey', column: 'issue_key', type: 'string', required: true },
      { arg: 'source', column: 'source', type: 'string', required: true },
      { arg: 'status', column: 'status', type: 'string', required: true },
      { arg: 'title', column: 'title', type: 'string', required: true },
      { arg: 'body', column: 'body', type: 'string' },
      { arg: 'projectKey', column: 'project_key', type: 'string' },
      { arg: 'components', column: 'components_json', type: 'array' },
      { arg: 'labels', column: 'labels_json', type: 'array' },
      { arg: 'repoNames', column: 'repo_names_json', type: 'array' },
      { arg: 'implementationId', column: 'implementation_id', type: 'number' },
      { arg: 'snapshot', column: 'snapshot_json', type: 'object' },
    ],
    timestamps: 'both',
    getByKey: true,
  },
  note: {
    table: 'notes',
    plural: 'notes',
    idArg: 'noteId',
    fields: [
      { arg: 'entityType', column: 'entity_type', type: 'string', required: true },
      { arg: 'entityId', column: 'entity_id', type: 'number', required: true },
      { arg: 'authorType', column: 'author_type', type: 'string', required: true },
      { arg: 'authorId', column: 'author_id', type: 'string', required: true },
      { arg: 'trustLevel', column: 'trust_level', type: 'string', required: true },
      { arg: 'body', column: 'body', type: 'string', required: true },
    ],
    timestamps: 'created',
  },
  person: {
    table: 'people',
    plural: 'people',
    idArg: 'personId',
    fields: [
      { arg: 'externalId', column: 'external_id', type: 'string', required: true },
      { arg: 'displayName', column: 'display_name', type: 'string', required: true },
    ],
    timestamps: 'both',
  },
  tool: {
    table: 'tools',
    plural: 'tools',
    idArg: 'toolId',
    fields: [
      { arg: 'name', column: 'name', type: 'string', required: true },
      { arg: 'description', column: 'description', type: 'string' },
    ],
    timestamps: 'both',
  },
};

const DATA_ENTITIES = [
  ENTITIES.organization,
  ENTITIES.project,
  ENTITIES.feature,
  ENTITIES.repo,
  ENTITIES.branch,
  ENTITIES.implementation,
  ENTITIES.implementationRepo,
  ENTITIES.issue,
  ENTITIES.note,
  ENTITIES.person,
  ENTITIES.tool,
];

function schemaForType(type) {
  if (type === 'number') return { type: 'number' };
  if (type === 'array') return { type: 'array', items: {} };
  if (type === 'object') return { type: 'object' };
  return { type: 'string' };
}

function buildSchema(fields, required = []) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field.arg, schemaForType(field.type)])),
    required,
  };
}

function encodeValue(field, value) {
  if (field.type === 'array' || field.type === 'object') return JSON.stringify(value);
  return value;
}

function decodeValue(field, value) {
  if (field.type === 'array') return value ? JSON.parse(value) : [];
  if (field.type === 'object') return value ? JSON.parse(value) : {};
  return value;
}

function normalizeRow(entity, row) {
  if (!row) return null;
  const value = { id: row.id };
  for (const field of entity.fields) {
    value[field.arg] = decodeValue(field, row[field.column]);
  }
  if (entity.timestamps === 'created' || entity.timestamps === 'both') {
    value.createdAt = row.created_at;
  }
  if (entity.timestamps === 'both') {
    value.updatedAt = row.updated_at;
  }
  return value;
}

function pickFields(entity, args, { requireAll = false } = {}) {
  const values = [];
  for (const field of entity.fields) {
    const hasValue = Object.hasOwn(args, field.arg);
    if (requireAll && field.required && !hasValue) {
      throw new Error(`missing required field: ${field.arg}`);
    }
    if (!hasValue) continue;
    values.push([field.column, encodeValue(field, args[field.arg])]);
  }
  return values;
}

function listEntity(store, entity, where = '', params = []) {
  return store
    .query(`SELECT * FROM ${entity.table}${where} ORDER BY id`, params)
    .map((row) => normalizeRow(entity, row));
}

function getEntityById(store, entity, id) {
  const row = store.query(`SELECT * FROM ${entity.table} WHERE id = ?`, [id])[0] ?? null;
  return normalizeRow(entity, row);
}

function getIssueByKey(store, issueKey) {
  return normalizeRow(ENTITIES.issue, store.query('SELECT * FROM issues WHERE issue_key = ?', [issueKey])[0] ?? null);
}

function insertEntity(store, entity, args) {
  const values = pickFields(entity, args, { requireAll: true });
  const now = new Date().toISOString();
  if (entity.timestamps === 'created' || entity.timestamps === 'both') {
    values.push(['created_at', now]);
  }
  if (entity.timestamps === 'both') {
    values.push(['updated_at', now]);
  }
  const columns = values.map(([column]) => column);
  const params = values.map(([, value]) => value);
  const sql = `INSERT INTO ${entity.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  const result = store.execute(sql, params);
  return getEntityById(store, entity, Number(result.lastInsertRowid));
}

function updateEntity(store, entity, id, args) {
  const values = pickFields(entity, args);
  if (entity.timestamps === 'both') {
    values.push(['updated_at', new Date().toISOString()]);
  }
  if (values.length === 0) throw new Error('no fields provided for update');
  const params = values.map(([, value]) => value);
  params.push(id);
  const sql = `UPDATE ${entity.table} SET ${values.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`;
  const result = store.execute(sql, params);
  if (result.changes === 0) return null;
  return getEntityById(store, entity, id);
}

function listTool(entity) {
  return {
    name: `context_list_${entity.plural}`,
    description: `List ${entity.plural}.`,
    inputSchema: { type: 'object', properties: {} },
  };
}

function getTool(entity) {
  if (entity === ENTITIES.issue) {
    return {
      name: 'context_get_issue',
      description: 'Get one issue by issue key.',
      inputSchema: buildSchema([{ arg: 'issueKey', type: 'string' }], ['issueKey']),
    };
  }
  return {
    name: `context_get_${entity === ENTITIES.people ? 'person' : entity === ENTITIES.implementationRepo ? 'implementation_repo' : entity === ENTITIES.organization ? 'organization' : entity === ENTITIES.project ? 'project' : entity === ENTITIES.feature ? 'feature' : entity === ENTITIES.repo ? 'repo' : entity === ENTITIES.branch ? 'branch' : entity === ENTITIES.implementation ? 'implementation' : entity === ENTITIES.note ? 'note' : entity === ENTITIES.tool ? 'tool' : ''}`,
    description: `Get one ${entity.table} row by id.`,
    inputSchema: buildSchema([{ arg: entity.idArg, type: 'number' }], [entity.idArg]),
  };
}

function addTool(entity) {
  const singular =
    entity === ENTITIES.implementationRepo ? 'implementation_repo' :
    entity === ENTITIES.organization ? 'organization' :
    entity === ENTITIES.project ? 'project' :
    entity === ENTITIES.feature ? 'feature' :
    entity === ENTITIES.repo ? 'repo' :
    entity === ENTITIES.branch ? 'branch' :
    entity === ENTITIES.implementation ? 'implementation' :
    entity === ENTITIES.issue ? 'issue' :
    entity === ENTITIES.note ? 'note' :
    entity === ENTITIES.person ? 'person' :
    'tool';
  const extra = entity === ENTITIES.implementation ? [{ arg: 'repos', type: 'array' }] : [];
  return {
    name: `context_add_${singular}`,
    description: `Add a ${singular}.`,
    inputSchema: buildSchema([...entity.fields, ...extra], entity.fields.filter((field) => field.required).map((field) => field.arg)),
  };
}

function editTool(entity) {
  const singular =
    entity === ENTITIES.implementationRepo ? 'implementation_repo' :
    entity === ENTITIES.organization ? 'organization' :
    entity === ENTITIES.project ? 'project' :
    entity === ENTITIES.feature ? 'feature' :
    entity === ENTITIES.repo ? 'repo' :
    entity === ENTITIES.branch ? 'branch' :
    entity === ENTITIES.implementation ? 'implementation' :
    entity === ENTITIES.issue ? 'issue' :
    entity === ENTITIES.note ? 'note' :
    entity === ENTITIES.person ? 'person' :
    'tool';
  return {
    name: `context_edit_${singular}`,
    description: `Edit a ${singular}.`,
    inputSchema: buildSchema([{ arg: entity.idArg, type: 'number' }, ...entity.fields], [entity.idArg]),
  };
}

const TOOLS = [
  ...DATA_ENTITIES.flatMap((entity) => [listTool(entity), getTool(entity), addTool(entity), editTool(entity)]),
  {
    name: 'context_create_organization',
    description: 'Create an organization.',
    inputSchema: buildSchema(ENTITIES.organization.fields, ['name']),
  },
  {
    name: 'context_update_organization',
    description: 'Update an organization.',
    inputSchema: buildSchema([{ arg: 'organizationId', type: 'number' }, ...ENTITIES.organization.fields], ['organizationId']),
  },
  {
    name: 'context_create_project',
    description: 'Create a project.',
    inputSchema: buildSchema(ENTITIES.project.fields, ['organizationId', 'key', 'name']),
  },
  {
    name: 'context_update_project',
    description: 'Update a project.',
    inputSchema: buildSchema([{ arg: 'projectId', type: 'number' }, ...ENTITIES.project.fields], ['projectId']),
  },
  {
    name: 'context_create_feature',
    description: 'Create a feature.',
    inputSchema: buildSchema(ENTITIES.feature.fields, ['projectId', 'name']),
  },
  {
    name: 'context_update_feature',
    description: 'Update a feature.',
    inputSchema: buildSchema([{ arg: 'featureId', type: 'number' }, ...ENTITIES.feature.fields], ['featureId']),
  },
  {
    name: 'context_create_repo',
    description: 'Create a repo.',
    inputSchema: buildSchema(ENTITIES.repo.fields, ['organizationId', 'name']),
  },
  {
    name: 'context_upsert_repo',
    description: 'Find or create a repo by organizationId and name.',
    inputSchema: buildSchema(ENTITIES.repo.fields, ['organizationId', 'name']),
  },
  {
    name: 'context_update_repo',
    description: 'Update a repo.',
    inputSchema: buildSchema([{ arg: 'repoId', type: 'number' }, ...ENTITIES.repo.fields], ['repoId']),
  },
  {
    name: 'context_create_branch',
    description: 'Create a branch.',
    inputSchema: buildSchema(ENTITIES.branch.fields, ['repoId', 'name']),
  },
  {
    name: 'context_upsert_branch',
    description: 'Find or create a branch by repoId and name.',
    inputSchema: buildSchema(ENTITIES.branch.fields, ['repoId', 'name']),
  },
  {
    name: 'context_update_branch',
    description: 'Update a branch.',
    inputSchema: buildSchema([{ arg: 'branchId', type: 'number' }, ...ENTITIES.branch.fields], ['branchId']),
  },
  {
    name: 'context_create_implementation',
    description: 'Create an implementation.',
    inputSchema: buildSchema([...ENTITIES.implementation.fields, { arg: 'repos', type: 'array' }], ['featureId', 'name', 'type', 'status']),
  },
  {
    name: 'context_update_implementation',
    description: 'Update an implementation.',
    inputSchema: buildSchema([{ arg: 'implementationId', type: 'number' }, ...ENTITIES.implementation.fields], ['implementationId']),
  },
  {
    name: 'context_add_implementation_repo',
    description: 'Attach a repo to an implementation.',
    inputSchema: buildSchema(ENTITIES.implementationRepo.fields, ['implementationId', 'repoId']),
  },
  {
    name: 'context_update_implementation_repo',
    description: 'Update an implementation repo link.',
    inputSchema: buildSchema([{ arg: 'implementationRepoId', type: 'number' }, ...ENTITIES.implementationRepo.fields], ['implementationRepoId']),
  },
  {
    name: 'context_upsert_issue',
    description: 'Create or update an issue by issue key.',
    inputSchema: buildSchema(ENTITIES.issue.fields, ['issueKey', 'source', 'status', 'title']),
  },
  {
    name: 'context_add_note',
    description: 'Add a note to an entity.',
    inputSchema: buildSchema(ENTITIES.note.fields, ENTITIES.note.fields.map((field) => field.arg)),
  },
  {
    name: 'context_update_note',
    description: 'Update a note.',
    inputSchema: buildSchema([{ arg: 'noteId', type: 'number' }, ...ENTITIES.note.fields], ['noteId']),
  },
  {
    name: 'context_create_person',
    description: 'Create a person.',
    inputSchema: buildSchema(ENTITIES.person.fields, ['externalId', 'displayName']),
  },
  {
    name: 'context_update_person',
    description: 'Update a person.',
    inputSchema: buildSchema([{ arg: 'personId', type: 'number' }, ...ENTITIES.person.fields], ['personId']),
  },
  {
    name: 'context_create_tool',
    description: 'Create a tool.',
    inputSchema: buildSchema(ENTITIES.tool.fields, ['name']),
  },
  {
    name: 'context_update_tool',
    description: 'Update a tool.',
    inputSchema: buildSchema([{ arg: 'toolId', type: 'number' }, ...ENTITIES.tool.fields], ['toolId']),
  },
  {
    name: 'context_list_notes',
    description: 'List notes for an entity.',
    inputSchema: buildSchema([
      { arg: 'entityType', type: 'string' },
      { arg: 'entityId', type: 'number' },
    ], ['entityType', 'entityId']),
  },
  {
    name: 'context_list_repos',
    description: 'List repos. Optionally filter by organizationId.',
    inputSchema: buildSchema([{ arg: 'organizationId', type: 'number' }]),
  },
  {
    name: 'context_list_branches',
    description: 'List branches. Optionally filter by repoId.',
    inputSchema: buildSchema([{ arg: 'repoId', type: 'number' }]),
  },
  {
    name: 'context_list_implementation_repos',
    description: 'List implementation repo links. Optionally filter by implementationId.',
    inputSchema: buildSchema([{ arg: 'implementationId', type: 'number' }]),
  },
  {
    name: 'context_evaluate_readiness',
    description: 'Evaluate whether required implementation fields are filled.',
    inputSchema: buildSchema([{ arg: 'implementationId', type: 'number' }], ['implementationId']),
  },
  {
    name: 'context_match_issue',
    description: 'Return ranked implementation candidates for a stored issue key.',
    inputSchema: buildSchema([{ arg: 'issueKey', type: 'string' }], ['issueKey']),
  },
];

async function callTool(name, args) {
  const { store, service } = ctx;

  switch (name) {
    case 'context_list_organizations':
      return listEntity(store, ENTITIES.organization);
    case 'context_get_organization':
      return getEntityById(store, ENTITIES.organization, args.organizationId);
    case 'context_add_organization':
    case 'context_create_organization':
      return insertEntity(store, ENTITIES.organization, args);
    case 'context_edit_organization':
    case 'context_update_organization':
      return updateEntity(store, ENTITIES.organization, args.organizationId, args);

    case 'context_list_projects':
      return listEntity(store, ENTITIES.project);
    case 'context_get_project':
      return getEntityById(store, ENTITIES.project, args.projectId);
    case 'context_add_project':
    case 'context_create_project':
      return insertEntity(store, ENTITIES.project, args);
    case 'context_edit_project':
    case 'context_update_project':
      return updateEntity(store, ENTITIES.project, args.projectId, args);

    case 'context_list_features':
      return listEntity(store, ENTITIES.feature);
    case 'context_get_feature':
      return getEntityById(store, ENTITIES.feature, args.featureId);
    case 'context_add_feature':
    case 'context_create_feature':
      return insertEntity(store, ENTITIES.feature, args);
    case 'context_edit_feature':
    case 'context_update_feature':
      return updateEntity(store, ENTITIES.feature, args.featureId, args);

    case 'context_list_repos':
      return args.organizationId
        ? listEntity(store, ENTITIES.repo, ' WHERE organization_id = ?', [args.organizationId])
        : listEntity(store, ENTITIES.repo);
    case 'context_get_repo':
      return getEntityById(store, ENTITIES.repo, args.repoId);
    case 'context_add_repo':
    case 'context_create_repo':
      return insertEntity(store, ENTITIES.repo, args);
    case 'context_upsert_repo':
      return store.upsertRepo(args);
    case 'context_edit_repo':
    case 'context_update_repo':
      return updateEntity(store, ENTITIES.repo, args.repoId, args);

    case 'context_list_branches':
      return args.repoId
        ? listEntity(store, ENTITIES.branch, ' WHERE repo_id = ?', [args.repoId])
        : listEntity(store, ENTITIES.branch);
    case 'context_get_branch':
      return getEntityById(store, ENTITIES.branch, args.branchId);
    case 'context_add_branch':
    case 'context_create_branch':
      return insertEntity(store, ENTITIES.branch, args);
    case 'context_upsert_branch':
      return store.upsertBranch(args);
    case 'context_edit_branch':
    case 'context_update_branch':
      return updateEntity(store, ENTITIES.branch, args.branchId, args);

    case 'context_list_implementations':
      return store.listImplementations();
    case 'context_get_implementation':
      return store.getImplementation(args.implementationId);
    case 'context_add_implementation':
    case 'context_create_implementation':
      return store.createImplementation({
        ...args,
        codePointers: args.codePointers ?? [],
        repos: args.repos ?? [],
      });
    case 'context_edit_implementation':
    case 'context_update_implementation':
      return store.updateImplementation(args.implementationId, args);

    case 'context_list_implementation_repos':
      return args.implementationId
        ? listEntity(store, ENTITIES.implementationRepo, ' WHERE implementation_id = ?', [args.implementationId])
        : listEntity(store, ENTITIES.implementationRepo);
    case 'context_get_implementation_repo':
      return getEntityById(store, ENTITIES.implementationRepo, args.implementationRepoId);
    case 'context_add_implementation_repo':
      return insertEntity(store, ENTITIES.implementationRepo, args);
    case 'context_edit_implementation_repo':
    case 'context_update_implementation_repo':
      return updateEntity(store, ENTITIES.implementationRepo, args.implementationRepoId, args);

    case 'context_list_issues':
      return store.listIssues();
    case 'context_get_issue':
      return store.getIssueByKey(args.issueKey);
    case 'context_add_issue':
      return insertEntity(store, ENTITIES.issue, args);
    case 'context_upsert_issue':
      return store.upsertIssue({
        key: args.issueKey,
        source: args.source,
        status: args.status,
        title: args.title,
        body: args.body ?? null,
        projectKey: args.projectKey ?? null,
        components: args.components ?? [],
        labels: args.labels ?? [],
        repoNames: args.repoNames ?? [],
        implementationId: args.implementationId ?? null,
        snapshot: args.snapshot ?? {},
      });
    case 'context_edit_issue':
      return updateEntity(store, ENTITIES.issue, args.issueId, args);

    case 'context_list_notes':
      return store.listNotes(args.entityType, args.entityId);
    case 'context_get_note':
      return getEntityById(store, ENTITIES.note, args.noteId);
    case 'context_add_note':
      return store.addNote(args);
    case 'context_edit_note':
    case 'context_update_note':
      return updateEntity(store, ENTITIES.note, args.noteId, args);

    case 'context_list_people':
      return listEntity(store, ENTITIES.person);
    case 'context_get_person':
      return getEntityById(store, ENTITIES.person, args.personId);
    case 'context_add_person':
    case 'context_create_person':
      return insertEntity(store, ENTITIES.person, args);
    case 'context_edit_person':
    case 'context_update_person':
      return updateEntity(store, ENTITIES.person, args.personId, args);

    case 'context_list_tools':
      return listEntity(store, ENTITIES.tool);
    case 'context_get_tool':
      return getEntityById(store, ENTITIES.tool, args.toolId);
    case 'context_add_tool':
    case 'context_create_tool':
      return insertEntity(store, ENTITIES.tool, args);
    case 'context_edit_tool':
    case 'context_update_tool':
      return updateEntity(store, ENTITIES.tool, args.toolId, args);

    case 'context_evaluate_readiness':
      return service.evaluateImplementationReadiness(args.implementationId);
    case 'context_match_issue':
      return service.suggestImplementations(args.issueKey);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (message.id === undefined) return;
  try {
    let result;
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-army-context', version: '0.1.0' },
        };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call': {
        const value = await callTool(message.params.name, message.params.arguments ?? {});
        result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        break;
      }
      default:
        throw new Error(`method not found: ${message.method}`);
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: error.message },
    });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    handle(JSON.parse(line));
  } catch (error) {
    send({
      jsonrpc: '2.0',
      error: { code: -32700, message: error.message },
    });
  }
});
