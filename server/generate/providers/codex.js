// Generates an image through the user's ChatGPT subscription via the Codex CLI. The app
// never reads or stores a token: the CLI owns OAuth, and OPENAI_API_KEY / CODEX_API_KEY are
// stripped from the child's environment so an inherited API key cannot select a different
// billing path.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { detectMime, EXT_BY_MIME } = require('../images.js');

const TIMEOUT_MS = 300000;
const LOGIN_HINT = 'Run `codex login --device-auth` on the server, then retry.';
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

// Off in every request: nothing here should ever act outside its sandboxed, single-purpose role.
const DISABLED_FEATURES = [
    'shell_tool', 'unified_exec', 'apply_patch_freeform', 'apps', 'plugins', 'remote_plugin',
    'hooks', 'memories', 'multi_agent', 'browser_use', 'computer_use', 'js_repl', 'code_mode',
    'view_image', 'skill_search', 'shell_snapshot',
];

const INSTRUCTIONS = 'You are the image generator for a CNC and laser panel design tool. '
    + 'Use the built-in image generation tool for every request. '
    + 'Generate exactly one image or explain why generation is unavailable. '
    + 'Do not use external APIs, scripts, SVG, or other tools.';

function resolveBinary(config) {
    if (config.CODEX_CLI_PATH) {
        try { return fs.statSync(config.CODEX_CLI_PATH).isFile() ? config.CODEX_CLI_PATH : null; }
        catch { return null; }
    }
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, 'codex');
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* not here */ }
    }
    const home = path.join(os.homedir(), '.local/bin/codex');
    try { return fs.statSync(home).isFile() ? home : null; } catch { return null; }
}

function availability(config) {
    const bin = resolveBinary(config);
    if (!bin) return { available: false, reason: 'Codex CLI not found. Install it or set CODEX_CLI_PATH in server/generate/.env.' };
    return { available: true, reason: '' };
}

// Pure argv construction so the exact command line is unit testable without spawning anything.
function buildArgv({ cliPath, instructionsPath, effort, model, referencePaths = [] }) {
    if (!EFFORTS.includes(effort)) throw Object.assign(new Error('CODEX_EFFORT must be one of ' + EFFORTS.join(', ')), { status: 503 });
    const argv = [cliPath, 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
        '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never'];
    for (const refPath of referencePaths) argv.push('--image', refPath);

    const settings = {
        forced_login_method: 'chatgpt',
        approval_policy: 'never',
        model_instructions_file: instructionsPath,
        model_reasoning_effort: effort,
        project_doc_max_bytes: 0,
        web_search: 'disabled',
        'history.persistence': 'none',
        'features.skip_host_skill_discovery': true,
        'features.image_generation': true,
    };
    for (const feature of DISABLED_FEATURES) settings[`features.${feature}`] = false;
    for (const [key, value] of Object.entries(settings)) argv.push('-c', `${key}=${JSON.stringify(value)}`);

    if (model) argv.push('--model', model);
    argv.push('-');
    return argv;
}

// Parses Codex's JSONL stdout. Throws (502) on any turn.failed/error event or a missing
// turn.completed, without leaking the raw event bodies to the client.
function parseEvents(output) {
    let events;
    try {
        events = output.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
        if (events.some(event => typeof event !== 'object' || event === null)) throw new Error('not an object');
    } catch {
        throw Object.assign(new Error('Codex returned invalid image events; check the CLI version.'), { status: 502 });
    }
    if (events.some(event => event.type === 'turn.failed' || event.type === 'error')) {
        throw Object.assign(new Error('Codex image generation failed; check the server login and subscription usage.'), { status: 502 });
    }
    if (!events.some(event => event.type === 'turn.completed')) {
        throw Object.assign(new Error('Codex image generation did not complete.'), { status: 502 });
    }
    return events;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parentChain(dirPath) {
    const out = [];
    let current = path.dirname(dirPath);
    let previous = null;
    while (current !== previous) { out.push(current); previous = current; current = path.dirname(current); }
    return out;
}

// Reads the single generated image out of `${CODEX_HOME}/generated_images/<thread_id>/`.
// Every step here defends against a hostile or buggy CLI: symlinked directories, a thread
// directory that resolves outside generatedRoot, more than one file, or a non-regular file.
async function readOutput(output, generatedRoot) {
    const events = parseEvents(output);
    const threadIds = events.filter(event => event.type === 'thread.started').map(event => event.thread_id);
    if (threadIds.length !== 1 || typeof threadIds[0] !== 'string' || !UUID_RE.test(threadIds[0])) {
        throw Object.assign(new Error('Codex returned no valid image thread ID.'), { status: 502 });
    }
    const threadId = threadIds[0];
    const directory = path.join(generatedRoot, threadId);

    for (const candidate of [directory, generatedRoot, ...parentChain(generatedRoot)]) {
        try {
            const info = await fs.promises.lstat(candidate);
            if (info.isSymbolicLink()) {
                throw Object.assign(new Error('Codex image output must not use symlinks.'), { status: 502 });
            }
        } catch (err) {
            if (err && err.status) throw err;
            // ENOENT on a non-existent ancestor is fine; only the thread dir and root must exist.
        }
    }

    let resolvedRoot;
    let resolvedDirectory;
    try {
        resolvedRoot = await fs.promises.realpath(generatedRoot);
        resolvedDirectory = await fs.promises.realpath(directory);
    } catch {
        throw Object.assign(new Error('Codex image output is missing or unreadable; check the CLI output contract.'), { status: 502 });
    }
    if (path.dirname(resolvedDirectory) !== resolvedRoot) {
        throw Object.assign(new Error('Codex image output is outside its request directory.'), { status: 502 });
    }

    let entries;
    try {
        entries = await fs.promises.readdir(resolvedDirectory);
    } catch {
        throw Object.assign(new Error('Codex image output is missing or unreadable; check the CLI output contract.'), { status: 502 });
    }
    const files = entries.filter(name => IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase()));
    if (files.length !== 1) {
        throw Object.assign(new Error('Codex did not return exactly one image.'), { status: 502 });
    }

    const filePath = path.join(resolvedDirectory, files[0]);
    let handle;
    try {
        handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch {
        throw Object.assign(new Error('Codex image output is missing or unreadable; check the CLI output contract.'), { status: 502 });
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) {
            throw Object.assign(new Error('Codex image output is not a supported regular image file.'), { status: 502 });
        }
        const buffer = Buffer.alloc(stat.size);
        await handle.read(buffer, 0, stat.size, 0);
        const mime = detectMime(buffer);
        if (!mime) throw Object.assign(new Error('Codex returned an invalid or unsupported raster image.'), { status: 502 });
        return { buffer, mime };
    } finally {
        await handle.close();
    }
}

