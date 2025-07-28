const vscode = require('vscode');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

let logFilePath = null;
let outputChannel = null;
let lastCoreLog = ''; // store last non-timestamp message
//let pasteEventCount = 0;
let logLineCount = 0;
let lastLogWrite = null;
//let totalFileUpdates = 0;
const uniqueFilesUpdated = new Set();
let logRotationCount = 0;
let webviewProvider = null;

const config = vscode.workspace.getConfiguration('fileLogger');
const logIntervalSeconds = config.get('logIntervalSeconds', 10);
//const enablePasteDetection = config.get('enablePasteDetection', true);
const maxLogFileSizeMB = config.get('maxLogFileSizeMB', 5);
// Read config at the top of activate()

// ========== Sidebar Provider ==========
let interval = null;
/*let treeDataProvider = null;
class FileLoggerProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getChildren() {
        const loggingStatus = interval ? 'Enabled' : 'Disabled';
        return [
            { label: `Logging: ${loggingStatus}`, description: '' },
            { label: `Log file: ${logFilePath || 'Unavailable'}` },
            { label: `Paste events detected: ${pasteEventCount}`, description: '' }
        ];
    }
    getTreeItem(element) {
        return {
            label: element.label,
            description: element.description,
            collapsibleState: vscode.TreeItemCollapsibleState.None
        };
    }
}*/

class FileLoggerWebviewProvider {
    constructor(context) {
        this.context = context;
    }

