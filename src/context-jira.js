import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeStatus(statusName) {
  return statusName ? 'new' : 'new';
}

export function createContextJira({ run, command = 'jira' } = {}) {
  const execute =
    run ??
    (async (bin, args) => {
      const result = await execFileAsync(bin, args, { encoding: 'utf8' });
      return result.stdout;
    });

  async function fetchIssue(key) {
    const raw = await execute(command, ['issue', 'view', key, '--json']);
    const parsed = JSON.parse(raw);

    return {
      key: parsed.key,
      source: 'jira',
      title: parsed.fields?.summary ?? '',
      body: parsed.fields?.description ?? '',
      labels: parsed.fields?.labels ?? [],
      components: (parsed.fields?.components ?? []).map((component) => component.name),
      projectKey: parsed.fields?.project?.key ?? '',
      status: normalizeStatus(parsed.fields?.status?.name),
      snapshot: parsed,
    };
  }

  return {
    fetchIssue,
  };
}
