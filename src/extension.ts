/* eslint-disable @typescript-eslint/naming-convention */
// https://www.youtube.com/watch?v=a5DX5pQ9p5M
// https://code.visualstudio.com/api/references/vscode-api
import * as vscode from 'vscode';

//Lors de l'activation de l'extension
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "iscode" is now active!');

	context.subscriptions.push(
		vscode.commands.registerCommand('iscode.translate',()=>{
			// vscode.window.setStatusBarMessage("test",5000);
			TranslateCode();
		})
	);

	
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((e)=>{
			TranslateCode();
		})
	);
}

function TranslateCode(){
	const srcFile = vscode.window.activeTextEditor;
	if(srcFile){
		const srcFilePathTotal = srcFile.document.fileName;
		const srcFileName = srcFilePathTotal.split("\\")[srcFilePathTotal.split("\\").length-1];
		const srcFilePath = srcFilePathTotal.replace(srcFileName,"");
		const currentCodeLevel = srcFileName.split(".")[srcFileName.split(".").length-1].replace("_","");

		if(currentCodeLevel === 'isc0'){
			vscode.window.showInformationMessage(currentCodeLevel+" => NASM");
			ConvertISC0(srcFilePath,srcFileName);
		}else{
			vscode.window.showInformationMessage("File not compatible");
		}
		
	}else{
		vscode.window.showInformationMessage("No selected file");
	}
}

function ConvertISC0(filePath:String,fileName:string){
	const convertTableISC0 = require("../src/convert/isc0.json");
	let outputCode = "";

	const inputFile = require('fs');
	inputFile.readFile(filePath+fileName,function(err:any,data:any){
		if(err){throw err;};
		const inputLines = data.toString().replace(/\r\n/g,'\n').split('\n');
		inputLines.forEach((inputLine:string, lineIndex:number) => {
			let instructionFind = false;
			Object.keys(convertTableISC0).forEach(function(key){
				let expr = new RegExp(convertTableISC0[key][0]);
				let outputPatern = convertTableISC0[key][1];
				let match = expr.exec(inputLine);
				if(match){
					instructionFind = true;
					outputCode += outputPatern.replace("%1",match[1]).replace("%2",match[2]).replace("%3",match[3])+"\n";
				}
			});
			// if(!instructionFind){return new Error("Instruction not found line "+String(lineIndex));};
			// if(!instructionFind){vscode.window.showErrorMessage("Instruction not found line "+String(lineIndex+1));return;};
			if(!instructionFind){vscode.window.showInformationMessage("Instruction not found line "+String(lineIndex+1));return;};
			console.log(inputLine);
		});
		const outputFile = require("fs");
		outputFile.writeFileSync(filePath+fileName.split(".")[0]+".nasm",outputCode,function(err:any){
			if(err){
				return console.log("error");
			}
		});
	});

}



//Quand l'extension est désactivé
export function deactivate() {}
