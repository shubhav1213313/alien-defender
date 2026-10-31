// Which achievements a finished game earns. Pure function, so every rule is
// easy to unit test. Quiz-based achievements use quiz_attempts recorded by
// the server, not numbers sent by the browser.
//
//   result - this game's validated result
//   totals - lifetime stats INCLUDING this game (GameRepository.userStats)
//   quiz   - lifetime arena totals (QuizAttemptRepository.userTotals)
const RULES = {
  first_blood: ({ result }) => result.enemiesDestroyed >= 1,
  alien_hunter: ({ totals }) => totals.enemiesDestroyed >= 250,
  wave_survivor: ({ result }) => result.wavesCleared >= 5,
  boss_slayer: ({ result }) => result.bossDefeated,
  first_victory: ({ result }) => result.outcome === 'victory',
  combo_master: ({ result }) => result.maxCombo >= 25,
  perfect_quiz: ({ quiz }) => quiz.perfectCount >= 1,
  knowledge_master: ({ quiz }) => quiz.correct >= 50,
  hard_victory: ({ result, difficulty }) => result.outcome === 'victory' && difficulty === 'hard',
  legendary_defender: ({ quiz }) => quiz.legendaryCount >= 1,
};

function earnedAchievements(context) {
  return Object.keys(RULES).filter((id) => RULES[id](context));
}

module.exports = { earnedAchievements, ACHIEVEMENT_IDS: Object.keys(RULES) };
