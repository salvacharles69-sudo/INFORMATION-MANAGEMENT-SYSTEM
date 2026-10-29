const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
// Use the backend origin when the page is opened through a separate live-reload server.
const API_BASE = (() => {
    if (window.location.protocol.startsWith("http") && window.location.port === "3000") {
        return window.location.origin;
    }
    if (window.location.protocol.startsWith("http")) {
        return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
    return 'http://127.0.0.1:3000';
})();

let currentUser = loadCurrentUser();
let studentsCache = [];
let currentStudentProfileData = null;
let currentAdminStudentData = null;
let teacherStudentsCache = [];

const state = {
    role: null,
    studentTab: "register"
};

const curriculumSubjects = {
    "1st Year": {
        "1st Semester": [
            "IT 101 - Intro to Computing",
            "IT 102 - Fundamentals of Programming",
            "GE 1 - Understanding the Self w/ Pop Ed.",
            "GE 2 - Purposive Communication",
            "GE 3 - Mathematics in the Modern World",
            "GE 10 - Living in IT Era",
            "GE 8 - Ethics w/ GAD",
            "PATHFIT 1 - Movement Competency Training 1",
            "NSTP 1 - CWTS"
        ],
        "2nd Semester": [
            "IT 103 - Intermediate Programming (Java)",
            "HCI 101 - Intro to Human Computer Interaction",
            "MS 101 - Discrete Mathematics",
            "GE 7 - Science, Technology and Society w/ Environmental & Climate Change",
            "GE 8 - The Life & Works of Rizal",
            "GE 11 - The Entrepreneurial Mind",
            "GE 4 - Readings in Philippine History",
            "PATHFIT 2 - Exercise-based Fitness Activities",
            "NSTP 2 - CWTS"
        ]
    },
    "2nd Year": {
        "1st Semester": [
            "WS 201 - Web System & Technologies",
            "IT 204 - Data Structures & Algorithm",
            "PF 201 - Object Oriented Programming",
            "MS 202 - Quantitative Methods",
            "GE 6 - The Contemporary World",
            "IT 205 - Information Management",
            "GE 12 - Reading Visual Arts",
            "PATHFIT 3 - Fundamental Dance Steps"
        ],
        "2nd Semester": [
            "IPT 201 - Integrative Programming & Technologies",
            "PT 201 - Platform Technologies",
            "Net 201 - Networking 1",
            "IT 206 - Application Development & Emerging Technologies",
            "GE 5 - Art Appreciation",
            "IM 201 - Fundamentals of Database System",
            "PATHFIT 4 - Recreational Activities"
        ]
    },
    "3rd Year": {
        "1st Semester": [
            "SIA 301 - System Integration & Architecture 1",
            "IAS 301 - Information Assurance & Security 1",
            "Net 302 - Networking 2",
            "SP 301 - Social & Professional Issues 1",
            "IT Elec 1 - IT Elective 1",
            "IT Elec 2 - IT Elective 2"
        ],
        "2nd Semester": [
            "IAS 302 - Information Assurance & Security 2",
            "SA 301 - System Administration & Maintenance",
            "SIA 302 - System Integration & Architecture 2",
            "IT Elec 3 - IT Elective 3",
            "IT Elec 4 - IT Elective 4",
            "Cap 301 - Capstone 1"
        ]
    },
    "4th Year": {
        "1st Semester": [
            "Cap 302 - Capstone 2",
            "IT Elec 5 - IT Elective 5",
            "IT Elec 6 - IT Elective 6"
        ],
        "2nd Semester": [
            "OJT 401 - Practicum/OJT (486 HRS)"
        ]
    }
};

async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (err) {
        return { __parseError: true, __raw: text };
    }
}

function emailNotificationMessage(status) {
    if (status === "sent") return " An email notification was sent to the admin.";
    if (status === "failed") return " The update was saved, but the admin email notification could not be sent.";
    if (status === "not-configured") return " The update was saved, but Gmail SMTP or the admin notification address is not configured on the server.";
    return "";
}

function populateSubjectInputs(prefix, subjects, gradePrefix = null, lockPrefix = null) {
    const list = Array.isArray(subjects) ? subjects : [];
    for (let i = 1; i <= 9; i++) {
        const subjectEl = document.getElementById(`${prefix}${i}`);
        const entry = list[i - 1] || {};
        if (subjectEl) {
            subjectEl.value = entry.name || "";
            const isLocked = Boolean(entry.locked);
            subjectEl.disabled = isLocked;
            subjectEl.title = isLocked ? "Locked by admin" : "";
        }

        if (gradePrefix) {
            const gradeEl = document.getElementById(`${gradePrefix}${i}`);
            if (gradeEl) {
                gradeEl.value = entry.grade != null ? String(entry.grade) : "";
                gradeEl.disabled = Boolean(entry.locked);
                gradeEl.title = entry.locked ? "Locked by admin" : "";
            }
        }

        if (lockPrefix) {
            const lockEl = document.getElementById(`${lockPrefix}${i}`);
            if (lockEl) {
                lockEl.checked = Boolean(entry.locked);
            }
        }
    }
}

function getCurriculumSubjects(yearLevel, semesterName) {
    const subjects = curriculumSubjects[yearLevel]?.[semesterName];
    return Array.isArray(subjects) ? subjects.map(name => ({ name, grade: null })) : null;
}

function getSelectedSubjects(mode, student, semesterName) {
    const yearLevelId = mode === "student" ? "profileYearLevel" : mode === "admin" ? "editYearLevel" : "registerYearLevel";
    const yearLevel = document.getElementById(yearLevelId)?.value;
    const catalogSubjects = getCurriculumSubjects(yearLevel, semesterName);
    if (!catalogSubjects) {
        return student ? getSubjectsForSemester(student, semesterName) : [];
    }

    const savedSubjects = student ? getSubjectsForSemester(student, semesterName) : [];
    return catalogSubjects.map(subject => {
        const saved = savedSubjects.find(entry => entry.name === subject.name);
        return saved ? { ...subject, grade: saved.grade ?? null, locked: saved.locked } : subject;
    });
}

