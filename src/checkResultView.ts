import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModelCheckResult, ModelCheckResultSource } from './model/check';
import { CMD_CHECK_MODEL_STOP, CMD_SHOW_TLC_OUTPUT, CMD_CHECK_MODEL_RUN_AGAIN, CMD_CHECK_MODEL_RUN_ERROR_TRACE_EXPLORATION } from './commands/checkModel';

// Cached HTML template for the WebView
let viewHtmlTemplate: string | undefined;
let viewHtml: string | undefined;
let viewPanel: vscode.WebviewPanel | undefined;
let currentSource: ModelCheckResultSource | undefined;
let lastProcessCheckResult: ModelCheckResult | undefined;   // Only results with source=process go here
let lastCheckResult: ModelCheckResult | undefined;          // The last known check result, no matter what its source is

export function updateCheckResultView(checkResult: ModelCheckResult): void {
    if (checkResult.source === currentSource) {
        if (viewPanel && viewPanel.visible) {
            viewPanel.webview.postMessage({
                checkResult: checkResult
            });
        }
    }
    lastCheckResult = checkResult;
    if (checkResult.source === ModelCheckResultSource.Process) {
        lastProcessCheckResult = checkResult;
    }
}

export function revealEmptyCheckResultView(source: ModelCheckResultSource, extContext: vscode.ExtensionContext): void {
    revealCheckResultView(ModelCheckResult.createEmpty(source), extContext);
}

export function revealLastCheckResultView(extContext: vscode.ExtensionContext): void {
    if (lastProcessCheckResult) {
        revealCheckResultView(lastProcessCheckResult, extContext);
    } else {
        revealEmptyCheckResultView(ModelCheckResultSource.Process, extContext);
    }
}

function revealCheckResultView(checkResult: ModelCheckResult, extContext: vscode.ExtensionContext) {
    currentSource = checkResult.source;
    doRevealCheckResultView(extContext);
    updateCheckResultView(checkResult);
}

function doRevealCheckResultView(extContext: vscode.ExtensionContext) {
    if (!viewPanel) {
        createNewPanel();
        ensurePanelBody(extContext);
    } else {
        viewPanel.reveal();
    }
}

function createNewPanel() {
    const title = 'TLA+ model checking';
    viewPanel = vscode.window.createWebviewPanel(
        'modelChecking',
        title,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.resolve(__dirname, '../../resources'))]
        }
    );
    viewPanel.iconPath = {
        dark: vscode.Uri.file(path.resolve(__dirname, '../../resources/images/preview-dark.svg')),
        light: vscode.Uri.file(path.resolve(__dirname, '../../resources/images/preview-light.svg')),
    };
    viewPanel.onDidDispose(() => {
        viewPanel = undefined;
        viewHtml = undefined;
    });
    viewPanel.webview.onDidReceiveMessage(message => {
        if (message.command === 'init') {
            if (lastCheckResult) {
                // Show what has been missed while the panel was invisible
                updateCheckResultView(lastCheckResult);
            }
        } else if (message.command === 'stop') {
            vscode.commands.executeCommand(CMD_CHECK_MODEL_STOP);
        } else if (message.command === 'showTlcOutput') {
            vscode.commands.executeCommand(CMD_SHOW_TLC_OUTPUT);
        } else if (message.command === 'runAgain') {
            vscode.commands.executeCommand(CMD_CHECK_MODEL_RUN_AGAIN);
        } else if (message.command === 'runErrorTraceExploration') {         
            vscode.commands.executeCommand(CMD_CHECK_MODEL_RUN_ERROR_TRACE_EXPLORATION, message.traceExpression);   
        } else if (message.command === 'openFile') {
            // `One` is used here because at the moment, VSCode doesn't provide API
            // for revealing existing document, so we're speculating here to reduce open documents duplication.
            revealFile(message.filePath, vscode.ViewColumn.One, message.location.line, message.location.character);
        } else if (message.command === 'showInfoMessage') {
            vscode.window.showInformationMessage(message.text);
        } else if (message.command === 'showVariableValue') {
            const valStr = lastCheckResult ? lastCheckResult.formatValue(message.valueId) : undefined;
            if (valStr) {
                createDocument(valStr);
            }
        }
    });
}

function ensurePanelBody(extContext: vscode.ExtensionContext) {
    if (!viewPanel) {
        return;
    }
    if (!viewHtmlTemplate) {
        const pagePath = path.join(extContext.extensionPath, 'resources', 'check-result-view.html');
        viewHtmlTemplate = fs.readFileSync(pagePath, 'utf8');
    }
    if (!viewHtml) {
        const resourcesDiskPath = vscode.Uri.file(
            path.join(extContext.extensionPath, 'resources')
        );
        const resourcesPath = viewPanel.webview.asWebviewUri(resourcesDiskPath);
        viewHtml = viewHtmlTemplate
            .replace(/\${cspSource}/g, viewPanel.webview.cspSource)
            .replace(/\${resourcesPath}/g, String(resourcesPath));
    }
    viewPanel.webview.html = viewHtml;
}

function revealFile(filePath: string, viewColumn: vscode.ViewColumn, line: number, character: number) {
    const location = new vscode.Position(line, character);
    const showOpts: vscode.TextDocumentShowOptions = {
        selection: new vscode.Range(location, location),
        viewColumn: viewColumn
    };
    vscode.workspace.openTextDocument(filePath)
        .then(doc => vscode.window.showTextDocument(doc, showOpts));
}

async function createDocument(text: string) {
    const doc = await vscode.workspace.openTextDocument();
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const zero = new vscode.Position(0, 0);
    await editor.edit((edit) => edit.insert(zero, text));
    editor.selection = new vscode.Selection(zero, zero);
    editor.revealRange(new vscode.Range(zero, zero), vscode.TextEditorRevealType.AtTop);
}
