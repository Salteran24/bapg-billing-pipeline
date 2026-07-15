'use strict';
const t = require('./drchrono-tokens.json');

// Fetch one recent appointment and print all its fields
fetch('https://drchrono.com/api/appointments?page_size=1&status=Complete', {
  headers: { Authorization: 'Bearer ' + t.access_token }
}).then(r => r.json()).then(d => console.log(JSON.stringify(d.results?.[0], null, 2)));
