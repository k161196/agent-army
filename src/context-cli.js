import { join } from 'node:path';

import { openContextService } from './context-app.js';

function parseFlags(args) {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return flags;
}

function print(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`missing --${name}`);
  }

  return flags[name];
}

function findOrCreateOrganization(store, name) {
  return store.listOrganizations().find((organization) => organization.name === name) ?? store.createOrganization({ name });
}

function findOrCreateProject(store, { organizationId, key, name }) {
  return store.listProjects().find((project) => project.key === key) ?? store.createProject({ organizationId, key, name });
}

function getOrganizationForFeature(store, feature) {
  const project = store.getProject(feature.projectId);
  return store.getOrganization(project.organizationId);
}

function findFeature(store, flags) {
  if (flags['feature-id']) {
    return store.getFeature(Number(flags['feature-id']));
  }

  const projectKey = requireFlag(flags, 'project-key');
  const featureName = requireFlag(flags, 'feature');
  const project = store.listProjects().find((entry) => entry.key === projectKey);
  if (!project) {
    throw new Error(`unknown project: ${projectKey}`);
  }

  return store
    .listFeatures()
    .find((feature) => feature.projectId === project.id && feature.name === featureName);
}

export async function runContextCli({ cwd = process.cwd(), argv, stdout = process.stdout }) {
  const [namespace, action, ...rest] = argv;
  const flags = parseFlags(rest);
  const context = openContextService({ cwd, dbPath: join(cwd, '.agent-army', 'context.db') });

  try {
    if (namespace === 'context') {
      if (action === 'init') {
        return print(stdout, { ok: true, dbPath: context.dbPath });
      }

      if (action === 'add-feature') {
        const organization = findOrCreateOrganization(context.store, requireFlag(flags, 'organization'));
        const project = findOrCreateProject(context.store, {
          organizationId: organization.id,
          key: requireFlag(flags, 'project-key'),
          name: requireFlag(flags, 'project-name'),
        });
        const feature = context.store.createFeature({
          projectId: project.id,
          name: requireFlag(flags, 'name'),
          description: flags.description ?? null,
        });
        return print(stdout, { organization, project, feature });
      }

      if (action === 'add-repo') {
        const org = findOrCreateOrganization(context.store, requireFlag(flags, 'organization'));
        const repo = context.store.createRepo({
          organizationId: org.id,
          name: requireFlag(flags, 'name'),
          path: flags.path ?? null,
        });
        return print(stdout, repo);
      }

      if (action === 'add-implementation') {
        const feature = findFeature(context.store, flags);
        if (!feature) {
          throw new Error('unknown feature');
        }

        const org = flags.organization
          ? findOrCreateOrganization(context.store, flags.organization)
          : getOrganizationForFeature(context.store, feature);

        const repos = String(requireFlag(flags, 'repo'))
          .split(',')
          .filter(Boolean)
          .map((name) => {
            const repo = context.store.upsertRepo({
              organizationId: org.id,
              name: name.trim(),
              path: flags['repo-path'] ?? null,
            });
            return { repoId: repo.id };
          });

        const implementation = context.store.createImplementation({
          featureId: feature.id,
          name: requireFlag(flags, 'name'),
          type: requireFlag(flags, 'type'),
          status: flags.status ?? 'incomplete',
          target: requireFlag(flags, 'target'),
          runInstructions: requireFlag(flags, 'run'),
          testInstructions: requireFlag(flags, 'test'),
          invocationExample: requireFlag(flags, 'invoke'),
          expectedResult: requireFlag(flags, 'expect'),
          verificationCheck: requireFlag(flags, 'verify'),
          repos,
        });

        return print(stdout, implementation);
      }

      if (action === 'add-note') {
        const note = context.store.addNote({
          entityType: requireFlag(flags, 'entity-type'),
          entityId: Number(requireFlag(flags, 'entity-id')),
          authorType: requireFlag(flags, 'author-type'),
          authorId: requireFlag(flags, 'author-id'),
          trustLevel: requireFlag(flags, 'trust-level'),
          body: requireFlag(flags, 'body'),
        });

        return print(stdout, note);
      }

      if (action === 'show') {
        const entityType = rest[0];
        const identifier = rest[1];

        if (entityType === 'implementation') {
          return print(stdout, context.store.getImplementation(Number(identifier)));
        }

        if (entityType === 'issue') {
          return print(stdout, context.store.getIssueByKey(identifier));
        }

        if (entityType === 'feature') {
          return print(stdout, context.store.getFeature(Number(identifier)));
        }
      }
    }

    if (namespace === 'issue') {
      const issueKey = rest[0];

      if (action === 'fetch') {
        const issue = context.store.upsertIssue(await context.service.jira.fetchIssue(issueKey));
        return print(stdout, issue);
      }

      if (action === 'match') {
        let issue = context.store.getIssueByKey(issueKey);
        if (!issue) {
          issue = context.store.upsertIssue(await context.service.jira.fetchIssue(issueKey));
        }

        return print(stdout, context.service.suggestImplementations(issue.key));
      }

      if (action === 'ready') {
        const implementationId = Number(flags['implementation-id'] ?? context.store.getIssueByKey(issueKey)?.implementationId);
        if (!implementationId) {
          throw new Error('missing implementation id');
        }

        return print(stdout, context.service.evaluateIssueReadiness(issueKey, implementationId));
      }
    }

    throw new Error(`unknown command: ${argv.join(' ')}`);
  } finally {
    context.close();
  }
}
