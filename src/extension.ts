/* eslint-disable @typescript-eslint/naming-convention */
// https://www.youtube.com/watch?v=a5DX5pQ9p5M
// https://code.visualstudio.com/api/references/vscode-api
import * as vscode from 'vscode';

export interface AvailableTranslation{
    [key:string]:string
}
export interface Snippet{
    output:string,
    documentation:string,
    commitChars:Array<string>
}
export interface Token{
    [key:string]:string
}
export interface Instruction{
    syntax:Array<string>,
    snippet:Snippet,
    translation:AvailableTranslation
}
export interface Instructions{
    [key:string]:Instruction
}
export interface LanguageJson{
    name: string,
    availableTranslation: AvailableTranslation,
    tokens: Token,
    instructions:Instructions
}

//Lors de l'activation de l'extension
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iscode" is now active!');

	/*CONTEXT MENU COMMAND*/
	context.subscriptions.push(
		vscode.commands.registerCommand('iscode.translate',()=>{
			// vscode.window.setStatusBarMessage("test",5000);
			TranslateCode(context);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('iscode.openFolder',()=>{
			// vscode.commands.executeCommand("revealFileInOS",context.extensionPath);
			let success = vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(context.extensionPath+"/convert"),true);

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
            const srcFileName = document.fileName.split("\\")[document.fileName.split("\\").length-1];
		    const currentCodeLevel = srcFileName.split(".")[srcFileName.split(".").length-1];
            
            const convertFile = require("fs");
			let jsonFileStr:string = convertFile.readFileSync(context.extensionPath+"/convert/"+currentCodeLevel+".json",{encoding:'utf8', flag:'r'});
			const languageJson:LanguageJson = JSON.parse(jsonFileStr);

            let completionList = [];
            for(let instructionName in languageJson.instructions){
                if(languageJson.instructions[instructionName].snippet){                                             //Si l'instruction a un snippets
                    let completion = new vscode.CompletionItem(instructionName);
                    completion.insertText = new vscode.SnippetString(languageJson.instructions[instructionName].snippet.output);
                    if(languageJson.instructions[instructionName].snippet.documentation)completion.documentation = new vscode.MarkdownString(languageJson.instructions[instructionName].snippet.documentation);
                    if(languageJson.instructions[instructionName].snippet.commitChars)completion.commitCharacters = languageJson.instructions[instructionName].snippet.commitChars;
                    completionList.push(completion);
                }
            }

			return completionList;
		}
    });
    context.subscriptions.push(completionProvider);
    /*#############*/
}

const TranslateCode = async (context: vscode.ExtensionContext)=>{
	const srcFile = vscode.window.activeTextEditor;
	if(srcFile){
		const srcFilePathTotal = srcFile.document.fileName;
		const srcFileName = srcFilePathTotal.split("\\")[srcFilePathTotal.split("\\").length-1];
		const srcFilePath = srcFilePathTotal.replace(srcFileName,"");
		const currentCodeLevel = srcFileName.split(".")[srcFileName.split(".").length-1];

		console.log("Input file : "+srcFileName);

		try{
			const convertFile = require("fs");
			let jsonFileStr:string = convertFile.readFileSync(context.extensionPath+"/convert/"+currentCodeLevel+".json",{encoding:'utf8', flag:'r'});
			const languageJson:LanguageJson = JSON.parse(jsonFileStr);	

			try{
				let outputCodeLevel:string = "";
                let availableOutput = [];
                for(let translationName in languageJson.availableTranslation){
                    availableOutput.push(translationName);
                }
				const selectedOutput:string = String(await vscode.window.showQuickPick(availableOutput));

				console.log(currentCodeLevel+" => "+languageJson.availableTranslation[selectedOutput]);
				/*CONVERT*/
				ConvertISCode(srcFilePath,srcFileName,languageJson,selectedOutput);
				/*#######*/				
			}catch(error){
				console.error(error);
				// vscode.window.showErrorMessage(String(error));
				vscode.window.showErrorMessage("No output format selected");
			}

		}catch(error){
			console.error(error);
			// vscode.window.showErrorMessage(String(error));
			vscode.window.showErrorMessage("File not compatible");
		}		
	}else{
		vscode.window.showInformationMessage("No selected file");
	}
};

function ConvertISCode(filePath:string,fileName:string,languageJson:LanguageJson,targetLanguage:string){
	let outputCode = "";                                                                                //Code de sortie

	const inputFile = require("fs");                                                                    //Lecture du fichier
	let data = inputFile.readFileSync(filePath+fileName,{encoding:'utf8', flag:'r'});                   //Lecture du fichier d'entrée

	const inputLines = data.toString().replace(/\r\n/g,'\n').split('\n');                               //On separe chaque ligne
	inputLines.forEach((inputLine:string,lineIndex:number)=>{                                           //Pour chaque ligne
		let instructionFind = false;                                                                        //Si on trouve l'instruction
		Object.keys(languageJson.instructions).forEach(function(key){                                       //Pour chaque instruction du language
            let regex:string = "";                                                                              //Expression final de l'instruction
            for(let i in languageJson.instructions[key].syntax)regex+="("+languageJson.tokens[languageJson.instructions[key].syntax[i]]+")";//Pour chaque partie de la syntax => on ajoute la partie regex du token au regex final

			let expr = new RegExp(regex);                                                                       //On créé l'expression regex
			let outputPatern = languageJson.instructions[key].translation[targetLanguage];                      //On recupere le patern du langage cible
			let match = expr.exec(inputLine);                                                                   //On applique l'expression regex
			if(match){                                                                                          //Si on a trouvé
				instructionFind = true;                                                                             //On definie comme quoi la ligne a était identifier
				for(let i=1;i<match.length;i++){                                                                    //Pour chaque partie trouvé (sans compter le premier)
                    outputPatern = outputPatern.replace("%"+String(i),match[i]);                                        //On remplace la partie
                }
                outputCode += outputPatern+"\n";                                                                    //On ajoute l'instruction dans le code finale
                //Aller a la ligne suivante
            }
		});
		// if(!instructionFind){return new Error("Instruction not found line "+String(lineIndex));};
		// if(!instructionFind){vscode.window.showErrorMessage("Instruction not found line "+String(lineIndex+1));return;};
		if(!instructionFind){vscode.window.showErrorMessage("Instruction not found line "+String(lineIndex+1));return;};
		console.log(inputLine);
	});
	
	const outputFile = require("fs");
	outputFile.writeFileSync(filePath+fileName.split(".")[0]+"."+languageJson.availableTranslation[targetLanguage],outputCode,function(err:any){
		if(err){
			return console.log("error");
		}
	});
	vscode.window.showInformationMessage("Done");
}


//Quand l'extension est désactivé
export function deactivate() {}
