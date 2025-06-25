/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
// Privacy-first: code_assist (Google OAuth) removed
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { getEffectiveModel } from './modelCheck.js';
import { LlamaCppClient, LlamaCppMessage } from './llamacppClient.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE_PERSONAL = 'oauth-personal',
  LOGIN_WITH_GOOGLE_ENTERPRISE = 'oauth-enterprise',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  USE_LLAMACPP_SERVER = 'llamacpp-server',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  llamacppBaseUrl?: string;
};

export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
  config?: { getModel?: () => string },
): Promise<ContentGeneratorConfig> {
  // If no auth type specified, default to llama.cpp and require base URL
  if (!authType) {
    authType = AuthType.USE_LLAMACPP_SERVER;
  }

  // For llama.cpp, only require the base URL
  if (authType === AuthType.USE_LLAMACPP_SERVER) {
    const llamacppBaseUrl = process.env.LLAMACPP_BASE_URL;
    if (!llamacppBaseUrl) {
      throw new Error('LLAMACPP_BASE_URL environment variable is required for llama.cpp server');
    }

    const effectiveModel = config?.getModel?.() || model || 'auto-detect';
    return {
      model: effectiveModel,
      authType,
      llamacppBaseUrl,
    };
  }

  // For other auth types, throw an error since we're only supporting llama.cpp now
  throw new Error(`Authentication type ${authType} is no longer supported. Please use llama.cpp server with LLAMACPP_BASE_URL environment variable.`);
}

function createLlamaCppContentGenerator(client: LlamaCppClient): ContentGenerator {
  return {
    async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
      // Convert Gemini format to simple chat format
      const messages: LlamaCppMessage[] = [];
      
      // Handle ContentListUnion (can be string, Content[], or Part[])
      const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
      
      for (const content of contents) {
        if (typeof content === 'string') {
          messages.push({ role: 'user', content });
        } else if ('role' in content) {
          // It's a Content object
          const role = content.role === 'model' ? 'assistant' : content.role as 'user' | 'system';
          const text = content.parts?.map((p: any) => p.text || '').join('\n') || '';
          if (text.trim()) {
            messages.push({ role, content: text });
          }
        } else {
          // It's a Part object
          const text = (content as any).text || '';
          if (text.trim()) {
            messages.push({ role: 'user', content: text });
          }
        }
      }

      const response = await client.chatCompletion({
        messages,
        temperature: (request as any).config?.temperature,
        max_tokens: (request as any).config?.maxOutputTokens,
      });

      const geminiResponse = new GenerateContentResponse();
      geminiResponse.candidates = [{
        content: {
          role: 'model',
          parts: [{ text: response.content }]
        },
        finishReason: 'STOP' as any,
        index: 0,
      }];
      geminiResponse.usageMetadata = response.usage ? {
        promptTokenCount: response.usage.prompt_tokens,
        candidatesTokenCount: response.usage.completion_tokens,
        totalTokenCount: response.usage.total_tokens,
      } : undefined;
      
      return geminiResponse;
    },

    generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
      return Promise.resolve((async function* () {
        // Convert Gemini format to simple chat format
        const messages: LlamaCppMessage[] = [];
        
        // Handle ContentListUnion (can be string, Content[], or Part[])
        const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
        
        for (const content of contents) {
          if (typeof content === 'string') {
            messages.push({ role: 'user', content });
          } else if ('role' in content) {
            // It's a Content object
            const role = content.role === 'model' ? 'assistant' : content.role as 'user' | 'system';
            const text = content.parts?.map((p: any) => p.text || '').join('\n') || '';
            if (text.trim()) {
              messages.push({ role, content: text });
            }
          } else {
            // It's a Part object
            const text = (content as any).text || '';
            if (text.trim()) {
              messages.push({ role: 'user', content: text });
            }
          }
        }

        for await (const chunk of client.chatCompletionStream({
          messages,
          temperature: (request as any).config?.temperature,
          max_tokens: (request as any).config?.maxOutputTokens,
        })) {
          const geminiResponse = new GenerateContentResponse();
          geminiResponse.candidates = [{
            content: {
              role: 'model',
              parts: [{ text: chunk }]
            },
            finishReason: undefined,
            index: 0,
          }];
          yield geminiResponse;
        }
      })());
    },

    async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
      // Simple token estimation: ~4 characters per token
      // Handle ContentListUnion (can be string, Content[], or Part[])
      const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
      
      let contentText = '';
      for (const content of contents) {
        if (typeof content === 'string') {
          contentText += content + ' ';
        } else if ('role' in content) {
          // It's a Content object
          const text = content.parts?.map((p: any) => p.text || '').join(' ') || '';
          contentText += text + ' ';
        } else {
          // It's a Part object
          const text = (content as any).text || '';
          contentText += text + ' ';
        }
      }
      
      return {
        totalTokens: Math.ceil(contentText.length / 4),
      };
    },

    async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
      throw new Error('Embedding is not supported by llama.cpp server');
    },
  };
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
): Promise<ContentGenerator> {
  // Only support llama.cpp now
  if (config.authType !== AuthType.USE_LLAMACPP_SERVER || !config.llamacppBaseUrl) {
    throw new Error('Only llama.cpp server authentication is supported. Please set LLAMACPP_BASE_URL environment variable.');
  }

  const client = new LlamaCppClient(config.llamacppBaseUrl);
  await client.initialize();
  // Update the config with the actual model name
  config.model = client.getDisplayName();
  // Return a simplified wrapper that implements ContentGenerator interface
  return createLlamaCppContentGenerator(client);
}
