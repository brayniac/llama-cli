# LLaMA CLI

A command-line interface for interacting with llama.cpp servers using OpenAI-compatible endpoints.

## Overview

LLaMA CLI is a powerful terminal-based tool that connects directly to your local llama.cpp server, providing:

- **Direct llama.cpp integration** - Connect to any llama.cpp server via OpenAI-compatible endpoints
- **Auto-model detection** - Automatically detects and displays your currently loaded model  
- **Rich terminal UI** - Interactive command-line interface built with React and Ink
- **Tool ecosystem** - File operations, code editing, and extensible tool support
- **Local-first** - All processing happens on your local llama.cpp server

## Quickstart

1. **Prerequisites:** 
   - [Node.js version 18](https://nodejs.org/en/download) or higher
   - A running [llama.cpp server](https://github.com/ggerganov/llama.cpp/tree/master/examples/server) with OpenAI-compatible endpoints

2. **Install the CLI:**

   ```bash
   npm install -g llama-cli
   ```

3. **Configure your llama.cpp server URL (choose one method):**

   **Option A: Environment variable (temporary)**
   ```bash
   export LLAMACPP_BASE_URL="http://localhost:8080"
   llama
   ```

   **Option B: CLI option (saves to settings for future use)**
   ```bash
   llama --llamacpp-base-url="http://10.3.0.0:8080"
   ```

   **Option C: Settings file (persistent)**
   
   Create `~/.llama/settings.json`:
   ```json
   {
     "llamacppBaseUrl": "http://10.3.0.0:8080"
   }
   ```

4. **Run the CLI:**

   ```bash
   llama
   ```

You are now ready to use LLaMA CLI! Once configured, you can just run `llama` without setting environment variables. The tool will automatically detect your model from the `/v1/models` endpoint.

For other authentication methods, including Google Workspace accounts, see the [authentication](./docs/cli/authentication.md) guide.

## Examples

Once the CLI is running, you can start interacting with your local LLM from your shell.

You can start a project from a new directory:

```sh
$ cd new-project/
$ llama
> Write me a Discord bot that answers questions using a FAQ.md file I will provide
```

Or work with an existing project:

```sh
$ git clone https://github.com/your-org/your-project
$ cd your-project
$ llama
> Give me a summary of all of the changes that went in yesterday
```

### Next steps

- Learn how to [contribute to or build from the source](./CONTRIBUTING.md).
- Explore the available **[CLI Commands](./docs/cli/commands.md)**.
- If you encounter any issues, review the **[Troubleshooting guide](./docs/troubleshooting.md)**.
- For more comprehensive documentation, see the [full documentation](./docs/index.md).
- Take a look at some [popular tasks](#popular-tasks) for more inspiration.

## Popular tasks

### Explore a new codebase

Start by `cd`ing into an existing or newly-cloned repository and running `llama`.

```text
> Describe the main pieces of this system's architecture.
```

```text
> What security mechanisms are in place?
```

### Work with your existing code

```text
> Implement a first draft for GitHub issue #123.
```

```text
> Help me migrate this codebase to the latest version of Java. Start with a plan.
```

### Automate your workflows

Use MCP servers to integrate your local system tools with your enterprise collaboration suite.

```text
> Make me a slide deck showing the git history from the last 7 days, grouped by feature and team member.
```

```text
> Make a full-screen web app for a wall display to show our most interacted-with GitHub issues.
```

### Interact with your system

```text
> Convert all the images in this directory to png, and rename them to use dates from the exif data.
```

```text
> Organise my PDF invoices by month of expenditure.
```

## Local AI with llama.cpp

This project connects to your local llama.cpp server, ensuring all processing happens on your own hardware. Your data never leaves your machine, providing complete privacy and control over your AI interactions.
