const { contextBridge, ipcRenderer: r } = require('electron');
contextBridge.exposeInMainWorld('api', {
  get: () => r.invoke('get'),
  set: p => r.invoke('set', p),
  setOv: (id, p) => r.invoke('setOv', id, p),
  addOv: () => r.invoke('addOv'),
  delOv: id => r.invoke('delOv', id),
  act: a => r.invoke('act', a),
  size: (w, h) => r.send('size', { w, h }),
  on: (c, f) => r.on(c, (e, d) => f(d))
});
