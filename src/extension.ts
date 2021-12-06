/* eslint-disable @typescript-eslint/naming-convention */
// https://www.youtube.com/watch?v=a5DX5pQ9p5M
// https://code.visualstudio.com/api/references/vscode-api
import * as vscode from 'vscode';

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
			let success = vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(context.extensionPath+"/src/convert"),true);

		})
	);
	/*####################*/

	/*STATUS BAR BUTTON*/
	let translateButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	translateButton.command = "iscode.translate";
	translateButton.text = "Translate";
	translateButton.tooltip = "Translate ISCode";
	translateButton.show();

	context.subscriptions.push();
	/*#################*/


	
	// context.subscriptions.push(
	// 	vscode.workspace.onDidSaveTextDocument((e)=>{
	// 		TranslateCode(context);
	// 	})
	// );

	//////////////Afficher la liste des translations possible depuis le fichier actuel
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
			let jsonFileStr:string = convertFile.readFileSync(context.extensionPath+"/src/convert/"+currentCodeLevel+".json",{encoding:'utf8', flag:'r'});
			const convertJson = JSON.parse(jsonFileStr);	

			try{
				let outputCodeLevel:string = "";
				let availableOutput = Object.keys(convertJson["translation"]);
				const selectedOutput = String(await vscode.window.showQuickPick(availableOutput));
				console.log(currentCodeLevel+" => "+convertJson["translation"][selectedOutput]["outputExtension"]);
				/*CONVERT*/
				ConvertISCode(srcFilePath,srcFileName,convertJson["translation"][selectedOutput]);
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

function ConvertISCode(filePath:string,fileName:string,jsonOutputExtention:any){
	let outputCode = "";

	const inputFile = require("fs");
	let data = inputFile.readFileSync(filePath+fileName,{encoding:'utf8', flag:'r'});

	const inputLines = data.toString().replace(/\r\n/g,'\n').split('\n');
	inputLines.forEach((inputLine:string, lineIndex:number) => {
		let instructionFind = false;
		Object.keys(jsonOutputExtention["table"]).forEach(function(key){
			let expr = new RegExp(jsonOutputExtention["table"][key][0]);
			let outputPatern = jsonOutputExtention["table"][key][1];
			let match = expr.exec(inputLine);
			if(match){
				instructionFind = true;
				outputCode += outputPatern.replace("%1",match[1]).replace("%2",match[2]).replace("%3",match[3])+"\n";
			}
		});
		// if(!instructionFind){return new Error("Instruction not found line "+String(lineIndex));};
		// if(!instructionFind){vscode.window.showErrorMessage("Instruction not found line "+String(lineIndex+1));return;};
		if(!instructionFind){vscode.window.showErrorMessage("Instruction not found line "+String(lineIndex+1));return;};
		console.log(inputLine);
	});
	
	const outputFile = require("fs");
	outputFile.writeFileSync(filePath+fileName.split(".")[0]+"."+jsonOutputExtention["outputExtension"],outputCode,function(err:any){
		if(err){
			return console.log("error");
		}
	});
	vscode.window.showInformationMessage("Done");
}


//Quand l'extension est désactivé
export function deactivate() {}
