function parseSemesterRecords(value) {
  if (!value) return [];
  if (Array.isArray(value)) return cleanSemesterRecords(value);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? cleanSemesterRecords(parsed) : [];
  } catch (error) {
    return [];
  }
}

function cleanSubjects(subjects) {
  if (!Array.isArray(subjects)) return [];
  return subjects
    .filter(subject => subject && typeof subject.name === "string")
    .map(subject => ({ ...subject, name: subject.name.trim() }))
    .filter(subject => subject.name && subject.name.toLowerCase() !== "vacant");
}

function cleanSemesterRecords(records) {
  return records.map(record => ({
    ...record,
    subjects: cleanSubjects(record?.subjects)
  }));
}

function serializeSemesterRecords(records) {
  return JSON.stringify(records || []);
}

function calculateGwa(subjects) {
  const numericGrades = (subjects || [])
    .map(subject => subject?.grade)
    .filter(grade => grade !== null && grade !== undefined && String(grade).trim() !== "")
    .map(grade => Number(grade))
    .filter(Number.isFinite);
  if (!numericGrades.length) return null;
  const average = numericGrades.reduce((total, grade) => total + grade, 0) / numericGrades.length;
  return Math.round(average * 100) / 100;
}

function appendSemesterRecord(existingRecords, semester, subjects, gwa = null) {
  const records = parseSemesterRecords(existingRecords);
  const preparedSubjects = cleanSubjects(subjects);
  const existingIndex = records.findIndex(entry => entry && String(entry.semester).toLowerCase() === String(semester).toLowerCase());

  if (existingIndex >= 0) {
    records[existingIndex] = { ...records[existingIndex], semester, subjects: preparedSubjects, gwa: gwa != null ? gwa : records[existingIndex].gwa };
    return records;
  }

  records.push({ semester, subjects: preparedSubjects, gwa: gwa != null ? gwa : null });
  return records;
}

module.exports = {
  parseSemesterRecords,
  cleanSubjects,
  serializeSemesterRecords,
  appendSemesterRecord,
  calculateGwa
};
