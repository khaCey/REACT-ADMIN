function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseDisplayName(name) {
  const full = normalizeSpace(name);
  if (!full) {
    return { full: '', given: '', last: '' };
  }
  const parts = full.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return { full, given: full, last: '' };
  }
  return {
    full,
    given: parts.slice(0, -1).join(' '),
    last: parts[parts.length - 1],
  };
}

function joinHumanNames(items) {
  const names = (items || []).map(normalizeSpace).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function formatOrderedStudentNames(students) {
  const parsed = (students || [])
    .map((student) =>
      parseDisplayName(
        typeof student === 'string'
          ? student
          : student?.name || student?.student_name || student?.studentName || ''
      )
    )
    .filter((entry) => entry.full);

  if (parsed.length === 0) return '';

  const sharedLastName =
    parsed.length > 1 &&
    parsed.every(
      (entry) => entry.last && entry.last.toLowerCase() === String(parsed[0]?.last || '').toLowerCase()
    );

  const displayNames = parsed.map((entry, index) => {
    if (!sharedLastName) return entry.full;
    if (index === parsed.length - 1) return entry.full;
    return entry.given || entry.full;
  });

  return joinHumanNames(displayNames);
}

export function buildLessonTitleForOrderedStudents({
  students,
  lessonKind,
  locationLabel,
  lessonNumber,
  totalLessons,
}) {
  const names = formatOrderedStudentNames(students);
  const kind = String(lessonKind || '').trim().toLowerCase();
  if (kind === 'demo') {
    return names ? `${names} D/L` : 'D/L';
  }
  const location = normalizeSpace(locationLabel) || 'Cafe';
  const number = Number.isFinite(Number(lessonNumber)) ? Number(lessonNumber) : 1;
  const total = Number.isFinite(Number(totalLessons)) ? Number(totalLessons) : 1;
  return `${names} (${location}) ${number}/${total}`.trim();
}

export function rewriteLessonTitleStudentNames(existingCoreTitle, students) {
  const core = normalizeSpace(existingCoreTitle);
  const names = formatOrderedStudentNames(students);
  if (!core) return names;
  if (!names) return core;

  if (/D\/L$/i.test(core)) {
    return `${names} D/L`;
  }

  const numbered = core.match(/\(([^)]+)\)\s+(\d+)\s*\/\s*(\d+)\s*$/);
  if (numbered) {
    return `${names} (${normalizeSpace(numbered[1]) || 'Cafe'}) ${numbered[2]}/${numbered[3]}`;
  }

  return names;
}