function getSubjectsForSemester(student, semesterName) {
    const records = Array.isArray(student?.semesterRecords) ? student.semesterRecords : [];
    const normalizedSemester = (semesterName || "").trim().toLowerCase();
    const match = records.find(entry => String(entry?.semester || "").trim().toLowerCase() === normalizedSemester);
    if (match && Array.isArray(match.subjects)) {
        return match.subjects.filter(subject =>
            typeof subject?.name === "string" && subject.name.trim() && subject.name.trim().toLowerCase() !== "vacant"
        );
    }
    return [];
}

function getSemesterGwa(student, semesterName) {
    const records = Array.isArray(student?.semesterRecords) ? student.semesterRecords : [];
    const normalizedSemester = (semesterName || "").trim().toLowerCase();
    const match = records.find(entry => String(entry?.semester || "").trim().toLowerCase() === normalizedSemester);
    return match && match.gwa != null ? match.gwa : null;
}

function isBackSubjectYear(yearLevel) {
    return ["2nd Year", "3rd Year", "4th Year"].includes(yearLevel);
}

function toggleStudentIdField(mode, yearLevel) {
    const field = document.getElementById(`${mode}StudentIdField`);
    const input = document.getElementById(`${mode}StudentIdNumber`);
    const hasStudentId = isBackSubjectYear(yearLevel);
    if (field) field.classList.toggle("hidden", !hasStudentId);
    if (input) {
        input.required = hasStudentId;
        if (!hasStudentId) input.value = "";
    }
}

function toggleBackSubjectsField(mode, yearLevel) {
    const field = document.getElementById(`${mode === "student" ? "profile" : "edit"}BackSubjectsField`);
    const select = document.getElementById(`${mode === "student" ? "profile" : "edit"}YearLevel`);
    if (field) field.classList.toggle("hidden", !isBackSubjectYear(yearLevel || select?.value));
}

function syncSemesterInputs(mode, student, semesterName) {
    const subjects = getSelectedSubjects(mode, student, semesterName);
    const semesterGwa = student ? getSemesterGwa(student, semesterName) : null;
    if (mode === "student") {
        populateSubjectInputs("profileSubject", subjects);
        const gwaEl = document.getElementById("profileSemesterGwa");
        if (gwaEl) gwaEl.value = semesterGwa != null ? String(semesterGwa) : "";
    } else if (mode === "admin") {
        populateSubjectInputs("editSubject", subjects, "editGrade", "editLock");
        const gwaEl = document.getElementById("editSemesterGwa");
        if (gwaEl) gwaEl.value = semesterGwa != null ? String(semesterGwa) : "";
    } else if (mode === "register") {
        populateSubjectInputs("registerSubject", subjects);
    }
}

function collectSubjectsFromInputs(prefix, gradePrefix = null, lockPrefix = null, existingSubjects = []) {
    const subjects = [];
    const existingList = Array.isArray(existingSubjects) ? existingSubjects : [];
    for (let i = 1; i <= 9; i++) {
        const existing = existingList[i - 1] || {};
        const input = document.getElementById(`${prefix}${i}`);
        const name = input ? input.value.trim() : (existing.name || "");
        if (name.toLowerCase() === "vacant") continue;
        if (!name) continue;

        const subject = { name, grade: existing.grade != null ? existing.grade : null };
        if (gradePrefix) {
            const gradeEl = document.getElementById(`${gradePrefix}${i}`);
            const gradeVal = gradeEl?.value?.trim();
            subject.grade = gradeVal !== "" ? gradeVal : (existing.grade != null ? existing.grade : null);
        }

        if (lockPrefix) {
            const lockEl = document.getElementById(`${lockPrefix}${i}`);
            subject.locked = Boolean(lockEl?.checked || existing.locked);
        }

        subjects.push(subject);
    }
    return subjects;
}

function setSemesterSelection(mode, student) {
    const semesterEl = document.getElementById(mode === "student" ? "profileSemester" : "editSemester");
    if (!semesterEl) return;

    const semesterRecords = Array.isArray(student?.semesterRecords) ? student.semesterRecords : [];
    const currentValue = semesterEl.value?.trim();
    const hasCurrentValue = currentValue && semesterRecords.some(entry => String(entry?.semester || "").trim().toLowerCase() === currentValue.toLowerCase());

    if (!hasCurrentValue) {
        semesterEl.value = semesterRecords.length ? semesterRecords[semesterRecords.length - 1].semester : "1st Semester";
    }

    syncSemesterInputs(mode, student, semesterEl.value);
}

function attachSemesterSelectionHandlers() {
    const registerYearLevelEl = document.getElementById("registerYearLevel");
    const registerSemesterEl = document.getElementById("registerSemester");
    const refreshRegistrationSubjects = () => syncSemesterInputs("register", null, registerSemesterEl?.value || "1st Semester");
    registerYearLevelEl?.addEventListener("change", () => {
        toggleStudentIdField("register", registerYearLevelEl.value);
        refreshRegistrationSubjects();
    });
    registerSemesterEl?.addEventListener("change", refreshRegistrationSubjects);
    toggleStudentIdField("register", registerYearLevelEl?.value);
    refreshRegistrationSubjects();

    const profileSemesterEl = document.getElementById("profileSemester");
    if (profileSemesterEl) {
        profileSemesterEl.addEventListener("change", () => {
            syncSemesterInputs("student", currentStudentProfileData, profileSemesterEl.value);
        });
    }
    document.getElementById("profileYearLevel")?.addEventListener("change", event => {
        toggleStudentIdField("profile", event.target.value);
        toggleBackSubjectsField("student", event.target.value);
        syncSemesterInputs("student", currentStudentProfileData, profileSemesterEl?.value || "1st Semester");
    });

    const editSemesterEl = document.getElementById("editSemester");
    if (editSemesterEl) {
        editSemesterEl.addEventListener("change", () => {
            syncSemesterInputs("admin", currentAdminStudentData, editSemesterEl.value);
            updateAdminGwaFields();
        });
    }
    document.getElementById("editYearLevel")?.addEventListener("change", event => {
        toggleStudentIdField("edit", event.target.value);
        toggleBackSubjectsField("admin", event.target.value);
        syncSemesterInputs("admin", currentAdminStudentData, editSemesterEl?.value || "1st Semester");
    });

    document.querySelectorAll('[id^="editGrade"]').forEach(gradeEl => {
        gradeEl.addEventListener("input", updateAdminGwaFields);
    });
}