function runProcess(argv, cwd, stdinText, signal) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.OPENAI_API_KEY;
        delete env.CODEX_API_KEY;

        const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;

        const killGroup = () => {
            // ESRCH means the group is already gone; tolerate that (and anything else) here,
            // since this only runs during timeout/abort cleanup where a stray error must not crash the server.
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
        };
        const cleanup = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            killGroup();
            cleanup();
            reject(Object.assign(new Error(`Codex did not finish within ${TIMEOUT_MS / 1000} seconds.`), { status: 504 }));
        }, TIMEOUT_MS);

        const onAbort = () => {
            if (settled) return;
            settled = true;
            killGroup();
            cleanup();
            reject(Object.assign(new Error('Generation was cancelled.'), { status: 499, aborted: true }));
        };
        if (signal) {
            if (signal.aborted) { onAbort(); return; }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        // Decode as a stream: a multibyte character split across two chunks must not be mangled.
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(Object.assign(new Error('Codex CLI not found; check CODEX_CLI_PATH.'), { status: 503 }));
        });
        child.on('close', code => {
            if (settled) return;
            settled = true;
            cleanup();
            if (code) {
                const detail = (stderr.trim() || stdout.trim()).slice(-600);
                reject(Object.assign(new Error(`Codex request failed. ${LOGIN_HINT}`), { status: 502, detail }));
                return;
            }
            resolve(stdout);
        });

        child.stdin.write(stdinText);
        child.stdin.end();
    });
}

async function generate({ prompt, images, aspect, config, signal }) {
    const cliPath = resolveBinary(config);
    if (!cliPath) throw Object.assign(new Error('Codex CLI is not configured on the server. ' + LOGIN_HINT), { status: 503 });
    const effort = config.CODEX_EFFORT || 'low';
    if (!EFFORTS.includes(effort)) throw Object.assign(new Error('CODEX_EFFORT is misconfigured on the server.'), { status: 503 });

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pieceout-codex-'));
    try {
        const instructionsPath = path.join(workDir, 'instructions.md');
        await fs.promises.writeFile(instructionsPath, INSTRUCTIONS);

        const referencePaths = [];
        for (const [i, image] of images.entries()) {
            const ext = EXT_BY_MIME[image.mime] || 'png';
            const refPath = path.join(workDir, `reference-${i}.${ext}`);
            await fs.promises.writeFile(refPath, image.buffer);
            referencePaths.push(refPath);
        }

        const argv = buildArgv({ cliPath, instructionsPath, effort, model: config.CODEX_MODEL, referencePaths });
        const output = await runProcess(argv, workDir, prompt, signal);
        const generatedRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
        const raster = await readOutput(output, generatedRoot);
        return { buffer: raster.buffer, mime: raster.mime, model: null };
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    id: 'codex',
    label: 'ChatGPT (Codex login)',
    slow: false,
    availability,
    generate,
    // Exposed for direct unit testing as pure/near-pure functions.
    buildArgv, parseEvents, readOutput, resolveBinary, EFFORTS,
};
