-- Two-puzzle quiz redesign (2026-10-31)
-- Quiz attempts now record WHICH kind of challenge they were:
--   wave    - compulsory 2-puzzle quiz after waves 1-4
--   bonus   - 2-puzzle Victory Bonus Challenge after the boss
--   special - optional 1-puzzle VOID STORM challenge during combat
-- Existing rows (all from the old 4-puzzle arena) are post-wave or
-- post-boss quizzes; wave 5 rows were the post-boss bonus.
ALTER TABLE quiz_attempts
  ADD COLUMN kind ENUM('wave', 'bonus', 'special') NOT NULL DEFAULT 'wave' AFTER game_session_id;

UPDATE quiz_attempts SET kind = 'bonus' WHERE wave = 5;

UPDATE achievements SET description = 'Solve both puzzles in a Knowledge Challenge.'
  WHERE id = 'perfect_quiz';
UPDATE achievements SET description = 'Solve both Victory Bonus puzzles after defeating the Mothership on Hard.'
  WHERE id = 'legendary_defender';

INSERT INTO achievements (id, name, description, icon, sort_order) VALUES
  ('storm_caller', 'Storm Caller', 'Unlock VOID STORM by solving a special puzzle.', '⚡', 11);
