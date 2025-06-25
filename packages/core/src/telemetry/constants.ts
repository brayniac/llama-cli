/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SERVICE_NAME = 'llama-cli';

export const EVENT_USER_PROMPT = 'llama_cli.user_prompt';
export const EVENT_TOOL_CALL = 'llama_cli.tool_call';
export const EVENT_API_REQUEST = 'llama_cli.api_request';
export const EVENT_API_ERROR = 'llama_cli.api_error';
export const EVENT_API_RESPONSE = 'llama_cli.api_response';
export const EVENT_CLI_CONFIG = 'llama_cli.config';

export const METRIC_TOOL_CALL_COUNT = 'llama_cli.tool.call.count';
export const METRIC_TOOL_CALL_LATENCY = 'llama_cli.tool.call.latency';
export const METRIC_API_REQUEST_COUNT = 'llama_cli.api.request.count';
export const METRIC_API_REQUEST_LATENCY = 'llama_cli.api.request.latency';
export const METRIC_TOKEN_USAGE = 'llama_cli.token.usage';
export const METRIC_SESSION_COUNT = 'llama_cli.session.count';
export const METRIC_FILE_OPERATION_COUNT = 'llama_cli.file.operation.count';
