'use strict';
const t = require('./drchrono-tokens.json');
fetch('https://drchrono.com/api/patients?page_size=1', {
  headers: { Authorization: 'Bearer ' + t.access_token }
}).then(r => r.json()).then(d => console.log(JSON.stringify(d.results?.[0], null, 2)));
