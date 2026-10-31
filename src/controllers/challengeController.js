const { describeArena, FINAL_WAVE } = require('../services/arenaRules');
const { ChallengeError } = require('../services/challengeService');

// Translates HTTP requests into ChallengeService calls. Validation of the
// request shape happens here; game rules live in the service.
function parseWave(value) {
  const wave = Number(value);
  if (!Number.isInteger(wave) || wave < 1 || wave > FINAL_WAVE) {
    throw new ChallengeError(`wave must be an integer from 1 to ${FINAL_WAVE}`, 400);
  }
  return wave;
}

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
    if (!/^\d{1,3}$/.test(answer)) throw new ChallengeError('answer must be a whole number from 0 to 999', 400);
    answer = Number(answer);
  }
  return { questionIndex, answer };
}

const requester = (req) => (req.session && req.session.userId) || null;

// `scores` (optional) links arenas to a logged-in player's game and records
// results in MySQL. Without it (or for guests) arenas still work.
function createChallengeController(service, { scores, logger = console } = {}) {
  return {
    rules(req, res) {
      res.json({ success: true, data: describeArena(parseWave(req.query.wave)) });
    },

    async create(req, res) {
      const body = req.body || {};
      const userId = requester(req);
      let gameSessionId = null;
      // Only the owner of an unfinished game can attach an arena to it.
      if (userId && scores && body.gameSessionId !== undefined && body.gameSessionId !== null) {
        gameSessionId = (await scores.ownedOpenSession(userId, body.gameSessionId)).id;
      }
      const arena = service.createArena({ wave: parseWave(body.wave), difficulty: body.difficulty, userId, gameSessionId });
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
            userId: arena.userId, gameSessionId: arena.gameSessionId, wave: reward.wave,
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