    resolveWebviewView(webviewView) {
        /*webviewView.webview.options = {
            enableScripts: true,
        };
        this.updateWebview();

        const logStatus = interval ? 'Enabled' : 'Disabled';
        const logFile = logFilePath || 'Unavailable';

        webviewView.webview.html = this.getHtmlContent(logStatus, logFile);*/

        this._view = webviewView; // ✅ Fix: store the view for later updates
        webviewView.webview.options = { enableScripts: true };
        this.updateWebview();

        webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'downloadLogs') {
                vscode.commands.executeCommand('extension.exportFileLoggerAudit');
            }
        });
    }

    updateWebview() {
        if (this._view) {
            const logStatus = interval ? 'Enabled' : 'Disabled';
            const logFile = logFilePath || 'Unavailable';
            const logSizeKB = getLogFileSizeInKB(logFilePath);
            const uniqueFilesCount = uniqueFilesUpdated.size;

            const html = this.getHtmlContent(
                logStatus,
                logFile,
                logLineCount,
                lastLogWrite || 'N/A',
                uniqueFilesCount,
                logSizeKB,
                logRotationCount
            );

            this._view.webview.html = html;
        }
    }

    getHtmlContent(status, file, lineCount, lastWrite, uniqueFiles, fileSize, rotationCount) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
                        padding: 1rem;
                        background-color: #1e1e1e;
                        color: #d4d4d4;
                    }
                    h3 {
                        color: #61dafb;
                        margin-bottom: 0.5rem;
                    }
                    ul {
                        list-style: none;
                        padding: 0;
                    }
                    li {
                        margin-bottom: 0.5rem;
                        padding: 0.5rem;
                        background: #2d2d2d;
                        border-radius: 5px;
                        overflow-wrap: break-word;       /* ✅ allow wrapping */
                        word-break: break-word;          /* ✅ force breaking long words/paths */
                        max-width: 100%;                 /* ✅ fit container */
                        white-space: pre-wrap;           /* ✅ keep spaces, wrap as needed */
                    }
                    button {
                        background-color: #0e639c;
                        color: white;
                        border: none;
                        padding: 0.5rem 1rem;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-top: 1rem;
                    }
                    button:hover {
                        background-color: #1177bb;
                    }
                </style>

            </head>
            <body>
                <h3>Logger Status</h3>
                <ul>
                    <li><strong>Logging:</strong> ${status}</li>
                    <li><strong>Log File:</strong> ${file}</li>
                    <li><strong>Total Log Lines:</strong> ${lineCount}</li>
                    <li><strong>Last Log Write:</strong> ${lastWrite}</li>
                    <li><strong>Total Files Updated:</strong> ${uniqueFiles}</li>
                    <li><strong>Log File Size:</strong> ${fileSize} KB</li>
                    <li><strong>Log Rotations:</strong> ${rotationCount}</li>
                </ul>
                <button onclick="downloadLogs()">Download Logs</button>
                <script>
                    const vscode = acquireVsCodeApi();
                    function downloadLogs() {
                        vscode.postMessage({ command: 'downloadLogs' });
                    }
                </script>
            </body>
            </html>
        `;
    }
}

/*function registerPasteDetection(context, outputChannel, onPasteDetected) {
    let changeBuffer = [];
    let debounceTimer = null;
    let pasteCooldown = false;
    let userInitiatedPaste = false;
    const activatedAt = Date.now();

    // Optional: listen to paste command trigger
    context.subscriptions.push(
        vscode.commands.registerCommand('fileLogger._internalPasteTracker', () => {
            userInitiatedPaste = true;
            setTimeout(() => { userInitiatedPaste = false; }, 1000);
        })
    );

    // Trigger that from keybindings.json for real accuracy:
    // {
    //   "key": "ctrl+v",
    //   "command": "fileLogger._internalPasteTracker",
    //   "when": "editorTextFocus"
    // }

    const listener = vscode.workspace.onDidChangeTextDocument(event => {
        const timeSinceStart = Date.now() - activatedAt;
        if (timeSinceStart < 1500 || pasteCooldown) return;

        changeBuffer.push(...event.contentChanges);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const pasted = changeBuffer.some(change =>
                change.text.length > 50 &&
                change.rangeLength === 0 &&
                /\n/.test(change.text)
            );

            if (pasted || userInitiatedPaste) {
                pasteCooldown = true;
                pasteEventCount++;
                outputChannel?.appendLine(`[Paste Detected] ${new Date().toLocaleTimeString()}`);
                onPasteDetected?.();

                setTimeout(() => {
                    pasteCooldown = false;
                }, 500);
            }

            changeBuffer = [];
        }, 100);
    });

    context.subscriptions.push(listener);
}*/

function rotateLogIfNeeded(logFilePath) {
    if (fs.existsSync(logFilePath)) {
        const stats = fs.statSync(logFilePath);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedName = logFilePath.replace(
                /\.log$/,
                `-${timestamp}.log`
            );
            fs.renameSync(logFilePath, rotatedName);
            logRotationCount++; // Track rotations
        }
    }
}

function logToBoth(ndjsonLine, coreLogString, maxSizeBytes) {
    if (coreLogString === lastCoreLog) {
        return; // Skip duplicate
    }
    lastCoreLog = coreLogString;

    if (outputChannel) outputChannel.appendLine(ndjsonLine);

    if (logFilePath) {
        try {
            rotateLogIfNeeded(logFilePath, maxSizeBytes);
            fs.appendFileSync(logFilePath, ndjsonLine + '\n');
            const parsed = JSON.parse(coreLogString);
            if (parsed.file && !uniqueFilesUpdated.has(parsed.file)) {
                uniqueFilesUpdated.add(parsed.file);
            }
            logLineCount++;
            lastLogWrite = new Date().toLocaleTimeString();
        } catch (err) {
            if (outputChannel) outputChannel.appendLine(`[Logger Error] Failed to write to log file: ${err.message}`);
        }
    }
}

function logActiveFileInfo(config) {
    const activeEditor = vscode.window.activeTextEditor;
    const nowISO = new Date().toISOString();

    let fileName = null, charCount = null, currentLineNumber = null, totalLineCount = null;

    if (activeEditor &&
        activeEditor.document &&
        activeEditor.document.uri &&
        activeEditor.document.uri.scheme === 'file') {
        const document = activeEditor.document;
        fileName = document.fileName.split(/[\\/]/).pop();
        charCount = document.getText().length;
        currentLineNumber = activeEditor.selection.active.line + 1;
        totalLineCount = document.lineCount;
    }

    const coreLog = {
        file: fileName,
        chars: charCount,
        curLine: currentLineNumber,
        tl: totalLineCount
    };
    const coreLogString = JSON.stringify(coreLog);
    const logObject = { dt: nowISO, ...coreLog };
    const ndjsonLine = JSON.stringify(logObject);

    logToBoth(ndjsonLine, coreLogString, config.maxLogFileSizeMB * 1024 * 1024);
}

function getLogFileSizeInKB(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return (stats.size / 1024).toFixed(2);
    } catch {
        return '0.00';
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('File Logger');

    // Get workspace folder path
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const vscodeDir = path.join(workspaceRoot, '.vscode');
        // Ensure .vscode directory exists
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir);
        }
        logFilePath = path.join(vscodeDir, 'file-logger-audit.log');
    }

    // Start interval
    //const interval = setInterval(logActiveFileInfo, 10000);

    webviewProvider = new FileLoggerWebviewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('fileLoggerView', webviewProvider)
    );

    interval = setInterval(() => {
        logActiveFileInfo({ maxLogFileSizeMB });

        // Trigger Webview refresh with updated metrics
        if (webviewProvider && typeof webviewProvider.updateWebview === 'function') {
            webviewProvider.updateWebview();
        }
    }, logIntervalSeconds * 1000);

    let showLogDisposable = vscode.commands.registerCommand('extension.showFileLogger', function () {
        outputChannel.show();
    });

    // Export and zip logs command
    let exportLogsDisposable = vscode.commands.registerCommand('extension.exportFileLoggerAudit', async function () {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const vscodeDir = path.join(workspaceRoot, '.vscode');

        let logFiles = [];
        if (fs.existsSync(vscodeDir)) {
            logFiles = fs.readdirSync(vscodeDir)
                .filter(f => f.startsWith('file-logger-audit') && f.endsWith('.log'))
                .map(f => path.join(vscodeDir, f));
        }

        if (logFiles.length === 0) {
            vscode.window.showWarningMessage('No audit log files found to export.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            saveLabel: 'Export File Logger Audit Logs',
            filters: { 'Zip Files': ['zip'] },
            defaultUri: vscode.Uri.file(path.join(workspaceRoot, 'file-logger-audit-logs.zip'))
        });

        if (!uri) return;

        const output = fs.createWriteStream(uri.fsPath);
        const archive = archiver('zip');

        output.on('close', function () {
            vscode.window.showInformationMessage(`Exported logs to ${uri.fsPath}`);
        });

        archive.on('error', function (err) {
            vscode.window.showErrorMessage('Error zipping logs: ' + err.message);
        });

        archive.pipe(output);

        for (const logFile of logFiles) {
            archive.file(logFile, { name: path.basename(logFile) });
        }

        await archive.finalize();
    });

    /*context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'fileLoggerView',
            new FileLoggerWebviewProvider(context)
        )
    );*/


    context.subscriptions.push({
        dispose: () => clearInterval(interval)
    });
    context.subscriptions.push(showLogDisposable);
    context.subscriptions.push(exportLogsDisposable);
    context.subscriptions.push(outputChannel);

    //const webviewProvider = new FileLoggerWebviewProvider(context);

    /*if (enablePasteDetection) {
        registerPasteDetection(context, outputChannel, () => {
            webviewProvider?.updateWebview?.();  // safe call
        });
    }*/
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};