import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { bootstrapContextSchema } from './context-schema.js';

function clone(value) {
  return structuredClone(value);
}

function parseJson(value, fallback) {
  return value ? JSON.parse(value) : fallback;
}

function nowIso(now) {
  return now().toISOString();
}

function mapImplementation(row, repos) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    featureId: row.feature_id,
    name: row.name,
    type: row.type,
    status: row.status,
    target: row.target,
    runInstructions: row.run_instructions,
    testInstructions: row.test_instructions,
    invocationExample: row.invocation_example,
    expectedResult: row.expected_result,
    verificationCheck: row.verification_check,
    codePointers: parseJson(row.code_pointers_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repos,
  };
}

function mapIssue(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    key: row.issue_key,
    source: row.source,
    status: row.status,
    title: row.title,
    body: row.body,
    projectKey: row.project_key,
    components: parseJson(row.components_json, []),
    labels: parseJson(row.labels_json, []),
    repoNames: parseJson(row.repo_names_json, []),
    implementationId: row.implementation_id,
    snapshot: parseJson(row.snapshot_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRepo(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBranch(row) {
  if (!row) return null;
  return {
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNote(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    authorType: row.author_type,
    authorId: row.author_id,
    trustLevel: row.trust_level,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function createContextStore({ dbPath, now = () => new Date() }) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  const timestamps = () => nowIso(now);

  function init() {
    bootstrapContextSchema(db, { now: now() });
  }

  function listTableNames() {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
  }

  function createOrganization({ name }) {
    const timestamp = timestamps();
    const result = db
      .prepare('INSERT INTO organizations (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run(name, timestamp, timestamp);
    return getOrganization(Number(result.lastInsertRowid));
  }

  function getOrganization(id) {
    const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
    return row
      ? {
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  function listOrganizations() {
    return db.prepare('SELECT * FROM organizations ORDER BY id').all().map((row) => getOrganization(row.id));
  }

  function createProject({ organizationId, key, name }) {
    const timestamp = timestamps();
    const result = db
      .prepare(
        'INSERT INTO projects (organization_id, key, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(organizationId, key, name, timestamp, timestamp);
    return getProject(Number(result.lastInsertRowid));
  }

  function getProject(id) {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row
      ? {
          id: row.id,
          organizationId: row.organization_id,
          key: row.key,
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  function listProjects() {
    return db.prepare('SELECT * FROM projects ORDER BY id').all().map((row) => getProject(row.id));
  }

  function createFeature({ projectId, name, description = null }) {
    const timestamp = timestamps();
    const result = db
      .prepare(
        'INSERT INTO features (project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(projectId, name, description, timestamp, timestamp);
    return getFeature(Number(result.lastInsertRowid));
  }

  function getFeature(id) {
    const row = db.prepare('SELECT * FROM features WHERE id = ?').get(id);
    return row
      ? {
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  function listFeatures() {
    return db.prepare('SELECT * FROM features ORDER BY id').all().map((row) => getFeature(row.id));
  }

  function createRepo({ organizationId, name, url = null }) {
    const timestamp = timestamps();
    const result = db
      .prepare(
        'INSERT INTO repos (organization_id, name, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(organizationId, name, url, timestamp, timestamp);
    return getRepo(Number(result.lastInsertRowid));
  }

  function getRepo(id) {
    return mapRepo(db.prepare('SELECT * FROM repos WHERE id = ?').get(id));
  }

  function listRepos() {
    return db.prepare('SELECT * FROM repos ORDER BY id').all().map(mapRepo);
  }

  function upsertRepo({ organizationId, name, url = null }) {
    const existing = db.prepare('SELECT * FROM repos WHERE organization_id = ? AND name = ?').get(organizationId, name);
    if (existing) return mapRepo(existing);
    return createRepo({ organizationId, name, url });
  }

  function createBranch({ repoId, name }) {
    const timestamp = timestamps();
    const result = db
      .prepare(
        'INSERT INTO branches (repo_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(repoId, name, timestamp, timestamp);
    return getBranch(Number(result.lastInsertRowid));
  }

  function getBranch(id) {
    return mapBranch(db.prepare('SELECT * FROM branches WHERE id = ?').get(id));
  }

  function listBranches(repoId) {
    const rows = repoId
      ? db.prepare('SELECT * FROM branches WHERE repo_id = ? ORDER BY id').all(repoId)
      : db.prepare('SELECT * FROM branches ORDER BY id').all();
    return rows.map(mapBranch);
  }

  function upsertBranch({ repoId, name }) {
    const existing = db.prepare('SELECT * FROM branches WHERE repo_id = ? AND name = ?').get(repoId, name);
    if (existing) return mapBranch(existing);
    return createBranch({ repoId, name });
  }

  function listImplementationRepos(implementationId) {
    return db
      .prepare(
        `SELECT r.*, ir.branch_id AS ir_branch_id FROM repos r
         JOIN implementation_repos ir ON ir.repo_id = r.id
         WHERE ir.implementation_id = ?
         ORDER BY ir.id`,
      )
      .all(implementationId)
      .map((row) => ({ ...mapRepo(row), branchId: row.ir_branch_id ?? null }));
  }

  function createImplementation({
    featureId,
    name,
    type,
    status,
    target = null,
    runInstructions = null,
    testInstructions = null,
    invocationExample = null,
    expectedResult = null,
    verificationCheck = null,
    codePointers = [],
    repos = [],
  }) {
    const timestamp = timestamps();
    const result = db
      .prepare(
        `
          INSERT INTO implementations (
            feature_id,
            name,
            type,
            status,
            target,
            run_instructions,
            test_instructions,
            invocation_example,
            expected_result,
            verification_check,
            code_pointers_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        featureId,
        name,
        type,
        status,
        target,
        runInstructions,
        testInstructions,
        invocationExample,
        expectedResult,
        verificationCheck,
        JSON.stringify(codePointers),
        timestamp,
        timestamp,
      );
    const implementationId = Number(result.lastInsertRowid);

    for (const repo of repos) {
      db.prepare(
        'INSERT INTO implementation_repos (implementation_id, repo_id, branch_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(implementationId, repo.repoId, repo.branchId ?? null, timestamp);
    }

    return getImplementation(implementationId);
  }

  function getImplementation(id) {
    const row = db.prepare('SELECT * FROM implementations WHERE id = ?').get(id);
    return mapImplementation(row, row ? listImplementationRepos(id) : []);
  }

  function listImplementations() {
    return db.prepare('SELECT id FROM implementations ORDER BY id').all().map((row) => getImplementation(row.id));
  }

  function updateImplementation(id, fields) {
    const current = getImplementation(id);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...clone(fields),
      updatedAt: timestamps(),
    };

    db.prepare(
      `
        UPDATE implementations
        SET status = ?, target = ?, run_instructions = ?, test_instructions = ?, invocation_example = ?,
            expected_result = ?, verification_check = ?, code_pointers_json = ?, updated_at = ?
        WHERE id = ?
      `,
    ).run(
      next.status,
      next.target,
      next.runInstructions,
      next.testInstructions,
      next.invocationExample,
      next.expectedResult,
      next.verificationCheck,
      JSON.stringify(next.codePointers ?? []),
      next.updatedAt,
      id,
    );

    return getImplementation(id);
  }

  function addNote({ entityType, entityId, authorType, authorId, trustLevel, body }) {
    const createdAt = timestamps();
    const result = db
      .prepare(
        `
          INSERT INTO notes (entity_type, entity_id, author_type, author_id, trust_level, body, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(entityType, entityId, authorType, authorId, trustLevel, body, createdAt);

    return mapNote(
      db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(result.lastInsertRowid)),
    );
  }

  function listNotes(entityType, entityId) {
    return db
      .prepare('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY id')
      .all(entityType, entityId)
      .map(mapNote);
  }

  function upsertIssue({
    key,
    source,
    status,
    title,
    body = null,
    projectKey = null,
    components = [],
    labels = [],
    repoNames = [],
    implementationId = null,
    snapshot = {},
  }) {
    const existing = getIssueByKey(key);
    const createdAt = existing?.createdAt ?? timestamps();
    const updatedAt = timestamps();

    db.prepare(
      `
        INSERT INTO issues (
          issue_key,
          source,
          status,
          title,
          body,
          project_key,
          components_json,
          labels_json,
          repo_names_json,
          implementation_id,
          snapshot_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(issue_key) DO UPDATE SET
          source = excluded.source,
          status = excluded.status,
          title = excluded.title,
          body = excluded.body,
          project_key = excluded.project_key,
          components_json = excluded.components_json,
          labels_json = excluded.labels_json,
          repo_names_json = excluded.repo_names_json,
          implementation_id = excluded.implementation_id,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `,
    ).run(
      key,
      source,
      status,
      title,
      body,
      projectKey,
      JSON.stringify(components),
      JSON.stringify(labels),
      JSON.stringify(repoNames),
      implementationId,
      JSON.stringify(snapshot),
      createdAt,
      updatedAt,
    );

    return getIssueByKey(key);
  }

  function getIssueByKey(key) {
    return mapIssue(db.prepare('SELECT * FROM issues WHERE issue_key = ?').get(key));
  }

  function listIssues() {
    return db.prepare('SELECT * FROM issues ORDER BY id').all().map(mapIssue);
  }

  function query(sql, params = []) {
    const stmt = db.prepare(sql);
    return Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
  }

  function execute(sql, params = []) {
    const stmt = db.prepare(sql);
    const result = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
    return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
  }

  function schema(tables = null) {
    if (!tables) {
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()
        .map((r) => r.name);
    }
    return db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN (${tables.map(() => '?').join(',')}) ORDER BY name`,
      )
      .all(...tables);
  }

  function close() {
    db.close();
  }

  return {
    init,
    close,
    listTableNames,
    createOrganization,
    getOrganization,
    listOrganizations,
    createProject,
    getProject,
    listProjects,
    createFeature,
    getFeature,
    listFeatures,
    createRepo,
    getRepo,
    listRepos,
    upsertRepo,
    createImplementation,
    getImplementation,
    listImplementations,
    updateImplementation,
    listImplementationRepos,
    addNote,
    listNotes,
    upsertIssue,
    getIssueByKey,
    listIssues,
    createBranch,
    getBranch,
    listBranches,
    upsertBranch,
    query,
    execute,
    schema,
  };
}
