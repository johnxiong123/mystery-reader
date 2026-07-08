import { createApiDataSource } from "./ApiDataSource.js";
import { createPackDataSource } from "./PackDataSource.js";

export const api = import.meta.env.VITE_DATA_MODE === "pack"
  ? createPackDataSource()
  : createApiDataSource();
