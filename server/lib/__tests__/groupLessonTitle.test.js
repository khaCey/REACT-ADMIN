import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLessonTitleForOrderedStudents,
  rewriteLessonTitleStudentNames,
  applyKidsTitlePrefix,
} from '../groupLessonTitle.js';

test('kids titles get 子 prefix', () => {
  const kids = [{ name: 'Ada Lovelace', is_child: true }];
  assert.equal(
    buildLessonTitleForOrderedStudents({
      students: kids,
      lessonKind: 'regular',
      locationLabel: 'Cafe',
      lessonNumber: 1,
      totalLessons: 4,
    }),
    '子 Ada Lovelace (Cafe) 1/4'
  );
  assert.equal(
    buildLessonTitleForOrderedStudents({
      students: kids,
      lessonKind: 'demo',
    }),
    '子 Ada Lovelace D/L'
  );
});

test('adult titles have no 子 prefix', () => {
  const adults = [{ name: 'Ada Lovelace', is_child: false }];
  assert.equal(
    buildLessonTitleForOrderedStudents({
      students: adults,
      lessonKind: 'regular',
      locationLabel: 'Cafe',
      lessonNumber: 2,
      totalLessons: 4,
    }),
    'Ada Lovelace (Cafe) 2/4'
  );
});

test('rewrite preserves kids prefix', () => {
  const kids = [{ name: 'Bob Smith', is_child: true }];
  assert.equal(
    rewriteLessonTitleStudentNames('子 Ada (Cafe) 1/4', kids),
    '子 Bob Smith (Cafe) 1/4'
  );
  assert.equal(applyKidsTitlePrefix('Bob Smith (Cafe)', kids), '子 Bob Smith (Cafe)');
  assert.equal(applyKidsTitlePrefix('子 Bob Smith (Cafe)', kids), '子 Bob Smith (Cafe)');
});
