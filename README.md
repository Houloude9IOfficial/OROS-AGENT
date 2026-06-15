<div align="center">
  <img
    src="https://github.com/Houloude9IOfficial/OROS-AGENT/blob/main/assets/oros-logo-grey.png?raw=true"
    alt="OROS Agent Thumbnail"
    width="200"
  />
</div>
<div align="center">
  <img
    src="https://github.com/Houloude9IOfficial/OROS-AGENT/blob/main/assets/OrosThumbnail.png?raw=true"
    alt="OROS Agent Thumbnail"
    width="600"
  />
</div>


# OROS

OROS is a local-first, universally applicable autonomous agent runtime for Windows. It operates your machine by perceiving its environment (screen captures, file system reads, web search), reasoning step-by-step using local Ollama models, and executing actions through GUI automation, shell commands, and MCP tools. 

OROS runs a modern agentic tool loop that evaluates its progress, dynamically chooses tools, corrects its own errors, and cleanly terminates when its goal is achieved. It maintains structured state and memory, allowing complex tasks to be paused, resumed, and audited.

## Features

- **Modern Agent Loop:** A robust, single-model reasoning loop that naturally determines task completion without relying on brittle regex heuristics or secondary verifications.
- **Local-First AI:** Built entirely around [Ollama](https://ollama.com/), ensuring your screen contents and personal data never leave your machine unless you explicitly grant it internet tools.
- **Multimodal Perception:** Analyzes the current screen and active windows using Vision models to intelligently navigate UIs.
- **Extensible Capabilities:** Natively integrates with Model Context Protocol (MCP) servers, empowering OROS to connect to any backend, API, or local service.
- **Self-Correction:** Automatically detects command failures, reflects on what went wrong, and attempts alternative solutions.

## What's in this repository

- `src/core` - The core modern agent runtime, state manager, and executor.
- `src/action` - Tools for GUI, terminal, and browser automation.
- `src/perception` - Screen capture and vision analysis utilities.
- `src/memory` - Vector and structured stores for context-aware workflows.
- `src/mcp` - Model Context Protocol host adapter.

## Requirements

- Node.js 24 or newer
- Ollama running locally on `http://127.0.0.1:11434`
- Windows 10 or 11 (required for native GUI automation paths)

## Quick Start

1. Ensure Ollama is running and you have pulled your preferred models (default requires `gemma4:e2b` and `nomic-embed-text`).
2. Install dependencies:
```bash
npm install
```
3. Run the doctor to verify your environment:
```bash
npm run doctor
```
4. Accept the safety risks (required to allow the agent to modify files and run commands):
```bash
npm run start -- accept-risks
```
5. Give the agent a goal!
```bash
npm run start -- run "Open Notepad and type Hello"
```

## Configuration

Edit `oros.config.json` to change default models, runtime constraints, memory limits, or register custom MCP servers.

Use [`.env.example`](.env.example) as the template for local overrides (like custom API keys for external search tools).

For a sample MCP filesystem configuration, see `docs/MCP_SAMPLE.json`.

## Safety Guidelines

Because OROS is an autonomous agent with the power to execute shell commands and modify your filesystem, it operates behind a consent gate. 
- You must explicitly opt-in using `--accept-risks` or `--i-understand-the-risks`.
- You can stop the agent at any time by pressing Ctrl+C.
- Use caution when giving the agent open-ended, potentially destructive goals.
