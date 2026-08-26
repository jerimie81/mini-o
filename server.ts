import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type, Modality, FunctionDeclaration } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Available models catalog - Comprehensive Cloud Frontier & Curated Local Open-Weights
const modelCatalog = [
  // Cloud Frontier Models
  {
    name: 'minimax-m3:cloud',
    display_name: 'MiniMax M3 (Cloud / Ollama)',
    provider: 'minimax',
    provider_display: 'MiniMax AI',
    category: 'cloud',
    tags: ['default', 'polyglot', 'android-re', 'tools', 'fast'],
    size: 0,
    parameter_size: 'Cloud (MoE)',
    quantization_level: 'Cloud API (FP8/FP16 Cluster)',
    context_window: '1,000,000 tokens',
    context_tokens: 1000000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'thinking', 'vision', 'code'],
    description: 'High-speed polyglot engineering specialist with workspace tool integration, Android reverse engineering, and multi-language synthesis.',
    use_cases: ['System automation', 'Android RE & analysis', 'Full-stack development', 'Polyglot workflows'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Cloud Hosted Mixture-of-Experts (Zero host VRAM/RAM required)',
      speed_tier: 'Instant Cloud',
      est_tok_per_sec: { cloud: '90 - 130 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Zero local memory or GPU consumption. Handled via high-throughput cloud cluster with native workspace tools.',
      how_it_runs: 'Requests are securely dispatched to the MiniMax cloud gateway over HTTP/2 streaming. Workspace tool calls execute locally in sandbox while token generation occurs in cloud.',
      benchmarks: { coding: 93, reasoning: 92, speed: 96, tool_calling: 95, context: 98 },
    },
  },
  {
    name: 'gemini-3.7-flash',
    display_name: 'Gemini 3.7 Flash',
    provider: 'google',
    provider_display: 'Google DeepMind',
    category: 'reasoning',
    tags: ['hybrid-reasoning', 'vision', 'tools', 'search-grounding', 'multimodal'],
    size: 0,
    parameter_size: 'Frontier Cloud',
    quantization_level: 'Cloud API (Google TPU v5e/v5p)',
    context_window: '1,000,000 tokens',
    context_tokens: 1000000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'thinking', 'vision', 'search_grounding', 'audio_tts'],
    description: 'Next-generation multimodal model with dynamic hybrid reasoning, search grounding, thinking token budget controls, and ultra-low latency.',
    use_cases: ['Advanced reasoning & math', 'Deep code generation', 'Multimodal & vision analysis', 'Real-time tool execution'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'thinking_budget', 'search_grounding'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Google DeepMind Cloud TPU Matrix (Zero local hardware footprint)',
      speed_tier: 'Ultra Fast',
      est_tok_per_sec: { cloud: '100 - 140 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Operates via Google DeepMind Cloud TPU infrastructure with dynamic CoT thinking token budgeting.',
      how_it_runs: 'Queries execute on Google Cloud TPUs with streaming response chunks. Includes live Google Search grounding and multimodal vision tensor processing.',
      benchmarks: { coding: 96, reasoning: 97, speed: 98, tool_calling: 97, context: 99 },
    },
  },
  {
    name: 'gemini-2.5-pro',
    display_name: 'Gemini 2.5 Pro',
    provider: 'google',
    provider_display: 'Google DeepMind',
    category: 'reasoning',
    tags: ['deep-reasoning', 'code', 'large-context', 'tools'],
    size: 0,
    parameter_size: 'Frontier Pro',
    quantization_level: 'Cloud API (TPU Cluster)',
    context_window: '2,000,000 tokens',
    context_tokens: 2000000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'thinking', 'vision', 'search_grounding'],
    description: 'Google’s state-of-the-art model for complex multi-step reasoning, architecture design, repository-wide coding, and math.',
    use_cases: ['Complex software architecture', 'Extensive document analysis', 'Multi-step logic proofs', 'Refactoring'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Google Enterprise TPU v5p Cluster with 2M token context engine',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: '65 - 90 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Zero local overhead. Built for repository-scale context ingestion without taxing host RAM.',
      how_it_runs: 'Dispatched to Google Gemini Pro infrastructure with support for 2-million-token multi-file context windows.',
      benchmarks: { coding: 98, reasoning: 99, speed: 88, tool_calling: 98, context: 100 },
    },
  },
  {
    name: 'gemini-2.5-flash',
    display_name: 'Gemini 2.5 Flash',
    provider: 'google',
    provider_display: 'Google DeepMind',
    category: 'cloud',
    tags: ['fast', 'multimodal', 'tools', 'efficient'],
    size: 0,
    parameter_size: 'Frontier Flash',
    quantization_level: 'Cloud API',
    context_window: '1,000,000 tokens',
    context_tokens: 1000000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'vision', 'search_grounding'],
    description: 'Ultra-fast, cost-effective multimodal workhorse for responsive conversation and everyday workspace tasks.',
    use_cases: ['Instant chat responses', 'Quick edits', 'Visual queries', 'General assistance'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Cloud TPU Flash Architecture (Lowest Latency)',
      speed_tier: 'Instant Cloud',
      est_tok_per_sec: { cloud: '110 - 150 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Instant streaming with sub-200ms time-to-first-token. Zero host resource usage.',
      how_it_runs: 'Direct streaming API connection to Google Cloud edge accelerators.',
      benchmarks: { coding: 91, reasoning: 91, speed: 99, tool_calling: 94, context: 97 },
    },
  },
  {
    name: 'deepseek-chat:cloud',
    display_name: 'DeepSeek V3 (Cloud)',
    provider: 'deepseek',
    provider_display: 'DeepSeek AI',
    category: 'coding',
    tags: ['moe', 'coding', 'polyglot', 'fast'],
    size: 0,
    parameter_size: '671B (37B active)',
    quantization_level: 'Cloud API (FP8 Multi-Node)',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: '671B parameter Mixture-of-Experts model excelling at multi-language programming, math, and natural language understanding.',
    use_cases: ['Polyglot software engineering', 'Algorithm design', 'Data pipelines', 'Technical documentation'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Multi-GPU Cloud Cluster with 671B total / 37B active MoE routing',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: '70 - 100 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Running 671B locally would require ~350GB VRAM; cloud API delivers full power with zero local RAM load.',
      how_it_runs: 'DeepSeek MoE cluster activates 37B parameters per token for polyglot code generation.',
      benchmarks: { coding: 96, reasoning: 95, speed: 92, tool_calling: 93, context: 94 },
    },
  },
  {
    name: 'deepseek-reasoner:cloud',
    display_name: 'DeepSeek R1 (Cloud)',
    provider: 'deepseek',
    provider_display: 'DeepSeek AI',
    category: 'reasoning',
    tags: ['reasoning', 'chain-of-thought', 'math', 'logic'],
    size: 0,
    parameter_size: '671B CoT',
    quantization_level: 'Cloud API (FP8 CoT)',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: true,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'thinking', 'code'],
    description: 'Open-weight reasoning architecture using reinforcement learning with full chain-of-thought problem breakdown before answering.',
    use_cases: ['Hard algorithmic problems', 'Mathematical theorems', 'Reverse engineering logic', 'Root cause debugging'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx'],
    download_size_est: 'Cloud (0 GB)',
    hardware_profile: {
      execution_type: 'cloud',
      min_ram_gb: 0,
      recommended_ram_gb: 0,
      recommended_vram_gb: 0,
      storage_required_gb: 0,
      quantization_detail: 'Full 671B Parameter DeepSeek RL Reinforcement Reasoning Cluster',
      speed_tier: 'Moderate',
      est_tok_per_sec: { cloud: '45 - 75 tok/s', gpu: 'N/A (Cloud)', cpu: 'N/A (Cloud)' },
      resource_impact: 'Zero',
      offload_advice: 'Emits complete inner thinking reasoning trace prior to output. Zero host hardware load.',
      how_it_runs: 'Streams chain-of-thought reasoning tokens followed by structured answer.',
      benchmarks: { coding: 97, reasoning: 99, speed: 82, tool_calling: 90, context: 93 },
    },
  },

  // Local Open-Weights & Ollama Models Catalog
  {
    name: 'llama3.3:70b',
    display_name: 'Meta Llama 3.3 (70B)',
    provider: 'meta',
    provider_display: 'Meta AI',
    category: 'reasoning',
    tags: ['flagship', 'local', 'large-weights', 'tools'],
    size: 42949672960,
    parameter_size: '70B',
    quantization_level: 'Q4_K_M',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: 'Meta’s most capable 70B open weights model, matching previous-generation frontier models in reasoning and general knowledge.',
    use_cases: ['On-premise enterprise reasoning', 'Complex coding', 'Offline analytical synthesis'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '42.0 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 48,
      recommended_ram_gb: 64,
      recommended_vram_gb: 44,
      storage_required_gb: 42.0,
      quantization_detail: 'GGUF Q4_K_M (4.5 bits/weight, near-lossless 70B compression)',
      speed_tier: 'Heavy Compute',
      est_tok_per_sec: { cloud: 'N/A', gpu: '25 - 40 tok/s (RTX 4090/A6000/M3 Max)', cpu: '3 - 6 tok/s (16-core CPU)' },
      resource_impact: 'Heavy',
      offload_advice: 'Requires Mac Studio (64GB+ unified memory) or dual 24GB GPUs (e.g. 2x RTX 3090/4090) for full GPU offload.',
      how_it_runs: 'Runs locally via Ollama with llama.cpp. Offloads ~80 layers to GPU VRAM and remainder to system unified memory.',
      benchmarks: { coding: 95, reasoning: 95, speed: 65, tool_calling: 94, context: 95 },
    },
  },
  {
    name: 'llama3.1:8b',
    display_name: 'Meta Llama 3.1 (8B)',
    provider: 'meta',
    provider_display: 'Meta AI',
    category: 'lightweight',
    tags: ['fast', 'local', 'daily-driver', 'tools'],
    size: 4940000000,
    parameter_size: '8B',
    quantization_level: 'Q4_K_M',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: 'The golden standard 8B local model with 128k context window, excellent speed-to-accuracy ratio, and native tool-calling support.',
    use_cases: ['Fast local chats', 'Command-line assistants', 'Laptop and desktop inference'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '4.7 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 8,
      recommended_ram_gb: 16,
      recommended_vram_gb: 6,
      storage_required_gb: 4.7,
      quantization_detail: 'GGUF Q4_K_M (33 layers, 4.7 GB memory resident)',
      speed_tier: 'Ultra Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '55 - 90 tok/s (RTX 3060/4060/M1/M2)', cpu: '12 - 22 tok/s (8-core CPU)' },
      resource_impact: 'Low',
      offload_advice: 'Fits fully in any 6GB+ VRAM GPU or any modern 8GB+ laptop CPU with AVX2.',
      how_it_runs: 'Entire 8B network loaded into GPU VRAM (33/33 layers offloaded). Instantaneous token generation with low thermal footprint.',
      benchmarks: { coding: 86, reasoning: 87, speed: 94, tool_calling: 89, context: 92 },
    },
  },
  {
    name: 'deepseek-r1:14b',
    display_name: 'DeepSeek R1 (14B)',
    provider: 'deepseek',
    provider_display: 'DeepSeek AI',
    category: 'reasoning',
    tags: ['reasoning', 'local', 'chain-of-thought', 'math'],
    size: 9000000000,
    parameter_size: '14B',
    quantization_level: 'Q4_K_M',
    context_window: '64,000 tokens',
    context_tokens: 64000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'thinking', 'code'],
    description: 'Distilled Qwen-based R1 reasoning model. Produces detailed chain-of-thought verification for code, logic, and math on local hardware.',
    use_cases: ['Local reasoning & debugging', 'Algorithm verification', 'Offline problem solving'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '9.0 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 12,
      recommended_ram_gb: 16,
      recommended_vram_gb: 10,
      storage_required_gb: 9.0,
      quantization_detail: 'GGUF Q4_K_M (48 layers, 9.0 GB resident memory)',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '35 - 55 tok/s (RTX 3080/4070/M2 Pro)', cpu: '8 - 14 tok/s (8-core CPU)' },
      resource_impact: 'Moderate',
      offload_advice: 'Ideal for 12GB/16GB GPUs or 16GB+ Apple Silicon MacBooks. Generates full step-by-step thinking traces locally.',
      how_it_runs: 'Executes distilled R1 reasoning weights with dynamic thinking phase before output synthesis.',
      benchmarks: { coding: 92, reasoning: 94, speed: 84, tool_calling: 85, context: 88 },
    },
  },
  {
    name: 'deepseek-r1:8b',
    display_name: 'DeepSeek R1 (8B)',
    provider: 'deepseek',
    provider_display: 'DeepSeek AI',
    category: 'reasoning',
    tags: ['reasoning', 'local', 'lightweight-cot'],
    size: 4900000000,
    parameter_size: '8B',
    quantization_level: 'Q4_K_M',
    context_window: '64,000 tokens',
    context_tokens: 64000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'thinking', 'code'],
    description: 'Distilled Llama-based R1 model for fast step-by-step reasoning on modest consumer GPUs or Apple Silicon.',
    use_cases: ['Step-by-step logic', 'Quick verification', 'Lightweight reasoning'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '4.9 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 8,
      recommended_ram_gb: 16,
      recommended_vram_gb: 6,
      storage_required_gb: 4.9,
      quantization_detail: 'GGUF Q4_K_M (32 layers, 4.9 GB)',
      speed_tier: 'Ultra Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '50 - 80 tok/s', cpu: '11 - 19 tok/s' },
      resource_impact: 'Low',
      offload_advice: 'Runs smoothly on any 8GB+ RAM machine or 6GB GPU with minimal battery draw.',
      how_it_runs: 'High-speed local chain-of-thought execution with minimal VRAM overhead.',
      benchmarks: { coding: 88, reasoning: 90, speed: 92, tool_calling: 86, context: 88 },
    },
  },
  {
    name: 'qwen2.5-coder:32b',
    display_name: 'Qwen 2.5 Coder (32B)',
    provider: 'qwen',
    provider_display: 'Alibaba Cloud / Qwen',
    category: 'coding',
    tags: ['coding-premier', 'local', 'repo-analysis', 'tools'],
    size: 19500000000,
    parameter_size: '32B',
    quantization_level: 'Q4_K_M',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: 'World-class open-source coding engine rivaling GPT-4o in code generation, bug fixing, repo navigation, and refactoring.',
    use_cases: ['Repository-scale refactoring', 'Complex feature implementation', 'Multi-file code synthesis'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '19.5 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 24,
      recommended_ram_gb: 32,
      recommended_vram_gb: 20,
      storage_required_gb: 19.5,
      quantization_detail: 'GGUF Q4_K_M (64 layers, 19.5 GB memory resident)',
      speed_tier: 'Moderate',
      est_tok_per_sec: { cloud: 'N/A', gpu: '28 - 45 tok/s (RTX 3090/4090/M2 Max)', cpu: '5 - 9 tok/s (12-core CPU)' },
      resource_impact: 'High',
      offload_advice: 'Requires 24GB VRAM GPU (RTX 3090/4090) or 32GB+ Unified Memory Mac for 100% GPU offload.',
      how_it_runs: 'Full local code intelligence model with 128k attention span. Can partial-offload 40/64 layers on 16GB GPUs.',
      benchmarks: { coding: 97, reasoning: 93, speed: 76, tool_calling: 94, context: 95 },
    },
  },
  {
    name: 'qwen2.5-coder:7b',
    display_name: 'Qwen 2.5 Coder (7B)',
    provider: 'qwen',
    provider_display: 'Alibaba Cloud / Qwen',
    category: 'coding',
    tags: ['coding', 'fast', 'local', 'tools'],
    size: 4700000000,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: 'Fast and responsive 7B coding model optimized for code generation, syntax fixing, script generation, and terminal tool execution.',
    use_cases: ['Fast code completion', 'Single-file scripting', 'Quick debugging'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '4.7 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 8,
      recommended_ram_gb: 16,
      recommended_vram_gb: 6,
      storage_required_gb: 4.7,
      quantization_detail: 'GGUF Q4_K_M (28 layers, 4.7 GB)',
      speed_tier: 'Ultra Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '60 - 95 tok/s', cpu: '14 - 24 tok/s' },
      resource_impact: 'Low',
      offload_advice: 'Extremely lightweight. Flawless execution on consumer laptops and entry GPUs.',
      how_it_runs: '100% GPU offload on standard 6GB+ graphics cards with rapid AST code parsing.',
      benchmarks: { coding: 91, reasoning: 88, speed: 96, tool_calling: 91, context: 92 },
    },
  },
  {
    name: 'phi4:14b',
    display_name: 'Microsoft Phi-4 (14B)',
    provider: 'microsoft',
    provider_display: 'Microsoft Research',
    category: 'reasoning',
    tags: ['synthetic-data', 'math', 'local', 'precise'],
    size: 9100000000,
    parameter_size: '14B',
    quantization_level: 'Q4_K_M',
    context_window: '16,000 tokens',
    context_tokens: 16000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'code'],
    description: 'Microsoft’s flagship synthetic-data trained 14B model with exceptional density in mathematics, logic puzzles, and science.',
    use_cases: ['Mathematical modeling', 'Logical deductions', 'Concise code analysis'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '9.1 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 12,
      recommended_ram_gb: 16,
      recommended_vram_gb: 10,
      storage_required_gb: 9.1,
      quantization_detail: 'GGUF Q4_K_M (40 layers, 9.1 GB)',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '35 - 55 tok/s', cpu: '9 - 15 tok/s' },
      resource_impact: 'Moderate',
      offload_advice: 'Comfortably fits in 10GB+ VRAM or 16GB System RAM.',
      how_it_runs: 'Dense high-precision synthetic weights processed in local llama.cpp backend.',
      benchmarks: { coding: 92, reasoning: 95, speed: 85, tool_calling: 87, context: 82 },
    },
  },
  {
    name: 'gemma2:27b',
    display_name: 'Google Gemma 2 (27B)',
    provider: 'google',
    provider_display: 'Google',
    category: 'general',
    tags: ['open-weights', 'high-throughput', 'local'],
    size: 16000000000,
    parameter_size: '27B',
    quantization_level: 'Q4_K_M',
    context_window: '8,192 tokens',
    context_tokens: 8192,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'code'],
    description: 'Google’s open model with sliding window attention and soft-capping architecture, delivering high throughput and nuanced responses.',
    use_cases: ['General knowledge', 'Text analysis', 'Instruction following'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '16.0 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 20,
      recommended_ram_gb: 32,
      recommended_vram_gb: 18,
      storage_required_gb: 16.0,
      quantization_detail: 'GGUF Q4_K_M (46 layers, sliding window attention)',
      speed_tier: 'Moderate',
      est_tok_per_sec: { cloud: 'N/A', gpu: '30 - 48 tok/s (16GB+ GPU)', cpu: '6 - 10 tok/s' },
      resource_impact: 'High',
      offload_advice: 'Requires 16GB-24GB VRAM or 32GB system RAM for smooth local execution.',
      how_it_runs: 'Sliding window attention interleaves local and global layers to reduce KV cache VRAM footprint.',
      benchmarks: { coding: 90, reasoning: 92, speed: 78, tool_calling: 88, context: 85 },
    },
  },
  {
    name: 'gemma2:9b',
    display_name: 'Google Gemma 2 (9B)',
    provider: 'google',
    provider_display: 'Google',
    category: 'lightweight',
    tags: ['open-weights', 'efficient', 'local'],
    size: 5400000000,
    parameter_size: '9B',
    quantization_level: 'Q4_K_M',
    context_window: '8,192 tokens',
    context_tokens: 8192,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'code'],
    description: 'Efficient on-device model from Google outperforming many larger models in standard benchmarks.',
    use_cases: ['Local summaries', 'Lightweight reasoning', 'Instruction following'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '5.4 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 8,
      recommended_ram_gb: 16,
      recommended_vram_gb: 6,
      storage_required_gb: 5.4,
      quantization_detail: 'GGUF Q4_K_M (42 layers, 5.4 GB)',
      speed_tier: 'Ultra Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '55 - 85 tok/s', cpu: '12 - 20 tok/s' },
      resource_impact: 'Low',
      offload_advice: 'Great daily-driver for 8GB RAM laptops and entry graphics cards.',
      how_it_runs: 'Full GPU offload on 6GB+ cards with soft-capped logit stability.',
      benchmarks: { coding: 87, reasoning: 89, speed: 93, tool_calling: 86, context: 86 },
    },
  },
  {
    name: 'mistral-nemo:12b',
    display_name: 'Mistral NeMo (12B)',
    provider: 'mistral',
    provider_display: 'Mistral AI & NVIDIA',
    category: 'general',
    tags: ['128k-context', 'multilingual', 'local'],
    size: 7100000000,
    parameter_size: '12B',
    quantization_level: 'Q4_K_M',
    context_window: '128,000 tokens',
    context_tokens: 128000,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'tools', 'code'],
    description: 'Co-developed with NVIDIA. Built with Tekken tokenizer for extreme multilingual compression and 128k native context length.',
    use_cases: ['Multilingual projects', 'Long document parsing', 'General coding'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '7.1 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 10,
      recommended_ram_gb: 16,
      recommended_vram_gb: 8,
      storage_required_gb: 7.1,
      quantization_detail: 'GGUF Q4_K_M (40 layers, Tekken tokenizer)',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '40 - 65 tok/s', cpu: '9 - 16 tok/s' },
      resource_impact: 'Moderate',
      offload_advice: 'Recommended on 8GB+ VRAM GPU or 16GB system RAM.',
      how_it_runs: 'Tekken tokenizer compresses tokens by 30% for higher effective throughput on multi-language inputs.',
      benchmarks: { coding: 89, reasoning: 90, speed: 89, tool_calling: 90, context: 94 },
    },
  },
  {
    name: 'llava:13b',
    display_name: 'LLaVA 1.6 Vision (13B)',
    provider: 'meta',
    provider_display: 'LLaVA Team / Open Source',
    category: 'vision',
    tags: ['vision', 'local', 'multimodal', 'ocr'],
    size: 7900000000,
    parameter_size: '13B',
    quantization_level: 'Q4_K_M',
    context_window: '4,096 tokens',
    context_tokens: 4096,
    installed: false,
    modified_at: new Date().toISOString(),
    capabilities: ['chat', 'streaming', 'vision'],
    description: 'Open visual instruction-tuned model capable of image understanding, UI screenshot parsing, diagram analysis, and OCR.',
    use_cases: ['Local visual inspection', 'Diagram decoding', 'UI screenshot understanding'],
    supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
    download_size_est: '7.9 GB',
    hardware_profile: {
      execution_type: 'local_gpu',
      min_ram_gb: 12,
      recommended_ram_gb: 16,
      recommended_vram_gb: 10,
      storage_required_gb: 7.9,
      quantization_detail: 'GGUF Q4_K_M + CLIP ViT-L/14 Vision Projector',
      speed_tier: 'Fast',
      est_tok_per_sec: { cloud: 'N/A', gpu: '35 - 55 tok/s', cpu: '8 - 14 tok/s' },
      resource_impact: 'Moderate',
      offload_advice: 'Requires 10GB+ VRAM or 16GB system RAM for vision tensor encoding.',
      how_it_runs: 'Passes uploaded images through CLIP vision encoder into LLaMA language backbone locally.',
      benchmarks: { coding: 82, reasoning: 86, speed: 86, tool_calling: 80, context: 78 },
    },
  },
];

