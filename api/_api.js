// Shared API instance for the Vercel Functions in this folder.
// Files starting with "_" are not exposed as routes by Vercel.
import { createApi } from '../lib/api.js';

export const api = createApi();
