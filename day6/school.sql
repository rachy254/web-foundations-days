PRAGMA foreign_keys = ON;

CREATE TABLE students (
    student_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
    course_id INTEGER PRIMARY KEY,
    course_name TEXT NOT NULL UNIQUE,
    instructor TEXT NOT NULL
);

CREATE TABLE enrolments (
    enrolment_id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    grade REAL CHECK (grade IS NULL OR (grade >= 0 AND grade <= 100)),
    FOREIGN KEY (student_id) REFERENCES students(student_id),
    FOREIGN KEY (course_id) REFERENCES courses(course_id),
    UNIQUE (student_id, course_id)
);

CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);

INSERT INTO students (student_id, name, email) VALUES
    (1, 'Amina Hassan', 'amina.hassan@example.edu'),
    (2, 'Brian Otieno', 'brian.otieno@example.edu'),
    (3, 'Chao Mwangi', 'chao.mwangi@example.edu'),
    (4, 'Diana Wanjiku', 'diana.wanjiku@example.edu');

INSERT INTO courses (course_id, course_name, instructor) VALUES
    (1, 'Introduction to SQL', 'Mr. Kamau'),
    (2, 'Web Development', 'Ms. Njeri'),
    (3, 'Data Analysis', 'Dr. Otieno');

INSERT INTO enrolments (student_id, course_id, grade) VALUES
    (1, 1, 88),
    (1, 2, 91),
    (2, 1, 76),
    (2, 3, 84),
    (3, 2, 95);

-- List all courses and grades for one student.
SELECT c.course_name, e.grade
FROM students AS s
JOIN enrolments AS e ON e.student_id = s.student_id
JOIN courses AS c ON c.course_id = e.course_id
WHERE s.name = 'Amina Hassan'
ORDER BY c.course_name;

-- List all students enrolled on one course.
SELECT s.name, s.email, e.grade
FROM courses AS c
JOIN enrolments AS e ON e.course_id = c.course_id
JOIN students AS s ON s.student_id = e.student_id
WHERE c.course_name = 'Introduction to SQL'
ORDER BY s.name;

-- Count students per course, including courses with no enrolments.
SELECT c.course_name, COUNT(e.student_id) AS student_count
FROM courses AS c
LEFT JOIN enrolments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.course_name
ORDER BY c.course_name;

-- Find students who have no enrolments.
SELECT s.student_id, s.name, s.email
FROM students AS s
LEFT JOIN enrolments AS e ON e.student_id = s.student_id
WHERE e.enrolment_id IS NULL
ORDER BY s.name;

-- Update one student's grade on one course.
UPDATE enrolments
SET grade = 92
WHERE student_id = 1 AND course_id = 1;
