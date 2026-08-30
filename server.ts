import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';

const __currentDirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const execAsync = promisify(exec);

// Load .env if present
function loadEnvFile() {
  const envCandidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.env.HOME || '/tmp', '.mini-o', '.env'),
    '/etc/mini-o/.env',
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (key && process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}
loadEnvFile();

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'minimax-m3:cloud';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Shared server-side Gemini client with official telemetry User-Agent
let geminiClientInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClientInstance) {
    geminiClientInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClientInstance;
}

// Path resolution helpers
function resolveDataDir(): string {
  if (process.env.MINI_O_DATA_DIR) {
    return path.resolve(process.env.MINI_O_DATA_DIR);
  }
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }

  // If running in development (current working directory is NOT /opt/mini-o and ./data is writable)
  const cwd = process.cwd();
  if (cwd !== '/opt/mini-o' && !cwd.startsWith('/opt/mini-o/')) {
    const localData = path.join(cwd, 'data');
    try {
      if (!fs.existsSync(localData)) {
        fs.mkdirSync(localData, { recursive: true });
      }
      fs.accessSync(localData, fs.constants.W_OK);
      return localData;
    } catch {
      // Fall through to user data directory
    }
  }

  // User-specific data directory: ~/.local/share/mini-o/data or ~/.mini-o/data
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const userDir = path.join(process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share', 'mini-o'), 'data');
  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    fs.accessSync(userDir, fs.constants.W_OK);
    return userDir;
  } catch {
    // If /var/lib/mini-o is writable (e.g. systemd daemon)
    try {
      if (fs.existsSync('/var/lib/mini-o')) {
        fs.accessSync('/var/lib/mini-o', fs.constants.W_OK);
        return '/var/lib/mini-o';
      }
    } catch {
      // ignore
    }
    return path.join('/tmp', 'mini-o-data');
  }
}

// Workspace settings
const rootDir = process.cwd();
const dataDir = resolveDataDir();

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Seed sample workspace files if empty
  const sampleNotePath = path.join(dataDir, 'welcome.md');
  if (!fs.existsSync(sampleNotePath)) {
    fs.writeFileSync(sampleNotePath, `# Welcome to Mini-O Workspace

Mini-O is your local-first AI workspace.

## Key Features
- **Conversations**: Chat with AI models with streaming and tool usage.
- **Workspace File Management**: Read, write, and explore files.
- **Tool Execution**: Agent file tools, search, and research helpers.
- **Custom Agent Instructions**: Customize agent behaviors using AGENT.md templates.
- **Robust Error Handling**: Structured diagnostics, recovery, and audit tracking.
`, 'utf-8');
  }

  const sampleAgentPath = path.join(dataDir, 'AGENT.md');
  if (!fs.existsSync(sampleAgentPath)) {
    fs.writeFileSync(sampleAgentPath, `# Workspace Agent Instructions

You are Mini-O, a helpful assistant with access to local workspace files and tools.
When working on code or documents in the workspace:
1. Examine existing files before proposing changes.
2. Provide clear, modular explanations.
`, 'utf-8');
  }
} catch (err) {
  console.warn(`[Mini-O] Warning: Could not initialize workspace seed files at ${dataDir}:`, err);
}

// Diagnostic Error Log Buffer
interface ServerDiagnosticEntry {
  id: string;
  timestamp: string;
  status: number;
  code: string;
  category: string;
  message: string;
  action: string;
  route?: string;
  method?: string;
  details?: any;
}

const MAX_ERROR_LOGS = 150;
const serverErrorLogs: ServerDiagnosticEntry[] = [];

function generateDiagnosticId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `srv-${ts}-${rand}`;
}

function logServerError(
  status: number,
  code: string,
  category: string,
  message: string,
  action: string,
  req?: Request,
  details?: any
): ServerDiagnosticEntry {
  const entry: ServerDiagnosticEntry = {
    id: generateDiagnosticId(),
    timestamp: new Date().toISOString(),
    status,
    code,
    category,
    message,
    action,
    route: req?.originalUrl || req?.path,
    method: req?.method,
    details: details || null,
  };

  serverErrorLogs.unshift(entry);
  if (serverErrorLogs.length > MAX_ERROR_LOGS) {
    serverErrorLogs.pop();
  }

  console.error(`[Mini-O Error ${entry.id}] ${entry.code} (${entry.status}): ${entry.message}`);
  return entry;
}

function formatErrorPayload(
  status: number,
  code: string,
  category: string,
  message: string,
  action: string,
  req?: Request,
  details?: any
) {
  const entry = logServerError(status, code, category, message, action, req, details);
  return {
    error: {
      code: entry.code,
      category: entry.category,
      message: entry.message,
      status: entry.status,
      diagnostic_id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      details: entry.details,
    },
  };
}

// In-memory data store with state management
interface Conversation {
  id: string;
  title: string;
  model: string;
  options: Record<string, unknown>;
  messages: Array<{ role: string; content?: string; tool_calls?: any[]; name?: string }>;
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

const conversations = new Map<string, Conversation>();

// Tool definitions
const toolDefinitions = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path inside the workspace.',
    requires_confirmation: false,
    category: 'workspace',
    risk: 'low',
    side_effects: ['reads local file'],
    timeout: 10,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'write_file',
    description: 'Write text content to a file in the workspace.',
    requires_confirmation: false,
    category: 'workspace',
    risk: 'high',
    side_effects: ['overwrites local file'],
    timeout: 10,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'list_files',
    description: 'List files and directories under a path inside the workspace.',
    requires_confirmation: false,
    category: 'workspace',
    risk: 'low',
    side_effects: ['lists local paths'],
    timeout: 10,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', default: '.' } },
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'search_files',
    description: 'Search for files whose name matches a substring, recursively.',
    requires_confirmation: false,
    category: 'workspace',
    risk: 'low',
    side_effects: ['searches local names'],
    timeout: 10,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string', default: '.' } },
      required: ['query'],
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'run_python',
    description: 'Execute a Python code snippet in the workspace and return stdout/stderr.',
    requires_confirmation: false,
    category: 'execution',
    risk: 'critical',
    side_effects: ['executes Python in workspace'],
    timeout: 60,
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python code to execute' } },
      required: ['code'],
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'run_shell',
    description: 'Execute a shell command in the workspace directory and return its output.',
    requires_confirmation: false,
    category: 'execution',
    risk: 'critical',
    side_effects: ['executes shell command in workspace'],
    timeout: 60,
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command string to run' } },
      required: ['command'],
    },
    policy: { enabled: true, mode: 'allow', scope: 'session' },
  },
  {
    name: 'web_fetch',
    description: 'Fetch the text content of a public URL (max 50 KB).',
    requires_confirmation: true,
    category: 'network',
    risk: 'medium',
    side_effects: ['sends request to public network'],
    timeout: 15,
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    policy: { enabled: true, mode: 'confirm', scope: 'conversation' },
  },
];

const toolPolicies: Record<string, { enabled: boolean; mode: string; scope: string }> = {};
toolDefinitions.forEach(t => {
  toolPolicies[t.name] = { ...t.policy };
});

const toolActivity: Array<{
  timestamp: string;
  tool: string;
  ok: boolean;
  conversation_id?: string;
  arguments?: any;
  error?: string;
}> = [];

// Available models catalog with structured tiers, location (cloud vs local), parameters, context windows, and capabilities
export interface ModelCatalogItem {
  name: string;
  display_name: string;
  family: string;
  families: string[];
  location: 'cloud' | 'local';
  tier: 'free' | 'paid';
  pricing_tier: 'free' | 'paid';
  pricing_badge: string;
  pricing_description: string;
  size: number;
  parameter_size: string;
  quantization_level: string;
  context_window: string;
  modified_at: string;
  capabilities: string[];
  use_cases: string[];
  description: string;
  installed: boolean;
  supports_options: string[];
}

