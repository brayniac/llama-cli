/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from 'llama-cli-core';
import { loadEnvironment } from './config.js';

export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  
  if (authMethod === AuthType.USE_LLAMACPP_SERVER) {
    if (!process.env.LLAMACPP_BASE_URL) {
      return 'LLAMACPP_BASE_URL environment variable not found. Add that to your .env (e.g., LLAMACPP_BASE_URL=http://10.3.0.0:8080) and try again, no reload needed!';
    }
    return null;
  }

  // Other auth methods are no longer supported
  if (authMethod === AuthType.LOGIN_WITH_GOOGLE_PERSONAL) {
    return 'Google OAuth authentication is no longer supported. Please use llama.cpp server with LLAMACPP_BASE_URL environment variable.';
  }

  if (authMethod === AuthType.LOGIN_WITH_GOOGLE_ENTERPRISE) {
    return 'Google Workspace authentication is no longer supported. Please use llama.cpp server with LLAMACPP_BASE_URL environment variable.';
  }

  if (authMethod === AuthType.USE_GEMINI) {
    return 'Gemini API key authentication is no longer supported. Please use llama.cpp server with LLAMACPP_BASE_URL environment variable.';
  }

  if (authMethod === AuthType.USE_VERTEX_AI) {
    return 'Vertex AI authentication is no longer supported. Please use llama.cpp server with LLAMACPP_BASE_URL environment variable.';
  }

  return 'Invalid auth method selected. Please use llama.cpp server authentication.';
};
