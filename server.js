require("dotenv").config();

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { parseSemesterRecords, cleanSubjects, serializeSemesterRecords, appendSemesterRecord, calculateGwa } = require("./semesterRecords");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
const publicDir = __dirname;
const dbFile = process.env.DB_FILE || path.join(__dirname, "data.db");
const teacherSessions = new Map();
const mailTransporter = process.env.SMTP_USER && process.env.SMTP_PASS
  ? nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

if (!mailTransporter) {
  console.warn("Gmail notifications are disabled. Configure SMTP_USER and SMTP_PASS in .env.");
}

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get("/script.js", (req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(publicDir, "script.js"));
});

app.get("/style.css", (req, res) => {
  res.type("text/css");
  res.sendFile(path.join(publicDir, "style.css"));
});

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

const db = new sqlite3.Database(dbFile, err => {
  if (err) {
    console.error("Failed to open database:", err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT,
      lastName TEXT,
      email TEXT UNIQUE,
      password TEXT,
      gwa REAL,
      postalCode TEXT,
      city TEXT,
      province TEXT,
      birthday TEXT,
      age INTEGER,
      sex TEXT,
      yearLevel TEXT,
      studentIdNumber TEXT,
      course TEXT,
      section TEXT,
      subjects TEXT,
      backSubjects TEXT DEFAULT '[]',
      semesterRecords TEXT,
      notifications TEXT,
      status TEXT DEFAULT 'approved'
    )
  `);
    db.run(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        subject TEXT NOT NULL,
        subjects TEXT
      )
    `);
    db.run("DROP TABLE IF EXISTS password_resets");
    db.run(
      "INSERT OR IGNORE INTO teachers (username, password, subject) VALUES (?, ?, ?)",
      ["teacher", "teacher123", "Math"]
    );
  // Ensure older DBs have the columns they need
  db.all("PRAGMA table_info(students)", (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasSubjects = cols.some(c => c.name === 'subjects');
      const hasBackSubjects = cols.some(c => c.name === 'backSubjects');
      const hasSemesterRecords = cols.some(c => c.name === 'semesterRecords');
      const hasNotifications = cols.some(c => c.name === 'notifications');
      const hasStatus = cols.some(c => c.name === 'status');
      const hasStudentIdNumber = cols.some(c => c.name === "studentIdNumber");
      if (!hasSubjects) {
        db.run("ALTER TABLE students ADD COLUMN subjects TEXT");
      }
      if (!hasBackSubjects) {
        db.run("ALTER TABLE students ADD COLUMN backSubjects TEXT DEFAULT '[]'");
      }
      if (!hasSemesterRecords) {
        db.run("ALTER TABLE students ADD COLUMN semesterRecords TEXT");
      }
      if (!hasNotifications) {
        db.run("ALTER TABLE students ADD COLUMN notifications TEXT");
      }
      if (!hasStatus) {
        db.run("ALTER TABLE students ADD COLUMN status TEXT DEFAULT 'approved'");
      }
      if (!hasStudentIdNumber) {
        db.run("ALTER TABLE students ADD COLUMN studentIdNumber TEXT");
      }
    }
  });
  db.all("PRAGMA table_info(teachers)", (err, cols) => {
    if (!err && Array.isArray(cols) && !cols.some(c => c.name === "subjects")) {
      db.run("ALTER TABLE teachers ADD COLUMN subjects TEXT");
    }
  });
});

function getTeacherSubjects(teacher) {
  try {
    const subjects = teacher.subjects ? JSON.parse(teacher.subjects) : [];
    if (Array.isArray(subjects) && subjects.length) return subjects;
  } catch (error) {
    // Fall back to the legacy single-subject column.
  }
  return teacher.subject ? [teacher.subject] : [];
}

function parseBackSubjects(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(subject => typeof subject === "string") : [];
  } catch (error) {
    return [];
  }
}

function getChangedGrades(existingRecords, semesterName, subjects) {
  const existingSemester = parseSemesterRecords(existingRecords).find(record =>
    String(record.semester || "").trim().toLowerCase() === String(semesterName || "").trim().toLowerCase()
  );
  if (!Array.isArray(subjects)) return [];

  return subjects.filter(subject => {
    const previous = (existingSemester?.subjects || []).find(entry =>
      String(entry.name || "").trim().toLowerCase() === String(subject.name || "").trim().toLowerCase()
    );
    return !previous || String(previous.grade ?? "") !== String(subject.grade ?? "");
  });
}

