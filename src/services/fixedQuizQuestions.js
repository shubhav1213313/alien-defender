// LOCAL FIXED quiz questions for the compulsory quizzes after waves 1-3.
// These are NOT Banana API puzzles: they are the same, in the same order,
// every game. They live only on the server - the browser receives the
// question text, never the solution, until an answer has been submitted.
// Wave 4 (and the bonus / special puzzles) still use the live Banana API.
const FIXED_WAVE_QUESTIONS = Object.freeze({
  1: Object.freeze([
    Object.freeze({ text: '3 + 2 = ?', solution: 5 }),
    Object.freeze({ text: '7 - 3 = ?', solution: 4 }),
  ]),
  2: Object.freeze([
    Object.freeze({ text: '4 × 2 = ?', solution: 8 }),
    Object.freeze({ text: '9 - 3 = ?', solution: 6 }),
  ]),
  3: Object.freeze([
    Object.freeze({ text: '3 × 3 = ?', solution: 9 }),
    Object.freeze({ text: '8 - 6 = ?', solution: 2 }),
  ]),
});

const FIXED_SOURCE = 'local-fixed';

// The fixed questions for a challenge, or null when it uses the Banana API.
function fixedQuestionsFor(kind, wave) {
  return kind === 'wave' && Object.prototype.hasOwnProperty.call(FIXED_WAVE_QUESTIONS, wave) ? FIXED_WAVE_QUESTIONS[wave] : null;
}

module.exports = { FIXED_WAVE_QUESTIONS, FIXED_SOURCE, fixedQuestionsFor };