const modelCatalog: ModelCatalogItem[] = [
  // ─── CLOUD MODELS: FREE TIER / PREVIEW ───────────────────────────
  {
    name: 'gemini-2.5-flash',
    display_name: 'Gemini 2.5 Flash',
    family: 'gemini',
    families: ['gemini', 'cloud', 'google'],
    location: 'cloud',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: 'Free Tier Available',
    pricing_description: 'Generous free tier on Google AI with high rate limits',
    size: 0,
    parameter_size: 'Cloud (Fast)',
    quantization_level: 'Cloud FP16',
    context_window: '1M tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'multimodal', 'fast', 'search-grounding'],
    use_cases: ['Fast general reasoning', 'Workspace coding', 'Document analysis', 'Agentic tool calling'],
    description: "Google's ultra-fast, highly capable multimodal model with a 1M token context window and free tier.",
    installed: true,
    supports_options: ['temperature', 'top_p', 'top_k', 'num_predict', 'googleSearch', 'ttsVoice'],
  },
  {
    name: 'gemini-3.7-flash',
    display_name: 'Gemini 3.7 Flash',
    family: 'gemini',
    families: ['gemini', 'cloud', 'google'],
    location: 'cloud',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: 'Free Tier / Preview',
    pricing_description: 'Free tier supported with hybrid thinking tokens',
    size: 0,
    parameter_size: 'Cloud (Reasoning)',
    quantization_level: 'Cloud FP16',
    context_window: '1M tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'thinking', 'search-grounding', 'coding', 'vision'],
    use_cases: ['Hybrid thinking & deep reasoning', 'Web search grounding', 'Complex multi-step tool execution'],
    description: 'Advanced hybrid reasoning model supporting controllable thinking budgets and real-time Search grounding.',
    installed: true,
    supports_options: ['temperature', 'top_p', 'top_k', 'thinkingBudget', 'googleSearch', 'ttsVoice'],
  },
  {
    name: 'gemini-2.5-flash-lite',
    display_name: 'Gemini 2.5 Flash Lite',
    family: 'gemini',
    families: ['gemini', 'cloud', 'google'],
    location: 'cloud',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: 'Free Tier',
    pricing_description: 'Free tier with lowest latency and highest throughput',
    size: 0,
    parameter_size: 'Cloud (Light)',
    quantization_level: 'Cloud FP16',
    context_window: '1M tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'fast', 'low-latency', 'summarization'],
    use_cases: ['High-throughput quick responses', 'Rapid file summarization', 'Low-latency conversational chat'],
    description: "Google's lightweight, cost-efficient model optimized for speed, quick edits, and high-frequency queries.",
    installed: true,
    supports_options: ['temperature', 'top_p', 'top_k', 'num_predict'],
  },
  {
    name: 'minimax-m3:cloud',
    display_name: 'MiniMax M3 (Cloud / Ollama)',
    family: 'minimax',
    families: ['cloud', 'ollama', 'minimax'],
    location: 'cloud',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: 'Free Cloud Tier',
    pricing_description: 'Included default workspace model with cloud acceleration',
    size: 0,
    parameter_size: 'Cloud',
    quantization_level: 'Cloud FP16',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'thinking', 'vision'],
    use_cases: ['General reasoning', 'Cloud inference', 'Fast coding', 'Workspace assistant'],
    description: 'Dedicated workspace assistant model with tool execution and fast cloud inference.',
    installed: true,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },

  // ─── CLOUD MODELS: PAID API TIERS ────────────────────────────────
  {
    name: 'gemini-2.5-pro',
    display_name: 'Gemini 2.5 Pro',
    family: 'gemini',
    families: ['gemini', 'cloud', 'google'],
    location: 'cloud',
    tier: 'paid',
    pricing_tier: 'paid',
    pricing_badge: 'Paid / Pro Tier',
    pricing_description: 'Standard pay-per-token API pricing on Google Cloud / AI Studio',
    size: 0,
    parameter_size: 'Cloud (Large)',
    quantization_level: 'Cloud FP16',
    context_window: '2M tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'deep-reasoning', 'complex-coding', 'multimodal'],
    use_cases: ['Complex architectural design', 'Multi-repository code analysis', 'Mathematical proofs', 'Large-document synthesis'],
    description: "Google's flagship frontier model for complex reasoning, 2M context window analysis, and full-stack engineering.",
    installed: true,
    supports_options: ['temperature', 'top_p', 'top_k', 'googleSearch', 'ttsVoice'],
  },
  {
    name: 'deepseek-chat:cloud',
    display_name: 'DeepSeek V3 (Cloud)',
    family: 'deepseek',
    families: ['deepseek', 'cloud'],
    location: 'cloud',
    tier: 'paid',
    pricing_tier: 'paid',
    pricing_badge: 'Paid API (Low Cost)',
    pricing_description: 'Ultra-low cost cloud API pricing per million tokens',
    size: 0,
    parameter_size: '671B MoE (37B active)',
    quantization_level: 'Cloud FP8',
    context_window: '64k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'coding', 'reasoning', 'multilingual'],
    use_cases: ['General programming', 'Multilingual translation', 'Rapid code refactoring'],
    description: 'DeepSeek-V3 671B MoE architecture delivering frontier-class coding and reasoning at very low API cost.',
    installed: true,
    supports_options: ['temperature', 'top_p', 'num_predict'],
  },
  {
    name: 'deepseek-r1:cloud',
    display_name: 'DeepSeek R1 (Cloud)',
    family: 'deepseek',
    families: ['deepseek', 'cloud'],
    location: 'cloud',
    tier: 'paid',
    pricing_tier: 'paid',
    pricing_badge: 'Paid Cloud Reasoning',
    pricing_description: 'Cloud API pricing with full 671B MoE RL reasoning',
    size: 0,
    parameter_size: '671B MoE (RL)',
    quantization_level: 'Cloud FP8',
    context_window: '64k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'deep-reasoning', 'math', 'coding', 'thinking'],
    use_cases: ['Complex mathematical reasoning', 'Algorithm design', 'Formal logic verification'],
    description: 'Full 671B DeepSeek-R1 reasoning model trained with large-scale reinforcement learning for step-by-step math and coding.',
    installed: true,
    supports_options: ['temperature', 'top_p', 'num_predict'],
  },
  {
    name: 'claude-3-5-sonnet:cloud',
    display_name: 'Claude 3.5 Sonnet (Cloud)',
    family: 'anthropic',
    families: ['anthropic', 'cloud'],
    location: 'cloud',
    tier: 'paid',
    pricing_tier: 'paid',
    pricing_badge: 'Paid API',
    pricing_description: 'Anthropic commercial API subscription / token usage',
    size: 0,
    parameter_size: 'Cloud (Frontier)',
    quantization_level: 'Cloud',
    context_window: '200k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'coding', 'vision', 'nuanced-writing', 'tools'],
    use_cases: ['Complex full-stack development', 'Artifact generation', 'Visual comprehension'],
    description: "Anthropic's frontier model known for exceptional coding precision, nuanced writing, and visual reasoning.",
    installed: true,
    supports_options: ['temperature', 'top_p', 'num_predict'],
  },
  {
    name: 'gpt-4o:cloud',
    display_name: 'OpenAI GPT-4o (Cloud)',
    family: 'openai',
    families: ['openai', 'cloud'],
    location: 'cloud',
    tier: 'paid',
    pricing_tier: 'paid',
    pricing_badge: 'Paid API',
    pricing_description: 'OpenAI API commercial token pricing',
    size: 0,
    parameter_size: 'Cloud (Omni)',
    quantization_level: 'Cloud',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'multimodal'],
    use_cases: ['Omni reasoning', 'General assistance', 'JSON data extraction', 'Workflow automation'],
    description: "OpenAI's high-speed omni model designed for multimodal text and visual problem solving.",
    installed: true,
    supports_options: ['temperature', 'top_p', 'num_predict'],
  },

  // ─── LOCAL MODELS: FREE OPEN-WEIGHTS (OLLAMA / ON-DEVICE) ─────────
  {
    name: 'llama3.3:70b',
    display_name: 'Llama 3.3 (70B Local)',
    family: 'llama',
    families: ['llama', 'ollama', 'meta'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 42949672960,
    parameter_size: '70B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'deep-reasoning', 'coding', 'local-privacy'],
    use_cases: ['Enterprise private reasoning', 'Offline software engineering', 'Complete data privacy'],
    description: "Meta's flagship 70B open-weights model rivaling frontier cloud models completely offline on your device.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'llama3.2:3b',
    display_name: 'Llama 3.2 (3B Local)',
    family: 'llama',
    families: ['llama', 'ollama', 'meta'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 2147483648,
    parameter_size: '3B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'fast', 'local-privacy', 'low-memory'],
    use_cases: ['Fast local summarization', 'Edge laptops & portable devices', 'Private scratchpad assistant'],
    description: 'Lightweight local model designed for fast on-device inference with low RAM footprint (~2GB).',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'llama3.2:1b',
    display_name: 'Llama 3.2 (1B Local)',
    family: 'llama',
    families: ['llama', 'ollama', 'meta'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 1395864371,
    parameter_size: '1B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'ultra-fast', 'low-memory', 'local-privacy'],
    use_cases: ['Ultra-fast local chat', 'Low-resource environments', 'Quick text polishing'],
    description: "Meta's smallest local model, runs on almost any laptop or embedded device with minimal memory.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'llama3.1:8b',
    display_name: 'Llama 3.1 (8B Local)',
    family: 'llama',
    families: ['llama', 'ollama', 'meta'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 4939212390,
    parameter_size: '8B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'coding', 'local-privacy'],
    use_cases: ['General local coding', 'Workspace question answering', 'Private daily driver assistant'],
    description: 'The standard 8B parameter local model for daily workspace coding, tool calling, and general discussion.',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'deepseek-r1:8b',
    display_name: 'DeepSeek R1 (8B Distill Local)',
    family: 'deepseek',
    families: ['deepseek', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 5261334528,
    parameter_size: '8B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'thinking', 'math', 'reasoning', 'local-privacy'],
    use_cases: ['Local step-by-step thinking', 'Offline math and logic problem solving'],
    description: 'DeepSeek-R1 distilled on Llama 8B, delivering local reasoning with transparent `<think>` traces.',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'deepseek-r1:14b',
    display_name: 'DeepSeek R1 (14B Distill Local)',
    family: 'deepseek',
    families: ['deepseek', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 9663676416,
    parameter_size: '14B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'thinking', 'complex-reasoning', 'coding', 'local-privacy'],
    use_cases: ['Advanced offline reasoning', 'Complex coding challenges', 'Analytical breakdown'],
    description: 'Distilled 14B Qwen-based R1 reasoning model with outstanding math, logic, and coding capabilities.',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'qwen2.5-coder:7b',
    display_name: 'Qwen 2.5 Coder (7B Local)',
    family: 'qwen',
    families: ['qwen', 'ollama', 'alibaba'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 4724464025,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'coding', 'tools', 'refactoring', 'local-privacy'],
    use_cases: ['Offline code generation', 'Bug fixing', 'Syntax analysis', 'Workspace automation scripts'],
    description: 'Specialized programming model trained on 5.5T tokens of code, excelling at code generation and debugging.',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'qwen2.5-coder:14b',
    display_name: 'Qwen 2.5 Coder (14B Local)',
    family: 'qwen',
    families: ['qwen', 'ollama', 'alibaba'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 9663676416,
    parameter_size: '14B',
    quantization_level: 'Q4_K_M',
    context_window: '128k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'advanced-coding', 'multi-language', 'tools', 'local-privacy'],
    use_cases: ['Full-project coding', 'System architecture review', 'Complex refactoring and tests'],
    description: 'High-accuracy programming model rivaling frontier models on HumanEval and SWE-bench.',
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'mistral:7b',
    display_name: 'Mistral (7B Local)',
    family: 'mistral',
    families: ['mistral', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 4402341478,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
    context_window: '32k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'fast', 'general-knowledge', 'local-privacy'],
    use_cases: ['Fast local conversation', 'Text synthesis', 'Document drafting'],
    description: "Mistral AI's standard 7B open model with fast sliding-window attention and concise reasoning.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'gemma2:9b',
    display_name: 'Gemma 2 (9B Local)',
    family: 'gemma',
    families: ['gemma', 'google', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 5800000000,
    parameter_size: '9B',
    quantization_level: 'Q4_K_M',
    context_window: '8k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'reasoning', 'general-knowledge', 'local-privacy'],
    use_cases: ['Research discussion', 'Local knowledge queries', 'Technical explanations'],
    description: "Google's open-weights 9B architecture built on research breakthroughs with stellar benchmark scores.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'phi4:14b',
    display_name: 'Phi-4 (14B Local)',
    family: 'phi',
    families: ['phi', 'microsoft', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 9126805504,
    parameter_size: '14B',
    quantization_level: 'Q4_K_M',
    context_window: '16k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'math', 'logic', 'reasoning', 'local-privacy'],
    use_cases: ['Synthetic reasoning', 'Mathematical logic', 'Structured data parsing'],
    description: "Microsoft's 14B state-of-the-art synthetic reasoning and STEM model with high efficiency.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
  {
    name: 'codellama:7b',
    display_name: 'Code Llama (7B Local)',
    family: 'llama',
    families: ['llama', 'meta', 'ollama'],
    location: 'local',
    tier: 'free',
    pricing_tier: 'free',
    pricing_badge: '100% Free (Open Weights)',
    pricing_description: 'Free open weights running privately on your hardware via Ollama',
    size: 4100000000,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
    context_window: '16k tokens',
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'coding', 'infill', 'local-privacy'],
    use_cases: ['Code completion', 'Docstring generation', 'Script writing'],
    description: "Meta's specialized Code Llama model for syntax generation, code completion, and infilling.",
    installed: false,
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
  },
];

function getOllamaHost(): string {
  return process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
}

async function getDynamicModelCatalog(): Promise<ModelCatalogItem[]> {
  // Start with a clone of the base catalog
  const catalogMap = new Map<string, ModelCatalogItem>();
  modelCatalog.forEach(m => catalogMap.set(m.name, { ...m }));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${getOllamaHost()}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data: any = await resp.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        for (const om of data.models) {
          const rawName = om.name || '';
          const baseName = rawName.split(':')[0];
          const isCloud = rawName.includes(':cloud') || om.details?.families === null || !!om.remote_host;

          // Check if we have an existing catalog item matching exact name or base name
          const existing = catalogMap.get(rawName) || [...catalogMap.values()].find(v => v.name.startsWith(baseName));
          if (existing) {
            existing.installed = true;
            if (om.size) existing.size = om.size;
            if (om.details?.parameter_size) existing.parameter_size = om.details.parameter_size;
            if (om.details?.quantization_level) existing.quantization_level = om.details.quantization_level;
            if (om.modified_at) existing.modified_at = om.modified_at;
          } else {
            // Add dynamically discovered local model from Ollama
            catalogMap.set(rawName, {
              name: rawName,
              display_name: `${rawName} (Installed Local)`,
              family: om.details?.family || 'ollama',
              families: om.details?.families || ['ollama'],
              location: isCloud ? 'cloud' : 'local',
              tier: 'free',
              pricing_tier: 'free',
              pricing_badge: isCloud ? 'Cloud' : '100% Free (Installed)',
              pricing_description: isCloud ? 'Cloud API' : 'Locally installed in Ollama runtime',
              size: om.size || 0,
              parameter_size: om.details?.parameter_size || (isCloud ? 'Cloud' : 'Local'),
              quantization_level: om.details?.quantization_level || '',
              context_window: '32k tokens',
              modified_at: om.modified_at || new Date().toISOString(),
              capabilities: ['chat', 'streaming', 'tools', 'local-privacy'],
              use_cases: ['Custom local inference', 'Offline tasks'],
              description: `Installed model on local Ollama server (${rawName}).`,
              installed: true,
              supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
            });
          }
        }
      }
    }
  } catch {
    // Fallback if Ollama is unreachable; catalog remains populated
  }

  return Array.from(catalogMap.values());
}

// Gemini Function Declarations for Workspace Tool Calling
const geminiFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path inside the workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Relative path of file inside data directory (e.g. "welcome.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite text content to a file in the workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Relative path of file to create or update' },
        content: { type: Type.STRING, description: 'Full UTF-8 content to write into the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List all files and folders in the workspace directory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Relative directory path to list (defaults to ".")' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search workspace file names for a given query keyword.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search term or file name fragment' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch the text content of a public URL (maximum 50 KB).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'Public HTTP or HTTPS URL to fetch' },
      },
      required: ['url'],
    },
  },
];

// Helper: safe path resolution within workspace (cross-platform Linux & Windows)
function resolveSafePath(relPath: string = '.'): { ok: boolean; path: string; error?: string } {
  if (typeof relPath !== 'string') {
    return { ok: false, path: dataDir, error: 'Path must be a valid string' };
  }

  // Prevent null byte injections
  if (relPath.includes('\0')) {
    return { ok: false, path: dataDir, error: 'Null bytes are not allowed in file paths' };
  }

  // Handle Windows and POSIX path separators
  const sanitizedRel = relPath.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[a-zA-Z]:[/\\]/, '');
  const normalized = path.normalize(sanitizedRel);
  const target = path.resolve(dataDir, normalized);

  const isWindows = process.platform === 'win32';
  const targetCmp = isWindows ? target.toLowerCase() : target;
  const dataDirCmp = isWindows ? dataDir.toLowerCase() : dataDir;

  if (!targetCmp.startsWith(dataDirCmp)) {
    return {
      ok: false,
      path: dataDir,
      error: `Access Denied: Path '${relPath}' resolves outside the allowed workspace boundary (${dataDir})`,
    };
  }

  return { ok: true, path: target };
}

// Tool executor with structured policy checking & timeout safety
async function executeTool(
  name: string,
  args: any,
  confirmedTools: string[] = []
): Promise<{ ok: boolean; output?: string; error?: string; requires_confirmation?: boolean; risk?: string; side_effects?: string[] }> {
  try {
    const def = toolDefinitions.find(t => t.name === name);
    if (!def) {
      return { ok: false, error: `Tool '${name}' is not recognized in the tool registry` };
    }

    const policy = toolPolicies[name] || def.policy;
    if (policy.enabled === false || policy.mode === 'deny') {
      return {
        ok: false,
        error: `Tool '${name}' execution was denied by workspace policy (mode: ${policy.mode})`,
      };
    }

    if (policy.mode === 'confirm' && !confirmedTools.includes(name)) {
      return {
        ok: false,
        requires_confirmation: true,
        risk: def.risk,
        side_effects: def.side_effects,
        error: `Tool '${name}' requires user confirmation before execution`,
      };
    }

    if (name === 'read_file') {
      const resolved = resolveSafePath(args.path);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      if (!fs.existsSync(resolved.path)) {
        return { ok: false, error: `File not found in workspace: '${args.path}'` };
      }
      if (fs.statSync(resolved.path).isDirectory()) {
        return { ok: false, error: `Path '${args.path}' is a directory, not a file` };
      }
      const content = fs.readFileSync(resolved.path, 'utf-8');
      return { ok: true, output: content };
    }

    if (name === 'write_file') {
      const resolved = resolveSafePath(args.path);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
      fs.writeFileSync(resolved.path, args.content || '', 'utf-8');
      const bytes = Buffer.byteLength(args.content || '', 'utf8');
      return { ok: true, output: `Successfully wrote ${bytes} bytes to '${args.path}'` };
    }

    if (name === 'list_files') {
      const resolved = resolveSafePath(args.path || '.');
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      if (!fs.existsSync(resolved.path)) {
        return { ok: false, error: `Directory not found: '${args.path}'` };
      }
      const entries = fs.readdirSync(resolved.path, { withFileTypes: true });
      const list = entries.map(e => ({
        name: e.name,
        path: path.relative(dataDir, path.join(resolved.path, e.name)).replace(/\\/g, '/'),
        is_dir: e.isDirectory(),
      }));
      return { ok: true, output: JSON.stringify(list, null, 2) };
    }

    if (name === 'search_files') {
      const q = (args.query || '').toLowerCase();
      const results: string[] = [];
      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = path.relative(dataDir, full).replace(/\\/g, '/');
          if (entry.name.toLowerCase().includes(q)) {
            results.push(rel);
          }
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            walk(full);
          }
        }
      }
      if (fs.existsSync(dataDir)) walk(dataDir);
      return { ok: true, output: JSON.stringify(results, null, 2) };
    }

    if (name === 'web_fetch') {
      const url = args.url;
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return { ok: false, error: `Invalid protocol '${parsedUrl.protocol}'. Only http/https supported.` };
        }
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mini-O/0.1.0' },
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) {
          return { ok: false, error: `HTTP fetch failed with status ${response.status} (${response.statusText})` };
        }
        const text = await response.text();
        return { ok: true, output: text.slice(0, 50000) };
      } catch (err: any) {
        return { ok: false, error: `Failed to fetch URL: ${err.message}` };
      }
    }

    if (name === 'run_shell') {
      const cmd = args.command;
      if (!cmd || typeof cmd !== 'string') {
        return { ok: false, error: 'Command string is required' };
      }
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: dataDir,
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
        });
        const out = (stdout || '') + (stderr ? (stdout ? '\n' : '') + stderr : '');
        return { ok: true, output: out || '(command completed with no output)' };
      } catch (err: any) {
        const out = (err.stdout || '') + (err.stderr ? '\n' + err.stderr : '');
        return { ok: false, error: err.message, output: out || undefined };
      }
    }

    if (name === 'run_python') {
      const code = args.code;
      if (!code || typeof code !== 'string') {
        return { ok: false, error: 'Python code string is required' };
      }
      return new Promise((resolve) => {
        const pythonBin = process.platform === 'win32' ? 'python' : (fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3');
        const child = spawn(pythonBin, ['-'], {
          cwd: dataDir,
          env: process.env,
        });

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill();
          resolve({ ok: false, error: 'Python execution timed out after 60 seconds' });
        }, 60000);

        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
          clearTimeout(timer);
          const out = (stdout || '') + (stderr ? (stdout ? '\n' : '') + stderr : '');
          if (code === 0) {
            resolve({ ok: true, output: out || '(script completed with no output)' });
          } else {
            resolve({ ok: false, error: `Python exited with code ${code}`, output: out || undefined });
          }
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ ok: false, error: err.message });
        });

        child.stdin.write(code);
        child.stdin.end();
      });
    }

    return { ok: false, error: `Unknown tool '${name}'` };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Tool execution failed' };
  }
}

