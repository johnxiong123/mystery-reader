import { api as httpApi } from "../api.js";

export function createApiDataSource() {
  return {
    ...httpApi,
    capabilities: { canImport: true, canManageBooks: true, canConfigureAi: true }
  };
}
