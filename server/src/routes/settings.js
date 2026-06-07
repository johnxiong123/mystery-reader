import { badRequest } from '../errors.js';

export async function registerSettingsRoutes(app, { settingsStore }) {
  app.get('/api/settings/ai', async () => settingsStore.getPublicAiSettings());

  app.put('/api/settings/ai', async (request) => {
    try {
      return settingsStore.saveAiSettings(request.body || {});
    } catch (error) {
      throw badRequest(error.message);
    }
  });
}
