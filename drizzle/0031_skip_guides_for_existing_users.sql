-- Mark every guide as seen for accounts that already exist when this deploys, so the tours do not
-- start by themselves for long-time users. New accounts still get the welcome/course tours; anyone
-- can replay a guide from Settings.
INSERT INTO "user_guide_seen" ("user_id", "guide_id", "seen_at")
SELECT u."id", g."guide_id", now()
FROM "user" u
CROSS JOIN (
  VALUES
    ('lecturer', 'lecturerWelcome'),
    ('lecturer', 'classAndCourse'),
    ('lecturer', 'attendance'),
    ('lecturer', 'ca'),
    ('lecturer', 'tests'),
    ('lecturer', 'assignments'),
    ('lecturer', 'lecturerCourse'),
    ('student', 'studentWelcome'),
    ('student', 'joinClass'),
    ('student', 'checkIn'),
    ('student', 'takeTest'),
    ('student', 'studentCourse')
) AS g("role", "guide_id")
WHERE u."role" = g."role"
ON CONFLICT ("user_id", "guide_id") DO NOTHING;
