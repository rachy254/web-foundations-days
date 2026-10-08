# School Database Design

## Tables

- **`students`** stores each student's name and email address. The email is required and unique, and `student_id` is the primary key.
- **`courses`** stores each course name and instructor. Course names are required and unique, and `course_id` is the primary key.
- **`enrolments`** records a student's enrolment in a course and the student's optional grade. Its primary key identifies each enrolment, and its foreign keys reference `students` and `courses`. A unique constraint on `(student_id, course_id)` prevents a student being enrolled in the same course twice. Grades may be `NULL` until assigned and, when present, must be between 0 and 100.

## Relationships

One student can have many enrolments, and one course can have many enrolments; each enrolment belongs to exactly one student and one course. This means students and courses have a many-to-many relationship: a student can take several courses, and a course can have several students. The `enrolments` join table represents that relationship and stores data that belongs to the relationship itself, such as the grade.

## Index

The SQL script creates an index on `enrolments(course_id)`. It helps the database find students enrolled in a particular course and supports course-based aggregation without scanning every enrolment. The unique constraint on `(student_id, course_id)` already creates an index useful for student-based lookups.

## SQL or NoSQL?

I would choose a relational SQL database for this system. Students, courses, and enrolments have clear relationships, and foreign keys and uniqueness constraints protect those relationships and prevent invalid or duplicate enrolments. SQL joins and aggregate queries also make the required course rosters and enrolment counts straightforward. A document database could store this data, but keeping course and student data consistent across many-to-many relationships would require extra application-side work.
