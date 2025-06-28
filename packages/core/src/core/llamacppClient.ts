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
  OpenAITool,
  OpenAIToolCall,
} from './openaiTypes.js';

export interface LlamaCppMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string; // Tool name when role is 'tool'
}

export interface LlamaCppRequest {
  messages: LlamaCppMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
}

export interface LlamaCppResponse {
  content: string;
  model: string;
  tool_calls?: OpenAIToolCall[];
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
      tools: request.tools,
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
    if (!choice?.message) {
      throw new Error('No message in response');
    }

    // Check for tool calls in the response
    const toolCalls = choice.message.tool_calls;
    
    return {
      content: choice.message.content || '',
      model: this.displayName,
      tool_calls: toolCalls,
      usage: openaiResponse.usage ? {
        prompt_tokens: openaiResponse.usage.prompt_tokens,
        completion_tokens: openaiResponse.usage.completion_tokens,
        total_tokens: openaiResponse.usage.total_tokens,
      } : undefined,
    };
  }

  async *chatCompletionStream(request: LlamaCppRequest): AsyncGenerator<string | { tool_calls: OpenAIToolCall[] }> {
    const openaiRequest: OpenAIChatCompletionRequest = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.max_tokens,
      stream: true,
      tools: request.tools,
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
    
    // Tool call accumulation
    let currentToolCall: Partial<OpenAIToolCall> | null = null;
    let toolCallAccumulator: OpenAIToolCall[] = [];

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
              // Emit final tool calls if any
              if (currentToolCall && currentToolCall.id) {
                toolCallAccumulator.push(currentToolCall as OpenAIToolCall);
              }
              if (toolCallAccumulator.length > 0) {
                yield { tool_calls: toolCallAccumulator };
              }
              return;
            }
            
            try {
              const chunk: OpenAIChatCompletionResponse = JSON.parse(data);
              const delta = chunk.choices[0]?.delta;
              
              // Handle content
              if (delta?.content) {
                yield delta.content;
              }
              
              // Handle tool calls
              if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                  if (toolCallDelta.index === 0 && toolCallDelta.id) {
                    // New tool call starting
                    if (currentToolCall && currentToolCall.id) {
                      toolCallAccumulator.push(currentToolCall as OpenAIToolCall);
                    }
                    currentToolCall = {
                      id: toolCallDelta.id,
                      type: 'function',
                      function: { name: '', arguments: '' }
                    };
                  }
                  
                  if (currentToolCall) {
                    if (toolCallDelta.function?.name) {
                      currentToolCall.function!.name += toolCallDelta.function.name;
                    }
                    if (toolCallDelta.function?.arguments) {
                      currentToolCall.function!.arguments += toolCallDelta.function.arguments;
                    }
                  }
                }
              }
            } catch (error) {
              console.warn('Failed to parse streaming chunk:', error);
            }
          }
        }
      }
      
      // Emit any remaining tool calls
      if (currentToolCall && currentToolCall.id) {
        toolCallAccumulator.push(currentToolCall as OpenAIToolCall);
      }
      if (toolCallAccumulator.length > 0) {
        yield { tool_calls: toolCallAccumulator };
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