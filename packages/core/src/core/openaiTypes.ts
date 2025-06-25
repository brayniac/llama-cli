/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI-compatible types for llama.cpp server integration
 */
export interface OpenAIChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatCompletionMessage[];
  stream?: boolean;
  tools?: OpenAITool[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
}

export interface OpenAIChoice {
  index: number;
  message?: OpenAIChatCompletionMessage;
  delta?: Partial<OpenAIChatCompletionMessage>;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  meta?: Record<string, unknown>;
}

export interface OpenAIModelsResponse {
  object: 'list';
  data: OpenAIModel[];
}

export interface LlamaCppModel {
  name: string;
  model: string;
  modified_at: string;
  size: string;
  digest: string;
  type: string;
  description: string;
  tags: string[];
  capabilities: string[];
  parameters: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface LlamaCppModelsResponse {
  models: LlamaCppModel[];
  object: string;
  data: OpenAIModel[];
}
