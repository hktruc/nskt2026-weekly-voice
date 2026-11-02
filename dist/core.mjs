const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function localParts(instant) {
  const shifted = new Date(new Date(instant).getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(),
    day: shifted.getUTCDay(), hour: shifted.getUTCHours()
  };
}

function vnLocalToUtc(year, month, date, hour, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month, date, hour, minute, second) - VN_OFFSET_MS);
}

export function weekWindowFor(instant) {
  const p = localParts(instant);
  let daysSinceSaturday = (p.day - 6 + 7) % 7;
  if (p.day === 6 && p.hour < 1) daysSinceSaturday = 7;
  const localMidnightUtc = vnLocalToUtc(p.year, p.month, p.date, 0);
  const startDate = new Date(localMidnightUtc.getTime() - daysSinceSaturday * DAY_MS);
  const startLocal = localParts(startDate);
  const start = vnLocalToUtc(startLocal.year, startLocal.month, startLocal.date, 1);
  const end = new Date(start.getTime() + 5 * DAY_MS + 22 * 60 * 60 * 1000); // Thu 23:00 VN
  return { start, end };
}

export function classifyByWeek(records, reference) {
  const { start, end } = weekWindowFor(reference);
  const seen = new Set();
  const included = [];
  const excludedGap = [];
  const duplicates = [];
  const invalid = [];
  for (const record of records) {
    const key = record.sourceAnswerKey || `${record.submissionId}:${record.questionId || 'q'}:${record.questionIndex ?? 0}`;
    if (seen.has(key)) { duplicates.push(record); continue; }
    seen.add(key);
    const time = new Date(record.submittedAt);
    if (Number.isNaN(time.getTime())) { invalid.push(record); continue; }
    (time >= start && time <= end ? included : excludedGap).push(record);
  }
  return { start, end, included, excludedGap, duplicates, invalid };
}

export function escapeForText(value) { return String(value ?? ""); }

export function deriveAnswerKeys(answers, submissionId) {
  const counts = new Map();
  return answers.map((answer, questionIndex) => {
    const questionPart = String(answer.questionId || answer.question || 'q').trim().toLowerCase().replace(/[^a-z0-9\p{L}]+/gu,'-').slice(0,48) || 'q';
    const base = `${submissionId}:${questionPart}:${questionIndex}`;
    const version = (counts.get(base) || 0) + 1; counts.set(base, version);
    return { ...answer, questionIndex, sourceAnswerKey:`${base}:v${version}` };
  });
}

export function toPublicProjection(record, { includeIdentity = false } = {}) {
  const clean = {
    submissionId: record.submissionId,
    sourceAnswerKey: record.sourceAnswerKey,
    submittedAt: record.submittedAt,
    questionText: escapeForText(record.questionText),
    answerText: escapeForText(record.answerText),
    group: escapeForText(record.author?.group)
  };
  if (includeIdentity) clean.displayName = escapeForText(record.author?.displayName);
  return clean;
}

