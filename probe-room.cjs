'use strict';
const ROOM_ID = '!tpWhVGBaiMGLYXfzji:chat.procare-solutions.net';

(async () => {
  const login = await fetch('https://chat.procare-solutions.net/_matrix/client/v3/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({type:'m.login.password', user:'admin', password:'Matrix2026!JA'})
  }).then(r => r.json());
  const token = login.access_token;

  const room = await fetch(`https://chat.procare-solutions.net/_synapse/admin/v1/rooms/${ROOM_ID}`, {
    headers: {Authorization: `Bearer ${token}`}
  }).then(r => r.json());
  console.log('Room info:', JSON.stringify(room, null, 2));

  const state = await fetch(`https://chat.procare-solutions.net/_synapse/admin/v1/rooms/${ROOM_ID}/state`, {
    headers: {Authorization: `Bearer ${token}`}
  }).then(r => r.json());
  const creation = (state.state || []).find(e => e.type === 'm.room.create');
  const name = (state.state || []).find(e => e.type === 'm.room.name');
  console.log('Created by:', creation?.sender);
  console.log('Created at:', creation ? new Date(creation.origin_server_ts).toISOString() : 'unknown');
  console.log('Room name:', name?.content?.name || '(none)');
})().catch(e => console.error(e.message));