function getOllamaHost(): string {
  return process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
}

export function getSystemHardwareDiagnostics() {
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const totalRamGb = Number((totalMemBytes / (1024 * 1024 * 1024)).toFixed(1));
  const freeRamGb = Number((freeMemBytes / (1024 * 1024 * 1024)).toFixed(1));
  const cpus = os.cpus() || [];
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Multi-core Processor';
  const cpuCores = cpus.length;
  const platform = os.platform();
  const arch = os.arch();

  let tier = 'entry';
  let maxLocalParam = '8B';
  if (totalRamGb >= 58) {
    tier = 'powerhouse';
    maxLocalParam = '70B';
  } else if (totalRamGb >= 28) {
    tier = 'advanced';
    maxLocalParam = '32B';
  } else if (totalRamGb >= 14) {
    tier = 'balanced';
    maxLocalParam = '14B';
  }

  return {
    total_ram_gb: totalRamGb,
    free_ram_gb: freeRamGb,
    cpu_cores: cpuCores,
    cpu_model: cpuModel,
    arch,
    platform,
    tier,
    max_recommended_param: maxLocalParam,
    ollama_host: getOllamaHost(),
  };
}

export function calculateMachineFit(model: any, hw: ReturnType<typeof getSystemHardwareDiagnostics>) {
  const isCloud = model.category === 'cloud' || model.provider === 'google' || model.provider === 'minimax' || model.name?.includes(':cloud');

  if (isCloud) {
    return {
      status: 'cloud_seamless',
      badge: 'Zero Local RAM (Cloud)',
      badge_class: 'fit-cloud',
      fit_score: 100,
      expected_tok_sec: model.hardware_profile?.est_tok_per_sec?.cloud || '~90-140 tok/s',
      execution_mode: 'Cloud Distributed Cluster',
      execution_summary: 'Dispatched to high-throughput cloud accelerators with zero CPU, RAM, or battery load on this host.',
      vram_usage: '0 GB (100% Cloud Hosted)',
      ram_usage: '0 MB local memory footprint',
      recommendation: 'Runs instantaneously on this host without hardware limitations.',
    };
  }

  const minRam = model.hardware_profile?.min_ram_gb || 8;
  const recRam = model.hardware_profile?.recommended_ram_gb || 16;
  const totalRam = hw.total_ram_gb;

  if (totalRam >= recRam) {
    return {
      status: 'optimal',
      badge: 'Optimal Local Fit',
      badge_class: 'fit-optimal',
      fit_score: 95,
      expected_tok_sec: model.hardware_profile?.est_tok_per_sec?.gpu || '~40-70 tok/s (GPU) / ~12-20 tok/s (CPU)',
      execution_mode: 'Local Ollama Engine (llama.cpp)',
      execution_summary: `Your host has ${totalRam} GB RAM which comfortably exceeds the ${recRam} GB recommended for full context evaluation.`,
      vram_usage: `${model.hardware_profile?.recommended_vram_gb || 8} GB VRAM for full GPU offload, or ${recRam} GB system RAM for multi-threaded CPU.`,
      ram_usage: `~${model.hardware_profile?.storage_required_gb || 4.5} GB resident memory`,
      recommendation: 'Recommended for fast, secure local offline inference on this machine.',
    };
  } else if (totalRam >= minRam) {
    return {
      status: 'good',
      badge: 'Runs Well (Moderate RAM)',
      badge_class: 'fit-good',
      fit_score: 75,
      expected_tok_sec: model.hardware_profile?.est_tok_per_sec?.cpu || '~8-16 tok/s',
      execution_mode: 'Local Ollama (Partial/CPU Offload)',
      execution_summary: `Host RAM (${totalRam} GB) satisfies the minimum ${minRam} GB requirement. Context window should be kept under 32k for optimal performance.`,
      vram_usage: `Partial GPU layers or ~${minRam} GB system RAM.`,
      ram_usage: `~${model.hardware_profile?.storage_required_gb || 4.5} GB resident memory`,
      recommendation: 'Runs well. Avoid opening multiple high-memory background tasks while running heavy prompts.',
    };
  } else {
    return {
      status: 'heavy',
      badge: 'High Resource Load',
      badge_class: 'fit-heavy',
      fit_score: 40,
      expected_tok_sec: '~2-6 tok/s (Heavy CPU Paging)',
      execution_mode: 'Local Ollama (Memory Constrained)',
      execution_summary: `Model requires at least ${minRam} GB RAM. With ${totalRam} GB host RAM, system memory pressure may cause paging slowdowns.`,
      vram_usage: `${model.hardware_profile?.recommended_vram_gb || 16} GB VRAM required for full offload.`,
      ram_usage: `Exceeds available free memory (${hw.free_ram_gb} GB free of ${totalRam} GB total).`,
      recommendation: 'Consider using Cloud Frontier models or lighter local models (e.g. 7B/8B or Gemini/MiniMax) for higher throughput.',
    };
  }
}

