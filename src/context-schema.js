export const SCHEMA_VERSION = 5;

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
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, name)
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
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
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
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(repo_id, name)
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

function migrateV1ToV2(db, now) {
  const cols = db.prepare('PRAGMA table_info(implementation_repos)').all();
  const hasOldSchema = cols.some((col) => col.name === 'repo_name');
  if (!hasOldSchema) return;

  const ts = now.toISOString();
  const oldRows = db.prepare('SELECT * FROM implementation_repos').all();

  if (oldRows.length > 0) {
    const orgResult = db
      .prepare('INSERT INTO organizations (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run('(migrated)', ts, ts);
    const orgId = Number(orgResult.lastInsertRowid);

    const repoMap = new Map();
    for (const row of oldRows) {
      if (!repoMap.has(row.repo_name)) {
        const repoResult = db
          .prepare(
            'INSERT INTO repos (organization_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(orgId, row.repo_name, row.repo_path ?? null, ts, ts);
        repoMap.set(row.repo_name, Number(repoResult.lastInsertRowid));
      }
    }

    db.exec(`
      CREATE TABLE implementation_repos_new (
        id INTEGER PRIMARY KEY,
        implementation_id INTEGER NOT NULL REFERENCES implementations(id) ON DELETE CASCADE,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      )
    `);
    for (const row of oldRows) {
      db.prepare(
        'INSERT INTO implementation_repos_new (id, implementation_id, repo_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(row.id, row.implementation_id, repoMap.get(row.repo_name), row.created_at);
    }
  } else {
    db.exec(`
      CREATE TABLE implementation_repos_new (
        id INTEGER PRIMARY KEY,
        implementation_id INTEGER NOT NULL REFERENCES implementations(id) ON DELETE CASCADE,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      )
    `);
  }

  db.exec('DROP TABLE implementation_repos');
  db.exec('ALTER TABLE implementation_repos_new RENAME TO implementation_repos');

  db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING',
  ).run(2, ts);
}

function migrateV2ToV3(db, now) {
  const ts = now.toISOString();
  const cols = db.prepare('PRAGMA table_info(repos)').all().map((c) => c.name);

  if (!cols.includes('url')) {
    db.exec('ALTER TABLE repos ADD COLUMN url TEXT');
    db.exec('UPDATE repos SET url = path WHERE path IS NOT NULL');
  }

  if (cols.includes('path')) {
    db.exec('ALTER TABLE repos DROP COLUMN path');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(repo_id, name)
    )
  `);

  db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING',
  ).run(3, ts);
}

function migrateV3ToV4(db, now) {
  const ts = now.toISOString();
  // V4 mistakenly added branch_id to implementations — corrected in V5
  const cols = db.prepare('PRAGMA table_info(implementations)').all().map((c) => c.name);
  if (!cols.includes('branch_id')) {
    db.exec('ALTER TABLE implementations ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL');
  }
  db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING',
  ).run(4, ts);
}

function migrateV4ToV5(db, now) {
  const ts = now.toISOString();

  const implCols = db.prepare('PRAGMA table_info(implementations)').all().map((c) => c.name);
  if (implCols.includes('branch_id')) {
    db.exec('ALTER TABLE implementations DROP COLUMN branch_id');
  }

  const irCols = db.prepare('PRAGMA table_info(implementation_repos)').all().map((c) => c.name);
  if (!irCols.includes('branch_id')) {
    db.exec('ALTER TABLE implementation_repos ADD COLUMN branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL');
  }

  db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING',
  ).run(5, ts);
}

export function bootstrapContextSchema(db, { now }) {
  db.exec('PRAGMA foreign_keys = ON');

  for (const statement of TABLES) {
    db.exec(statement);
  }

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );

  if (appliedVersions.has(1) && !appliedVersions.has(2)) {
    migrateV1ToV2(db, now);
  }

  const afterMigrations = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );
  if (afterMigrations.has(2) && !afterMigrations.has(3)) {
    migrateV2ToV3(db, now);
  }

  const afterV3 = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );
  if (afterV3.has(3) && !afterV3.has(4)) {
    migrateV3ToV4(db, now);
  }

  const afterV4 = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );
  if (afterV4.has(4) && !afterV4.has(5)) {
    migrateV4ToV5(db, now);
  }

  db.prepare(
    `
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
      ON CONFLICT(version) DO NOTHING
    `,
  ).run(SCHEMA_VERSION, now.toISOString());
}