async function notifyAdminByEmail(student, changedFields, details = []) {
  const recipientEmail = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER;
  if (!mailTransporter || !recipientEmail) return "not-configured";
  if (!changedFields.length) return "not-sent";

  const detailLines = details.length
    ? `\n\nDetails:\n${details.join("\n")}`
    : "";
  await mailTransporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: recipientEmail,
    subject: `Student record notification: ${student.firstName || ""} ${student.lastName || ""}`.trim(),
    text: `A student record event requires your attention.\n\nStudent: ${student.firstName || ""} ${student.lastName || ""}\nEmail: ${student.email || "Not provided"}\nRecord changes: ${changedFields.join(", ")}.${detailLines}`
  });
  return "sent";
}

app.get("/client", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.get("/teacher", (req, res) => {
  res.sendFile(path.join(publicDir, "teacher.html"));
});

app.post("/api/register", (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    postalCode,
    city,
    province,
    birthday,
    age,
    sex,
    yearLevel,
    studentIdNumber,
    course,
    section,
    subjects = [],
    semesterName,
    semesterGwa
  } = req.body;
  const cleanedSubjects = cleanSubjects(subjects);
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const normalizedStudentIdNumber = ["2nd Year", "3rd Year", "4th Year"].includes(yearLevel)
    ? String(studentIdNumber || "").trim()
    : null;
  if (["2nd Year", "3rd Year", "4th Year"].includes(yearLevel) && !normalizedStudentIdNumber) {
    return res.status(400).json({ error: "Student ID number is required for 2nd through 4th year students." });
  }
  if (normalizedStudentIdNumber && normalizedStudentIdNumber.length > 50) {
    return res.status(400).json({ error: "Student ID number must be 50 characters or fewer." });
  }

  const initialSemesterRecords = semesterName && cleanedSubjects.length
    ? appendSemesterRecord([], semesterName, cleanedSubjects, semesterGwa ?? null)
    : [];

  const query = `INSERT INTO students
    (firstName, lastName, email, password, gwa, postalCode, city, province, birthday, age, sex, yearLevel, studentIdNumber, course, section, subjects, backSubjects, semesterRecords, notifications, status)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.run(query, [firstName, lastName, normalizedEmail, password, postalCode, city, province, birthday, age, sex, yearLevel, normalizedStudentIdNumber, course, section, JSON.stringify(cleanedSubjects), JSON.stringify([]), serializeSemesterRecords(initialSemesterRecords), JSON.stringify([]), "pending"], async function (err) {
    if (err) {
      if (err.code === "SQLITE_CONSTRAINT") {
        return res.status(400).json({ error: "A student with that email already exists." });
      }
      return res.status(500).json({ error: "Failed to register student." });
    }

    const student = { id: this.lastID, firstName, lastName, email: normalizedEmail };
    let emailStatus = "not-sent";
    try {
      emailStatus = await notifyAdminByEmail(student, ["New student registration"], ["Registration status: pending"]);
    } catch (emailError) {
      console.error("Unable to send student registration email:", emailError.message);
      emailStatus = "failed";
    }
    res.json({ id: student.id, status: "pending", emailStatus });
  });
});

app.post("/api/student/login", (req, res) => {
  const identifier = String(req.body.identifier ?? req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!identifier || !password) {
    return res.status(400).json({ error: "Email or student ID number and password are required." });
  }
  db.get(
    `SELECT id, password, status FROM students
     WHERE lower(trim(email)) = ? OR lower(trim(COALESCE(studentIdNumber, ''))) = ?`,
    [identifier, identifier],
    (err, student) => {
      if (err) {
        return res.status(500).json({ error: "Login failed." });
      }
      if (!student) {
        return res.status(401).json({ error: "No student account was found for that email or student ID number." });
      }
      if (student.password !== password) {
        return res.status(401).json({ error: "Incorrect password." });
      }
      const status = String(student.status || "approved").trim().toLowerCase();
      if (status !== "approved") {
        const error = status === "pending"
          ? "Your registration is still awaiting admin approval."
          : status === "rejected"
            ? "Your registration was not approved. Please contact the administrator."
            : "Your account is not approved. Please contact the administrator.";
        return res.status(403).json({ error });
      }
      res.json({ id: student.id });
    }
  );
});

app.get("/api/teachers", (req, res) => {
  db.all("SELECT id, username, subject, subjects FROM teachers ORDER BY username", (err, teachers) => {
    if (err) return res.status(500).json({ error: "Unable to load teachers." });
    res.json(teachers.map(teacher => ({ ...teacher, subjects: getTeacherSubjects(teacher) })));
  });
});

app.post("/api/teachers", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const subjects = (Array.isArray(req.body.subjects) ? req.body.subjects : String(req.body.subject || "").split(","))
    .map(subject => String(subject).trim()).filter(Boolean);
  if (username.length < 3 || password.length < 6 || !subjects.length) {
    return res.status(400).json({ error: "Username, password, and at least one subject are required. Password must be at least 6 characters." });
  }
  const subject = subjects[0];

  db.run("INSERT INTO teachers (username, password, subject, subjects) VALUES (?, ?, ?, ?)", [username, password, subject, JSON.stringify(subjects)], function (err) {
    if (err) {
      if (err.code === "SQLITE_CONSTRAINT") return res.status(400).json({ error: "That teacher username already exists." });
      return res.status(500).json({ error: "Unable to create teacher account." });
    }
    res.status(201).json({ id: this.lastID, username, subjects });
  });
});

app.put("/api/teachers/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const subjects = (Array.isArray(req.body.subjects) ? req.body.subjects : String(req.body.subject || "").split(","))
    .map(subject => String(subject).trim()).filter(Boolean);
  if (!Number.isInteger(id) || username.length < 3 || !subjects.length || (password && password.length < 6)) {
    return res.status(400).json({ error: "Username and at least one subject are required. A new password must be at least 6 characters." });
  }

  const fields = ["username = ?", "subject = ?", "subjects = ?"];
  const values = [username, subjects[0], JSON.stringify(subjects)];
  if (password) {
    fields.push("password = ?");
    values.push(password);
  }
  values.push(id);
  db.run(`UPDATE teachers SET ${fields.join(", ")} WHERE id = ?`, values, function (err) {
    if (err) {
      if (err.code === "SQLITE_CONSTRAINT") return res.status(400).json({ error: "That teacher username already exists." });
      return res.status(500).json({ error: "Unable to update teacher account." });
    }
    if (!this.changes) return res.status(404).json({ error: "Teacher not found." });
    res.json({ success: true, username, subjects });
  });
});

app.post("/api/teacher/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT id, username, subject, subjects FROM teachers WHERE username = ? AND password = ?", [username, password], (err, teacher) => {
    if (err) return res.status(500).json({ error: "Teacher login failed." });
    if (!teacher) return res.status(401).json({ error: "Invalid teacher username or password." });
    const token = crypto.randomBytes(24).toString("hex");
    teacherSessions.set(token, teacher.id);
    res.json({ ...teacher, subjects: getTeacherSubjects(teacher), token });
  });
});

function authenticateTeacher(req, res, next) {
  const token = req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const teacherId = teacherSessions.get(token);
  if (!teacherId || teacherId !== parseInt(req.params.id || req.params.teacherId, 10)) {
    return res.status(401).json({ error: "Teacher login is required." });
  }
  next(teacherId);
}

app.get("/api/teachers/:id/students", (req, res) => {
  authenticateTeacher(req, res, () => loadTeacherStudents(req, res));
});

function loadTeacherStudents(req, res) {
  const teacherId = parseInt(req.params.id, 10);
  db.get("SELECT id, subject, subjects FROM teachers WHERE id = ?", [teacherId], (teacherErr, teacher) => {
    if (teacherErr) return res.status(500).json({ error: "Unable to load teacher." });
    if (!teacher) return res.status(404).json({ error: "Teacher not found." });

    db.all("SELECT * FROM students ORDER BY lastName, firstName", (studentErr, students) => {
      if (studentErr) return res.status(500).json({ error: "Unable to load students." });
      const teacherSubjects = getTeacherSubjects(teacher);
      const subjectNames = teacherSubjects.map(subject => subject.trim().toLowerCase());
      const filtered = students.map(student => {
        const records = parseSemesterRecords(student.semesterRecords);
        const matchingRecords = records.map(record => ({
          ...record,
          subjects: (record.subjects || []).filter(subject => subjectNames.includes(String(subject.name || "").trim().toLowerCase()))
        })).filter(record => record.subjects.length);
        return {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          yearLevel: student.yearLevel,
          course: student.course,
          subjects: teacherSubjects,
          semesterRecords: matchingRecords
        };
      }).filter(student => student.semesterRecords.length);
      res.json({ teacher: { id: teacher.id, subjects: teacherSubjects }, students: filtered });
    });
  });
}

app.put("/api/teachers/:teacherId/students/:studentId/grade", (req, res) => {
  authenticateTeacher(req, res, () => saveTeacherGrade(req, res));
});

function saveTeacherGrade(req, res) {
  const teacherId = parseInt(req.params.teacherId, 10);
  const studentId = parseInt(req.params.studentId, 10);
  const { semesterName, subjectName, grade } = req.body;

  db.get("SELECT subject, subjects FROM teachers WHERE id = ?", [teacherId], (teacherErr, teacher) => {
    if (teacherErr) return res.status(500).json({ error: "Unable to validate teacher." });
    if (!teacher) return res.status(404).json({ error: "Teacher not found." });
    const teacherSubjects = getTeacherSubjects(teacher);
    const requestedSubject = String(subjectName || "").trim().toLowerCase();
    if (!teacherSubjects.some(subject => subject.trim().toLowerCase() === requestedSubject)) {
      return res.status(403).json({ error: "You can only grade your assigned subject." });
    }

    db.get("SELECT * FROM students WHERE id = ?", [studentId], (studentErr, student) => {
      if (studentErr) return res.status(500).json({ error: "Unable to load student." });
      if (!student) return res.status(404).json({ error: "Student not found." });

      const records = parseSemesterRecords(student.semesterRecords);
      const semester = records.find(record => String(record.semester).trim().toLowerCase() === String(semesterName || "").trim().toLowerCase());
      const subject = semester?.subjects?.find(entry => String(entry.name).trim().toLowerCase() === requestedSubject);
      if (!subject) return res.status(403).json({ error: "This student is not enrolled in your subject for that semester." });
      if (subject.locked) return res.status(403).json({ error: "This grade is locked by the administrator." });

      const nextGrade = grade === "" || grade == null ? null : String(grade).trim();
      const gradeChanged = String(subject.grade ?? "") !== String(nextGrade ?? "");
      subject.grade = nextGrade;
      const semesterGwa = calculateGwa(semester.subjects);
      const nextGwa = semesterGwa ?? semester.gwa ?? student.gwa ?? null;
      semester.gwa = nextGwa;
      const serializedRecords = serializeSemesterRecords(records);
      db.run("UPDATE students SET semesterRecords = ?, subjects = ?, gwa = ? WHERE id = ?", [serializedRecords, JSON.stringify(records[records.length - 1]?.subjects || []), nextGwa, studentId], async function (updateErr) {
        if (updateErr) return res.status(500).json({ error: "Unable to save grade." });
        let emailStatus = "not-sent";
        if (gradeChanged) {
          try {
            emailStatus = await notifyAdminByEmail(student, [`${semesterName} grade`], [`${subjectName}: ${nextGrade ?? "Not graded"}`]);
          } catch (emailError) {
            console.error("Unable to send student update email:", emailError.message);
            emailStatus = "failed";
          }
        }
        res.json({ success: true, emailStatus });
      });
    });
  });
}

app.get("/api/students", (req, res) => {
  db.all("SELECT * FROM students ORDER BY id", (err, students) => {
    if (err) {
      return res.status(500).json({ error: "Unable to load students." });
    }
    const parsed = students.map(s => ({ ...s, subjects: cleanSubjects(s.subjects ? JSON.parse(s.subjects) : []), backSubjects: parseBackSubjects(s.backSubjects), semesterRecords: parseSemesterRecords(s.semesterRecords), notifications: parseSemesterRecords(s.notifications), status: s.status || "approved" }));
    res.json(parsed);
  });
});

app.get("/api/students/pending", (req, res) => {
  db.all("SELECT * FROM students WHERE lower(trim(COALESCE(status, ''))) = 'pending' ORDER BY id", (err, students) => {
    if (err) return res.status(500).json({ error: "Unable to load pending registrations." });
    res.json(students.map(s => ({ ...s, subjects: cleanSubjects(s.subjects ? JSON.parse(s.subjects) : []), semesterRecords: parseSemesterRecords(s.semesterRecords), status: "pending" })));
  });
});

app.put("/api/students/:id/status", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body.status || "").trim().toLowerCase();
  if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "A valid student ID and status are required." });
  }
  db.get("SELECT * FROM students WHERE id = ? AND lower(trim(COALESCE(status, ''))) = 'pending'", [id], (lookupErr, student) => {
    if (lookupErr) return res.status(500).json({ error: "Unable to update registration status." });
    if (!student) return res.status(404).json({ error: "Pending registration not found." });
    db.run("UPDATE students SET status = ? WHERE id = ? AND lower(trim(COALESCE(status, ''))) = 'pending'", [status, id], async function (err) {
      if (err) return res.status(500).json({ error: "Unable to update registration status." });
      if (!this.changes) return res.status(404).json({ error: "Pending registration not found." });
      let emailStatus = "not-sent";
      try {
        emailStatus = await notifyAdminByEmail(student, ["Registration status"], [`Registration status: ${status}`]);
      } catch (emailError) {
        console.error("Unable to send student update email:", emailError.message);
        emailStatus = "failed";
      }
      res.json({ success: true, status, emailStatus });
    });
  });
});

app.get("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.get("SELECT * FROM students WHERE id = ?", [id], (err, student) => {
    if (err) {
      return res.status(500).json({ error: "Unable to load student." });
    }
    if (!student) {
      return res.status(404).json({ error: "Student not found." });
    }
    if (String(student.status || "approved").trim().toLowerCase() !== "approved") {
      return res.status(403).json({ error: "This registration is awaiting admin approval." });
    }
    student.subjects = cleanSubjects(student.subjects ? JSON.parse(student.subjects) : []);
    student.backSubjects = parseBackSubjects(student.backSubjects);
    student.semesterRecords = parseSemesterRecords(student.semesterRecords);
    student.notifications = parseSemesterRecords(student.notifications);
    res.json(student);
  });
});

app.put("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const {
    firstName,
    lastName,
    email,
    password,
    postalCode,
    city,
    province,
    birthday,
    age,
    sex,
    yearLevel,
    studentIdNumber,
    course,
    section,
    gwa,
    subjects,
    backSubjects,
    semesterName,
    semesterGwa,
    updatedBy
  } = req.body;
  const cleanedSubjects = subjects === undefined ? undefined : cleanSubjects(subjects);

  db.get("SELECT * FROM students WHERE id = ?", [id], (err, existingStudent) => {
    if (err) {
      return res.status(500).json({ error: "Unable to update student." });
    }
    if (!existingStudent) {
      return res.status(404).json({ error: "Student not found." });
    }

    const nextYearLevel = yearLevel ?? existingStudent.yearLevel;
    const hasStudentId = ["2nd Year", "3rd Year", "4th Year"].includes(nextYearLevel);
    const nextStudentIdNumber = hasStudentId
      ? String(studentIdNumber ?? existingStudent.studentIdNumber ?? "").trim()
      : null;
    if (hasStudentId && !nextStudentIdNumber) {
      return res.status(400).json({ error: "Student ID number is required for 2nd through 4th year students." });
    }
    if (nextStudentIdNumber && nextStudentIdNumber.length > 50) {
      return res.status(400).json({ error: "Student ID number must be 50 characters or fewer." });
    }

    let cleanedBackSubjects;
    if (backSubjects !== undefined) {
      if (!Array.isArray(backSubjects) || backSubjects.length > 20 || backSubjects.some(subject => typeof subject !== "string" || subject.length > 120)) {
        return res.status(400).json({ error: "Back subjects must be a list of up to 20 subject names, each no longer than 120 characters." });
      }
      cleanedBackSubjects = [...new Set(backSubjects.map(subject => subject.trim()).filter(Boolean))];
      const currentBackSubjects = parseBackSubjects(existingStudent.backSubjects);
      const currentBackSubjectsJson = JSON.stringify(currentBackSubjects);
      if (!["2nd Year", "3rd Year", "4th Year"].includes(yearLevel ?? existingStudent.yearLevel)
        && JSON.stringify(cleanedBackSubjects) !== currentBackSubjectsJson) {
        return res.status(400).json({ error: "Back subjects can only be changed for students in 2nd through 4th year." });
      }
    }

    const fields = [
      { key: "firstName", value: firstName },
      { key: "lastName", value: lastName },
      { key: "email", value: email },
      { key: "password", value: password },
      { key: "postalCode", value: postalCode },
      { key: "city", value: city },
      { key: "province", value: province },
      { key: "birthday", value: birthday },
      { key: "age", value: age },
      { key: "sex", value: sex },
      { key: "yearLevel", value: yearLevel },
      { key: "studentIdNumber", value: nextStudentIdNumber },
      { key: "course", value: course },
      { key: "section", value: section }
    ];

    const updates = fields.filter(item => item.value !== undefined).map(item => `${item.key} = ?`);
    const values = fields.filter(item => item.value !== undefined).map(item => item.value);
    const fieldLabels = {
      firstName: "First name",
      lastName: "Last name",
      email: "Email",
      password: "Password",
      postalCode: "Postal code",
      city: "City",
      province: "Province",
      birthday: "Birthday",
      age: "Age",
      sex: "Sex",
      yearLevel: "Year level",
      studentIdNumber: "Student ID number",
      course: "Course",
      section: "Section"
    };
    const changedFields = fields
      .filter(item => item.value !== undefined && String(item.value ?? "") !== String(existingStudent[item.key] ?? ""))
      .map(item => fieldLabels[item.key]);

    if (cleanedBackSubjects !== undefined) {
      const serializedBackSubjects = JSON.stringify(cleanedBackSubjects);
      if (serializedBackSubjects !== (existingStudent.backSubjects || "[]")) {
        updates.push("backSubjects = ?");
        values.push(serializedBackSubjects);
        changedFields.push("Back subjects");
      }
    }

    const automaticGwa = semesterName && Array.isArray(cleanedSubjects) ? calculateGwa(cleanedSubjects) : null;

    if (automaticGwa !== null || gwa !== undefined) {
      updates.push("gwa = ?");
      const nextGwa = automaticGwa ?? gwa;
      values.push(nextGwa);
      if (String(nextGwa ?? "") !== String(existingStudent.gwa ?? "")) changedFields.push("GWA");
    }

    if (cleanedSubjects !== undefined) {
      updates.push("subjects = ?");
      values.push(JSON.stringify(cleanedSubjects));
      if (JSON.stringify(cleanedSubjects) !== (existingStudent.subjects || "[]")) changedFields.push("subjects");
    }

    if (semesterName && Array.isArray(cleanedSubjects)) {
      const recordGwa = automaticGwa ?? (semesterGwa !== undefined ? semesterGwa : (gwa !== undefined ? gwa : null));
      const updatedRecords = appendSemesterRecord(existingStudent.semesterRecords, semesterName, cleanedSubjects, recordGwa);
      const serializedRecords = serializeSemesterRecords(updatedRecords);
      if (serializedRecords !== (existingStudent.semesterRecords || "[]")) {
        updates.push("semesterRecords = ?");
        values.push(serializedRecords);
        changedFields.push(`${semesterName} records`);
      }
    }

    if (updatedBy === "admin" && changedFields.length) {
      const notifications = parseSemesterRecords(existingStudent.notifications);
      notifications.unshift({
        message: `An administrator updated: ${changedFields.join(", ")}.`,
        createdAt: new Date().toISOString()
      });
      updates.push("notifications = ?");
      values.push(JSON.stringify(notifications.slice(0, 20)));
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No valid student fields to update." });
    }

    values.push(id);
    const query = `UPDATE students SET ${updates.join(", ")} WHERE id = ?`;

    const changedGrades = semesterName && Array.isArray(subjects)
      ? getChangedGrades(existingStudent.semesterRecords, semesterName, cleanedSubjects)
      : [];

    db.run(query, values, async function (runErr) {
      if (runErr) {
        return res.status(500).json({ error: "Unable to update student." });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Student not found." });
      }

      let emailStatus = "not-sent";
      if (changedFields.length) {
        try {
          const updatedStudent = { ...existingStudent, firstName: firstName ?? existingStudent.firstName };
          const gradeDetails = changedGrades.map(subject => `${subject.name}: ${subject.grade ?? "Not graded"}`);
          emailStatus = await notifyAdminByEmail(updatedStudent, changedFields, gradeDetails);
        } catch (emailError) {
          console.error("Unable to send student update email:", emailError.message);
          emailStatus = "failed";
        }
      }
      res.json({ success: true, emailStatus });
    });
  });
});

app.delete("/api/students/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid student ID." });
  }

  db.run("DELETE FROM students WHERE id = ?", [id], function (err) {
    if (err) {
      return res.status(500).json({ error: "Unable to delete student." });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Student not found." });
    }
    res.json({ success: true });
  });
});

app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});
