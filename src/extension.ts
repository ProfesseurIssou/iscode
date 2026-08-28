/* eslint-disable @typescript-eslint/naming-convention */
// https://www.youtube.com/watch?v=a5DX5pQ9p5M
// https://code.visualstudio.com/api/references/vscode-api
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as language from './language';
import * as parser from './parser';
import * as passes from './passes';
import * as render from './render';

/*Nom de fichier seul, séparateur Windows ou Linux accepté*/
function fileNameOf(fullPath: string): string {
    const parts = fullPath.split(/[\\/]/);
    return parts[parts.length - 1];
}

/*Extension du fichier (le niveau de langage ISCode : isc0, isc1...).*/
function fileExtensionOf(fullPath: string): string {
    const fileName = fileNameOf(fullPath);
    const parts = fileName.split(".");
    return parts[parts.length - 1];
}

//Lors de l'activation de l'extension
export function activate(context: vscode.ExtensionContext) {
	console.log('The rising of ISCode');

	/*CONTEXT MENU COMMAND*/
	context.subscriptions.push(
		vscode.commands.registerCommand('iscode.translate',()=>{
			TranslateCode(context);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('iscode.openFolder',()=>{
			vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path.join(context.extensionPath,"convert")),true);
		})
	);
	/*####################*/

	/*STATUS BAR BUTTON*/
	let translateButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	translateButton.command = "iscode.translate";
	translateButton.text = "ISCode : Translate";
	translateButton.tooltip = "Translate ISCode";
	translateButton.show();
	context.subscriptions.push(translateButton);
	/*#################*/

    /*AUTO COMPLETE*/
    const completionProvider = vscode.languages.registerCompletionItemProvider("*",{
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, completionContext: vscode.CompletionContext) {
            let languageJson;
            try{
                languageJson = language.loadGrammar(context.extensionPath, fileExtensionOf(document.fileName));
            }catch(error){
                return [];
            }

            let completionList = [];
            for(let instructionName in languageJson.instructions){
                const instruction = languageJson.instructions[instructionName];
                if(instruction.snippet){                                             //Si l'instruction a un snippets
                    let completion = new vscode.CompletionItem(instructionName);
                    completion.insertText = new vscode.SnippetString(instruction.snippet.output);
                    if(instruction.snippet.documentation)completion.documentation = new vscode.MarkdownString(instruction.snippet.documentation);
                    if(instruction.snippet.commitChars)completion.commitCharacters = instruction.snippet.commitChars;
                    completionList.push(completion);
                }
            }

			return completionList;
		}
    });
    context.subscriptions.push(completionProvider);
    /*#############*/
}

/*Pipeline complet de traduction :
  source -> grammaire versionnée -> AST -> passes -> rendu par zones -> fichier de sortie + source map*/
const TranslateCode = async (context: vscode.ExtensionContext)=>{
	const srcFile = vscode.window.activeTextEditor;
	if(!srcFile){
		vscode.window.showInformationMessage("No selected file");
		return;
	}

	const srcFilePathTotal = srcFile.document.fileName;
	const srcFileName = fileNameOf(srcFilePathTotal);
	const srcFilePath = srcFilePathTotal.substring(0, srcFilePathTotal.length - srcFileName.length);

	console.log("Input file : "+srcFileName);

	let content : string;
	try{
		content = fs.readFileSync(srcFilePathTotal,{encoding:'utf8', flag:'r'});
	}catch(error){
		console.error(error);
		vscode.window.showErrorMessage("File not readable");
		return;
	}

	let resolved;
	try{
		resolved = language.resolveForFile(context.extensionPath,srcFileName,content);
	}catch(error){
		console.error(error);
		vscode.window.showErrorMessage("File not compatible");
		return;
	}

	const availableOutput = Object.keys(resolved.grammar.availableTranslation);
	const selectedOutput = await vscode.window.showQuickPick(availableOutput);
	if(!selectedOutput){
		vscode.window.showErrorMessage("No output format selected");
		return;
	}
	const targetDef = resolved.grammar.availableTranslation[selectedOutput];

	try{
		console.log(resolved.grammar.name+" v"+resolved.grammar.version+" => "+selectedOutput);

		/*PARSE -> PASSES -> RENDU*/
		const parsed = parser.parse(content,resolved.grammar,srcFileName);
		const nodes = passes.run(resolved.grammar,parsed.nodes);

		let outputGrammar = resolved.grammar;
		if(targetDef.grammar)outputGrammar = language.loadGrammar(context.extensionPath,targetDef.grammar);          //Rendu avec la grammaire du niveau cible (ex: isc1 rendu avec isc0)

		const result = render.render(nodes,outputGrammar,targetDef.target || selectedOutput,{emitHeader:targetDef.emitHeader});

		const outputFileName = srcFileName.split(".")[0]+"."+targetDef.extension;
		fs.writeFileSync(path.join(srcFilePath,outputFileName),result.text);
		fs.writeFileSync(path.join(srcFilePath,outputFileName+".map"),JSON.stringify(result.map,null,"    "));

		if(resolved.warning)vscode.window.showWarningMessage(resolved.warning);
		if(parsed.errors.length > 0){
			const errorLines = parsed.errors.map((error)=>String(error.line)).join(", ");
			vscode.window.showWarningMessage("Instructions non reconnues, lignes "+errorLines+" (ignorées dans la sortie)");
		}else{
			vscode.window.showInformationMessage("Done");
		}
	}catch(error){
		console.error(error);
		vscode.window.showErrorMessage(String(error));
	}
};


//Quand l'extension est désactivé
export function deactivate() {}