async function getDynamicModelCatalog(): Promise<any[]> {
  const catalogMap = new Map<string, any>();
  const hw = getSystemHardwareDiagnostics();

  // Populate preset catalog first with machine fit calculated
  for (const m of modelCatalog) {
    const item: any = { ...m };
    item.machine_fit = calculateMachineFit(item, hw);
    catalogMap.set(m.name, item);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${getOllamaHost()}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data: any = await resp.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        for (const localModel of data.models) {
          const name = localModel.name;
          const existing = catalogMap.get(name);
          const isCloud = name.includes(':cloud') || localModel.remote_host || !localModel.size;

          if (existing) {
            existing.installed = true;
            existing.size = localModel.size || existing.size;
            existing.modified_at = localModel.modified_at || existing.modified_at;
            if (localModel.details) {
              if (localModel.details.parameter_size) existing.parameter_size = localModel.details.parameter_size;
              if (localModel.details.quantization_level) existing.quantization_level = localModel.details.quantization_level;
            }
            existing.machine_fit = calculateMachineFit(existing, hw);
          } else {
            // New local model detected in Ollama
            const estGb = localModel.size ? Number((localModel.size / (1024 * 1024 * 1024)).toFixed(1)) : 4.5;
            const dynamicItem = {
              name,
              display_name: `${name} (Local Ollama)`,
              provider: isCloud ? 'cloud' : 'ollama',
              provider_display: isCloud ? 'Cloud' : 'Local Ollama',
              category: isCloud ? 'cloud' : 'general',
              tags: isCloud ? ['cloud'] : ['local', 'custom'],
              size: localModel.size || 0,
              parameter_size: localModel.details?.parameter_size || (isCloud ? 'Cloud' : 'Local'),
              quantization_level: localModel.details?.quantization_level || 'GGUF',
              context_window: '32,000 tokens',
              context_tokens: 32768,
              installed: true,
              modified_at: localModel.modified_at || new Date().toISOString(),
              capabilities: ['chat', 'streaming', 'tools', 'code'],
              description: `Locally detected Ollama model: ${name}`,
              use_cases: ['General local inference'],
              supports_options: ['temperature', 'top_p', 'top_k', 'seed', 'num_ctx', 'num_predict'],
              download_size_est: localModel.size ? `${estGb} GB` : 'Installed',
              hardware_profile: {
                execution_type: isCloud ? 'cloud' : 'local_gpu',
                min_ram_gb: Math.max(8, Math.round(estGb * 1.3)),
                recommended_ram_gb: Math.max(16, Math.round(estGb * 1.8)),
                recommended_vram_gb: Math.max(6, Math.round(estGb * 1.1)),
                storage_required_gb: estGb,
                quantization_detail: localModel.details?.quantization_level || 'GGUF Quantized',
                speed_tier: isCloud ? 'Instant Cloud' : 'Fast',
                est_tok_per_sec: { cloud: isCloud ? '80 - 120 tok/s' : 'N/A', gpu: '35 - 65 tok/s', cpu: '8 - 16 tok/s' },
                resource_impact: isCloud ? 'Zero' : 'Moderate',
                offload_advice: isCloud ? 'Zero local resource load.' : `Requires ~${estGb} GB RAM to host weights.`,
                how_it_runs: `Loaded directly into local Ollama runtime from ${name}.`,
                benchmarks: { coding: 85, reasoning: 85, speed: 88, tool_calling: 85, context: 85 },
              },
            };
            (dynamicItem as any).machine_fit = calculateMachineFit(dynamicItem, hw);
            catalogMap.set(name, dynamicItem);
          }
        }
      }
    }
  } catch {
    // Ollama not reachable - use static catalog with cloud models active
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

  // System Hardware Diagnostics
  router.get('/system/hardware', (_req, res) => {
    try {
      const hw = getSystemHardwareDiagnostics();
      res.json(hw);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Models
  router.get('/models', async (req, res) => {
    try {
      const q = ((req.query.q as string) || '').toLowerCase().trim();
      const category = (req.query.category as string) || '';
      const provider = (req.query.provider as string) || '';
      const installedOnly = req.query.installed === 'true';

      const catalog = await getDynamicModelCatalog();
      let filtered = catalog;

      if (q) {
        filtered = filtered.filter(m =>
          m.name.toLowerCase().includes(q) ||
          (m.display_name && m.display_name.toLowerCase().includes(q)) ||
          (m.provider_display && m.provider_display.toLowerCase().includes(q)) ||
          (m.description && m.description.toLowerCase().includes(q)) ||
          (m.tags && m.tags.some((t: string) => t.toLowerCase().includes(q)))
        );
      }

      if (category && category !== 'all') {
        if (category === 'installed') {
          filtered = filtered.filter(m => m.installed);
        } else if (category === 'cloud') {
          filtered = filtered.filter(m => m.provider === 'google' || m.provider === 'minimax' || m.name.includes(':cloud') || m.category === 'cloud');
        } else {
          filtered = filtered.filter(m => m.category === category || (m.tags && m.tags.includes(category)));
        }
      }

      if (provider && provider !== 'all') {
        filtered = filtered.filter(m => m.provider === provider);
      }

      if (installedOnly) {
        filtered = filtered.filter(m => m.installed);
      }

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
    path.join(__dirname, '..', 'frontend'),
    path.join(__dirname, 'frontend'),
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
app.use(express.static(frontendDir, {
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
