export const SCHEMA_VERSION = 1;

const TABLES = [
  `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS implementations (
      id INTEGER PRIMARY KEY,
      feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      target TEXT,
      run_instructions TEXT,
      test_instructions TEXT,
      invocation_example TEXT,
      expected_result TEXT,
      verification_check TEXT,
      code_pointers_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS implementation_repos (
      id INTEGER PRIMARY KEY,
      implementation_id INTEGER NOT NULL REFERENCES implementations(id) ON DELETE CASCADE,
      repo_name TEXT NOT NULL,
      repo_path TEXT,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY,
      issue_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      project_key TEXT,
      components_json TEXT NOT NULL DEFAULT '[]',
      labels_json TEXT NOT NULL DEFAULT '[]',
      repo_names_json TEXT NOT NULL DEFAULT '[]',
      implementation_id INTEGER,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT NOT NULL,
      trust_level TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
];

export function bootstrapContextSchema(db, { now }) {
  db.exec('PRAGMA foreign_keys = ON');

  for (const statement of TABLES) {
    db.exec(statement);
  }

  db.prepare(
    `
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
      ON CONFLICT(version) DO NOTHING
    `,
  ).run(SCHEMA_VERSION, now.toISOString());
}
