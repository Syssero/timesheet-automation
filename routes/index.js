//import {ticketSummary} from './public/javascripts/ticket-summary/tickets.js'
const tickets = require('../public/javascripts/ticket-summary/tickets.js');
//const tickets = require('../public/typescripts/ticket-summary/tickets.ts');

var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  //res.render('index', { title: 'Hi, there!' });
  res.send('Welcome!')
});

router.get('/api/v1/ticket-summary', async function(req, res, next) {
  //res.render('index', { title: 'Express' });
  const resp = await tickets(req, res);
  return resp;
});

module.exports = router;
