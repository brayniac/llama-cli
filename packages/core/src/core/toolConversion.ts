/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration, FunctionCall, Part } from '@google/genai';
import { OpenAITool, OpenAIToolCall, OpenAIChatCompletionMessage } from './openaiTypes.js';

/**
 * Generate a unique tool call ID
 */
function generateToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert Gemini FunctionDeclaration to OpenAI Tool format
 */
export function convertGeminiToolToOpenAI(func: FunctionDeclaration): OpenAITool {
  return {
    type: 'function',
    function: {
      name: func.name,
      description: func.description,
      parameters: func.parameters,
    },
  };
}

/**
 * Convert Gemini FunctionCall to OpenAI ToolCall format
 */
export function convertGeminiFunctionCallToOpenAI(
  functionCall: FunctionCall,
  callId?: string
): OpenAIToolCall {
  return {
    id: callId || functionCall.id || generateToolCallId(),
    type: 'function',
    function: {
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.args || {}),
    },
  };
}

/**
 * Convert OpenAI ToolCall to Gemini FunctionCall format
 */
export function convertOpenAIToolCallToGemini(toolCall: OpenAIToolCall): FunctionCall {
  let args: Record<string, unknown> = {};
  
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (error) {
    console.warn('Failed to parse tool call arguments:', error);
  }
  
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args,
  };
}

/**
 * Convert OpenAI tool response message to Gemini Part format
 */
export function convertToolResponseToGeminiPart(
  message: OpenAIChatCompletionMessage
): Part {
  let content: unknown = message.content;
  
  // Try to parse content as JSON if it's a string
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      // Keep as string if not valid JSON
    }
  }
  
  return {
    functionResponse: {
      name: message.name!,
      response: {
        name: message.name,
        content,
      },
    },
  };
}

/**
 * Convert array of Gemini FunctionDeclarations to OpenAI Tools
 */
export function convertGeminiToolsToOpenAI(
  functions: FunctionDeclaration[]
): OpenAITool[] {
  return functions.map(convertGeminiToolToOpenAI);
}

/**
 * Convert array of OpenAI ToolCalls to Gemini FunctionCalls
 */
export function convertOpenAIToolCallsToGemini(
  toolCalls: OpenAIToolCall[]
): FunctionCall[] {
  return toolCalls.map(convertOpenAIToolCallToGemini);
}