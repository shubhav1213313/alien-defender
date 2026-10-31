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

function createChallengeController(service) {
  return {
    rules(req, res) {
      res.json({ success: true, data: describeArena(parseWave(req.query.wave)) });
    },

    create(req, res) {
      const body = req.body || {};
      const arena = service.createArena({ wave: parseWave(body.wave), difficulty: body.difficulty });
      res.status(201).json({ success: true, data: arena });
    },

    show(req, res) {
      res.json({ success: true, data: service.publicArena(service.getArena(req.params.id)) });
    },

    async question(req, res) {
      res.json({ success: true, data: await service.getQuestion(req.params.id) });
    },

    answer(req, res) {
      res.json({ success: true, data: service.submitAnswer(req.params.id, parseAnswer(req.body || {})) });
    },

    hint(req, res) {
      res.json({ success: true, data: service.useHint(req.params.id) });
    },

    claim(req, res) {
      res.json({ success: true, data: service.claimRewards(req.params.id) });
    },
  };
}

module.exports = { createChallengeController, parseAnswer };
