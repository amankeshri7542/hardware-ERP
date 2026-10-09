const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const actor = require('../../middleware/requireFinancialActor');
const send = (res, data) => res.json({ success: true, data });

for (const domain of ['customer', 'supplier']) {
  router.post(`/${domain}/quote`, asyncHandler(async (req, res) => {
    send(res, await require(`./${domain}`).quote(req.body, req.user.id));
  }));
  router.post(`/${domain}/commands`, actor, asyncHandler(async (req, res) => {
    const result = await require(`./${domain}`).execute(req.body, req.user.id, req.get('Idempotency-Key'));
    res.status(result.status).json(result.body);
  }));
  router.get(`/${domain}s/:id`, asyncHandler(async (req, res) => {
    send(res, await require(`./${domain}`).getAccount(req.params.id, req.query));
  }));
  for (const path of [`/statements/${domain}/:id`, `/${domain}s/:id/statement`]) {
    router.get(path, asyncHandler(async (req, res) => {
      send(res, await require('./reporting')[`${domain}Statement`](req.params.id, req.query));
    }));
  }
}
router.get('/anonymous', asyncHandler(async (req, res) => send(res, await require('./customer').listAnonymous(req.query))));
for (const path of ['/reports', '/summary']) router.get(path, asyncHandler(async (req, res) => send(res, await require('./reporting').summary(req.query))));
router.get('/export.csv', asyncHandler(async (req, res) => {
  const file = await require('./reporting').exportRows(req.query);
  res.set('Content-Type', file.content_type);
  res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.content);
}));
router.get('/days', asyncHandler(async (req, res) => send(res, await require('./dayClose').getDay(req.query))));
router.post('/days/quote', asyncHandler(async (req, res) => send(res, await require('./dayClose').quote(req.body))));
for (const kind of ['open','close']) router.post(`/days/${kind}`, actor, asyncHandler(async (req,res) => {
  const result = await require('./dayClose')[kind](req.body,req.user.id,req.get('Idempotency-Key'));
  res.status(result.status).json(result.body);
}));
module.exports = router;
