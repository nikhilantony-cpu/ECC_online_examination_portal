const defaultQuestions = [
    { id: 1, subject: 'Web foundations', text: 'Which language is used to structure a webpage?', options: ['HTML', 'CSS', 'JavaScript', 'Python'], correct: 0 },
    { id: 2, subject: 'Web foundations', text: 'Which technology is used for styling webpages?', options: ['HTML', 'CSS', 'SQL', 'PHP'], correct: 1 },
    { id: 3, subject: 'Web foundations', text: 'Which library is commonly used for JavaScript DOM manipulation?', options: ['jQuery', 'Django', 'Laravel', 'Rails'], correct: 0 },
    { id: 4, subject: 'Web foundations', text: 'Which Bootstrap class creates a primary blue button?', options: ['btn-success', 'btn-primary', 'button-blue', 'primary-btn'], correct: 1 },
    { id: 5, subject: 'Web foundations', text: 'Which CSS property controls whether an element is visible?', options: ['position', 'display', 'visibility', 'opacity'], correct: 2 }
];

const getQuestions = () => JSON.parse(localStorage.getItem('quizoraQuestions')) || defaultQuestions;
const saveQuestions = (questions) => localStorage.setItem('quizoraQuestions', JSON.stringify(questions));
const getStudents = () => JSON.parse(localStorage.getItem('quizoraStudents')) || [];
const saveStudents = (students) => localStorage.setItem('quizoraStudents', JSON.stringify(students));
const apiRequest = async (endpoint, options = {}) => {
    if (window.location.protocol === 'file:') return null;
    try {
        const response = await fetch(endpoint, { headers: { 'Content-Type': 'application/json' }, ...options, body: options.body ? JSON.stringify(options.body) : undefined });
        if (!response.ok) return null;
        return response.json();
    } catch {
        return null;
    }
};
const syncSharedState = async () => {
    const state = await apiRequest('/api/state');
    if (!state) return;
    localStorage.setItem('quizoraQuestions', JSON.stringify(state.questions));
    localStorage.setItem('quizoraStudents', JSON.stringify(state.students));
};
const initials = (name) => name ? name.trim().split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : 'Q';
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setupLoginForms() {
    const studentForm = document.getElementById('studentLoginForm');
    if (studentForm) {
        studentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = document.getElementById('studentName').value.trim();
            const registerNo = document.getElementById('registerNo').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('studentPassword').value;
            if (!name || !registerNo || !email || !password) return;
            const student = { name, registerNo, email };
            const students = getStudents();
            const existingStudent = students.find((entry) => entry.registerNo.toLowerCase() === registerNo.toLowerCase());
            if (existingStudent) {
                Object.assign(existingStudent, student);
            } else {
                students.push({ ...student, status: 'unattended', result: null });
            }
            saveStudents(students);
            const sharedStudents = await apiRequest('/api/students', { method: 'POST', body: { ...student, password } });
            if (sharedStudents) saveStudents(sharedStudents);
            localStorage.setItem('quizoraStudent', JSON.stringify(student));
            window.location.href = 'student-dashboard.html';
        });
    }

    const teacherForm = document.getElementById('teacherLoginForm');
    if (teacherForm) {
        teacherForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = document.getElementById('teacherName').value.trim();
            const email = document.getElementById('teacherEmail').value.trim();
            const password = document.getElementById('teacherPassword').value;
            if (!name || !email || !password) return;
            await apiRequest('/api/teachers', { method: 'POST', body: { name, email, password } });
            localStorage.setItem('quizoraTeacher', JSON.stringify({ name, email }));
            window.location.href = 'teacher-dashboard.html';
        });
    }
}

function setupStudentDashboard() {
    const list = document.getElementById('examList');
    if (!list) return;
    const student = JSON.parse(localStorage.getItem('quizoraStudent')) || { name: 'Student' };
    const questions = getQuestions();
    const subjects = [...new Set(questions.map((question) => question.subject))];
    setText('studentGreeting', student.name.split(' ')[0]);
    setText('studentHeaderName', student.name);
    setText('studentAvatar', initials(student.name));
    setText('availableCount', subjects.length);
    setText('answeredCount', localStorage.getItem('quizoraAnswered') || '0');
    const lastScore = JSON.parse(localStorage.getItem('quizoraResult') || 'null');
    setText('latestScore', lastScore ? `${lastScore.score}/${lastScore.total}` : '--');
    list.innerHTML = subjects.map((subject, index) => {
        const count = questions.filter((question) => question.subject === subject).length;
        return `<article class="exam-card"><span class="subject-icon">${escapeHtml(subject.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHtml(subject)} practice set</h3><p>${count} questions · 2 marks each · No time pressure</p></div><button class="primary-button start-exam" data-subject="${escapeHtml(subject)}">Start exam <span>→</span></button></article>`;
    }).join('');
    list.querySelectorAll('.start-exam').forEach((button) => button.addEventListener('click', () => {
        localStorage.setItem('quizoraActiveSubject', button.dataset.subject);
        window.location.href = 'exam.html';
    }));
}

