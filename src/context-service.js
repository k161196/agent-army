const IMPLEMENTATION_FIELDS = [
  ['repos', (implementation) => Array.isArray(implementation.repos) && implementation.repos.length > 0],
  ['target', (implementation) => Boolean(implementation.target)],
  ['runInstructions', (implementation) => Boolean(implementation.runInstructions)],
  ['testInstructions', (implementation) => Boolean(implementation.testInstructions)],
  ['invocationExample', (implementation) => Boolean(implementation.invocationExample)],
  ['expectedResult', (implementation) => Boolean(implementation.expectedResult)],
  ['verificationCheck', (implementation) => Boolean(implementation.verificationCheck)],
];

const ISSUE_REPRODUCTION_FIELDS = [
  ['environment', (reproduction) => Boolean(reproduction.environment)],
  ['command', (reproduction) => Boolean(reproduction.command)],
  ['payload', (reproduction) => Boolean(reproduction.payload)],
  ['observedOutput', (reproduction) => Boolean(reproduction.observedOutput)],
  ['expectedOutput', (reproduction) => Boolean(reproduction.expectedOutput)],
  ['verificationMethod', (reproduction) => Boolean(reproduction.verificationMethod)],
];

function missingFieldsFromChecks(value, checks) {
  return checks.filter(([, predicate]) => !predicate(value)).map(([name]) => name);
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function defaultMatcher({ issue, candidates }) {
  return candidates.map((candidate) => ({ ...candidate, score: 0, reasons: [] }));
}

export function createContextService({ store, matcher = null, jira = null, now = () => new Date() }) {
  const rankCandidates = matcher?.rankImplementationCandidates ?? defaultMatcher;

  function evaluateImplementationReadiness(implementationId) {
    const implementation = store.getImplementation(implementationId);
    if (!implementation) {
      throw new Error(`unknown implementation: ${implementationId}`);
    }

    const missingFields = missingFieldsFromChecks(implementation, IMPLEMENTATION_FIELDS);

    return {
      implementation,
      status: missingFields.length > 0 || implementation.status !== 'ready' ? 'incomplete' : 'ready',
      missingFields: [...new Set(missingFields)],
      evaluatedAt: now().toISOString(),
    };
  }

  function evaluateIssueReadiness(issueKey, implementationId) {
    const issue = store.getIssueByKey(issueKey);
    if (!issue) {
      throw new Error(`unknown issue: ${issueKey}`);
    }

    const implementationReadiness = evaluateImplementationReadiness(implementationId);
    const reproduction = issue.snapshot?.reproduction ?? issue.snapshot?.fields?.reproduction ?? {};
    const missingChecklistItems = missingFieldsFromChecks(reproduction, ISSUE_REPRODUCTION_FIELDS);
    const status =
      implementationReadiness.status === 'ready' && missingChecklistItems.length === 0
        ? 'ready_for_debug'
        : 'needs_reproduction';

    const updatedIssue = store.upsertIssue({
      ...issue,
      status,
      implementationId,
    });

    return {
      issue: updatedIssue,
      implementationReadiness,
      reproduction,
      missingChecklistItems,
      status,
      evaluatedAt: now().toISOString(),
    };
  }

  function buildImplementationCandidate(implementation) {
    const feature = store.getFeature(implementation.featureId);
    const project = feature ? store.getProject(feature.projectId) : null;

    return {
      implementation,
      feature,
      project,
      notes: store.listNotes('implementation', implementation.id),
    };
  }

  function suggestImplementations(issueKey) {
    const issue = store.getIssueByKey(issueKey);
    if (!issue) {
      throw new Error(`unknown issue: ${issueKey}`);
    }

    const candidates = rankCandidates({
      issue,
      candidates: store.listImplementations().map(buildImplementationCandidate),
    });
    const top = candidates[0] ?? null;
    const next = candidates[1] ?? null;
    const warnings = [];

    if (top) {
      const ageDays = daysBetween(new Date(top.implementation.updatedAt), now());
      if (ageDays > 30) {
        warnings.push('implementation-stale');
      }
    }

    const lowConfidence = Boolean(
      !top ||
        top.score < 30 ||
        (next && top.score - next.score < 10),
    );

    if (lowConfidence) {
      warnings.push('low-confidence-match');
    }

    return {
      issue,
      candidates,
      selectedImplementationId: !lowConfidence && top ? top.implementation.id : null,
      requiresConfirmation: lowConfidence,
      warnings,
      evaluatedAt: now().toISOString(),
    };
  }

  async function intakeJiraIssue(issueKey) {
    if (!jira?.fetchIssue) {
      throw new Error('jira client is not configured');
    }

    const issue = store.upsertIssue(await jira.fetchIssue(issueKey));
    const match = suggestImplementations(issue.key);
    let readiness = null;

    if (match.selectedImplementationId) {
      readiness = evaluateIssueReadiness(issue.key, match.selectedImplementationId);
    } else {
      store.upsertIssue({
        ...issue,
        status: 'matched',
      });
    }

    return {
      issue: store.getIssueByKey(issue.key),
      match,
      readiness,
    };
  }

  return {
    store,
    matcher,
    jira,
    evaluateImplementationReadiness,
    evaluateIssueReadiness,
    suggestImplementations,
    intakeJiraIssue,
  };
}
