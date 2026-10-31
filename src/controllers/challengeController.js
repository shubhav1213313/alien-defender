const { describeChallenge, validWave, KINDS } = require('../services/arenaRules');
const { ChallengeError } = require('../services/challengeService');

// Translates HTTP requests into ChallengeService calls. Validation of the
// request shape happens here; game rules live in the service.
function parseKindAndWave(kindValue, waveValue) {
  const kind = kindValue === undefined ? 'wave' : kindValue;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ChallengeError('kind must be wave, bonus or special', 400);
  const wave = Number(waveValue);
  if (!Number.isInteger(wave) || !validWave(kind, wave)) throw new ChallengeError(`wave must be valid for a ${kind} challenge`, 400);
  return { kind, wave };
}

// Answers are single digits 0-9 (the Banana API's solution range); a few
// extra digits are accepted so a wrong answer is marked wrong, not rejected.
function parseAnswer(body) {
  const questionIndex = Number(body.questionIndex);
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    throw new ChallengeError('questionIndex must be a non-negative integer', 400);
  }
  let { answer } = body;
  if (answer === null || answer === undefined || answer === '') {
    answer = null; // treated as "time ran out / no answer"
  } else {
    answer = String(answer).trim();
    if (!/^\d{1,3}$/.test(answer)) throw new ChallengeError('answer must be a whole number from 0 to 9', 400);
    answer = Number(answer);
  }
  return { questionIndex, answer };
}

const requester = (req) => (req.session && req.session.userId) || null;

// `scores` (optional) links challenges to a logged-in player's game and
// records results in MySQL. Without it (or for guests) challenges still work.
function createChallengeController(service, { scores, logger = console } = {}) {
  return {
    rules(req, res) {
      const { kind, wave } = parseKindAndWave(req.query.kind, req.query.wave);
      res.json({ success: true, data: describeChallenge(kind, wave) });
    },

    async create(req, res) {
      const body = req.body || {};
      const { kind, wave } = parseKindAndWave(body.kind, body.wave);
      const userId = requester(req);
      let gameSessionId = null;
      let difficulty = body.difficulty === undefined ? 'normal' : body.difficulty;
      // Only the owner of an unfinished game can attach a challenge to it,
      // and then the SAVED game's difficulty is used, not the browser's.
      if (userId && scores && body.gameSessionId !== undefined && body.gameSessionId !== null) {
        const session = await scores.ownedOpenSession(userId, body.gameSessionId);
        gameSessionId = session.id;
        difficulty = session.difficulty;
      }
      const arena = service.createArena({ kind, wave, difficulty, userId, gameSessionId });
      res.status(201).json({ success: true, data: arena });
    },

    show(req, res) {
      res.json({ success: true, data: service.publicArena(service.getArena(req.params.id, requester(req))) });
    },

    async question(req, res) {
      res.json({ success: true, data: await service.getQuestion(req.params.id, requester(req)) });
    },

    answer(req, res) {
      res.json({ success: true, data: service.submitAnswer(req.params.id, parseAnswer(req.body || {}), requester(req)) });
    },

    hint(req, res) {
      res.json({ success: true, data: service.useHint(req.params.id, requester(req)) });
    },

    async claim(req, res) {
      const reward = service.claimRewards(req.params.id, requester(req));
      const arena = service.getArena(req.params.id, requester(req));
      if (arena.userId && scores) {
        try {
          await scores.recordArena({
            userId: arena.userId, gameSessionId: arena.gameSessionId, kind: reward.kind, wave: reward.wave,
            difficulty: reward.difficulty, correct: reward.correct, total: reward.total,
          });
        } catch (err) {
          // Saving statistics must never cost the player their rewards.
          logger.error('[arena] could not record quiz attempt:', err.message);
        }
      }
      res.json({ success: true, data: reward });
    },
  };
}

module.exports = { createChallengeController, parseAnswer };
