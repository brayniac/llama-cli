/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionMessage,
  LlamaCppModelsResponse,
} from './openaiTypes.js';

export interface LlamaCppMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlamaCppRequest {
  messages: LlamaCppMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface LlamaCppResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class LlamaCppClient {
  private baseUrl: string;
  private model: string = '';
  private displayName: string = 'llama.cpp';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout = 10000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async initialize(): Promise<void> {
    try {
      // Fetch available models
      const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const modelsResponse: LlamaCppModelsResponse = await response.json();
      
      // Extract model information
      if (modelsResponse.models && modelsResponse.models.length > 0) {
        this.model = modelsResponse.models[0].name;
        this.displayName = this.extractModelName(modelsResponse.models[0].name);
      } else if (modelsResponse.data && modelsResponse.data.length > 0) {
        this.model = modelsResponse.data[0].id;
        this.displayName = this.extractModelName(modelsResponse.data[0].id);
      } else {
        throw new Error('No models available from llama.cpp server');
      }
    } catch (error) {
      console.warn('Failed to fetch models from llama.cpp server:', error);
      throw error;
    }
  }

  private extractModelName(modelPath: string): string {
    // Extract model name from path like "/mnt/llm-models/GGUF/google/gemma-3-27b-it/gemma-3-27b-it.Q8_0.gguf"
    const parts = modelPath.split('/');
    const filename = parts[parts.length - 1];
    
    // Remove .gguf extension
    const nameWithoutExt = filename.replace(/\.gguf$/, '');
    
    // Try to extract brand/model pattern
    const match = nameWithoutExt.match(/^(.+?)[-_](.+)$/);
    if (match) {
      return match[0]; // Return the full name without extension
    }
    
    return nameWithoutExt;
  }

  async chatCompletion(request: LlamaCppRequest): Promise<LlamaCppResponse> {
    const openaiRequest: OpenAIChatCompletionRequest = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.max_tokens,
      stream: false,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(openaiRequest),
      },
    );

    if (!response.ok) {
      throw new Error(`llama.cpp server error: ${response.status} ${response.statusText}`);
    }

    const openaiResponse: OpenAIChatCompletionResponse = await response.json();
    
    const choice = openaiResponse.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No content in response');
    }

    return {
      content: choice.message.content,
      model: this.displayName,
      usage: openaiResponse.usage ? {
        prompt_tokens: openaiResponse.usage.prompt_tokens,
        completion_tokens: openaiResponse.usage.completion_tokens,
        total_tokens: openaiResponse.usage.total_tokens,
      } : undefined,
    };
  }

  async *chatCompletionStream(request: LlamaCppRequest): AsyncGenerator<string> {
    const openaiRequest: OpenAIChatCompletionRequest = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.max_tokens,
      stream: true,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(openaiRequest),
      },
    );

    if (!response.ok) {
      throw new Error(`llama.cpp server error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming request');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            
            if (data === '[DONE]') {
              return;
            }
            
            try {
              const chunk: OpenAIChatCompletionResponse = JSON.parse(data);
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (error) {
              console.warn('Failed to parse streaming chunk:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  getDisplayName(): string {
    return this.displayName;
  }

  getCurrentModel(): string {
    return this.model;
  }
}