function updateAdminGwaFields() {
    const grades = [];
    for (let i = 1; i <= 9; i++) {
        const value = document.getElementById(`editGrade${i}`)?.value?.trim();
        if (value !== "" && Number.isFinite(Number(value))) grades.push(Number(value));
    }
    if (!grades.length) return;

    const gwa = (grades.reduce((total, grade) => total + grade, 0) / grades.length).toFixed(2);
    const semesterGwaEl = document.getElementById("editSemesterGwa");
    const gwaEl = document.getElementById("editGwa");
    if (semesterGwaEl) semesterGwaEl.value = gwa;
    if (gwaEl) gwaEl.value = gwa;
}

function init() {
    initializeAdminNavigation();
    attachSemesterSelectionHandlers();
    if (currentUser && currentUser.role === "student" && document.getElementById("studentSection")) {
        showStudentDashboard(currentUser.id);
    } else if (currentUser && currentUser.role === "admin" && document.getElementById("adminView")) {
        showAdminDashboard();
    } else if (currentUser && currentUser.role === "teacher" && document.getElementById("teacherView")) {
        showTeacherDashboard();
    }
}

function loadCurrentUser() {
    const stored = localStorage.getItem("currentUser");
    return stored ? JSON.parse(stored) : null;
}

function saveCurrentUser(user) {
    if (user) {
        localStorage.setItem("currentUser", JSON.stringify(user));
    } else {
        localStorage.removeItem("currentUser");
    }
}

function showRole(role) {
    state.role = role;
    hideAllViews();
    clearMessage();
    if (role === "student") {
        document.getElementById("studentSection").classList.remove("hidden");
        showStudentTab(state.studentTab);
    } else if (role === "admin") {
        document.getElementById("adminSection").classList.remove("hidden");
    }
}

