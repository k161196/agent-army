function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
}

function keywords(text) {
  return normalize(text)
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function hasWholePhrase(haystack, needle) {
  if (!needle) {
    return false;
  }

  return haystack.includes(normalize(needle));
}

export function rankImplementationCandidates({ issue, candidates }) {
  const issueText = normalize([
    issue.title,
    issue.body,
    issue.projectKey,
    ...(issue.labels ?? []),
    ...(issue.components ?? []),
    ...(issue.repoNames ?? []),
  ].join(' '));

  return candidates
    .map((candidate) => {
      let score = 0;
      const reasons = [];

      if (hasWholePhrase(issueText, candidate.feature?.name)) {
        score += 40;
        reasons.push(`feature match: ${candidate.feature.name}`);
      }

      if (hasWholePhrase(issueText, candidate.implementation?.name)) {
        score += 25;
        reasons.push(`implementation match: ${candidate.implementation.name}`);
      }

      if (hasWholePhrase(issueText, candidate.implementation?.target)) {
        score += 35;
        reasons.push(`target match: ${candidate.implementation.target}`);
      }

      if ((candidate.project?.key ?? '').toLowerCase() === String(issue.projectKey ?? '').toLowerCase()) {
        score += 10;
        reasons.push(`project match: ${candidate.project.key}`);
      }

      for (const note of candidate.notes ?? []) {
        const noteKeywords = keywords(note.body);
        const overlap = noteKeywords.filter((word) => issueText.includes(word));
        if (hasWholePhrase(issueText, note.body) || overlap.length > 0) {
          score += note.trustLevel === 'verified' ? 20 : 8;
          reasons.push(`${note.trustLevel} note match`);
        }
      }

      if (reasons.length === 0 && (candidate.project?.key ?? '').toLowerCase() === String(issue.projectKey ?? '').toLowerCase()) {
        reasons.push(`project fallback: ${candidate.project.key}`);
      }

      return {
        ...candidate,
        score,
        reasons,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.implementation.id - right.implementation.id;
    });
}
