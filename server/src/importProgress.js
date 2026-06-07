import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishImportProgress(bookId, payload) {
  emitter.emit(String(bookId), payload);
}

export function subscribeImportProgress(bookId, listener) {
  const key = String(bookId);
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
}
