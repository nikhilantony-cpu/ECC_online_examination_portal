const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATABASE_FILE = process.env.DATABASE_PATH || path.join(ROOT, 'quizora.sqlite');
const db = new DatabaseSync(DATABASE_FILE);
const defaultQuestions = [
    { subject: 'Web foundations', text: 'Which language is used to structure a webpage?', options: ['HTML', 'CSS', 'JavaScript', 'Python'], correct: 0 },
    { subject: 'Web foundations', text: 'Which technology is used for styling webpages?', options: ['HTML', 'CSS', 'SQL', 'PHP'], correct: 1 },
    { subject: 'Web foundations', text: 'Which library is commonly used for JavaScript DOM manipulation?', options: ['jQuery', 'Django', 'Laravel', 'Rails'], correct: 0 },
    { subject: 'Web foundations', text: 'Which Bootstrap class creates a primary blue button?', options: ['btn-success', 'btn-primary', 'button-blue', 'primary-btn'], correct: 1 },
    { subject: 'Web foundations', text: 'Which CSS property controls whether an element is visible?', options: ['position', 'display', 'visibility', 'opacity'], correct: 2 }
];

db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        register_no TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE,
        password_hash TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY,
        teacher_id INTEGER,
        subject TEXT NOT NULL,
        prompt TEXT NOT NULL,
        options_json TEXT NOT NULL,
        correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        score INTEGER NOT NULL CHECK (score >= 0),
        total INTEGER NOT NULL CHECK (total > 0),
        correct INTEGER NOT NULL CHECK (correct >= 0),
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject);
    CREATE INDEX IF NOT EXISTS idx_attempts_student_date ON attempts(student_id, submitted_at DESC);
`);

try {
    db.exec('ALTER TABLE students ADD COLUMN password_hash TEXT');
} catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
}

if (db.prepare('SELECT COUNT(*) AS count FROM questions').get().count === 0) {
    const insertQuestion = db.prepare('INSERT INTO questions (subject, prompt, options_json, correct_index) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
        defaultQuestions.forEach((question) => insertQuestion.run(question.subject, question.text, JSON.stringify(question.options), question.correct));
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

db.prepare('INSERT OR IGNORE INTO teachers (name, email, password_hash) VALUES (?, ?, ?)').run('Demo Teacher', 'demo@quizora.local', hashPassword('teacher123'));
db.prepare('INSERT OR IGNORE INTO students (name, register_no, email, password_hash) VALUES (?, ?, ?, ?)').run('Demo Student', 'STU-001', 'student@quizora.local', hashPassword('student123'));

function questionRows() {
    return db.prepare('SELECT id, subject, prompt, options_json, correct_index FROM questions ORDER BY id').all().map((question) => ({
        id: question.id,
        subject: question.subject,
        text: question.prompt,
        options: JSON.parse(question.options_json),
        correct: question.correct_index
    }));
}

function studentRows() {
    return db.prepare(`
        SELECT s.name, s.register_no, s.email, a.subject, a.score, a.total, a.correct
        FROM students s
        LEFT JOIN attempts a ON a.id = (
            SELECT latest.id FROM attempts latest
            WHERE latest.student_id = s.id
            ORDER BY latest.submitted_at DESC, latest.id DESC
            LIMIT 1
        )
        ORDER BY s.name COLLATE NOCASE
    `).all().map((student) => {
        const hasAttempt = student.subject !== null;
        const result = hasAttempt ? {
            score: student.score,
            total: student.total,
            correct: student.correct,
            subject: student.subject,
            name: student.name,
            registerNo: student.register_no
        } : null;
        return { name: student.name, registerNo: student.register_no, email: student.email, status: hasAttempt ? 'completed' : 'unattended', result };
    });
}

function getState() {
    return { questions: questionRows(), students: studentRows() };
}

function sendJson(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1000000) request.destroy();
        });
        request.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
        });
        request.on('error', reject);
    });
}

function serveFile(request, response) {
    const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    try {
        if (url.pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { ok: true, database: 'sqlite' });
        if (url.pathname === '/api/state' && request.method === 'GET') return sendJson(response, 200, getState());

        if (url.pathname === '/api/teachers' && request.method === 'POST') {
            const body = await readBody(request);
            if (!body.name || !body.email || !body.password) return sendJson(response, 400, { error: 'Name, email, and password are required.' });
            const passwordHash = hashPassword(body.password);
            db.prepare(`INSERT INTO teachers (name, email, password_hash) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash`).run(body.name.trim(), body.email.trim(), passwordHash);
            return sendJson(response, 200, { name: body.name.trim(), email: body.email.trim() });
        }

        if (url.pathname === '/api/students' && request.method === 'POST') {
            const body = await readBody(request);
            if (!body.name || !body.registerNo || !body.email) return sendJson(response, 400, { error: 'Name, register number, and email are required.' });
            const passwordHash = body.password ? hashPassword(body.password) : null;
            db.prepare(`INSERT INTO students (name, register_no, email, password_hash) VALUES (?, ?, ?, ?) ON CONFLICT(register_no) DO UPDATE SET name = excluded.name, email = excluded.email, password_hash = COALESCE(excluded.password_hash, students.password_hash)`).run(body.name.trim(), body.registerNo.trim(), body.email.trim(), passwordHash);
            return sendJson(response, 200, studentRows());
        }

        if (url.pathname === '/api/questions' && request.method === 'POST') {
            const body = await readBody(request);
            const questions = Array.isArray(body.questions) ? body.questions : [body];
            const isValid = questions.length > 0 && questions.every((question) => question.subject && question.text && Array.isArray(question.options) && question.options.length === 4 && question.options.every(Boolean) && Number.isInteger(Number(question.correct)) && Number(question.correct) >= 0 && Number(question.correct) <= 3);
            if (!isValid) return sendJson(response, 400, { error: 'Each question needs a subject, prompt, four options, and a valid correct answer.' });
            const insertQuestion = db.prepare('INSERT INTO questions (subject, prompt, options_json, correct_index) VALUES (?, ?, ?, ?)');
            db.exec('BEGIN');
            try {
                questions.forEach((question) => insertQuestion.run(question.subject.trim(), question.text.trim(), JSON.stringify(question.options.map((option) => option.trim())), Number(question.correct)));
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
            return sendJson(response, 201, questionRows());
        }

        if (url.pathname === '/api/attempts' && request.method === 'POST') {
            const body = await readBody(request);
            if (!body.registerNo || !body.result || !body.result.subject || !Number.isFinite(Number(body.result.score)) || !Number.isFinite(Number(body.result.total))) return sendJson(response, 400, { error: 'Student and a valid result are required.' });
            const student = db.prepare('SELECT id, name, register_no, email FROM students WHERE register_no = ? COLLATE NOCASE').get(String(body.registerNo).trim());
            if (!student) return sendJson(response, 404, { error: 'Student is not registered.' });
            db.prepare('INSERT INTO attempts (student_id, subject, score, total, correct) VALUES (?, ?, ?, ?, ?)').run(student.id, body.result.subject, Number(body.result.score), Number(body.result.total), Number(body.result.correct) || 0);
            const latest = studentRows().find((entry) => entry.registerNo.toLowerCase() === student.register_no.toLowerCase());
            return sendJson(response, 200, latest);
        }

        if (request.method === 'GET') return serveFile(request, response);
        return sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
        console.error(error);
        return sendJson(response, 500, { error: 'The server could not complete that request.' });
    }
});

server.listen(PORT, () => console.log(`Quizora is running at http://localhost:${PORT}`));