function setupTeacherDashboard() {
    const form = document.getElementById('questionForm');
    if (!form) return;
    const teacher = JSON.parse(localStorage.getItem('quizoraTeacher')) || { name: 'Teacher' };
    setText('teacherHeaderName', teacher.name);
    setText('teacherAvatar', initials(teacher.name));
    const questionBlocks = document.getElementById('questionBlocks');
    const questionTemplate = (number) => `<article class="question-entry"><div class="question-entry-heading"><span class="question-number">Question ${number}</span>${number > 1 ? '<button class="remove-question-button" type="button">Remove</button>' : ''}</div><label>Question prompt<textarea data-field="text" rows="3" placeholder="Write a clear question..." required></textarea></label><div class="option-grid"><label>Option A<input data-field="option" type="text" placeholder="First answer" required></label><label>Option B<input data-field="option" type="text" placeholder="Second answer" required></label><label>Option C<input data-field="option" type="text" placeholder="Third answer" required></label><label>Option D<input data-field="option" type="text" placeholder="Fourth answer" required></label></div><label>Correct answer<select data-field="correct" required><option value="">Select the correct option</option><option value="0">Option A</option><option value="1">Option B</option><option value="2">Option C</option><option value="3">Option D</option></select></label></article>`;
    const addQuestionBlock = () => { questionBlocks.insertAdjacentHTML('beforeend', questionTemplate(questionBlocks.children.length + 1)); };
    addQuestionBlock();
    document.getElementById('addQuestionButton').addEventListener('click', addQuestionBlock);
    questionBlocks.addEventListener('click', (event) => { if (event.target.classList.contains('remove-question-button')) { event.target.closest('.question-entry').remove(); [...questionBlocks.children].forEach((entry, index) => { entry.querySelector('.question-number').textContent = `Question ${index + 1}`; }); } });
    const renderBank = () => {
        const questions = getQuestions();
        const customQuestions = JSON.parse(localStorage.getItem('quizoraQuestions')) || [];
        setText('questionBankCount', questions.length);
        setText('subjectCount', new Set(questions.map((question) => question.subject)).size);
        const list = document.getElementById('teacherQuestionList');
        list.innerHTML = questions.slice().reverse().slice(0, 7).map((question) => `<article class="teacher-question"><span class="question-meta">${escapeHtml(question.subject)}</span><p>${escapeHtml(question.text)}</p></article>`).join('');
        if (!customQuestions.length) list.insertAdjacentHTML('afterbegin', '<p class="form-footnote">Your new questions will appear here.</p>');
    };
    const renderRoster = () => {
        const students = getStudents();
        const completed = students.filter((student) => student.status === 'completed');
        const roster = document.getElementById('studentRoster');
        setText('registeredStudentCount', students.length);
        setText('completedStudentCount', completed.length);
        setText('unattendedStudentCount', students.length - completed.length);
        document.getElementById('emptyRoster').style.display = students.length ? 'none' : 'block';
        roster.innerHTML = students.map((student) => {
            const result = student.result;
            const status = student.status === 'completed' ? '<span class="status-pill completed-pill">Completed</span>' : '<span class="status-pill unattended-pill">Unattended</span>';
            return `<tr><td><div class="roster-student"><span class="avatar">${escapeHtml(initials(student.name))}</span><span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.email)}</small></span></div></td><td>${escapeHtml(student.registerNo)}</td><td>${result ? escapeHtml(result.subject) : '<span class="muted-cell">Not attempted</span>'}</td><td>${result ? `<strong class="mark-cell">${result.score}/${result.total}</strong>` : '<span class="muted-cell">--</span>'}</td><td>${status}</td></tr>`;
        }).join('');
    };
    renderBank();
    renderRoster();
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const subject = document.getElementById('questionSubject').value.trim();
        const questions = [...questionBlocks.querySelectorAll('.question-entry')].map((entry, index) => ({ id: Date.now() + index, subject, text: entry.querySelector('[data-field="text"]').value.trim(), options: [...entry.querySelectorAll('[data-field="option"]')].map((input) => input.value.trim()), correct: Number(entry.querySelector('[data-field="correct"]').value) }));
        const existingQuestions = getQuestions();
        const sharedQuestions = await apiRequest('/api/questions', { method: 'POST', body: { questions } });
        saveQuestions(sharedQuestions || [...existingQuestions, ...questions]);
        form.reset();
        questionBlocks.innerHTML = '';
        addQuestionBlock();
        setText('formStatus', `${questions.length} question${questions.length === 1 ? '' : 's'} published to the student workspace.`);
        renderBank();
    });
    const focusButton = document.getElementById('focusQuestionForm');
    if (focusButton) focusButton.addEventListener('click', () => document.getElementById('questionSubject').focus());
}