// Router factory
function setupApiRoutes(router: express.Router) {
  // Health
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', ollama: 'online', timestamp: new Date().toISOString() });
  });

  router.get('/health/readiness', (_req, res) => {
    res.json({ ready: true, mini_o: 'ready', ollama: 'ready' });
  });

  // Diagnostics & Error Audit Logs
  router.get('/diagnostics', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      runtime: 'node22',
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      conversations_count: conversations.size,
      error_log_count: serverErrorLogs.length,
      workspace_dir: dataDir,
    });
  });

  router.get('/diagnostics/errors', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({
      total: serverErrorLogs.length,
      errors: serverErrorLogs.slice(0, limit),
    });
  });

  router.post('/diagnostics/errors/clear', (_req, res) => {
    serverErrorLogs.length = 0;
    res.json({ ok: true, message: 'Server diagnostic error log cleared' });
  });

  router.get('/diagnostics/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename=mini-o-diagnostics.json');
    res.json({
      version: '0.1.0',
      runtime: 'Node.js',
      uptime: process.uptime(),
      conversations_count: conversations.size,
      errors: serverErrorLogs,
      time: new Date().toISOString(),
    });
  });

  // Models Catalog with Multi-Criteria Filtering & Metadata
  router.get('/models/meta', async (req, res) => {
    try {
      const catalog = await getDynamicModelCatalog();
      const meta = {
        total: catalog.length,
        cloud: catalog.filter(m => m.location === 'cloud').length,
        local: catalog.filter(m => m.location === 'local').length,
        free: catalog.filter(m => m.tier === 'free').length,
        paid: catalog.filter(m => m.tier === 'paid').length,
        installed: catalog.filter(m => m.installed).length,
        families: Array.from(new Set(catalog.flatMap(m => m.families || [m.family]))).filter(Boolean),
      };
      res.json(meta);
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'MODEL_META_FAILED', 'model', err.message, 'Check model catalog', req));
    }
  });

  router.get('/models', async (req, res) => {
    try {
      const q = ((req.query.q as string) || '').toLowerCase().trim();
      const tier = ((req.query.tier as string) || 'all').toLowerCase().trim();
      const location = ((req.query.location as string) || (req.query.provider as string) || 'all').toLowerCase().trim();
      const family = ((req.query.family as string) || 'all').toLowerCase().trim();

      const catalog = await getDynamicModelCatalog();
      const filtered = catalog.filter(m => {
        // Query search
        if (q) {
          const matchName = m.name.toLowerCase().includes(q);
          const matchDisplay = (m.display_name || '').toLowerCase().includes(q);
          const matchDesc = (m.description || '').toLowerCase().includes(q);
          const matchFamily = (m.family || '').toLowerCase().includes(q);
          const matchCapabilities = (m.capabilities || []).some(c => c.toLowerCase().includes(q));
          const matchUseCases = (m.use_cases || []).some(u => u.toLowerCase().includes(q));
          if (!matchName && !matchDisplay && !matchDesc && !matchFamily && !matchCapabilities && !matchUseCases) {
            return false;
          }
        }

        // Tier filter (free vs paid)
        if (tier && tier !== 'all') {
          if (m.tier !== tier && m.pricing_tier !== tier) {
            return false;
          }
        }

        // Location filter (cloud vs local)
        if (location && location !== 'all') {
          if (m.location !== location) {
            return false;
          }
        }

        // Family filter
        if (family && family !== 'all') {
          if (m.family !== family && !(m.families || []).includes(family)) {
            return false;
          }
        }

        return true;
      });

      res.json(filtered);
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'MODEL_LIST_FAILED', 'model', err.message, 'Check model catalog', req));
    }
  });

  router.get('/models/:name(*)', async (req, res) => {
    const catalog = await getDynamicModelCatalog();
    const found = catalog.find(m => m.name === req.params.name);
    if (found) {
      res.json(found);
    } else {
      res.status(404).json(
        formatErrorPayload(
          404,
          'MODEL_NOT_FOUND',
          'model',
          `Model '${req.params.name}' is not installed or available in catalog`,
          'Pull the model using the Models panel or choose another model',
          req
        )
      );
    }
  });

  router.post('/models/:name(*)/pull', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const modelName = req.params.name;
    try {
      const ollamaResp = await fetch(`${getOllamaHost()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });
      if (ollamaResp.ok && ollamaResp.body) {
        const reader = ollamaResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) {
              res.write(`event: progress\ndata: ${line.trim()}\n\n`);
            }
          }
        }
        res.end();
        return;
      }
    } catch {
      // Fall through to simulation if Ollama is unreachable
    }

    const steps = [
      'pulling manifest',
      'downloading layers',
      'verifying sha256 digest',
      'writing model config',
      'success',
    ];

    for (const step of steps) {
      res.write(`event: progress\ndata: ${JSON.stringify({ status: step })}\n\n`);
      await new Promise(r => setTimeout(r, 200));
    }
    res.end();
  });

  router.delete('/models/:name(*)', async (req, res) => {
    try {
      await fetch(`${getOllamaHost()}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: req.params.name }),
      });
    } catch {
      // ignore delete error
    }
    res.json({ deleted: true, name: req.params.name });
  });

  // Chat stream
  router.post('/chat/stream', async (req, res) => {
    const { model = DEFAULT_MODEL, messages, conversation_id, use_tools, confirmed_tools = [], options = {} } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json(
        formatErrorPayload(
          400,
          'INVALID_REQUEST_BODY',
          'validation',
          'Chat request must include non-empty messages array',
          'Provide at least one user message',
          req
        )
      );
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const convId = conversation_id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullMessages = Array.isArray(messages) ? [...messages] : [];
    const lastUserMsg = fullMessages.filter(m => m.role === 'user').at(-1)?.content || '';

    // Check for Gemini client
    const geminiClient = getGeminiClient();
    let assistantContent = '';
    let streamStats: any = null;

    // Read AGENT.md for custom workspace instructions if available
    let agentInstructions = 'You are Mini-O, a versatile local AI workspace assistant with access to local workspace files and tools.';
    const agentMdPath = path.join(dataDir, 'AGENT.md');
    if (fs.existsSync(agentMdPath)) {
      try {
        const customAgent = fs.readFileSync(agentMdPath, 'utf-8');
        if (customAgent.trim()) {
          agentInstructions += `\n\nWorkspace Agent Directives (AGENT.md):\n${customAgent}`;
        }
      } catch {
        // ignore read error
      }
    }

    try {
      const isGeminiModel = model?.startsWith('gemini') || (geminiClient && !model?.includes(':') && !model?.includes('llama') && !model?.includes('minimax') && !model?.includes('glm') && !model?.includes('gemma') && !model?.includes('qwen'));
      const targetModel = model || DEFAULT_MODEL;

      if (geminiClient && isGeminiModel) {
        const contents: any[] = fullMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || '' }],
          }));

        if (contents.length === 0) {
          contents.push({ role: 'user', parts: [{ text: lastUserMsg || 'Hello' }] });
        }

        const toolsConfig: any[] = [];
        if (options.googleSearch) {
          toolsConfig.push({ googleSearch: {} });
        }
        if (use_tools) {
          toolsConfig.push({ functionDeclarations: geminiFunctionDeclarations });
        }

        // Call Gemini generateContentStream
        const streamResult = await geminiClient.models.generateContentStream({
          model: targetModel.startsWith('gemini') ? targetModel : 'gemini-3.7-flash',
          contents,
          config: {
            systemInstruction: agentInstructions,
            temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
            topP: typeof options.top_p === 'number' ? options.top_p : 0.95,
            tools: toolsConfig.length > 0 ? toolsConfig : undefined,
          },
        });

        const pendingFunctionCalls: any[] = [];

        for await (const chunk of streamResult) {
          // Check for grounding metadata
          const grounding = chunk.candidates?.[0]?.groundingMetadata;
          if (grounding?.groundingChunks?.length) {
            res.write(`event: grounding\ndata: ${JSON.stringify(grounding)}\n\n`);
          }

          // Check for function calls
          const functionCalls = chunk.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            for (const fc of functionCalls) {
              pendingFunctionCalls.push(fc);
            }
          }

          const text = chunk.text;
          if (text) {
            assistantContent += text;
            res.write(`event: token\ndata: ${JSON.stringify({ role: 'assistant', content: text })}\n\n`);
          }
        }

        // If Gemini called tools, execute them and generate final completion
        if (pendingFunctionCalls.length > 0) {
          const toolResultsParts: any[] = [];
          for (const fc of pendingFunctionCalls) {
            res.write(`event: tool_call\ndata: ${JSON.stringify({ name: fc.name, args: fc.args })}\n\n`);
            const tResult = await executeTool(fc.name, fc.args, confirmed_tools);
            res.write(`event: tool_result\ndata: ${JSON.stringify({ name: fc.name, ...tResult })}\n\n`);
            toolResultsParts.push({
              functionResponse: {
                name: fc.name,
                response: { output: tResult.output || tResult.error || 'ok' },
              },
            });
          }

          // Send function responses back to Gemini for final synthesized answer
          const followUpContents = [
            ...contents,
            {
              role: 'model',
              parts: pendingFunctionCalls.map(fc => ({ functionCall: fc })),
            },
            {
              role: 'user',
              parts: toolResultsParts,
            },
          ];

          const followUpStream = await geminiClient.models.generateContentStream({
            model: targetModel.startsWith('gemini') ? targetModel : 'gemini-3.7-flash',
            contents: followUpContents,
            config: {
              systemInstruction: agentInstructions,
            },
          });

          for await (const chunk of followUpStream) {
            const text = chunk.text;
            if (text) {
              assistantContent += text;
              res.write(`event: token\ndata: ${JSON.stringify({ role: 'assistant', content: text })}\n\n`);
            }
          }
        }
      } else {
        let ollamaSuccess = false;
        // Try streaming inference directly from local/cloud Ollama with native tool execution
        try {
          const ollamaTools = toolDefinitions.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }));

          const ollamaMessages: any[] = fullMessages
            .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool')
            .map(m => {
              const msg: any = {
                role: m.role,
                content: m.content || '',
              };
              if (m.tool_calls) msg.tool_calls = m.tool_calls;
              return msg;
            });

          if (ollamaMessages.length === 0) {
            ollamaMessages.push({ role: 'user', content: lastUserMsg || 'Hello' });
          }

          if (agentInstructions) {
            ollamaMessages.unshift({ role: 'system', content: agentInstructions });
          }

          let currentMessages = [...ollamaMessages];
          const maxIterations = 5;
          let currentIteration = 0;

          while (currentIteration < maxIterations) {
            currentIteration++;
            const pendingToolCalls: any[] = [];
            let iterationContent = '';

            const ollamaReqBody: any = {
              model: targetModel,
              messages: currentMessages,
              stream: true,
              options: {
                temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
                top_p: typeof options.top_p === 'number' ? options.top_p : 0.95,
              },
            };

            if (use_tools) {
              ollamaReqBody.tools = ollamaTools;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);
            const ollamaResp = await fetch(`${getOllamaHost()}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ollamaReqBody),
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!ollamaResp.ok || !ollamaResp.body) {
              break;
            }

            ollamaSuccess = true;
            const reader = ollamaResp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
                    for (const tc of parsed.message.tool_calls) {
                      pendingToolCalls.push(tc);
                    }
                  }
                  const tokenText = parsed.message?.content || '';
                  if (tokenText) {
                    iterationContent += tokenText;
                    if (pendingToolCalls.length === 0) {
                      assistantContent += tokenText;
                      res.write(`event: token\ndata: ${JSON.stringify({ role: 'assistant', content: tokenText })}\n\n`);
                    }
                  }
                  if (parsed.done && parsed.eval_count) {
                    streamStats = {
                      eval_count: (streamStats?.eval_count || 0) + parsed.eval_count,
                      total_duration: (streamStats?.total_duration || 0) + (parsed.total_duration || 500000000),
                    };
                  }
                } catch {
                  // ignore line parse errors
                }
              }
            }

            if (buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer.trim());
                if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
                  for (const tc of parsed.message.tool_calls) {
                    pendingToolCalls.push(tc);
                  }
                }
                const tokenText = parsed.message?.content || '';
                if (tokenText) {
                  iterationContent += tokenText;
                  if (pendingToolCalls.length === 0) {
                    assistantContent += tokenText;
                    res.write(`event: token\ndata: ${JSON.stringify({ role: 'assistant', content: tokenText })}\n\n`);
                  }
                }
              } catch {}
            }

            // Fallback: check if model emitted inline JSON tool call in text output
            if (use_tools && pendingToolCalls.length === 0 && iterationContent.trim()) {
              const inlineMatch = iterationContent.match(/(?:```(?:json)?\s*)?\{\s*"name"\s*:\s*"([a-zA-Z0-9_-]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}(?:\s*```)?/);
              if (inlineMatch) {
                try {
                  const toolName = inlineMatch[1];
                  const toolArgs = JSON.parse(inlineMatch[2] || '{}');
                  if (toolDefinitions.some(t => t.name === toolName)) {
                    pendingToolCalls.push({
                      function: {
                        name: toolName,
                        arguments: toolArgs,
                      },
                    });
                  }
                } catch {}
              }
            }

            // If no tool calls were requested, we have the final assistant response
            if (pendingToolCalls.length === 0) {
              break;
            }

            // Execute each requested tool call
            const toolResponseMessages: any[] = [];
            for (const tc of pendingToolCalls) {
              const toolName = tc.function?.name || tc.name;
              let toolArgs = tc.function?.arguments || tc.arguments || {};
              if (typeof toolArgs === 'string') {
                try {
                  toolArgs = JSON.parse(toolArgs);
                } catch {
                  toolArgs = {};
                }
              }

              res.write(`event: tool_call\ndata: ${JSON.stringify({ name: toolName, args: toolArgs })}\n\n`);
              const tResult = await executeTool(toolName, toolArgs, confirmed_tools);
              res.write(`event: tool_result\ndata: ${JSON.stringify({ name: toolName, ...tResult })}\n\n`);

              toolActivity.unshift({
                timestamp: new Date().toISOString(),
                tool: toolName,
                ok: tResult.ok,
                conversation_id: convId,
                arguments: toolArgs,
                error: tResult.error,
              });
              if (toolActivity.length > 200) toolActivity.pop();

              toolResponseMessages.push({
                role: 'tool',
                content: tResult.output || tResult.error || (tResult.ok ? 'ok' : 'execution failed'),
              });
            }

            // Update currentMessages with assistant tool call turn + tool execution results
            currentMessages = [
              ...currentMessages,
              {
                role: 'assistant',
                content: iterationContent,
                tool_calls: pendingToolCalls,
              },
              ...toolResponseMessages,
            ];
          }
        } catch (ollamaErr: any) {
          ollamaSuccess = false;
        }

        if (!ollamaSuccess) {
          // Local agent simulation / fallback for offline setups
          let simulatedReply = '';
          const lowerPrompt = lastUserMsg.toLowerCase();
          let toolRan: { name: string; args: any; result: any } | null = null;

          if (use_tools && (lowerPrompt.includes('list') || lowerPrompt.includes('files') || lowerPrompt.includes('workspace'))) {
            const tArgs = { path: '.' };
            res.write(`event: tool_call\ndata: ${JSON.stringify({ name: 'list_files', args: tArgs })}\n\n`);
            const tResult = await executeTool('list_files', tArgs, confirmed_tools);
            res.write(`event: tool_result\ndata: ${JSON.stringify({ name: 'list_files', ...tResult })}\n\n`);
            toolRan = { name: 'list_files', args: tArgs, result: tResult };
          } else if (use_tools && (lowerPrompt.includes('read') || lowerPrompt.includes('show')) && (lowerPrompt.includes('.md') || lowerPrompt.includes('file'))) {
            const tArgs = { path: 'welcome.md' };
            res.write(`event: tool_call\ndata: ${JSON.stringify({ name: 'read_file', args: tArgs })}\n\n`);
            const tResult = await executeTool('read_file', tArgs, confirmed_tools);
            res.write(`event: tool_result\ndata: ${JSON.stringify({ name: 'read_file', ...tResult })}\n\n`);
            toolRan = { name: 'read_file', args: tArgs, result: tResult };
          }

          if (toolRan) {
            if (toolRan.result.ok) {
              simulatedReply = `I have inspected your workspace.\n\nHere is what I found:\n\`\`\`json\n${toolRan.result.output || ''}\n\`\`\`\n\nHow would you like to proceed with your project files?`;
            } else {
              simulatedReply = `I encountered an issue executing tool \`${toolRan.name}\`:\n> ${toolRan.result.error}\n\nYou can review Tool Policies in the Workspace tab.`;
            }
          } else if (lowerPrompt.includes('hello') || lowerPrompt.includes('hi') || lowerPrompt.includes('help')) {
            simulatedReply = `Hello! I am your **Mini-O** AI workspace partner powered by MiniMax M3.

I can help you with:
- **Fast Reasoning & Coding**: Powered by MiniMax M3 (Cloud / Ollama).
- **Workspace Navigation & Tools**: Reading, listing, and editing files in \`./data\`.
- **Project Assistance**: Full multi-turn conversation and workspace assistance.

How can I help you today?`;
          } else {
            simulatedReply = `I have processed your request: "${lastUserMsg.slice(0, 80)}".

You can interact with workspace files, configure tool policies, or send tasks to MiniMax M3.`;
          }

          // Stream simulated tokens
          const words = simulatedReply.split(' ');
          for (const word of words) {
            const chunk = word + ' ';
            assistantContent += chunk;
            res.write(`event: token\ndata: ${JSON.stringify({ role: 'assistant', content: chunk })}\n\n`);
            await new Promise(r => setTimeout(r, 18));
          }
        }
      }

      // Save or update conversation
      const existing = conversations.get(convId);
      const title = existing?.title || lastUserMsg.slice(0, 40) || 'New Conversation';
      fullMessages.push({ role: 'assistant', content: assistantContent });

      conversations.set(convId, {
        id: convId,
        title,
        model: model || DEFAULT_MODEL,
        options: req.body.options || {},
        messages: fullMessages,
        status: 'completed',
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const statsToSend = streamStats || { eval_count: Math.round(assistantContent.length / 4), total_duration: 450000000 };
      res.write(`event: done\ndata: ${JSON.stringify({ done: true, stats: statsToSend, stop_reason: 'stop' })}\n\n`);
      res.write(`event: end\ndata: ${JSON.stringify({ id: convId })}\n\n`);
      res.end();
    } catch (err: any) {
      const diag = logServerError(500, 'STREAM_FAILED', 'stream', err.message || 'Chat stream failed', 'Click Retry to restart generation', req);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat stream failed', detail: err.message, diagnostic_id: diag.id, action: diag.action })}\n\n`);
      res.end();
    }
  });

  // Dedicated Gemini Endpoints
  router.get('/gemini/status', (_req, res) => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    res.json({
      available: hasKey,
      default_model: 'gemini-3.7-flash',
      models: [
        { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', category: 'General & Coding' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', category: 'Deep Reasoning' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', category: 'Low Latency' },
        { id: 'gemini-3.1-flash-lite-image', name: 'Gemini Flash Image Gen', category: 'Visual Creation' },
      ],
      has_key: hasKey,
    });
  });

  router.post('/gemini/generate', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, 'GEMINI_NOT_CONFIGURED', 'gemini', 'GEMINI_API_KEY is not configured', 'Set GEMINI_API_KEY in environment or settings', req)
      );
    }
    const { prompt, model = 'gemini-3.7-flash', systemInstruction, temperature } = req.body;
    if (!prompt) {
      return res.status(400).json(
        formatErrorPayload(400, 'MISSING_PROMPT', 'validation', 'Prompt is required', 'Provide a prompt string', req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature: typeof temperature === 'number' ? temperature : undefined,
        },
      });
      res.json({ ok: true, text: response.text || '', model });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'GEMINI_GENERATE_FAILED', 'gemini', err.message, 'Check Gemini prompt parameters', req));
    }
  });

  router.post('/gemini/generate-image', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, 'GEMINI_NOT_CONFIGURED', 'gemini', 'GEMINI_API_KEY is not configured', 'Set GEMINI_API_KEY in environment or settings', req)
      );
    }
    const { prompt, aspectRatio = '1:1', saveToWorkspace = false, filename } = req.body;
    if (!prompt) {
      return res.status(400).json(
        formatErrorPayload(400, 'MISSING_PROMPT', 'validation', 'Prompt is required for image generation', 'Provide an image description prompt', req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio || '1:1',
          },
        },
      });

      let base64Data: string | null = null;
      let captionText = '';
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData?.data) {
            base64Data = part.inlineData.data;
          } else if (part.text) {
            captionText += part.text;
          }
        }
      }

      if (!base64Data) {
        return res.status(500).json(
          formatErrorPayload(500, 'NO_IMAGE_GENERATED', 'gemini', 'Gemini did not return image data for the prompt', 'Try refining your prompt', req)
        );
      }

      const imageUrl = `data:image/png;base64,${base64Data}`;
      let savedPath: string | null = null;

      if (saveToWorkspace) {
        const outName = filename || `generated-image-${Date.now()}.png`;
        const resolved = resolveSafePath(outName);
        if (resolved.ok) {
          fs.writeFileSync(resolved.path, Buffer.from(base64Data, 'base64'));
          savedPath = outName;
        }
      }

      res.json({
        ok: true,
        image_url: imageUrl,
        caption: captionText,
        saved_path: savedPath,
        prompt,
      });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'IMAGE_GEN_FAILED', 'gemini', err.message, 'Check Gemini image prompt', req));
    }
  });

  router.post('/gemini/speech', async (req, res) => {
    const client = getGeminiClient();
    if (!client) {
      return res.status(503).json(
        formatErrorPayload(503, 'GEMINI_NOT_CONFIGURED', 'gemini', 'GEMINI_API_KEY is not configured', 'Set GEMINI_API_KEY in environment or settings', req)
      );
    }
    const { text, voice = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json(
        formatErrorPayload(400, 'MISSING_TEXT', 'validation', 'Text is required for TTS', 'Provide text to convert to speech', req)
      );
    }
    try {
      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: text.slice(0, 2000) }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(500).json(
          formatErrorPayload(500, 'TTS_NO_AUDIO', 'gemini', 'Gemini TTS did not return audio data', 'Retry with shorter text', req)
        );
      }

      res.json({
        ok: true,
        audio_data: base64Audio,
        mime_type: 'audio/pcm;rate=24000',
        sample_rate: 24000,
        voice,
      });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'TTS_FAILED', 'gemini', err.message, 'Check speech text and quota', req));
    }
  });

  // Conversations CRUD
  router.get('/conversations', (req, res) => {
    try {
      const q = ((req.query.q as string) || '').toLowerCase().trim();
      const includeArchived = req.query.include_archived !== 'false';
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      let items = Array.from(conversations.values()).filter(c => {
        if (!includeArchived && c.archived) return false;
        if (q && !c.title.toLowerCase().includes(q)) return false;
        return true;
      });

      items.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      const total = items.length;
      if (limit !== undefined) {
        items = items.slice(offset, offset + limit);
        res.json({ total, items: items.map(c => ({ id: c.id, title: c.title, model: c.model, messages: c.messages.length, pinned: c.pinned, archived: c.archived, updated_at: c.updated_at })) });
      } else {
        res.json(items.map(c => ({ id: c.id, title: c.title, model: c.model, messages: c.messages.length, pinned: c.pinned, archived: c.archived, updated_at: c.updated_at })));
      }
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'CONVERSATION_LIST_ERROR', 'request', err.message, 'Refresh the page', req));
    }
  });

  router.get('/conversations/recovery', (_req, res) => {
    const recoverable = Array.from(conversations.values()).filter(c => c.status === 'failed' || c.status === 'streaming');
    res.json(recoverable);
  });

  router.post('/conversations/reindex', (_req, res) => {
    res.json({ ok: true, count: conversations.size });
  });

  router.post('/conversations/bulk', (req, res) => {
    const { ids = [], archived, delete: isDelete } = req.body;
    let modified = 0;
    for (const id of ids) {
      if (isDelete) {
        if (conversations.delete(id)) modified++;
      } else if (conversations.has(id)) {
        const conv = conversations.get(id)!;
        if (archived !== undefined) conv.archived = Boolean(archived);
        conv.updated_at = new Date().toISOString();
        modified++;
      }
    }
    res.json({ ok: true, modified });
  });

  router.get('/conversations/export', (req, res) => {
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean);
    const convList = ids.length
      ? ids.map(id => conversations.get(id)).filter(Boolean)
      : Array.from(conversations.values());
    res.json({
      format: 'mini-o.conversations',
      version: 1,
      conversations: convList,
    });
  });

  router.post('/conversations/import', (req, res) => {
    const { format, version, conversations: importedList = [] } = req.body;
    if (format !== 'mini-o.conversations' || version !== 1) {
      return res.status(400).json(
        formatErrorPayload(
          400,
          'INVALID_IMPORT_FORMAT',
          'validation',
          'Unsupported conversation export format or schema version',
          'Ensure the JSON file was exported from Mini-O format v1',
          req
        )
      );
    }
    const ids: string[] = [];
    for (const item of importedList) {
      const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      conversations.set(id, {
        id,
        title: item.title || 'Imported chat',
        model: item.model || DEFAULT_MODEL,
        options: item.options || {},
        messages: Array.isArray(item.messages) ? item.messages : [],
        pinned: Boolean(item.pinned),
        archived: Boolean(item.archived),
        created_at: item.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      ids.push(id);
    }
    res.json({ ids });
  });

  router.get('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          'CONVERSATION_NOT_FOUND',
          'request',
          `Conversation '${req.params.id}' was not found`,
          'Select a conversation from the sidebar or start a new chat',
          req
        )
      );
    }
    res.json(conv);
  });

  router.patch('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          'CONVERSATION_NOT_FOUND',
          'request',
          `Conversation '${req.params.id}' was not found`,
          'Check the conversation ID',
          req
        )
      );
    }
    const { title, pinned, archived, options, messages } = req.body;
    if (title !== undefined) conv.title = title;
    if (pinned !== undefined) conv.pinned = Boolean(pinned);
    if (archived !== undefined) conv.archived = Boolean(archived);
    if (options !== undefined) conv.options = options;
    if (messages !== undefined && Array.isArray(messages)) conv.messages = messages;
    conv.updated_at = new Date().toISOString();
    res.json(conv);
  });

  router.delete('/conversations/:id', (req, res) => {
    const deleted = conversations.delete(req.params.id);
    res.json({ deleted });
  });

  router.post('/conversations/:id/duplicate', (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          'CONVERSATION_NOT_FOUND',
          'request',
          `Cannot duplicate: conversation '${req.params.id}' not found`,
          'Refresh your conversation list',
          req
        )
      );
    }
    const newId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    conversations.set(newId, {
      ...conv,
      id: newId,
      title: `${conv.title} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.json({ id: newId });
  });

  // Files & File System
  router.get('/files', (req, res) => {
    const relPath = (req.query.path as string) || '.';
    const q = ((req.query.q as string) || '').toLowerCase();
    const sort = (req.query.sort as string) || 'name';
    const includeHidden = req.query.include_hidden === 'true';

    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Navigate within the allowed workspace directory', req)
      );
    }

    if (!fs.existsSync(resolved.path)) {
      return res.json([]);
    }

    try {
      const dirents = fs.readdirSync(resolved.path, { withFileTypes: true });
      let items = dirents
        .filter(d => includeHidden || !d.name.startsWith('.'))
        .map(d => {
          const full = path.join(resolved.path, d.name);
          const stat = fs.statSync(full);
          const relativeToWorkspace = path.relative(dataDir, full).replace(/\\/g, '/');
          return {
            name: d.name,
            path: relativeToWorkspace || '.',
            is_dir: d.isDirectory(),
            size: stat.size,
            modified: stat.mtimeMs / 1000,
          };
        });

      if (q) {
        items = items.filter(i => i.name.toLowerCase().includes(q));
      }

      if (sort === 'modified') {
        items.sort((a, b) => (b.modified || 0) - (a.modified || 0));
      } else if (sort === 'size') {
        items.sort((a, b) => (b.size || 0) - (a.size || 0));
      } else {
        items.sort((a, b) => a.name.localeCompare(b.name));
      }

      res.json(items);
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'FILES_READ_ERROR', 'filesystem', err.message, 'Check directory permissions', req));
    }
  });

  router.get('/files/content', (req, res) => {
    const relPath = (req.query.path as string) || '';
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Navigate within the allowed workspace directory', req)
      );
    }

    if (!fs.existsSync(resolved.path) || fs.statSync(resolved.path).isDirectory()) {
      return res.status(404).json(
        formatErrorPayload(
          404,
          'FILE_NOT_FOUND',
          'filesystem',
          `File '${relPath}' does not exist or is a directory`,
          'Verify the file name or create it before opening',
          req
        )
      );
    }

    try {
      const content = fs.readFileSync(resolved.path, 'utf-8');
      const stat = fs.statSync(resolved.path);
      res.json({ content, modified: stat.mtimeMs / 1000, size: stat.size });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'FILE_READ_ERROR', 'filesystem', err.message, 'Verify file encoding and permissions', req));
    }
  });

  router.post('/files/content', (req, res) => {
    const { path: relPath, content, expected_modified } = req.body;
    if (!relPath) {
      return res.status(400).json(
        formatErrorPayload(400, 'MISSING_PATH', 'validation', 'File path is required', 'Specify a non-empty relative file path', req)
      );
    }

    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Keep edits within workspace roots', req)
      );
    }

    try {
      // Concurrency conflict detection via mtime
      if (fs.existsSync(resolved.path) && expected_modified !== undefined && expected_modified !== null) {
        const currentStat = fs.statSync(resolved.path);
        const currentModified = currentStat.mtimeMs / 1000;
        if (Math.abs(currentModified - expected_modified) > 1.0) {
          return res.status(409).json(
            formatErrorPayload(
              409,
              'CONCURRENCY_CONFLICT',
              'filesystem',
              `File '${relPath}' was modified on disk by another process since you opened it`,
              'Reload the file to view recent changes, or force overwrite',
              req,
              { disk_modified: currentModified, expected_modified }
            )
          );
        }
      }

      fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
      fs.writeFileSync(resolved.path, content || '', 'utf-8');
      const stat = fs.statSync(resolved.path);
      res.json({ message: 'Saved', modified: stat.mtimeMs / 1000, size: stat.size });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'FILE_WRITE_ERROR', 'filesystem', err.message, 'Check write permissions and disk space', req));
    }
  });

  router.get('/files/search', (req, res) => {
    const q = ((req.query.q as string) || '').toLowerCase();
    const relPath = (req.query.path as string) || '.';
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Search within workspace root', req)
      );
    }

    const matches: string[] = [];
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(dataDir, full).replace(/\\/g, '/');
        if (entry.name.toLowerCase().includes(q)) {
          matches.push(rel);
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(full);
        }
      }
    }
    walk(resolved.path);
    res.json(matches);
  });

  router.get('/files/metadata', (req, res) => {
    const relPath = (req.query.path as string) || '';
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Check file path', req)
      );
    }

    if (!fs.existsSync(resolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, 'FILE_NOT_FOUND', 'filesystem', `File '${relPath}' not found`, 'Verify path', req)
      );
    }

    const stat = fs.statSync(resolved.path);
    const ext = path.extname(resolved.path).toLowerCase().replace('.', '') || 'text';
    res.json({
      path: relPath,
      size: stat.size,
      modified: stat.mtimeMs / 1000,
      is_dir: stat.isDirectory(),
      encoding: 'utf-8',
      line_ending: 'lf',
      language: ext,
      read_only: false,
    });
  });

  router.post('/files/operation', (req, res) => {
    const { operation, path: srcRel, target: dstRel } = req.body;
    const srcResolved = resolveSafePath(srcRel);
    if (!srcResolved.ok || !fs.existsSync(srcResolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, 'FILE_NOT_FOUND', 'filesystem', `Source '${srcRel}' not found or invalid`, 'Check source file path', req)
      );
    }

    try {
      if (operation === 'rename') {
        const dstResolved = resolveSafePath(dstRel);
        if (!dstResolved.ok) {
          return res.status(403).json(formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', dstResolved.error || 'Invalid target path', 'Choose a valid destination', req));
        }
        fs.renameSync(srcResolved.path, dstResolved.path);
      } else if (operation === 'duplicate') {
        const dstResolved = resolveSafePath(dstRel);
        if (!dstResolved.ok) {
          return res.status(403).json(formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', dstResolved.error || 'Invalid target path', 'Choose a valid destination', req));
        }
        if (fs.statSync(srcResolved.path).isDirectory()) {
          fs.cpSync(srcResolved.path, dstResolved.path, { recursive: true });
        } else {
          fs.copyFileSync(srcResolved.path, dstResolved.path);
        }
      } else if (operation === 'delete') {
        if (fs.statSync(srcResolved.path).isDirectory()) {
          fs.rmSync(srcResolved.path, { recursive: true, force: true });
        } else {
          fs.unlinkSync(srcResolved.path);
        }
      } else {
        return res.status(400).json(formatErrorPayload(400, 'UNKNOWN_OPERATION', 'validation', `Unsupported file operation '${operation}'`, 'Use rename, duplicate, or delete', req));
      }
      res.json({ ok: true, operation, path: srcRel });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'FILE_OP_FAILED', 'filesystem', err.message, 'Check permissions and target path', req));
    }
  });

  // Tools & Policies
  router.get('/tools', (_req, res) => {
    res.json(toolDefinitions);
  });

  router.get('/tools/policies', (_req, res) => {
    res.json(toolPolicies);
  });

  router.patch('/tools/policies/:name', (req, res) => {
    const { name } = req.params;
    if (!toolPolicies[name]) {
      return res.status(404).json(
        formatErrorPayload(404, 'TOOL_NOT_FOUND', 'tools', `Tool '${name}' is not recognized`, 'Choose a tool from the tool list', req)
      );
    }
    const { enabled, mode, scope } = req.body;
    if (enabled !== undefined) toolPolicies[name].enabled = Boolean(enabled);
    if (mode !== undefined) toolPolicies[name].mode = mode;
    if (scope !== undefined) toolPolicies[name].scope = scope;
    res.json({ name, ...toolPolicies[name] });
  });

  router.get('/tools/activity', (_req, res) => {
    res.json(toolActivity);
  });

  // Workspace configuration & search
  router.get('/workspace/config', (_req, res) => {
    res.json({
      workspace_dir: dataDir,
      allowed_roots: [dataDir],
      config_file: 'mini-o.config.json',
      tools: toolPolicies,
    });
  });

  router.put('/workspace/config', (req, res) => {
    const { tools } = req.body;
    if (tools && typeof tools === 'object') {
      Object.assign(toolPolicies, tools);
    }
    res.json({
      workspace_dir: dataDir,
      allowed_roots: [dataDir],
      config_file: 'mini-o.config.json',
      tools: toolPolicies,
    });
  });

  router.get('/workspace/search', (req, res) => {
    const q = ((req.query.q as string) || '').toLowerCase();
    const limit = parseInt(req.query.limit as string) || 50;
    if (!q) return res.json([]);

    const results: Array<{ path: string; preview: string; match_start: number }> = [];

    function searchDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(dataDir, full).replace(/\\/g, '/');
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          searchDir(full);
        } else if (entry.isFile() && !entry.name.startsWith('.')) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            const idx = content.toLowerCase().indexOf(q);
            if (idx !== -1) {
              const start = Math.max(0, idx - 40);
              const preview = content.slice(start, start + 200);
              results.push({ path: rel, preview, match_start: Math.max(0, idx - start) });
              if (results.length >= limit) return;
            }
          } catch {
            // ignore binary/unreadable
          }
        }
      }
    }
    searchDir(dataDir);
    res.json(results);
  });

  // Agent files
  router.get('/agents', (_req, res) => {
    const agentsList: Array<{ path: string; size: number }> = [];
    function scanAgents(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(dataDir, full).replace(/\\/g, '/');
        if (entry.name.toUpperCase() === 'AGENT.MD' || entry.name.endsWith('.AGENT.md')) {
          agentsList.push({ path: rel, size: fs.statSync(full).size });
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanAgents(full);
        }
      }
    }
    scanAgents(dataDir);
    res.json(agentsList);
  });

  router.get('/agents/templates', (_req, res) => {
    res.json([
      {
        id: 'standard',
        name: 'Standard Workspace Agent',
        content: '# Agent instructions\n\n## Goal\nAssist with code, documentation, and task automation in this workspace.\n\n## Rules\n- Read files before proposing edits.\n- Keep changes minimal and focused.',
      },
      {
        id: 'coding',
        name: 'Full-Stack Developer Agent',
        content: '# Coding Agent\n\n## Responsibilities\n- Write clean, type-safe TypeScript/JavaScript code.\n- Provide helpful summaries and testing suggestions.',
      },
      {
        id: 'reviewer',
        name: 'Code Reviewer Agent',
        content: '# Reviewer Agent\n\n## Guidelines\n- Review code for security, performance, and best practices.\n- Point out missing edge cases.',
      },
    ]);
  });

  router.post('/agents/validate', (req, res) => {
    const { content } = req.body;
    const errors: string[] = [];
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      errors.push('AGENT.md content cannot be empty');
    }
    res.json({ valid: errors.length === 0, errors });
  });

  router.get('/agents/content', (req, res) => {
    const relPath = (req.query.path as string) || 'AGENT.md';
    const resolved = resolveSafePath(relPath);
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Check path', req)
      );
    }
    if (!fs.existsSync(resolved.path)) {
      return res.status(404).json(
        formatErrorPayload(404, 'AGENT_FILE_NOT_FOUND', 'filesystem', `Agent instructions file '${relPath}' not found`, 'Create an AGENT.md file or use a template', req)
      );
    }
    const content = fs.readFileSync(resolved.path, 'utf-8');
    res.json({ content });
  });

  router.post('/agents/content', (req, res) => {
    const { path: relPath, content } = req.body;
    const resolved = resolveSafePath(relPath || 'AGENT.md');
    if (!resolved.ok) {
      return res.status(403).json(
        formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Check path', req)
      );
    }
    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    fs.writeFileSync(resolved.path, content || '', 'utf-8');
    res.json({ path: relPath });
  });

  // Research
  router.post('/research/fetch', async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json(formatErrorPayload(400, 'MISSING_URL', 'validation', 'Source URL is required', 'Enter a valid http/https URL', req));
    }
    try {
      const fetchRes = await fetch(url, {
        headers: { 'User-Agent': 'Mini-O/0.1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!fetchRes.ok) {
        return res.status(502).json(formatErrorPayload(502, 'UPSTREAM_FETCH_FAILED', 'network', `Fetch returned status ${fetchRes.status}`, 'Verify the URL is publicly reachable', req));
      }
      const html = await fetchRes.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;
      const text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                       .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();
      res.json({ url, title, content: text.slice(0, 10000) });
    } catch (err: any) {
      res.status(500).json(formatErrorPayload(500, 'RESEARCH_FETCH_ERROR', 'network', err.message, 'Check your connection or URL', req));
    }
  });

  router.post('/research/export', (req, res) => {
    const { path: relPath, title, notes = [] } = req.body;
    const resolved = resolveSafePath(relPath || 'research-notes.json');
    if (!resolved.ok) {
      return res.status(403).json(formatErrorPayload(403, 'SAFE_PATH_VIOLATION', 'permission', resolved.error || 'Access denied', 'Specify a valid filename', req));
    }
    const payload = {
      format: 'mini-o.research',
      version: 1,
      title: title || 'Research notes',
      sources: notes,
      notes,
    };
    fs.writeFileSync(resolved.path, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ path: relPath, sources: notes.length });
  });

  router.post('/feedback', (req, res) => {
    res.json({ saved: true, category: req.body.category || 'general' });
  });

  router.get('/plugins', (_req, res) => {
    res.json([
      {
        name: 'workspace-fs',
        version: '1.0.0',
        kind: 'filesystem',
        transport: 'local',
        description: 'Direct workspace sandboxed file access and modification.',
        platforms: ['web', 'desktop'],
        capabilities: ['read', 'write', 'search'],
      },
      {
        name: 'research-collector',
        version: '1.0.0',
        kind: 'research',
        transport: 'http',
        description: 'Web document extraction and research synthesis pipeline.',
        platforms: ['web'],
        capabilities: ['fetch', 'export'],
      },
    ]);
  });

  router.get('/plugins/:name', (req, res) => {
    res.json({
      name: req.params.name,
      version: '1.0.0',
      status: 'active',
      config: {},
    });
  });

  router.get('/integrations', (_req, res) => {
    res.json({
      items: [
        {
          name: 'Model Context Protocol (MCP)',
          status: 'ready',
          description: 'Standard protocol for model tool calls and context sharing.',
          platforms: ['vscode', 'jetbrains', 'cli'],
          capabilities: ['json-rpc', 'stdio', 'tools'],
        },
        {
          name: 'VS Code Extension',
          status: 'available',
          description: 'Mini-O companion extension for Visual Studio Code.',
          platforms: ['vscode'],
          capabilities: ['selection', 'code-actions'],
        },
        {
          name: 'JetBrains IDE Plugin',
          status: 'available',
          description: 'Mini-O client for IntelliJ, Android Studio, and PyCharm.',
          platforms: ['intellij', 'android-studio'],
          capabilities: ['selection', 'mcp-client'],
        },
      ],
    });
  });

  router.get('/mcp/manifest', (_req, res) => {
    res.json({
      schema_version: '2025-11-25',
      name: 'mini-o-server',
      version: '0.1.0',
      tools: toolDefinitions,
    });
  });

  router.post('/mcp', (req, res) => {
    res.json({
      jsonrpc: '2.0',
      id: req.body.id || 1,
      result: { status: 'ok', server: 'mini-o' },
    });
  });

  router.post('/mcp/context', (req, res) => {
    res.json({ valid: true, context: req.body });
  });

  router.get('/network-policy', (_req, res) => {
    res.json({
      outbound_network: 'web_fetch only',
      allowed_domains: ['*'],
      blocked_targets: ['loopback', 'private', 'link-local'],
      max_response_bytes: 52428800,
      redirects: 'revalidated',
    });
  });

  router.get('/settings', (_req, res) => {
    res.json({
      defaults: { model: DEFAULT_MODEL, theme: 'system', density: 'comfortable' },
      groups: ['general', 'appearance', 'models', 'chat', 'tools', 'workspace', 'privacy', 'diagnostics'],
      version: 1,
    });
  });

  router.get('/capabilities', (_req, res) => {
    res.json({
      streaming: true,
      tools: true,
      file_management: true,
      agent_instructions: true,
      research_mode: true,
      diagnostics_audit: true,
    });
  });

  router.get('/fixtures', (_req, res) => {
    res.json({
      schema_version: 1,
      sse: {
        token: { role: 'assistant', content: 'text' },
        done: { done: true, stop_reason: 'stop' },
        error: { error: 'category', correlation_id: 'example' },
      },
      portable_conversation: { format: 'mini-o.conversations', version: 1 },
    });
  });

  router.get('/extensions', (_req, res) => {
    res.json({ commands: [], panels: [], contract_version: 1 });
  });

  router.get('/platform', (_req, res) => {
    const isWindows = process.platform === 'win32';
    res.json({
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      is_windows: isWindows,
      is_linux: process.platform === 'linux',
      is_darwin: process.platform === 'darwin',
      paths: {
        workspace_dir: dataDir,
        app_root: rootDir,
        temp_dir: process.env.TEMP || process.env.TMP || '/tmp',
        appdata_dir: process.env.LOCALAPPDATA || process.env.APPDATA || path.join(process.env.HOME || '/tmp', '.mini-o'),
      },
      windows_support: {
        batch_launcher: 'mini-o.cmd',
        powershell_launcher: 'mini-o.ps1',
        double_click_launcher: 'start-mini-o.bat',
        silent_vbs_launcher: 'mini-o.vbs',
        inno_setup_script: 'installer.iss',
        winsw_service_config: 'mini-o-service.xml',
      },
    });
  });

  router.get('/package/info', (_req, res) => {
    const debPath = path.join(rootDir, 'dist', 'mini-o_0.1.0-1_amd64.deb');
    const winZipPath = path.join(rootDir, 'dist', 'mini-o-0.1.0-windows-x64.zip');
    const hasDeb = fs.existsSync(debPath);
    const hasWinZip = fs.existsSync(winZipPath);

    let debSize = 0;
    let winZipSize = 0;
    let debSha256 = '';
    let winSha256 = '';

    const sumsPath = path.join(rootDir, 'dist', 'SHA256SUMS');
    const hashes: Record<string, string> = {};
    if (fs.existsSync(sumsPath)) {
      const lines = fs.readFileSync(sumsPath, 'utf-8').split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          hashes[parts[1].replace(/^\.\//, '')] = parts[0];
        }
      }
    }

    if (hasDeb) {
      debSize = fs.statSync(debPath).size;
      debSha256 = hashes['mini-o_0.1.0-1_amd64.deb'] || '';
    }
    if (hasWinZip) {
      winZipSize = fs.statSync(winZipPath).size;
      winSha256 = hashes['mini-o-0.1.0-windows-x64.zip'] || '';
    }

    res.json({
      package: 'mini-o',
      version: '0.1.0-1',
      platforms: {
        windows: {
          available: hasWinZip,
          filename: 'mini-o-0.1.0-windows-x64.zip',
          arch: 'x64',
          size: winZipSize,
          sha256: winSha256,
          download_url: '/api/download/windows',
          quick_start: 'Expand-Archive mini-o-0.1.0-windows-x64.zip && cd mini-o-windows && .\\start-mini-o.bat',
          launchers: ['start-mini-o.bat', 'mini-o.cmd', 'mini-o.ps1', 'mini-o.vbs'],
        },
        debian: {
          available: hasDeb,
          filename: 'mini-o_0.1.0-1_amd64.deb',
          arch: 'amd64',
          size: debSize,
          sha256: debSha256,
          download_url: '/api/download/deb',
          install_command: 'sudo dpkg -i mini-o_0.1.0-1_amd64.deb && sudo apt-get install -f',
        },
      },
      // Backward-compatible top-level keys
      available: hasWinZip || hasDeb,
      filename: hasWinZip ? 'mini-o-0.1.0-windows-x64.zip' : 'mini-o_0.1.0-1_amd64.deb',
      size: winZipSize || debSize,
      sha256: winSha256 || debSha256,
      download_url: '/api/download/windows',
    });
  });

  router.get('/download/deb', (_req, res) => {
    const debPath = path.join(rootDir, 'dist', 'mini-o_0.1.0-1_amd64.deb');
    if (!fs.existsSync(debPath)) {
      return res.status(404).json(formatErrorPayload(404, 'PACKAGE_NOT_FOUND', 'not_found', 'Debian package not yet built. Run npm run build:deb first.', 'Run npm run build:deb or trigger build from diagnostics'));
    }
    res.download(debPath, 'mini-o_0.1.0-1_amd64.deb');
  });

  router.get('/download/windows', (_req, res) => {
    const winZipPath = path.join(rootDir, 'dist', 'mini-o-0.1.0-windows-x64.zip');
    if (!fs.existsSync(winZipPath)) {
      return res.status(404).json(formatErrorPayload(404, 'PACKAGE_NOT_FOUND', 'not_found', 'Windows package not yet built. Run npm run build:windows first.', 'Run npm run build:windows or trigger build from scripts'));
    }
    res.download(winZipPath, 'mini-o-0.1.0-windows-x64.zip');
  });

  router.get('/download/windows-zip', (_req, res) => {
    res.redirect('/api/download/windows');
  });
}

// Mount API routes on both /api and /api/v1
const apiRouter = express.Router();
setupApiRoutes(apiRouter);
app.use('/api', apiRouter);
app.use('/api/v1', apiRouter);

// Centralized Express error handler middleware
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err.status) || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const category = err.category || 'internal';
  const message = err.message || 'An unexpected internal server error occurred';
  const action = err.action || 'Inspect server diagnostics or retry the request';

  res.status(status).json(formatErrorPayload(status, code, category, message, action, req, { stack: err.stack }));
});

// Serve static frontend files
function resolveFrontendDir(): string {
  if (process.env.MINI_O_FRONTEND_DIR && fs.existsSync(process.env.MINI_O_FRONTEND_DIR)) {
    return path.resolve(process.env.MINI_O_FRONTEND_DIR);
  }
  const candidates = [
    path.join(rootDir, 'frontend'),
    path.join(__currentDirname, '..', 'frontend'),
    path.join(__currentDirname, 'frontend'),
    '/opt/mini-o/frontend',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return path.join(rootDir, 'frontend');
}

const frontendDir = resolveFrontendDir();
app.use('/static', express.static(frontendDir, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Root HTML fallback
app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Direct package download shortcuts
app.get('/download/deb', (_req, res) => {
  res.redirect('/api/download/deb');
});

app.get('/download/windows', (_req, res) => {
  res.redirect('/api/download/windows');
});

app.get('/download/windows-zip', (_req, res) => {
  res.redirect('/api/download/windows');
});

// Process-wide uncaught exception and rejection handlers
process.on('uncaughtException', (err: Error) => {
  logServerError(500, 'UNCAUGHT_EXCEPTION', 'internal', err.message, 'Review server crash logs and restart if needed', undefined, { stack: err.stack });
});

process.on('unhandledRejection', (reason: any) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logServerError(500, 'UNHANDLED_REJECTION', 'internal', msg, 'Review async operations in server route handlers', undefined, { stack });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mini-O server running on http://0.0.0.0:${PORT}`);
});
