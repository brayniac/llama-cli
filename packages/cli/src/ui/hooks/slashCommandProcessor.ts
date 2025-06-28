/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo } from 'react';
import { type PartListUnion } from '@google/genai';
import open from 'open';
import process from 'node:process';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useStateAndRef } from './useStateAndRef.js';
import {
  Config,
  GitService,
  Logger,
  MCPDiscoveryState,
  MCPServerStatus,
  getMCPDiscoveryState,
  getMCPServerStatus,
} from 'llama-cli-core';
import { useSessionStats } from '../contexts/SessionContext.js';
import {
  Message,
  MessageType,
  HistoryItemWithoutId,
  HistoryItem,
} from '../types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { createShowMemoryAction } from './useShowMemoryCommand.js';
import { GIT_COMMIT_INFO } from '../../generated/git-commit.js';
import { formatDuration, formatMemoryUsage } from '../utils/formatters.js';
import { getCliVersion } from '../../utils/version.js';
import { LoadedSettings } from '../../config/settings.js';

export interface SlashCommandActionReturn {
  shouldScheduleTool?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string; // For simple messages or errors
}

export interface SlashCommand {
  name: string;
  altName?: string;
  description?: string;
  completion?: () => Promise<string[]>;
  action: (
    mainCommand: string,
    subCommand?: string,
    args?: string,
  ) =>
    | void
    | SlashCommandActionReturn
    | Promise<void | SlashCommandActionReturn>; // Action can now return this object
}

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 */
export const useSlashCommandProcessor = (
  config: Config | null,
  settings: LoadedSettings,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  clearItems: UseHistoryManagerReturn['clearItems'],
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  refreshStatic: () => void,
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  onDebugMessage: (message: string) => void,
  openThemeDialog: () => void,
  openAuthDialog: () => void,
  openEditorDialog: () => void,
  performMemoryRefresh: () => Promise<void>,
  toggleCorgiMode: () => void,
  showToolDescriptions: boolean = false,
  setQuittingMessages: (message: HistoryItem[]) => void,
  submitQuery?: (query: PartListUnion) => void,
) => {
  const session = useSessionStats();
  const gitService = useMemo(() => {
    if (!config?.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const pendingHistoryItems: HistoryItemWithoutId[] = [];
  const [pendingCompressionItemRef, setPendingCompressionItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  if (pendingCompressionItemRef.current != null) {
    pendingHistoryItems.push(pendingCompressionItemRef.current);
  }

  const addMessage = useCallback(
    (message: Message) => {
      // Convert Message to HistoryItemWithoutId
      let historyItemContent: HistoryItemWithoutId;
      if (message.type === MessageType.ABOUT) {
        historyItemContent = {
          type: 'about',
          cliVersion: message.cliVersion,
          osVersion: message.osVersion,
          sandboxEnv: message.sandboxEnv,
          modelVersion: message.modelVersion,
        };
      } else if (message.type === MessageType.STATS) {
        historyItemContent = {
          type: 'stats',
          stats: message.stats,
          lastTurnStats: message.lastTurnStats,
          duration: message.duration,
        };
      } else if (message.type === MessageType.QUIT) {
        historyItemContent = {
          type: 'quit',
          stats: message.stats,
          duration: message.duration,
        };
      } else if (message.type === MessageType.COMPRESSION) {
        historyItemContent = {
          type: 'compression',
          compression: message.compression,
        };
      } else {
        historyItemContent = {
          type: message.type as
            | MessageType.INFO
            | MessageType.ERROR
            | MessageType.USER,
          text: message.content,
        };
      }
      addItem(historyItemContent, message.timestamp.getTime());
    },
    [addItem],
  );

  const showMemoryAction = useCallback(async () => {
    const actionFn = createShowMemoryAction(config, settings, addMessage);
    await actionFn();
  }, [config, settings, addMessage]);

  const addMemoryAction = useCallback(
    (
      _mainCommand: string,
      _subCommand?: string,
      args?: string,
    ): SlashCommandActionReturn | void => {
      if (!args || args.trim() === '') {
        addMessage({
          type: MessageType.ERROR,
          content: 'Usage: /memory add <text to remember>',
          timestamp: new Date(),
        });
        return;
      }
      // UI feedback for attempting to schedule
      addMessage({
        type: MessageType.INFO,
        content: `Attempting to save to memory: "${args.trim()}"`,
        timestamp: new Date(),
      });
      // Return info for scheduling the tool call
      return {
        shouldScheduleTool: true,
        toolName: 'save_memory',
        toolArgs: { fact: args.trim() },
      };
    },
    [addMessage],
  );

  const savedChatTags = useCallback(async () => {
    const geminiDir = config?.getProjectTempDir();
    if (!geminiDir) {
      return [];
    }
    try {
      const files = await fs.readdir(geminiDir);
      return files
        .filter(
          (file) => file.startsWith('checkpoint-') && file.endsWith('.json'),
        )
        .map((file) => file.replace('checkpoint-', '').replace('.json', ''));
    } catch (_err) {
      return [];
    }
  }, [config]);

  const slashCommands: SlashCommand[] = useMemo(() => {
    const commands: SlashCommand[] = [
      {
        name: 'help',
        altName: '?',
        description: 'for help on gemini-cli',
        action: (_mainCommand, _subCommand, _args) => {
          onDebugMessage('Opening help.');
          setShowHelp(true);
        },
      },
      {
        name: 'docs',
        description: 'open full Gemini CLI documentation in your browser',
        action: async (_mainCommand, _subCommand, _args) => {
          const docsUrl = 'https://goo.gle/gemini-cli-docs';
          if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
            addMessage({
              type: MessageType.INFO,
              content: `Please open the following URL in your browser to view the documentation:\n${docsUrl}`,
              timestamp: new Date(),
            });
          } else {
            addMessage({
              type: MessageType.INFO,
              content: `Opening documentation in your browser: ${docsUrl}`,
              timestamp: new Date(),
            });
            await open(docsUrl);
          }
        },
      },
      {
        name: 'clear',
        description: 'clear the screen and conversation history',
        action: async (_mainCommand, _subCommand, _args) => {
          onDebugMessage('Clearing terminal and resetting chat.');
          clearItems();
          await config?.getGeminiClient()?.resetChat();
          console.clear();
          refreshStatic();
        },
      },
      {
        name: 'theme',
        description: 'change the theme',
        action: (_mainCommand, _subCommand, _args) => {
          openThemeDialog();
        },
      },
      {
        name: 'auth',
        description: 'change the auth method',
        action: (_mainCommand, _subCommand, _args) => {
          openAuthDialog();
        },
      },
      {
        name: 'editor',
        description: 'set external editor preference',
        action: (_mainCommand, _subCommand, _args) => {
          openEditorDialog();
        },
      },
      {
        name: 'stats',
        altName: 'usage',
        description: 'check session stats',
        action: (_mainCommand, _subCommand, _args) => {
          const now = new Date();
          const { sessionStartTime, cumulative, currentTurn } = session.stats;
          const wallDuration = now.getTime() - sessionStartTime.getTime();

          addMessage({
            type: MessageType.STATS,
            stats: cumulative,
            lastTurnStats: currentTurn,
            duration: formatDuration(wallDuration),
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'mcp',
        description: 'list configured MCP servers and tools',
        action: async (_mainCommand, _subCommand, _args) => {
          // Check if the _subCommand includes a specific flag to control description visibility
          let useShowDescriptions = showToolDescriptions;
          if (_subCommand === 'desc' || _subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            _subCommand === 'nodesc' ||
            _subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (_args === 'desc' || _args === 'descriptions') {
            useShowDescriptions = true;
          } else if (_args === 'nodesc' || _args === 'nodescriptions') {
            useShowDescriptions = false;
          }
          // Check if the _subCommand includes a specific flag to show detailed tool schema
          let useShowSchema = false;
          if (_subCommand === 'schema' || _args === 'schema') {
            useShowSchema = true;
          }

          const toolRegistry = await config?.getToolRegistry();
          if (!toolRegistry) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not retrieve tool registry.',
              timestamp: new Date(),
            });
            return;
          }

          const mcpServers = config?.getMcpServers() || {};
          const serverNames = Object.keys(mcpServers);

          if (serverNames.length === 0) {
            const docsUrl = 'https://goo.gle/gemini-cli-docs-mcp';
            if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
              addMessage({
                type: MessageType.INFO,
                content: `No MCP servers configured. Please open the following URL in your browser to view documentation:\n${docsUrl}`,
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.INFO,
                content: `No MCP servers configured. Opening documentation in your browser: ${docsUrl}`,
                timestamp: new Date(),
              });
              await open(docsUrl);
            }
            return;
          }

          // Check if any servers are still connecting
          const connectingServers = serverNames.filter(
            (name) => getMCPServerStatus(name) === MCPServerStatus.CONNECTING,
          );
          const discoveryState = getMCPDiscoveryState();

          let message = '';

          // Add overall discovery status message if needed
          if (
            discoveryState === MCPDiscoveryState.IN_PROGRESS ||
            connectingServers.length > 0
          ) {
            message += `\u001b[33m⏳ MCP servers are starting up (${connectingServers.length} initializing)...\u001b[0m\n`;
            message += `\u001b[90mNote: First startup may take longer. Tool availability will update automatically.\u001b[0m\n\n`;
          }

          message += 'Configured MCP servers:\n\n';

          for (const serverName of serverNames) {
            const serverTools = toolRegistry.getToolsByServer(serverName);
            const status = getMCPServerStatus(serverName);

            // Add status indicator with descriptive text
            let statusIndicator = '';
            let statusText = '';
            switch (status) {
              case MCPServerStatus.CONNECTED:
                statusIndicator = '🟢';
                statusText = 'Ready';
                break;
              case MCPServerStatus.CONNECTING:
                statusIndicator = '🔄';
                statusText = 'Starting... (first startup may take longer)';
                break;
              case MCPServerStatus.DISCONNECTED:
              default:
                statusIndicator = '🔴';
                statusText = 'Disconnected';
                break;
            }

            // Get server description if available
            const server = mcpServers[serverName];

            // Format server header with bold formatting and status
            message += `${statusIndicator} \u001b[1m${serverName}\u001b[0m - ${statusText}`;

            // Add tool count with conditional messaging
            if (status === MCPServerStatus.CONNECTED) {
              message += ` (${serverTools.length} tools)`;
            } else if (status === MCPServerStatus.CONNECTING) {
              message += ` (tools will appear when ready)`;
            } else {
              message += ` (${serverTools.length} tools cached)`;
            }

            // Add server description with proper handling of multi-line descriptions
            if ((useShowDescriptions || useShowSchema) && server?.description) {
              const greenColor = '\u001b[32m';
              const resetColor = '\u001b[0m';

              const descLines = server.description.trim().split('\n');
              if (descLines) {
                message += ':\n';
                for (let i = 0; i < descLines.length; i++) {
                  message += `    ${greenColor}${descLines[i]}${resetColor}\n`;
                }
              } else {
                message += '\n';
              }
            } else {
              message += '\n';
            }

            // Reset formatting after server entry
            message += '\u001b[0m';

            if (serverTools.length > 0) {
              serverTools.forEach((tool) => {
                if (
                  (useShowDescriptions || useShowSchema) &&
                  tool.description
                ) {
                  // Format tool name in cyan using simple ANSI cyan color
                  message += `  - \u001b[36m${tool.name}\u001b[0m`;

                  // Apply green color to the description text
                  const greenColor = '\u001b[32m';
                  const resetColor = '\u001b[0m';

                  // Handle multi-line descriptions by properly indenting and preserving formatting
                  const descLines = tool.description.trim().split('\n');
                  if (descLines) {
                    message += ':\n';
                    for (let i = 0; i < descLines.length; i++) {
                      message += `      ${greenColor}${descLines[i]}${resetColor}\n`;
                    }
                  } else {
                    message += '\n';
                  }
                  // Reset is handled inline with each line now
                } else {
                  // Use cyan color for the tool name even when not showing descriptions
                  message += `  - \u001b[36m${tool.name}\u001b[0m\n`;
                }
                if (useShowSchema) {
                  // Prefix the parameters in cyan
                  message += `    \u001b[36mParameters:\u001b[0m\n`;
                  // Apply green color to the parameter text
                  const greenColor = '\u001b[32m';
                  const resetColor = '\u001b[0m';

                  const paramsLines = JSON.stringify(
                    tool.schema.parameters,
                    null,
                    2,
                  )
                    .trim()
                    .split('\n');
                  if (paramsLines) {
                    for (let i = 0; i < paramsLines.length; i++) {
                      message += `      ${greenColor}${paramsLines[i]}${resetColor}\n`;
                    }
                  }
                }
              });
            } else {
              message += '  No tools available\n';
            }
            message += '\n';
          }

          // Make sure to reset any ANSI formatting at the end to prevent it from affecting the terminal
          message += '\u001b[0m';

          addMessage({
            type: MessageType.INFO,
            content: message,
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'memory',
        description:
          'manage memory. Usage: /memory <show|refresh|add> [text for add]',
        action: (mainCommand, subCommand, args) => {
          switch (subCommand) {
            case 'show':
              showMemoryAction();
              return; // Explicitly return void
            case 'refresh':
              performMemoryRefresh();
              return; // Explicitly return void
            case 'add':
              return addMemoryAction(mainCommand, subCommand, args); // Return the object
            default:
              addMessage({
                type: MessageType.ERROR,
                content: `Unknown /memory command: ${subCommand}. Available: show, refresh, add`,
                timestamp: new Date(),
              });
              return; // Explicitly return void
          }
        },
      },
      {
        name: 'tools',
        description: 'list available Gemini CLI tools',
        action: async (_mainCommand, _subCommand, _args) => {
          // Check if the _subCommand includes a specific flag to control description visibility
          let useShowDescriptions = showToolDescriptions;
          if (_subCommand === 'desc' || _subCommand === 'descriptions') {
            useShowDescriptions = true;
          } else if (
            _subCommand === 'nodesc' ||
            _subCommand === 'nodescriptions'
          ) {
            useShowDescriptions = false;
          } else if (_args === 'desc' || _args === 'descriptions') {
            useShowDescriptions = true;
          } else if (_args === 'nodesc' || _args === 'nodescriptions') {
            useShowDescriptions = false;
          }

          const toolRegistry = await config?.getToolRegistry();
          const tools = toolRegistry?.getAllTools();
          if (!tools) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not retrieve tools.',
              timestamp: new Date(),
            });
            return;
          }

          // Filter out MCP tools by checking if they have a serverName property
          const geminiTools = tools.filter((tool) => !('serverName' in tool));

          let message = 'Available Gemini CLI tools:\n\n';

          if (geminiTools.length > 0) {
            geminiTools.forEach((tool) => {
              if (useShowDescriptions && tool.description) {
                // Format tool name in cyan using simple ANSI cyan color
                message += `  - \u001b[36m${tool.displayName} (${tool.name})\u001b[0m:\n`;

                // Apply green color to the description text
                const greenColor = '\u001b[32m';
                const resetColor = '\u001b[0m';

                // Handle multi-line descriptions by properly indenting and preserving formatting
                const descLines = tool.description.trim().split('\n');

                // If there are multiple lines, add proper indentation for each line
                if (descLines) {
                  for (let i = 0; i < descLines.length; i++) {
                    message += `      ${greenColor}${descLines[i]}${resetColor}\n`;
                  }
                }
              } else {
                // Use cyan color for the tool name even when not showing descriptions
                message += `  - \u001b[36m${tool.displayName}\u001b[0m\n`;
              }
            });
          } else {
            message += '  No tools available\n';
          }
          message += '\n';

          // Make sure to reset any ANSI formatting at the end to prevent it from affecting the terminal
          message += '\u001b[0m';

          addMessage({
            type: MessageType.INFO,
            content: message,
            timestamp: new Date(),
          });
        },
      },
      {
        name: 'corgi',
        action: (_mainCommand, _subCommand, _args) => {
          toggleCorgiMode();
        },
      },
      {
        name: 'about',
        description: 'show version info',
        action: async (_mainCommand, _subCommand, _args) => {
          const osVersion = process.platform;
          let sandboxEnv = 'no sandbox';
          if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
            sandboxEnv = process.env.SANDBOX;
          } else if (process.env.SANDBOX === 'sandbox-exec') {
            sandboxEnv = `sandbox-exec (${
              process.env.SEATBELT_PROFILE || 'unknown'
            })`;
          }
          const modelVersion = config?.getModel() || 'Unknown';
          const cliVersion = await getCliVersion();
          addMessage({
            type: MessageType.ABOUT,
            timestamp: new Date(),
            cliVersion,
            osVersion,
            sandboxEnv,
            modelVersion,
          });
        },
      },
      {
        name: 'bug',
        description: 'submit a bug report',
        action: async (_mainCommand, _subCommand, args) => {
          let bugDescription = _subCommand || '';
          if (args) {
            bugDescription += ` ${args}`;
          }
          bugDescription = bugDescription.trim();

          const osVersion = `${process.platform} ${process.version}`;
          let sandboxEnv = 'no sandbox';
          if (process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec') {
            sandboxEnv = process.env.SANDBOX.replace(/^gemini-(?:code-)?/, '');
          } else if (process.env.SANDBOX === 'sandbox-exec') {
            sandboxEnv = `sandbox-exec (${
              process.env.SEATBELT_PROFILE || 'unknown'
            })`;
          }
          const modelVersion = config?.getModel() || 'Unknown';
          const cliVersion = await getCliVersion();
          const memoryUsage = formatMemoryUsage(process.memoryUsage().rss);

          const diagnosticInfo = `
## Describe the bug
A clear and concise description of what the bug is.

## Additional context
Add any other context about the problem here.

## Diagnostic Information
*   **CLI Version:** ${cliVersion}
*   **Git Commit:** ${GIT_COMMIT_INFO}
*   **Operating System:** ${osVersion}
*   **Sandbox Environment:** ${sandboxEnv}
*   **Model Version:** ${modelVersion}
*   **Memory Usage:** ${memoryUsage}
`;

          let bugReportUrl =
            'https://github.com/google-gemini/gemini-cli/issues/new?template=bug_report.md&title={title}&body={body}';
          const bugCommand = config?.getBugCommand();
          if (bugCommand?.urlTemplate) {
            bugReportUrl = bugCommand.urlTemplate;
          }
          bugReportUrl = bugReportUrl
            .replace('{title}', encodeURIComponent(bugDescription))
            .replace('{body}', encodeURIComponent(diagnosticInfo));

          addMessage({
            type: MessageType.INFO,
            content: `To submit your bug report, please open the following URL in your browser:\n${bugReportUrl}`,
            timestamp: new Date(),
          });
          (async () => {
            try {
              await open(bugReportUrl);
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              addMessage({
                type: MessageType.ERROR,
                content: `Could not open URL in browser: ${errorMessage}`,
                timestamp: new Date(),
              });
            }
          })();
        },
      },
      {
        name: 'chat',
        description:
          'Manage conversation history. Usage: /chat <list|save|resume> [tag]',
        action: async (_mainCommand, subCommand, args) => {
          const tag = (args || '').trim();
          const logger = new Logger(config?.getSessionId() || '');
          await logger.initialize();
          const chat = await config?.getGeminiClient()?.getChat();
          if (!chat) {
            addMessage({
              type: MessageType.ERROR,
              content: 'No chat client available for conversation status.',
              timestamp: new Date(),
            });
            return;
          }
          switch (subCommand) {
            case 'save': {
              const history = chat.getHistory();
              if (history.length > 0) {
                await logger.saveCheckpoint(chat?.getHistory() || [], tag);
                addMessage({
                  type: MessageType.INFO,
                  content: `Conversation checkpoint saved${tag ? ' with tag: ' + tag : ''}.`,
                  timestamp: new Date(),
                });
              } else {
                addMessage({
                  type: MessageType.INFO,
                  content: 'No conversation found to save.',
                  timestamp: new Date(),
                });
              }
              return;
            }
            case 'resume':
            case 'restore':
            case 'load': {
              const conversation = await logger.loadCheckpoint(tag);
              if (conversation.length === 0) {
                addMessage({
                  type: MessageType.INFO,
                  content: `No saved checkpoint found${tag ? ' with tag: ' + tag : ''}.`,
                  timestamp: new Date(),
                });
                return;
              }

              clearItems();
              chat.clearHistory();
              const rolemap: { [key: string]: MessageType } = {
                user: MessageType.USER,
                model: MessageType.GEMINI,
              };
              let hasSystemPrompt = false;
              let i = 0;
              for (const item of conversation) {
                i += 1;
                const text =
                  item.parts
                    ?.filter((m) => !!m.text)
                    .map((m) => m.text)
                    .join('') || '';
                if (!text) {
                  // Parsing Part[] back to various non-text output not yet implemented.
                  continue;
                }
                chat.addHistory(item);
                if (i === 1 && text.match(/context for our chat/)) {
                  hasSystemPrompt = true;
                }
                if (i > 2 || !hasSystemPrompt) {
                  addItem(
                    {
                      type:
                        (item.role && rolemap[item.role]) || MessageType.GEMINI,
                      text,
                    } as HistoryItemWithoutId,
                    i,
                  );
                }
              }
              console.clear();
              refreshStatic();
              return;
            }
            case 'list':
              addMessage({
                type: MessageType.INFO,
                content:
                  'list of saved conversations: ' +
                  (await savedChatTags()).join(', '),
                timestamp: new Date(),
              });
              return;
            default:
              addMessage({
                type: MessageType.ERROR,
                content: `Unknown /chat command: ${subCommand}. Available: list, save, resume`,
                timestamp: new Date(),
              });
              return;
          }
        },
        completion: async () =>
          (await savedChatTags()).map((tag) => 'resume ' + tag),
      },
      {
        name: 'quit',
        altName: 'exit',
        description: 'exit the cli',
        action: async (mainCommand, _subCommand, _args) => {
          const now = new Date();
          const { sessionStartTime, cumulative } = session.stats;
          const wallDuration = now.getTime() - sessionStartTime.getTime();

          setQuittingMessages([
            {
              type: 'user',
              text: `/${mainCommand}`,
              id: now.getTime() - 1,
            },
            {
              type: 'quit',
              stats: cumulative,
              duration: formatDuration(wallDuration),
              id: now.getTime(),
            },
          ]);

          setTimeout(() => {
            process.exit(0);
          }, 100);
        },
      },
      {
        name: 'compress',
        altName: 'summarize',
        description: 'Compresses the context by replacing it with a summary.',
        action: async (_mainCommand, _subCommand, _args) => {
          if (pendingCompressionItemRef.current !== null) {
            addMessage({
              type: MessageType.ERROR,
              content:
                'Already compressing, wait for previous request to complete',
              timestamp: new Date(),
            });
            return;
          }
          setPendingCompressionItem({
            type: MessageType.COMPRESSION,
            compression: {
              isPending: true,
              originalTokenCount: null,
              newTokenCount: null,
            },
          });
          try {
            const compressed = await config!
              .getGeminiClient()!
              .tryCompressChat(true);
            if (compressed) {
              addMessage({
                type: MessageType.COMPRESSION,
                compression: {
                  isPending: false,
                  originalTokenCount: compressed.originalTokenCount,
                  newTokenCount: compressed.newTokenCount,
                },
                timestamp: new Date(),
              });
            } else {
              addMessage({
                type: MessageType.ERROR,
                content: 'Failed to compress chat history.',
                timestamp: new Date(),
              });
            }
          } catch (e) {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to compress chat history: ${e instanceof Error ? e.message : String(e)}`,
              timestamp: new Date(),
            });
          }
          setPendingCompressionItem(null);
        },
      },
      {
        name: 'test-tools',
        description: 'test tool-calling functionality. Usage: /test-tools [basic|full|llm]',
        completion: async () => ['basic', 'full', 'llm', 'debug'],
        action: async (_mainCommand, _subCommand, _args) => {
          const testLevel = _subCommand || 'basic';
          
          if (!['basic', 'full', 'llm', 'debug'].includes(testLevel)) {
            addMessage({
              type: MessageType.ERROR,
              content: '❌ Invalid test level. Use: basic, full, llm, or debug',
              timestamp: new Date(),
            });
            return;
          }

          addMessage({
            type: MessageType.INFO,
            content: `🔧 Starting ${testLevel} tool-calling functionality test...\n`,
            timestamp: new Date(),
          });

          try {
            // Test 1: Check tool registry availability
            const toolRegistry = await config?.getToolRegistry();
            if (!toolRegistry) {
              addMessage({
                type: MessageType.ERROR,
                content: '❌ Tool registry unavailable - tool calling cannot work',
                timestamp: new Date(),
              });
              return;
            }

            const allTools = toolRegistry.getAllTools();
            const toolCount = allTools.length;
            
            // Show breakdown of tool types
            const coreTools = allTools.filter((tool) => !('serverName' in tool));
            const mcpTools = allTools.filter((tool) => ('serverName' in tool));
            
            addMessage({
              type: MessageType.INFO,
              content: `✅ Tool registry accessible: ${toolCount} tools available (${coreTools.length} core, ${mcpTools.length} MCP)`,
              timestamp: new Date(),
            });

            // Test 2: Check client type and capabilities
            const client = await config?.getGeminiClient();
            if (!client) {
              addMessage({
                type: MessageType.ERROR,
                content: '❌ No client available - cannot test tool calling',
                timestamp: new Date(),
              });
              return;
            }

            const model = config?.getModel() || 'unknown';
            const isLlamaCpp = process.env.LLAMACPP_BASE_URL ? true : false;
            const backendType = isLlamaCpp ? 'llama.cpp' : 'Gemini';
            
            addMessage({
              type: MessageType.INFO,
              content: `✅ Client available: ${model} (${backendType} backend)`,
              timestamp: new Date(),
            });

            // Test 3: Check if we have basic tools
            const listTool = allTools.find(tool => tool.name === 'list_directory');
            const readTool = allTools.find(tool => tool.name === 'read_file');
            const grepTool = allTools.find(tool => tool.name === 'search_file_content');
            
            if (!listTool) {
              addMessage({
                type: MessageType.ERROR,
                content: '❌ Basic list_directory tool not found - tool registration may be broken',
                timestamp: new Date(),
              });
              return;
            }

            addMessage({
              type: MessageType.INFO,
              content: `✅ Basic tools found (list_directory: ✓, read_file: ${readTool ? '✓' : '✗'}, search_file_content: ${grepTool ? '✓' : '✗'})`,
              timestamp: new Date(),
            });

            // Basic test stops here
            if (testLevel === 'basic') {
              addMessage({
                type: MessageType.INFO,
                content: '🎉 Basic test completed successfully! Tool infrastructure is ready.',
                timestamp: new Date(),
              });
              return;
            }

            // Test 4: Check tool declarations format
            const toolDeclarations = toolRegistry.getFunctionDeclarations();
            addMessage({
              type: MessageType.INFO,
              content: `✅ Tool declarations generated: ${toolDeclarations.length} function schemas`,
              timestamp: new Date(),
            });

            // Full test - attempt a tool call
            if (testLevel === 'full') {
              addMessage({
                type: MessageType.INFO,
                content: '🧪 Testing direct tool call execution...',
                timestamp: new Date(),
              });

              return {
                shouldScheduleTool: true,
                toolName: 'list_directory',
                toolArgs: { path: process.cwd() },
                message: '🧪 Executing test tool call: list_directory (list directory contents)'
              };
            }

            // LLM test - test LLM-initiated tool calling
            if (testLevel === 'llm') {
              addMessage({
                type: MessageType.INFO,
                content: '🤖 Testing LLM-initiated tool calling...',
                timestamp: new Date(),
              });
              
              if (!submitQuery) {
                addMessage({
                  type: MessageType.ERROR,
                  content: '❌ submitQuery function not available - cannot send message to LLM',
                  timestamp: new Date(),
                });
                return;
              }
              
              addMessage({
                type: MessageType.INFO,
                content: '🚀 Sending message directly to LLM...',
                timestamp: new Date(),
              });

              const testMessage = 'Please list the files in the current directory using the appropriate tool. This is a test of LLM-initiated tool calling.';
              
              // Send directly to LLM using submitQuery
              setTimeout(() => {
                submitQuery(testMessage);
              }, 100); // Small delay to ensure UI updates are processed
              
              return; // Don't return anything - just trigger the direct submission
            }

            // Debug test - show detailed tool information
            if (testLevel === 'debug') {
              addMessage({
                type: MessageType.INFO,
                content: '🔍 Debug mode: Tool details...',
                timestamp: new Date(),
              });

              // Show all tools list
              const coreTools = allTools.filter((tool) => !('serverName' in tool));
              const mcpTools = allTools.filter((tool) => ('serverName' in tool));
              
              let toolsList = `📋 All Available Tools (${allTools.length} total):\n\n`;
              
              if (coreTools.length > 0) {
                toolsList += `🔧 Core Tools (${coreTools.length}):\n`;
                coreTools.forEach((tool, index) => {
                  toolsList += `  ${index + 1}. ${tool.name} (${tool.displayName})\n`;
                });
                toolsList += '\n';
              }
              
              if (mcpTools.length > 0) {
                toolsList += `🔌 MCP Tools (${mcpTools.length}):\n`;
                mcpTools.forEach((tool, index) => {
                  const serverName = 'serverName' in tool ? tool.serverName : 'unknown';
                  toolsList += `  ${index + 1}. ${tool.name} (${tool.displayName}) [${serverName}]\n`;
                });
              }
              
              addMessage({
                type: MessageType.INFO,
                content: toolsList,
                timestamp: new Date(),
              });

              // Show current directory info
              const cwd = process.cwd();
              const rootDir = config?.getTargetDir() || 'unknown';
              
              addMessage({
                type: MessageType.INFO,
                content: `📁 Directory Info:
• Current Directory: ${cwd}
• Target Root: ${rootDir}
• Path is absolute: ${require('path').isAbsolute(cwd)}
• Within root: ${cwd.startsWith(rootDir)}`,
                timestamp: new Date(),
              });

              return;
            }

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            addMessage({
              type: MessageType.ERROR,
              content: `❌ Tool-calling test failed: ${errorMessage}`,
              timestamp: new Date(),
            });
          }
        },
      },
    ];

    if (config?.getCheckpointingEnabled()) {
      commands.push({
        name: 'restore',
        description:
          'restore a tool call. This will reset the conversation and file history to the state it was in when the tool call was suggested',
        completion: async () => {
          const checkpointDir = config?.getProjectTempDir()
            ? path.join(config.getProjectTempDir(), 'checkpoints')
            : undefined;
          if (!checkpointDir) {
            return [];
          }
          try {
            const files = await fs.readdir(checkpointDir);
            return files
              .filter((file) => file.endsWith('.json'))
              .map((file) => file.replace('.json', ''));
          } catch (_err) {
            return [];
          }
        },
        action: async (_mainCommand, subCommand, _args) => {
          const checkpointDir = config?.getProjectTempDir()
            ? path.join(config.getProjectTempDir(), 'checkpoints')
            : undefined;

          if (!checkpointDir) {
            addMessage({
              type: MessageType.ERROR,
              content: 'Could not determine the .gemini directory path.',
              timestamp: new Date(),
            });
            return;
          }

          try {
            // Ensure the directory exists before trying to read it.
            await fs.mkdir(checkpointDir, { recursive: true });
            const files = await fs.readdir(checkpointDir);
            const jsonFiles = files.filter((file) => file.endsWith('.json'));

            if (!subCommand) {
              if (jsonFiles.length === 0) {
                addMessage({
                  type: MessageType.INFO,
                  content: 'No restorable tool calls found.',
                  timestamp: new Date(),
                });
                return;
              }
              const truncatedFiles = jsonFiles.map((file) => {
                const components = file.split('.');
                if (components.length <= 1) {
                  return file;
                }
                components.pop();
                return components.join('.');
              });
              const fileList = truncatedFiles.join('\n');
              addMessage({
                type: MessageType.INFO,
                content: `Available tool calls to restore:\n\n${fileList}`,
                timestamp: new Date(),
              });
              return;
            }

            const selectedFile = subCommand.endsWith('.json')
              ? subCommand
              : `${subCommand}.json`;

            if (!jsonFiles.includes(selectedFile)) {
              addMessage({
                type: MessageType.ERROR,
                content: `File not found: ${selectedFile}`,
                timestamp: new Date(),
              });
              return;
            }

            const filePath = path.join(checkpointDir, selectedFile);
            const data = await fs.readFile(filePath, 'utf-8');
            const toolCallData = JSON.parse(data);

            if (toolCallData.history) {
              loadHistory(toolCallData.history);
            }

            if (toolCallData.clientHistory) {
              await config
                ?.getGeminiClient()
                ?.setHistory(toolCallData.clientHistory);
            }

            if (toolCallData.commitHash) {
              await gitService?.restoreProjectFromSnapshot(
                toolCallData.commitHash,
              );
              addMessage({
                type: MessageType.INFO,
                content: `Restored project to the state before the tool call.`,
                timestamp: new Date(),
              });
            }

            return {
              shouldScheduleTool: true,
              toolName: toolCallData.toolCall.name,
              toolArgs: toolCallData.toolCall.args,
            };
          } catch (error) {
            addMessage({
              type: MessageType.ERROR,
              content: `Could not read restorable tool calls. This is the error: ${error}`,
              timestamp: new Date(),
            });
          }
        },
      });
    }
    return commands;
  }, [
    onDebugMessage,
    setShowHelp,
    refreshStatic,
    openThemeDialog,
    openAuthDialog,
    openEditorDialog,
    clearItems,
    performMemoryRefresh,
    showMemoryAction,
    addMemoryAction,
    addMessage,
    toggleCorgiMode,
    savedChatTags,
    config,
    showToolDescriptions,
    session,
    gitService,
    loadHistory,
    addItem,
    setQuittingMessages,
    pendingCompressionItemRef,
    setPendingCompressionItem,
    submitQuery,
  ]);

  const handleSlashCommand = useCallback(
    async (
      rawQuery: PartListUnion,
    ): Promise<SlashCommandActionReturn | boolean> => {
      if (typeof rawQuery !== 'string') {
        return false;
      }
      const trimmed = rawQuery.trim();
      if (!trimmed.startsWith('/') && !trimmed.startsWith('?')) {
        return false;
      }
      const userMessageTimestamp = Date.now();
      if (trimmed !== '/quit' && trimmed !== '/exit') {
        addItem(
          { type: MessageType.USER, text: trimmed },
          userMessageTimestamp,
        );
      }

      let subCommand: string | undefined;
      let args: string | undefined;

      const commandToMatch = (() => {
        if (trimmed.startsWith('?')) {
          return 'help';
        }
        const parts = trimmed.substring(1).trim().split(/\s+/);
        if (parts.length > 1) {
          subCommand = parts[1];
        }
        if (parts.length > 2) {
          args = parts.slice(2).join(' ');
        }
        return parts[0];
      })();

      const mainCommand = commandToMatch;

      for (const cmd of slashCommands) {
        if (mainCommand === cmd.name || mainCommand === cmd.altName) {
          const actionResult = await cmd.action(mainCommand, subCommand, args);
          if (
            typeof actionResult === 'object' &&
            actionResult?.shouldScheduleTool
          ) {
            return actionResult; // Return the object for useGeminiStream
          }
          return true; // Command was handled, but no tool to schedule
        }
      }

      addMessage({
        type: MessageType.ERROR,
        content: `Unknown command: ${trimmed}`,
        timestamp: new Date(),
      });
      return true; // Indicate command was processed (even if unknown)
    },
    [addItem, slashCommands, addMessage],
  );

  return { handleSlashCommand, slashCommands, pendingHistoryItems };
};