function setupExam() {
    const form = document.getElementById('examForm');
    if (!form) return;
    const activeSubject = localStorage.getItem('quizoraActiveSubject') || getQuestions()[0].subject;
    const questions = getQuestions().filter((question) => question.subject === activeSubject);
    setText('examSubject', activeSubject);
    setText('examTitle', `${activeSubject} practice set`);
    setText('questionCount', questions.length);
    setText('questionProgress', `${questions.length} questions · 2 marks each`);
    form.innerHTML = questions.map((question, index) => `<article class="question-card"><span class="question-number">Question ${index + 1} of ${questions.length}</span><h2>${escapeHtml(question.text)}</h2>${question.options.map((option, optionIndex) => `<label class="answer-option"><input type="radio" name="question-${question.id}" value="${optionIndex}"><span>${escapeHtml(option)}</span></label>`).join('')}</article>`).join('');
    let seconds = 10 * 60;
    const timer = document.getElementById('timer');
    const updateTimer = () => { const minutes = Math.floor(seconds / 60); const remainingSeconds = String(seconds % 60).padStart(2, '0'); timer.textContent = `${minutes}:${remainingSeconds}`; };
    updateTimer();
    const countdown = window.setInterval(() => { seconds -= 1; updateTimer(); if (seconds <= 0) { window.clearInterval(countdown); form.requestSubmit(); } }, 1000);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        window.clearInterval(countdown);
        let correct = 0;
        questions.forEach((question) => { const selected = form.querySelector(`input[name="question-${question.id}"]:checked`); if (selected && Number(selected.value) === question.correct) correct += 1; });
        const student = JSON.parse(localStorage.getItem('quizoraStudent')) || { name: 'Student', registerNo: 'N/A', email: '' };
        const result = { score: correct * 2, total: questions.length * 2, correct, subject: activeSubject, name: student.name, registerNo: student.registerNo };
        const students = getStudents();
        const rosterStudent = students.find((entry) => entry.registerNo.toLowerCase() === student.registerNo.toLowerCase());
        if (rosterStudent) {
            rosterStudent.status = 'completed';
            rosterStudent.result = result;
        } else {
            students.push({ ...student, status: 'completed', result });
        }
        saveStudents(students);
        localStorage.setItem('quizoraResult', JSON.stringify(result));
        const sharedStudent = await apiRequest('/api/attempts', { method: 'POST', body: { registerNo: student.registerNo, result } });
        if (sharedStudent) {
            const sharedStudents = getStudents().map((entry) => entry.registerNo.toLowerCase() === student.registerNo.toLowerCase() ? sharedStudent : entry);
            saveStudents(sharedStudents);
        }
        localStorage.setItem('quizoraAnswered', String(Number(localStorage.getItem('quizoraAnswered') || 0) + questions.length));
        window.location.href = 'result.html';
    });
}

function setupResult() {
    if (!document.getElementById('totalMarks')) return;
    const result = JSON.parse(localStorage.getItem('quizoraResult') || 'null') || { score: 0, total: 0, correct: 0, subject: 'mock examination', name: 'student' };
    const percent = result.total ? Math.round((result.score / result.total) * 100) : 0;
    setText('resultName', result.name.split(' ')[0]);
    setText('resultSubject', result.subject);
    setText('totalMarks', `${result.score} / ${result.total}`);
    setText('scorePercent', `${percent}% correct`);
    setText('resultMessage', percent >= 80 ? 'You are on a great track.' : percent >= 50 ? 'A solid start.' : 'Keep building from here.');
    setText('resultDetail', percent >= 80 ? 'Your understanding is showing. Keep practicing to make it stick.' : 'Review the questions you found tricky, then take another run when you are ready.');
    const bar = document.getElementById('scoreBar');
    if (bar) bar.style.width = `${percent}%`;
}

document.addEventListener('DOMContentLoaded', async () => { await syncSharedState(); setupLoginForms(); setupStudentDashboard(); setupTeacherDashboard(); setupExam(); setupResult(); });