function hideAllViews() {
    ["studentSection", "studentView", "adminSection", "adminView", "teacherSection", "teacherView"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

function showStudentTab(tab) {
    state.studentTab = tab;
    document.getElementById("studentTabRegister").classList.toggle("active", tab === "register");
    document.getElementById("studentTabLogin").classList.toggle("active", tab === "login");
    document.getElementById("studentRegisterForm").classList.toggle("hidden", tab !== "register");
    document.getElementById("studentLoginForm").classList.toggle("hidden", tab !== "login");
}

async function registerStudent(event) {
    event.preventDefault();
    const firstName = document.getElementById("registerFirstName").value.trim();
    const lastName = document.getElementById("registerLastName").value.trim();
    const email = document.getElementById("registerEmail").value.trim().toLowerCase();
    const password = document.getElementById("registerPassword").value;
    const postalCode = document.getElementById("registerPostalCode").value.trim();
    const city = document.getElementById("registerCity").value.trim();
    const province = document.getElementById("registerProvince").value.trim();
    const birthday = document.getElementById("registerBirthday").value;
    const age = parseInt(document.getElementById("registerAge").value, 10);
    const sex = document.getElementById("registerSex").value;
    const yearLevel = document.getElementById("registerYearLevel").value;
    const studentIdNumber = isBackSubjectYear(yearLevel)
        ? document.getElementById("registerStudentIdNumber").value.trim()
        : "";
    const course = document.getElementById("registerCourse").value;
    const semesterName = document.getElementById("registerSemester")?.value?.trim() || "1st Semester";
    const semesterGwa = parseFloat(document.getElementById("registerSemesterGwa")?.value);
    // Empty subject fields are allowed because some years have fewer subjects.
    const subjects = [];
    for (let i = 1; i <= 9; i++) {
        const val = document.getElementById(`registerSubject${i}`)?.value?.trim();
        if (val) subjects.push({ name: val, grade: null });
    }

    try {
        const response = await fetch(`${API_BASE}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName, lastName, email, password, postalCode, city, province, birthday, age, sex, yearLevel, studentIdNumber, course, subjects, semesterName, semesterGwa: Number.isFinite(semesterGwa) ? semesterGwa : null })
        });
        const result = await parseJsonResponse(response);
        if (result && result.__parseError) {
            if (!response.ok) throw new Error(result.__raw || "Registration failed.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(result.error || "Registration failed.");
        }

        currentUser = null;
        saveCurrentUser(null);
        showStudentTab("login");
        showMessage(`Registration submitted. Please wait for admin approval before logging in.${emailNotificationMessage(result.emailStatus)}`, "success");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function studentLogin(event) {
    event.preventDefault();
    const identifier = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
        const response = await fetch(`${API_BASE}/api/student/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password })
        });
        const student = await parseJsonResponse(response);
        if (student && student.__parseError) {
            if (!response.ok) throw new Error(student.__raw || "Login failed.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(student.error || "Login failed.");
        }

        currentUser = { role: "student", id: student.id };
        await showStudentDashboard(student.id);
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function showStudentDashboard(studentId) {
    try {
        const response = await fetch(`${API_BASE}/api/students/${studentId}`);
        const student = await parseJsonResponse(response);
        if (student && student.__parseError) {
            if (!response.ok) throw new Error(student.__raw || "Student not found.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(student.error || "Student not found.");
        }

        hideAllViews();
        document.getElementById("studentView").classList.remove("hidden");

        document.getElementById("studentData").innerHTML = `
            <div class="student-card">
                ${isBackSubjectYear(student.yearLevel) ? `<strong>Student ID Number:</strong> ${escapeHtml(student.studentIdNumber || "Not assigned")}<br>` : ""}
                <strong>GWA:</strong> ${student.gwa !== null ? student.gwa.toFixed(2) : "Not assigned"}
            </div>
        `;

        const notifications = Array.isArray(student.notifications) ? student.notifications : [];
        if (notifications.length) {
            const notificationContainer = document.createElement("div");
            notificationContainer.className = "student-card notification-card";
            notificationContainer.innerHTML = `<div><strong>Notifications</strong>${notifications.slice(0, 5).map(notification => `<br>${notification.message}<small> ${new Date(notification.createdAt).toLocaleString()}</small>`).join("")}</div>`;
            document.getElementById("studentData").prepend(notificationContainer);
        }

        const semesterHistory = Array.isArray(student.semesterRecords) ? student.semesterRecords : [];
        if (semesterHistory.length) {
            const historyContainer = document.createElement('div');
            historyContainer.className = 'student-subjects';
            historyContainer.innerHTML = `<h4>Semester History</h4>${semesterHistory.map(entry => `
                <div class="subject-item"><strong>${entry.semester}</strong>${entry.gwa != null ? ` (GWA: ${entry.gwa})` : ''}<br>${(entry.subjects || []).map(s => `${s.name}: ${s.grade != null ? s.grade : 'Not graded'}`).join('<br>')}</div>
            `).join('')}`;
            document.getElementById('studentData').appendChild(historyContainer);
        }
        // show subjects and grades
        const currentSemesterName = semesterHistory.length ? semesterHistory[semesterHistory.length - 1].semester : "1st Semester";
        const currentSemesterSubjects = getSubjectsForSemester(student, currentSemesterName);
        const subjectsHtml = (currentSemesterSubjects || []).map(s => `
            <div class="subject-item"><strong>${s.name}</strong>: ${s.grade != null ? s.grade : 'Not graded'}${s.locked ? ' (Locked)' : ''}</div>
        `).join("");
        if (subjectsHtml) {
            const subjectsContainer = document.createElement('div');
            subjectsContainer.className = 'student-subjects';
            subjectsContainer.innerHTML = `<h4>Subjects</h4>${subjectsHtml}`;
            document.getElementById('studentData').appendChild(subjectsContainer);
        }

        const backSubjects = Array.isArray(student.backSubjects) ? student.backSubjects : [];
        if (isBackSubjectYear(student.yearLevel)) {
            const backSubjectsContainer = document.createElement("section");
            backSubjectsContainer.className = "student-subjects";
            const heading = document.createElement("h4");
            heading.textContent = "Back Subjects";
            backSubjectsContainer.appendChild(heading);
            if (backSubjects.length) {
                const list = document.createElement("ul");
                backSubjects.forEach(subject => {
                    const item = document.createElement("li");
                    item.textContent = subject;
                    list.appendChild(item);
                });
                backSubjectsContainer.appendChild(list);
            } else {
                const emptyMessage = document.createElement("p");
                emptyMessage.textContent = "No back subjects added yet.";
                backSubjectsContainer.appendChild(emptyMessage);
            }
            document.getElementById("studentData").appendChild(backSubjectsContainer);
        }

        document.getElementById("profileFirstName").value = student.firstName;
        document.getElementById("profileLastName").value = student.lastName;
        document.getElementById("profileEmail").value = student.email;
        document.getElementById("profilePassword").value = student.password;
        document.getElementById("profilePostalCode").value = student.postalCode;
        document.getElementById("profileCity").value = student.city;
        document.getElementById("profileProvince").value = student.province;
        document.getElementById("profileBirthday").value = student.birthday;
        document.getElementById("profileAge").value = student.age;
        document.getElementById("profileSex").value = student.sex;
        document.getElementById("profileYearLevel").value = student.yearLevel;
        document.getElementById("profileStudentIdNumber").value = student.studentIdNumber || "";
        document.getElementById("profileCourse").value = student.course;
        document.getElementById("profileBackSubjects").value = backSubjects.join("\n");
        toggleStudentIdField("profile", student.yearLevel);
        toggleBackSubjectsField("student", student.yearLevel);
        currentStudentProfileData = student;
        setSemesterSelection("student", student);

        currentUser = { role: "student", id: student.id };
        saveCurrentUser(currentUser);
        return true;
    } catch (error) {
        currentUser = null;
        saveCurrentUser(null);
        const studentSection = document.getElementById("studentSection");
        if (studentSection) {
            hideAllViews();
            studentSection.classList.remove("hidden");
            showStudentTab("login");
        }
        showMessage(error.message, "error");
        return false;
    }
}

async function updateStudentProfile(event) {
    event.preventDefault();
    if (!currentUser || currentUser.role !== "student") {
        showMessage("Student record not found.", "error");
        return;
    }

    const firstName = document.getElementById("profileFirstName").value.trim();
    const lastName = document.getElementById("profileLastName").value.trim();
    const email = document.getElementById("profileEmail").value.trim().toLowerCase();
    const password = document.getElementById("profilePassword").value;
    const postalCode = document.getElementById("profilePostalCode").value.trim();
    const city = document.getElementById("profileCity").value.trim();
    const province = document.getElementById("profileProvince").value.trim();
    const birthday = document.getElementById("profileBirthday").value;
    const age = parseInt(document.getElementById("profileAge").value, 10);
    const sex = document.getElementById("profileSex").value;
    const yearLevel = document.getElementById("profileYearLevel").value;
    const studentIdNumber = isBackSubjectYear(yearLevel)
        ? document.getElementById("profileStudentIdNumber").value.trim()
        : "";
    const course = document.getElementById("profileCourse").value;
    const semesterName = document.getElementById("profileSemester")?.value?.trim() || "Current Semester";
    const existingSubjects = getSelectedSubjects("student", currentStudentProfileData, semesterName);
    const subjects = collectSubjectsFromInputs("profileSubject", null, null, existingSubjects);
    const backSubjects = isBackSubjectYear(yearLevel)
        ? document.getElementById("profileBackSubjects").value.split(/\r?\n/).map(subject => subject.trim()).filter(Boolean)
        : (Array.isArray(currentStudentProfileData?.backSubjects) ? currentStudentProfileData.backSubjects : []);
    const semesterGwa = parseFloat(document.getElementById("profileSemesterGwa")?.value);

    try {
        const response = await fetch(`${API_BASE}/api/students/${currentUser.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName, lastName, email, password, postalCode, city, province, birthday, age, sex, yearLevel, studentIdNumber, course, subjects, backSubjects, semesterName, semesterGwa: Number.isFinite(semesterGwa) ? semesterGwa : null })
        });
        const result = await parseJsonResponse(response);
        if (result && result.__parseError) {
            if (!response.ok) throw new Error(result.__raw || "Profile update failed.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(result.error || "Profile update failed.");
        }

        showMessage(`Your profile has been updated.${emailNotificationMessage(result.emailStatus)}`, "success");
        await showStudentDashboard(currentUser.id);
    } catch (error) {
        showMessage(error.message, "error");
    }
}

function adminLogin(event) {
    event.preventDefault();
    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value;

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        showMessage("Admin login failed.", "error");
        return;
    }

    currentUser = { role: "admin" };
    saveCurrentUser(currentUser);
    showAdminDashboard();
}

function updateAdminSummary({ totalStudents = 0, pending = 0, teachers = 0 } = {}) {
    const totalStudentsEl = document.getElementById("adminTotalStudentsValue");
    const totalStudentsMetaEl = document.getElementById("adminTotalStudentsMeta");
    const pendingEl = document.getElementById("adminPendingValue");
    const pendingMetaEl = document.getElementById("adminPendingMeta");
    const teachersEl = document.getElementById("adminTeachersValue");
    const teachersMetaEl = document.getElementById("adminTeachersMeta");

    if (totalStudentsEl) totalStudentsEl.textContent = String(totalStudents);
    if (totalStudentsMetaEl) totalStudentsMetaEl.textContent = `${totalStudents} this month`;
    if (pendingEl) pendingEl.textContent = String(pending);
    if (pendingMetaEl) pendingMetaEl.textContent = pending ? `${pending} awaiting review` : "Awaiting review";
    if (teachersEl) teachersEl.textContent = String(teachers);
    if (teachersMetaEl) teachersMetaEl.textContent = teachers ? `Across ${teachers} subjects` : "Across 0 subjects";
}

function activateAdminNav(sectionName = "teachers") {
    const shell = document.getElementById("adminView");
    if (!shell) return;

    shell.querySelectorAll(".nav-link").forEach(link => {
        const isActive = link.dataset.adminNav === sectionName;
        link.classList.toggle("active", isActive);
    });

    shell.querySelectorAll(".admin-panel-section").forEach(panel => {
        const isVisible = panel.dataset.adminSection === sectionName;
        panel.classList.toggle("hidden-section", !isVisible);
    });
}

async function showAdminDashboard() {
    hideAllViews();
    document.getElementById("adminView").classList.remove("hidden");
    document.getElementById("adminSection").classList.add("hidden");
    const searchInput = document.getElementById("adminSearch");
    if (searchInput) searchInput.value = "";
    currentUser = { role: "admin" };
    saveCurrentUser(currentUser);
    updateAdminSummary({ totalStudents: 0, pending: 0, teachers: 0 });
    activateAdminNav("dashboard");
    await renderStudentList();
    await renderPendingRegistrations();
    await renderTeacherAccounts();
}

function initializeAdminNavigation() {
    const shell = document.getElementById("adminView");
    if (!shell) return;

    shell.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            activateAdminNav(link.dataset.adminNav);
        });
    });
}

async function renderPendingRegistrations() {
    const container = document.getElementById("pendingRegistrations");
    if (!container) return;
    container.innerHTML = "";
    try {
        const response = await fetch(`${API_BASE}/api/students/pending`);
        const pending = await parseJsonResponse(response);
        if (!response.ok) throw new Error(pending.error || "Unable to load pending registrations.");
        updateAdminSummary({
            totalStudents: Number(document.getElementById("adminTotalStudentsValue")?.textContent || 0),
            pending: pending.length,
            teachers: Number(document.getElementById("adminTeachersValue")?.textContent || 0)
        });
        if (!pending.length) {
            container.innerHTML = "<p class=\"note\">No pending registrations.</p>";
            return;
        }
        pending.forEach(student => {
            const card = document.createElement("div");
            card.className = "student-card admin-card";
            const subjects = (student.subjects || []).map(subject => escapeHtml(subject.name)).join(", ") || "None listed";
            card.innerHTML = `
                <div>
                    <strong>Name:</strong> ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}<br>
                    <strong>Email:</strong> ${escapeHtml(student.email)}<br>
                    ${isBackSubjectYear(student.yearLevel) ? `<strong>Student ID Number:</strong> ${escapeHtml(student.studentIdNumber || "Not assigned")}<br>` : ""}
                    <strong>Course:</strong> ${escapeHtml(student.course || "Not assigned")}<br>
                    <strong>Subjects:</strong> ${subjects}
                </div>
                <div>
                    <button class="small-button" onclick="updateRegistrationStatus(${student.id}, 'approved')">Accept</button>
                    <button class="small-button secondary" onclick="updateRegistrationStatus(${student.id}, 'rejected')">Reject</button>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (error) {
        container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    }
}

async function updateRegistrationStatus(studentId, status) {
    const action = status === "approved" ? "accept" : "reject";
    if (!window.confirm(`Are you sure you want to ${action} this registration?`)) return;
    try {
        const response = await fetch(`${API_BASE}/api/students/${studentId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || "Unable to update registration.");
        showMessage(`Registration ${status === "approved" ? "accepted" : "rejected"}.${emailNotificationMessage(result.emailStatus)}`, "success");
        await renderPendingRegistrations();
        await renderStudentList(document.getElementById("adminSearch")?.value || "");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function renderTeacherAccounts() {
    const container = document.getElementById("teacherAccounts");
    if (!container) return;
    try {
        const response = await fetch(`${API_BASE}/api/teachers`);
        const teachers = await parseJsonResponse(response);
        if (!response.ok) throw new Error(teachers.error || "Unable to load teacher accounts.");
        const uniqueSubjects = new Set((teachers || []).flatMap(teacher => teacher.subjects || []));
        updateAdminSummary({
            totalStudents: Number(document.getElementById("adminTotalStudentsValue")?.textContent || 0),
            pending: Number(document.getElementById("adminPendingValue")?.textContent || 0),
            teachers: teachers.length,
        });
        container.innerHTML = `<h4>Teacher Accounts</h4>${teachers.map(teacher => `
            <div class="subject-item"><strong>${escapeHtml(teacher.username)}</strong> - ${escapeHtml((teacher.subjects || [teacher.subject]).join(", "))}
                <button class="small-button" onclick="editTeacher(${teacher.id}, '${escapeHtml(teacher.username)}', '${escapeHtml((teacher.subjects || [teacher.subject]).join(", "))}')">Edit</button>
            </div>
        `).join("")}`;
        updateAdminSummary({
            totalStudents: Number(document.getElementById("adminTotalStudentsValue")?.textContent || 0),
            pending: Number(document.getElementById("adminPendingValue")?.textContent || 0),
            teachers: teachers.length,
        });
    } catch (error) {
        container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    }
}

function editTeacher(id, username, subjects) {
    document.getElementById("teacherEditForm").classList.remove("hidden");
    document.getElementById("editTeacherId").value = id;
    document.getElementById("editTeacherUsername").value = username;
    document.getElementById("editTeacherPassword").value = "";
    document.getElementById("editTeacherSubjects").value = subjects;
}

function cancelTeacherEdit() {
    document.getElementById("teacherEditForm").classList.add("hidden");
    document.getElementById("teacherEditForm").reset();
}

async function updateTeacher(event) {
    event.preventDefault();
    const id = document.getElementById("editTeacherId").value;
    const username = document.getElementById("editTeacherUsername").value.trim();
    const password = document.getElementById("editTeacherPassword").value;
    const subjects = document.getElementById("editTeacherSubjects").value.split(",").map(subject => subject.trim()).filter(Boolean);
    try {
        const response = await fetch(`${API_BASE}/api/teachers/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, subjects })
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || "Unable to update teacher account.");
        activateAdminNav("teachers");
        showMessage("Teacher account updated.", "success");
        cancelTeacherEdit();
        await renderTeacherAccounts();
        activateAdminNav("teachers");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function createTeacher(event) {
    event.preventDefault();
    const username = document.getElementById("newTeacherUsername").value.trim();
    const password = document.getElementById("newTeacherPassword").value;
    const subjects = document.getElementById("newTeacherSubject").value.split(",").map(subject => subject.trim()).filter(Boolean);
    try {
        const response = await fetch(`${API_BASE}/api/teachers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, subjects })
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || "Unable to create teacher account.");
        document.getElementById("teacherCreateForm").reset();
        activateAdminNav("teachers");
        showMessage("Teacher account created.", "success");
        await renderTeacherAccounts();
        activateAdminNav("teachers");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function renderStudentList(query = "") {
    const allDiv = document.getElementById("allStudents");
    allDiv.innerHTML = "";
    allDiv.onclick = event => {
        const deleteButton = event.target.closest("[data-delete-student]");
        if (!deleteButton) return;
        const studentId = Number(deleteButton.dataset.deleteStudent);
        const student = studentsCache.find(entry => entry.id === studentId);
        if (student) deleteStudent(studentId, `${student.firstName} ${student.lastName}`);
    };

    try {
        const response = await fetch(`${API_BASE}/api/students`);
        const students = await parseJsonResponse(response);
        if (students && students.__parseError) {
            if (!response.ok) throw new Error(students.__raw || "Unable to load students.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(students.error || "Unable to load students.");
        }

        studentsCache = students;
        const approvedStudents = studentsCache.filter(student => (student.status || "approved") === "approved");
        studentsCache = approvedStudents;
        updateAdminSummary({
            totalStudents: approvedStudents.length,
            pending: Number(document.getElementById("adminPendingValue")?.textContent || 0),
            teachers: Number(document.getElementById("adminTeachersValue")?.textContent || 0)
        });
        const searchTerm = query.trim().toLowerCase();
        const filteredStudents = searchTerm ? studentsCache.filter(student => {
            return (
                String(student.id).includes(searchTerm) ||
                String(student.studentIdNumber || "").toLowerCase().includes(searchTerm) ||
                student.firstName.toLowerCase().includes(searchTerm) ||
                student.lastName.toLowerCase().includes(searchTerm) ||
                student.email.toLowerCase().includes(searchTerm)
            );
        }) : studentsCache;

        if (!filteredStudents.length) {
            allDiv.innerHTML = query ? "<p>No matching students found.</p>" : "<p>No students have registered yet.</p>";
            return;
        }

        filteredStudents.forEach(student => {
            const card = document.createElement("div");
            card.className = "student-card admin-card";
            const semesterSummary = (student.semesterRecords || []).map(entry => `
                <div class="subject-item"><strong>${entry.semester}</strong>${entry.gwa != null ? ` (GWA: ${entry.gwa})` : ''}: ${(entry.subjects || []).map(subject => `${subject.name} (${subject.grade != null ? subject.grade : 'Not graded'})`).join(', ')}</div>
            `).join('');
            card.innerHTML = `
                <div>
                    <strong>ID:</strong> ${student.id}<br>
                    ${isBackSubjectYear(student.yearLevel) ? `<strong>Student ID Number:</strong> ${escapeHtml(student.studentIdNumber || "Not assigned")}<br>` : ""}
                    <strong>Name:</strong> ${student.firstName} ${student.lastName}<br>
                    <strong>Email:</strong> ${student.email}<br>
                    <strong>GWA:</strong> ${student.gwa != null ? Number(student.gwa).toFixed(2) : "Not assigned"}
                    ${semesterSummary ? `<br><strong>Semester History:</strong><br>${semesterSummary}` : ''}
                </div>
                <div>
                    <button class="small-button" onclick="editStudent(${student.id})">Edit</button>
                    <button class="small-button secondary" data-delete-student="${student.id}">Delete</button>
                </div>
            `;
            allDiv.appendChild(card);
        });
    } catch (error) {
        allDiv.innerHTML = `<p class="error">${error.message}</p>`;
    }
}

function handleAdminSearch(event) {
    renderStudentList(event.target.value);
}

async function deleteStudent(studentId, studentName) {
    if (!window.confirm(`Delete ${studentName}'s student record? This cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/students/${studentId}`, { method: "DELETE" });
        const result = await parseJsonResponse(response);
        if (!response.ok) {
            throw new Error(result.error || "Student deletion failed.");
        }

        if (currentAdminStudentData?.id === studentId) {
            cancelAdminEdit();
            currentAdminStudentData = null;
        }
        showMessage("Student record deleted.", "success");
        await renderStudentList(document.getElementById("adminSearch")?.value || "");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function editStudent(studentId) {
    try {
        const response = await fetch(`${API_BASE}/api/students/${studentId}`);
        const student = await parseJsonResponse(response);
        if (student && student.__parseError) {
            if (!response.ok) throw new Error(student.__raw || "Student not found.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(student.error || "Student not found.");
        }

        document.getElementById("adminEditPanel").classList.remove("hidden");
        document.getElementById("editStudentId").value = student.id;
        document.getElementById("editFirstName").value = student.firstName;
        document.getElementById("editLastName").value = student.lastName;
        document.getElementById("editEmail").value = student.email;
        document.getElementById("editPassword").value = student.password;
        document.getElementById("editGwa").value = student.gwa;
        document.getElementById("editPostalCode").value = student.postalCode;
        document.getElementById("editCity").value = student.city;
        document.getElementById("editProvince").value = student.province;
        document.getElementById("editBirthday").value = student.birthday;
        document.getElementById("editAge").value = student.age;
        document.getElementById("editSex").value = student.sex;
        document.getElementById("editYearLevel").value = student.yearLevel;
        document.getElementById("editStudentIdNumber").value = student.studentIdNumber || "";
        document.getElementById("editCourse").value = student.course;
        document.getElementById("editBackSubjects").value = (Array.isArray(student.backSubjects) ? student.backSubjects : []).join("\n");
        toggleStudentIdField("edit", student.yearLevel);
        toggleBackSubjectsField("admin", student.yearLevel);
        currentAdminStudentData = student;
        setSemesterSelection("admin", student);
        updateAdminGwaFields();
    } catch (error) {
        showMessage(error.message, "error");
    }
}

function cancelAdminEdit() {
    document.getElementById("adminEditPanel").classList.add("hidden");
    document.getElementById("adminEditForm").reset();
}

async function updateStudentFromAdmin(event) {
    event.preventDefault();
    const id = parseInt(document.getElementById("editStudentId").value, 10);
    const firstName = document.getElementById("editFirstName").value.trim();
    const lastName = document.getElementById("editLastName").value.trim();
    const email = document.getElementById("editEmail").value.trim().toLowerCase();
    const password = document.getElementById("editPassword").value;
    const gwa = parseFloat(document.getElementById("editGwa").value);
    const postalCode = document.getElementById("editPostalCode").value.trim();
    const city = document.getElementById("editCity").value.trim();
    const province = document.getElementById("editProvince").value.trim();
    const birthday = document.getElementById("editBirthday").value;
    const age = parseInt(document.getElementById("editAge").value, 10);
    const sex = document.getElementById("editSex").value;
    const yearLevel = document.getElementById("editYearLevel").value;
    const studentIdNumber = isBackSubjectYear(yearLevel)
        ? document.getElementById("editStudentIdNumber").value.trim()
        : "";
    const course = document.getElementById("editCourse").value;
    const semesterName = document.getElementById("editSemester")?.value?.trim() || "Current Semester";
    const existingSubjects = getSelectedSubjects("admin", currentAdminStudentData, semesterName);
    const subjects = collectSubjectsFromInputs("editSubject", "editGrade", "editLock", existingSubjects);
    const backSubjects = isBackSubjectYear(yearLevel)
        ? document.getElementById("editBackSubjects").value.split(/\r?\n/).map(subject => subject.trim()).filter(Boolean)
        : (Array.isArray(currentAdminStudentData?.backSubjects) ? currentAdminStudentData.backSubjects : []);
    const semesterGwa = parseFloat(document.getElementById("editSemesterGwa")?.value);

    try {
        const response = await fetch(`${API_BASE}/api/students/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstName, lastName, email, password, postalCode, city, province, birthday, age, sex, yearLevel, studentIdNumber, course, gwa, subjects, backSubjects, semesterName, semesterGwa: Number.isFinite(semesterGwa) ? semesterGwa : null, updatedBy: "admin" })
        });
        const result = await parseJsonResponse(response);
        if (result && result.__parseError) {
            if (!response.ok) throw new Error(result.__raw || "Student update failed.");
            throw new Error("Invalid server response.");
        }
        if (!response.ok) {
            throw new Error(result.error || "Student update failed.");
        }

        activateAdminNav("students");
        showMessage(`Student information updated.${emailNotificationMessage(result.emailStatus)}`, "success");
        await renderStudentList();
        cancelAdminEdit();
        activateAdminNav("students");
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function teacherLogin(event) {
    event.preventDefault();
    const username = document.getElementById("teacherUsername").value.trim();
    const password = document.getElementById("teacherPassword").value;

    try {
        const response = await fetch(`${API_BASE}/api/teacher/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const teacher = await parseJsonResponse(response);
        if (!response.ok) throw new Error(teacher.error || "Teacher login failed.");
        currentUser = { role: "teacher", id: teacher.id, subjects: teacher.subjects, token: teacher.token };
        saveCurrentUser(currentUser);
        await showTeacherDashboard();
    } catch (error) {
        showMessage(error.message, "error");
    }
}

async function showTeacherDashboard() {
    try {
        const response = await fetch(`${API_BASE}/api/teachers/${currentUser.id}/students`, {
            headers: { Authorization: `Bearer ${currentUser.token}` }
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || "Unable to load teacher dashboard.");

        currentUser.subjects = result.teacher.subjects;
        saveCurrentUser(currentUser);
        hideAllViews();
        document.getElementById("teacherView").classList.remove("hidden");
        document.getElementById("teacherSection").classList.add("hidden");
        document.getElementById("teacherSubject").textContent = result.teacher.subjects.join(", ");
        teacherStudentsCache = result.students || [];
        renderTeacherStudents();
    } catch (error) {
        showMessage(error.message, "error");
        saveCurrentUser(null);
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
}

function renderTeacherStudents(query = "") {
    const container = document.getElementById("teacherStudents");
    if (!container) return;
    const searchTerm = query.trim().toLowerCase();
    const students = teacherStudentsCache.filter(student => !searchTerm ||
        String(student.id).includes(searchTerm) ||
        `${student.firstName} ${student.lastName}`.toLowerCase().includes(searchTerm));

    if (!students.length) {
        container.innerHTML = `<p>${searchTerm ? "No matching students found." : "No students are enrolled in your subject."}</p>`;
        return;
    }

    container.innerHTML = students.map(student => `
        <div class="student-card admin-card">
            <div class="teacher-student-content">
                <strong>ID:</strong> ${escapeHtml(student.id)}<br>
                <strong>Name:</strong> ${escapeHtml(student.firstName)} ${escapeHtml(student.lastName)}<br>
                <strong>Course:</strong> ${escapeHtml(student.course || "Not assigned")}<br>
                ${student.semesterRecords.map(record => record.subjects.map(subject => `
                    <form class="teacher-grade-form" onsubmit="saveTeacherGrade(event, ${Number(student.id)}, '${escapeHtml(record.semester)}', '${escapeHtml(subject.name)}')">
                        <strong>${escapeHtml(record.semester)} - ${escapeHtml(subject.name)}</strong>
                        <input type="text" name="grade" value="${escapeHtml(subject.grade ?? "")}" placeholder="Grade" ${subject.locked ? "disabled" : "required"}>
                        ${subject.locked ? "<span class=\"note\">Locked by admin</span>" : "<button class=\"small-button\" type=\"submit\">Save grade</button>"}
                    </form>
                `).join("")) .join("")}
            </div>
        </div>
    `).join("");
}

function handleTeacherSearch(event) {
    renderTeacherStudents(event.target.value);
}

async function saveTeacherGrade(event, studentId, semesterName, subjectName) {
    event.preventDefault();
    const grade = event.target.elements.grade.value.trim();
    try {
        const response = await fetch(`${API_BASE}/api/teachers/${currentUser.id}/students/${studentId}/grade`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUser.token}` },
            body: JSON.stringify({ semesterName, subjectName, grade })
        });
        const result = await parseJsonResponse(response);
        if (!response.ok) throw new Error(result.error || "Unable to save grade.");
        showMessage(`Grade saved.${emailNotificationMessage(result.emailStatus)}`, "success");
        await showTeacherDashboard();
    } catch (error) {
        showMessage(error.message, "error");
    }
}

function logout() {
    saveCurrentUser(null);
    currentUser = null;
    state.role = null;
    hideAllViews();
    const studentSection = document.getElementById("studentSection");
    const adminSection = document.getElementById("adminSection");
    const teacherSection = document.getElementById("teacherSection");
    if (studentSection) studentSection.classList.add("hidden");
    if (adminSection) adminSection.classList.add("hidden");
    if (teacherSection) teacherSection.classList.add("hidden");
    clearFormInputs();
    showMessage("You have logged out.", "info");
}

function clearFormInputs() {
    ["registerFirstName", "registerLastName", "registerEmail", "registerPassword", "registerPostalCode", "registerCity", "registerProvince", "registerBirthday", "registerAge", "registerSex", "registerYearLevel", "registerStudentIdNumber", "registerCourse", "registerSemester",
    "registerSubject1","registerSubject2","registerSubject3","registerSubject4","registerSubject5","registerSubject6","registerSubject7","registerSubject8","registerSubject9",
    "loginEmail", "loginPassword",
    "profileFirstName", "profileLastName", "profileEmail", "profilePassword", "profilePostalCode", "profileCity", "profileProvince", "profileBirthday", "profileAge", "profileSex", "profileYearLevel", "profileStudentIdNumber", "profileCourse", "profileSemester",
    "profileSubject1","profileSubject2","profileSubject3","profileSubject4","profileSubject5","profileSubject6","profileSubject7","profileSubject8","profileSubject9",
    "adminUsername", "adminPassword", "teacherUsername", "teacherPassword", "newTeacherUsername", "newTeacherPassword", "newTeacherSubject", "editTeacherId", "editTeacherUsername", "editTeacherPassword", "editTeacherSubjects",
    "editFirstName", "editLastName", "editEmail", "editPassword", "editGwa", "editPostalCode", "editCity", "editProvince", "editBirthday", "editAge", "editSex", "editYearLevel", "editStudentIdNumber", "editCourse", "editSemester",
    "editSubject1","editSubject2","editSubject3","editSubject4","editSubject5","editSubject6","editSubject7","editSubject8","editSubject9",
    "editGrade1","editGrade2","editGrade3","editGrade4","editGrade5","editGrade6","editGrade7","editGrade8","editGrade9",
    "editLock1","editLock2","editLock3","editLock4","editLock5","editLock6","editLock7","editLock8","editLock9"].forEach(id => {
        const field = document.getElementById(id);
        if (field) {
            field.value = "";
            field.checked = false;
            field.disabled = false;
        }
    });
}

function showMessage(text, type = "info") {
    const message = document.getElementById("message");
    message.textContent = text;
    message.className = `message ${type}`;
    message.classList.remove("hidden");
}

function clearMessage() {
    const message = document.getElementById("message");
    message.textContent = "";
    message.className = "message hidden";
}

window.addEventListener("load", init);
